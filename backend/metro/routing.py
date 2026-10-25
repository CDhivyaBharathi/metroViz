"""Shortest route and its legs (PLAN.md C3, A2 Algorithms 1–2). Knows nothing about HTTP or the UI."""
import itertools

import networkx as nx

from metro.model import Journey, Leg


class RoutingError(Exception):
    pass


class UnknownStation(RoutingError):
    def __init__(self, station_id):
        self.station_id = station_id
        super().__init__(f"unknown station '{station_id}'")


class SameStation(RoutingError):
    def __init__(self, station_id):
        self.station_id = station_id
        super().__init__(f"source and destination are both '{station_id}'")


class NoRoute(RoutingError):
    def __init__(self, src, dst):
        self.src, self.dst = src, dst
        super().__init__(f"no route between '{src}' and '{dst}'")


def find_route(graph, src, dst):
    """Fastest Journey from src to dst by plain Dijkstra on edge minutes (D1: no interchange penalty)."""
    for station_id in (src, dst):
        if station_id not in graph:
            raise UnknownStation(station_id)
    if src == dst:
        raise SameStation(src)
    try:
        path = nx.dijkstra_path(graph, src, dst, weight="minutes")
    except nx.NetworkXNoPath:
        raise NoRoute(src, dst) from None
    return Journey(tuple(_legs(graph, path)))


def _legs(graph, path):
    """Split the path into legs: a new leg starts wherever the current line doesn't continue."""
    edges = [graph[a][b] for a, b in itertools.pairwise(path)]
    legs, line, ids, minutes = [], None, [path[0]], 0
    for i, edge in enumerate(edges):
        if line not in edge["lines"]:
            if line is not None:
                legs.append(Leg(line, tuple(ids), minutes))
                ids, minutes = [ids[-1]], 0
            following = edges[i + 1]["lines"] if i + 1 < len(edges) else set()
            line = _pick(edge["lines"], following)
        ids.append(path[i + 1])
        minutes += edge["minutes"]
    legs.append(Leg(line, tuple(ids), minutes))
    return legs


def _pick(lines, following):
    """On a shared track, board the line the next edge also runs on, so the leg doesn't split for nothing."""
    return min(lines & following or lines)
