"""Fetch the OpenStreetMap tiles behind the network and place them in station coordinates (run once, offline).

Writes frontend/public/tiles/<z>_<x>_<y>.png and frontend/src/basemap.json, a list of {src, x, y, w, h} in the same
SVG units as the stations (metro.model.projector), so the frontend draws them as plain <image>s and never sees a
latitude. Rerun after the station set changes. Tiles © OpenStreetMap contributors (ODbL); attribution is shown on the map.

    backend/.venv/bin/python backend/data/build_basemap.py [--zoom 12]
"""
import argparse
import json
import math
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metro.loader import DEFAULT_PATH, load
from metro.model import projector

ROOT = Path(__file__).resolve().parents[2]
TILE_DIR = ROOT / "frontend" / "public" / "tiles"
OUT = ROOT / "frontend" / "src" / "basemap.json"
URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
UA = "DelhiMetroRoutePlanner/1.0 (CS-3810 student project, Ashoka University)"  # OSM tile policy: identify yourself
MARGIN = 1  # tiles around the station bounding box (one z12 tile ≈ 9 km, more than the 40-unit map padding)


def tile_of(lat, lon, z):
    """Slippy-map tile indices containing (lat, lon)."""
    n = 2**z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def tile_bounds(x, y, z):
    """(north lat, west lon, south lat, east lon) of a tile."""
    n = 2**z
    lat = lambda yy: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / n))))
    return lat(y), x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180


def main(zoom):
    stations = load(DEFAULT_PATH)["stations"]
    to_xy = projector(stations)
    lats = [s["lat"] for s in stations]
    lons = [s["lon"] for s in stations]
    x0, y0 = tile_of(max(lats), min(lons), zoom)  # north-west corner
    x1, y1 = tile_of(min(lats), max(lons), zoom)  # south-east corner
    TILE_DIR.mkdir(parents=True, exist_ok=True)
    tiles = []
    for x in range(x0 - MARGIN, x1 + MARGIN + 1):
        for y in range(y0 - MARGIN, y1 + MARGIN + 1):
            name = f"{zoom}_{x}_{y}.png"
            path = TILE_DIR / name
            if not path.exists():
                req = urllib.request.Request(URL.format(z=zoom, x=x, y=y), headers={"User-Agent": UA})
                path.write_bytes(urllib.request.urlopen(req, timeout=30).read())
                time.sleep(0.2)  # be polite to the public tile servers
            north, west, south, east = tile_bounds(x, y, zoom)
            left, top = to_xy(north, west)
            right, bottom = to_xy(south, east)
            tiles.append({"src": f"/tiles/{name}", "x": left, "y": top, "w": round(right - left, 1), "h": round(bottom - top, 1)})
    OUT.write_text(json.dumps({"attribution": "© OpenStreetMap contributors", "zoom": zoom, "tiles": tiles}, indent=1) + "\n")
    print(f"{len(tiles)} tiles at z{zoom} -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--zoom", type=int, default=12)
    main(ap.parse_args().zoom)
