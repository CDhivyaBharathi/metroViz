import json
import random
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import create_app
from metro import routing
from metro.loader import DEFAULT_PATH

MINI = Path(__file__).parent / "fixtures" / "mini.json"
NO_DIST = Path("/nonexistent")


@pytest.fixture
def client():
    with TestClient(create_app(MINI, NO_DIST)) as c:
        yield c


@pytest.fixture(scope="module")
def real():
    with TestClient(create_app(DEFAULT_PATH, NO_DIST)) as c:
        yield c


def error(res):
    return res.status_code, res.json()["error"]["code"]


# --- /api/network -------------------------------------------------------------------------

def test_network_shape(client):
    net = client.get("/api/network").json()
    assert set(net) == {"lines", "stations", "edges"}
    assert [l["id"] for l in net["lines"]] == ["RED", "BLUE", "YELLOW", "GREEN"]
    assert len(net["stations"]) == 9 and len(net["edges"]) == 8
    a = next(s for s in net["stations"] if s["id"] == "a")
    assert a == {"id": "a", "name": "Alpha", "code": "ALP", "lines": ["RED", "YELLOW"], "is_interchange": True,
                 "x": a["x"], "y": a["y"]}                               # no exits key when the data has none
    assert net["edges"][0] == {"a": "a", "b": "b", "line": "RED", "minutes": 2}


def test_network_real_has_exits_and_time_source(real):
    net = real.get("/api/network").json()
    aiims = next(s for s in net["stations"] if s["id"] == "a-i-i-m-s")
    assert aiims["exits"][0] == {"gate": "Gate No. 1", "location": "AIIMS HOSPITAL/KIDWAI NAGAR"}
    assert {e["time_source"] for e in net["edges"]} == {"gtfs", "estimate"}
    assert all(0 <= s["x"] <= 1000 and 0 <= s["y"] <= 1000 for s in net["stations"])


# --- /api/search ----------------------------------------------------------------------------

def test_search_results(client):
    assert client.get("/api/search", params={"q": "alp"}).json() == {
        "results": [{"id": "a", "name": "Alpha", "code": "ALP", "lines": ["RED", "YELLOW"]}]}


def test_search_typo_gets_suggestion(client):
    assert client.get("/api/search", params={"q": "Alpah"}).json() == {
        "results": [], "suggestion": {"id": "a", "name": "Alpha"}}


@pytest.mark.parametrize("params", [{}, {"q": ""}, {"q": "   "}, {"q": "qzxjv"}])
def test_search_nothing(client, params):
    assert client.get("/api/search", params=params).json() == {"results": []}


# --- /api/route happy path ---------------------------------------------------------------------

def test_route_contract_shape(client):
    j = client.get("/api/route", params={"src": "a", "dst": "d"}).json()
    assert j == {
        "source": {"id": "a", "name": "Alpha"}, "destination": {"id": "d", "name": "Delta"},
        "total_minutes": 4.5, "interchanges": 1, "lines": ["YELLOW", "RED"], "station_ids": ["a", "g", "c", "d"],
        "legs": [
            {"line": "YELLOW", "from": {"id": "a", "name": "Alpha"}, "to": {"id": "c", "name": "Charlie"},
             "stops": 2, "minutes": 2.5, "station_ids": ["a", "g", "c"]},
            {"line": "RED", "from": {"id": "c", "name": "Charlie"}, "to": {"id": "d", "name": "Delta"},
             "stops": 1, "minutes": 2, "station_ids": ["c", "d"]},
        ]}
    assert j["interchanges"] == len(j["legs"]) - 1


def test_route_ignores_extra_params(client):
    assert client.get("/api/route", params={"src": "a", "dst": "b", "mode": "x"}).status_code == 200


# --- /api/route errors: decision table (test-plan §7) ----------------------------------------

@pytest.mark.parametrize("params, status, code", [
    ({}, 400, "missing_param"),
    ({"src": "a"}, 400, "missing_param"),
    ({"dst": "a"}, 400, "missing_param"),
    ({"src": "", "dst": "a"}, 400, "missing_param"),
    ({"src": "zz", "dst": "a"}, 404, "unknown_station"),
    ({"src": "a", "dst": "zz"}, 404, "unknown_station"),
    ({"src": "a", "dst": "a"}, 400, "same_station"),
    ({"src": "a", "dst": "h"}, 404, "no_route"),
])
def test_route_errors(client, params, status, code):
    res = client.get("/api/route", params=params)
    assert error(res) == (status, code)
    assert set(res.json()["error"]) <= {"code", "message", "suggestion"}


def test_no_route_message_names_stations(client):   # ER5, D3 wording
    assert client.get("/api/route", params={"src": "a", "dst": "h"}).json()["error"]["message"] == \
        "No route between Alpha and Hotel"


def test_unknown_station_suggests_closest(client):
    body = client.get("/api/route", params={"src": "alpah", "dst": "b"}).json()["error"]
    assert body["suggestion"] == {"id": "a", "name": "Alpha"}


@pytest.mark.parametrize("bad", ["'; DROP TABLE stations; --", "<script>alert(1)</script>", "x" * 5000, "%00", "../.."])
def test_injection_like_input_is_a_clean_404(client, bad):
    res = client.get("/api/route", params={"src": bad, "dst": "a"})
    assert error(res) == (404, "unknown_station")
    assert res.headers["content-type"].startswith("application/json")


