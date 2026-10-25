"""HTTP layer (PLAN.md C5). Loads and validates the data once at startup; every endpoint reads that state.

Run: `uvicorn api:app` from backend/. If frontend/dist exists it is served at /, so one process serves everything.
"""
import logging
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from metro import routing, search
from metro.graph import build_graph
from metro.loader import DEFAULT_PATH, DataError, load
from metro.model import stations_from

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
log = logging.getLogger("metro")


class ApiError(Exception):
    """Becomes `{error: {code, message, suggestion?}}` with the given status (API contract in PLAN.md)."""

    def __init__(self, status, code, message, suggestion=None):
        super().__init__(message)
        self.status, self.code, self.message, self.suggestion = status, code, message, suggestion


def create_app(data_path=DEFAULT_PATH, dist=FRONTEND_DIST):
    app = FastAPI(title="Delhi Metro Route Planner")
    # Loaded here, not in a lifespan hook: serverless hosts (Vercel) may skip ASGI startup events,
    # and the data is read once per process either way.
    try:
        app.state.net = _network(load(data_path))
    except DataError as e:
        log.error("%s", e)  # details go to the log, never to the client (ER1)
        app.state.net = None

    def net(request):
        if request.app.state.net is None:
            raise ApiError(503, "data_unavailable", "Data couldn't be loaded")
        return request.app.state.net

    @app.get("/api/network")
    def network(request: Request):
        return net(request).payload

    @app.get("/api/search")
    def search_stations(request: Request, q: str = ""):
        stations = net(request).stations
        results = search.search(stations, q)
        suggestion = None if results else search.suggest_closest(stations, q)
        return {"results": results, **({"suggestion": suggestion} if suggestion else {})}

    @app.get("/api/route")
    def route(request: Request, src: str = "", dst: str = ""):
        n = net(request)
        for name, value in (("src", src), ("dst", dst)):
            if not value:
                raise ApiError(400, "missing_param", f"Missing query parameter '{name}'")
        try:
            journey = routing.find_route(n.graph, src, dst)
        except routing.UnknownStation as e:
            raise ApiError(404, "unknown_station", f"Unknown station '{e.station_id}'",
                           search.suggest_closest(n.stations, e.station_id)) from None
        except routing.SameStation:
            raise ApiError(400, "same_station", "Source and destination are the same station") from None
        except routing.NoRoute as e:
            raise ApiError(404, "no_route",
                           f"No route between {n.stations[e.src].name} and {n.stations[e.dst].name}") from None
        return _journey_json(journey, n.stations)

    @app.exception_handler(ApiError)
    async def api_error(_, e):
        body = {"code": e.code, "message": e.message, **({"suggestion": e.suggestion} if e.suggestion else {})}
        return JSONResponse({"error": body}, e.status)

    @app.exception_handler(HTTPException)   # unknown path (404), wrong method (405): same body shape as ours
    async def http_error(_, e):
        return JSONResponse({"error": {"code": "http_error", "message": str(e.detail)}}, e.status_code)

    @app.exception_handler(Exception)       # never leak a stack trace
    async def unexpected(_, e):
        log.exception("unhandled error")
        return JSONResponse({"error": {"code": "internal", "message": "Something went wrong"}}, 500)

    if Path(dist).is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")   # after /api, so /api wins
    return app


def _network(data):
    stations = stations_from(data)
    payload = {
        "lines": data["lines"],
        "stations": [{"id": s.id, "name": s.name, "code": s.code, "lines": list(s.lines),
                      "is_interchange": s.is_interchange, "x": s.x, "y": s.y,
                      **({"exits": list(s.exits)} if s.exits else {})} for s in stations.values()],
        "edges": [{k: e[k] for k in ("a", "b", "line", "minutes", "time_source") if k in e} for e in data["edges"]],
    }
    return SimpleNamespace(stations=stations, graph=build_graph(data), payload=payload)


def _journey_json(j, stations):
    def ref(sid):
        return {"id": sid, "name": stations[sid].name}

    return {"source": ref(j.source), "destination": ref(j.destination), "total_minutes": j.total_minutes,
            "interchanges": j.interchanges, "lines": j.lines, "station_ids": list(j.station_ids),
            "legs": [{"line": leg.line, "from": ref(leg.station_ids[0]), "to": ref(leg.station_ids[-1]),
                      "stops": leg.stops, "minutes": leg.minutes, "station_ids": list(leg.station_ids)}
                     for leg in j.legs]}


app = create_app()
