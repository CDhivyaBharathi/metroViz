"""Data/model layer (A2 §4): Station objects with map coordinates (PLAN.md C2, D5).

Journey and Leg are what routing returns (PLAN.md C3).
"""
import math
from dataclasses import dataclass

MAP_SIZE = 1000  # SVG units across the longer side of the network (D5)


@dataclass(frozen=True)
class Station:
    id: str
    name: str
    code: str
    lat: float
    lon: float
    lines: tuple
    is_interchange: bool
    x: float  # SVG coordinates: x grows east, y grows south
    y: float
    exits: tuple = ()


def stations_from(data):
    """Map station id -> Station for a loaded network (loader.load output)."""
    xy = project(data["stations"])
    return {s["id"]: Station(s["id"], s["name"], s["code"], s["lat"], s["lon"], tuple(s["lines"]),
                             s["is_interchange"], *xy[s["id"]], tuple(s.get("exits", ())))
            for s in data["stations"]}


def projector(stations):
    """Return to_xy(lat, lon) -> (x, y): equirectangular projection to SVG units, north up, same scale on both axes.

    The network's bounding box maps onto 0..MAP_SIZE along its longer side. Anything else drawn on the map
    (the OpenStreetMap tiles behind it, see data/build_basemap.py) goes through the same function.
    ponytail: flat-earth approximation; fine over Delhi's ~50 km, wrong for a country-sized map.
    """
    lats = [s["lat"] for s in stations]
    lons = [s["lon"] for s in stations]
    k = math.cos(math.radians((min(lats) + max(lats)) / 2))  # a degree of lon is shorter than one of lat
    span = max((max(lons) - min(lons)) * k, max(lats) - min(lats)) or 1  # one station: avoid / 0
    scale = MAP_SIZE / span
    return lambda lat, lon: (round((lon - min(lons)) * k * scale, 1), round((max(lats) - lat) * scale, 1))


def project(stations):
    """Map station id -> (x, y) in SVG units (D5)."""
    to_xy = projector(stations)
    return {s["id"]: to_xy(s["lat"], s["lon"]) for s in stations}


@dataclass(frozen=True)
class Leg:
    """A ride on one line without changing: board at station_ids[0], get off at station_ids[-1]."""
    line: str
    station_ids: tuple
    minutes: float

    @property
    def stops(self):
        return len(self.station_ids) - 1


@dataclass(frozen=True)
class Journey:
    """A computed route (A2 §3). Everything else is derived from the legs, so it can't disagree with them."""
    legs: tuple

    @property
    def source(self):
        return self.legs[0].station_ids[0]

    @property
    def destination(self):
        return self.legs[-1].station_ids[-1]

    @property
    def station_ids(self):  # what the map highlights (FR7)
        return (self.source, *(s for leg in self.legs for s in leg.station_ids[1:]))

    @property
    def total_minutes(self):
        return sum(leg.minutes for leg in self.legs)

    @property
    def interchanges(self):
        return len(self.legs) - 1

    @property
    def lines(self):
        return [leg.line for leg in self.legs]