# --- startup with broken data (ER1) ------------------------------------------------------------

def test_corrupt_data_gives_503_not_crash(tmp_path):
    bad = tmp_path / "metro.json"
    bad.write_text('{"lines": [')
    with TestClient(create_app(bad, NO_DIST)) as c:
        for url in ("/api/network", "/api/search?q=a", "/api/route?src=a&dst=b"):
            assert error(c.get(url)) == (503, "data_unavailable")


def test_missing_data_file_gives_503(tmp_path):
    with TestClient(create_app(tmp_path / "nope.json", NO_DIST)) as c:
        assert error(c.get("/api/network")) == (503, "data_unavailable")


# --- contract: route <-> network stay in sync (A1 Q6) ---------------------------------------------

def test_route_ids_and_lines_exist_in_network(real):
    net = real.get("/api/network").json()
    ids = {s["id"] for s in net["stations"]}
    lines = {l["id"] for l in net["lines"]}
    rng = random.Random(3810)
    for _ in range(30):
        src, dst = rng.sample(sorted(ids), 2)
        j = real.get("/api/route", params={"src": src, "dst": dst}).json()
        assert set(j["station_ids"]) <= ids and set(j["lines"]) <= lines
        assert all(set(leg["station_ids"]) <= ids for leg in j["legs"])
        assert j["station_ids"] == [j["legs"][0]["station_ids"][0]] + [s for leg in j["legs"] for s in leg["station_ids"][1:]]


# --- HTTP semantics (test-plan T-8) ------------------------------------------------------------------

def test_post_is_not_allowed(client):
    assert error(client.post("/api/route", params={"src": "a", "dst": "b"})) == (405, "http_error")


def test_unknown_path_is_json_404(client):
    assert error(client.get("/api/nope")) == (404, "http_error")
    assert error(client.get("/")) == (404, "http_error")   # no frontend build mounted


def test_get_is_idempotent_and_json(client):
    r1, r2 = (client.get("/api/route", params={"src": "a", "dst": "d"}) for _ in range(2))
    assert r1.json() == r2.json()
    assert r1.headers["content-type"].startswith("application/json")


def test_unexpected_error_is_generic_500(monkeypatch):
    monkeypatch.setattr(routing, "find_route", lambda *a: 1 / 0)
    with TestClient(create_app(MINI, NO_DIST), raise_server_exceptions=False) as c:
        res = c.get("/api/route", params={"src": "a", "dst": "b"})
    assert error(res) == (500, "internal")
    assert "Traceback" not in res.text and "ZeroDivision" not in res.text


def test_serves_frontend_build_when_present(tmp_path):
    (tmp_path / "index.html").write_text("<h1>metro</h1>")
    with TestClient(create_app(MINI, tmp_path)) as c:
        assert c.get("/").text == "<h1>metro</h1>"
        assert c.get("/api/network").status_code == 200   # API still wins over the static mount


# --- concurrency: read-only shared state (test-plan T-8) --------------------------------------------

def test_parallel_requests_match_serial(real):
    ids = [s["id"] for s in real.get("/api/network").json()["stations"]]
    pairs = [tuple(random.Random(i).sample(ids, 2)) for i in range(20)]
    serial = [real.get("/api/route", params={"src": a, "dst": b}).json() for a, b in pairs]
    with ThreadPoolExecutor(max_workers=20) as pool:
        parallel = list(pool.map(lambda p: real.get("/api/route", params={"src": p[0], "dst": p[1]}).json(), pairs))
    assert parallel == serial


# --- extensibility (FR10, C7): new data, zero code change ---------------------------------------------

def test_new_station_in_json_appears_everywhere(tmp_path):
    data = json.loads(DEFAULT_PATH.read_text())
    data["lines"].append({"id": "TEST", "name": "Test Line", "color": "#000000"})
    data["stations"].append({"id": "zz-test-halt", "name": "Zz Test Halt", "code": "ZZT", "lat": 28.7, "lon": 77.3,
                             "lines": ["TEST"]})
    rithala = next(s for s in data["stations"] if s["id"] == "rithala")
    rithala["lines"].append("TEST")
    data["edges"].append({"a": "rithala", "b": "zz-test-halt", "line": "TEST", "minutes": 3})
    path = tmp_path / "metro.json"
    path.write_text(json.dumps(data))
    with TestClient(create_app(path, NO_DIST)) as c:
        assert any(s["id"] == "zz-test-halt" for s in c.get("/api/network").json()["stations"])
        assert c.get("/api/search", params={"q": "zz test"}).json()["results"][0]["id"] == "zz-test-halt"
        j = c.get("/api/route", params={"src": "zz-test-halt", "dst": "rohini-west"}).json()
        assert j["lines"][0] == "TEST" and j["legs"][0]["minutes"] == 3


# --- performance (C7) ------------------------------------------------------------------------------------

def test_route_p95_under_100ms(real):
    ids = [s["id"] for s in real.get("/api/network").json()["stations"]]
    rng = random.Random(3810)
    times = []
    for _ in range(50):
        a, b = rng.sample(ids, 2)
        t = time.perf_counter()
        real.get("/api/route", params={"src": a, "dst": b})
        times.append(time.perf_counter() - t)
    assert statistics.quantiles(times, n=20)[18] < 0.1   # p95
