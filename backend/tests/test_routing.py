import itertools
import random
import time
from pathlib import Path

import networkx as nx
import pytest

from metro.graph import build_graph
from metro.loader import DEFAULT_PATH, load
from metro.routing import NoRoute, RoutingError, SameStation, UnknownStation, find_route

MINI = Path(__file__).parent / "fixtures" / "mini.json"


@pytest.fixture
def mini():
    return load(MINI)


@pytest.fixture
def g(mini):
    return build_graph(mini)


@pytest.fixture(scope="module")
def real():
    data = load(DEFAULT_PATH)
    return data, build_graph(data), {s["name"]: s["id"] for s in data["stations"]}


def shape(j):
    return [(leg.line, "".join(leg.station_ids)) for leg in j.legs], j.total_minutes, j.interchanges


# --- hand-computed routes on the fixture (ECP + BVA, test-plan §5) --------------------

@pytest.mark.parametrize("src, dst, legs, minutes, changes", [
    ("a", "b", [("RED", "ab")], 2, 0),                           # adjacent: smallest valid route
    ("b", "d", [("RED", "bcd")], 4, 0),                          # same line through an interchange
    ("e", "f", [("BLUE", "ecf")], 6, 0),                         # passes a 3-line station, no change
    ("a", "c", [("YELLOW", "agc")], 2.5, 0),                     # faster path is the other line (RED is 4)
    ("a", "d", [("YELLOW", "agc"), ("RED", "cd")], 4.5, 1),      # faster even with a change
    ("b", "e", [("RED", "bc"), ("BLUE", "ce")], 5, 1),           # change at the destination's neighbour
    ("c", "d", [("RED", "cd")], 2, 0),                           # starts at an interchange
    ("d", "a", [("RED", "dc"), ("YELLOW", "cga")], 4.5, 1),      # reverse of a→d
])
def test_hand_routes(g, src, dst, legs, minutes, changes):
    assert shape(find_route(g, src, dst)) == (legs, minutes, changes)


def test_journey_fields(g):
    j = find_route(g, "a", "d")
    assert (j.source, j.destination, j.station_ids, j.lines) == ("a", "d", ("a", "g", "c", "d"), ["YELLOW", "RED"])
    assert [leg.stops for leg in j.legs] == [2, 1]


# --- two lines on one track (C2): no fake interchange --------------------------------

@pytest.fixture
def shared(mini):
    mini["edges"].append({"a": "c", "b": "d", "line": "YELLOW", "minutes": 2})  # ties RED on c–d
    mini["stations"][3]["lines"].append("YELLOW")
    return build_graph(mini)


@pytest.mark.parametrize("src, dst, line", [
    ("b", "d", "RED"),      # shared edge last: stay on the current line
    ("g", "d", "YELLOW"),
    ("d", "b", "RED"),      # shared edge first: board the line the next edge runs on
    ("d", "g", "YELLOW"),
])
def test_shared_track_stays_on_one_line(shared, src, dst, line):
    j = find_route(shared, src, dst)
    assert j.lines == [line] and j.interchanges == 0


def test_shared_track_alone_picks_deterministically(shared):
    assert find_route(shared, "c", "d").lines == ["RED"]   # first by name; same every run


def test_real_pink_through_anand_vihar_karkarduma(real):
    _, g, ids = real
    assert find_route(g, ids["IP Extension"], ids["Karkarduma Court"]).lines == ["PINK"]
    assert find_route(g, ids["Kaushambi"], ids["Preet Vihar"]).lines == ["BLUE_BR"]


# --- errors (ER3, ER5) ----------------------------------------------------------------

@pytest.mark.parametrize("src, dst, error", [
    ("a", "a", SameStation),
    ("zz", "a", UnknownStation),
    ("a", "zz", UnknownStation),
    ("zz", "zz", UnknownStation),   # unknown wins over same: the id itself is wrong
    ("a", "h", NoRoute),            # GREEN is disconnected in the fixture
])
def test_errors(g, src, dst, error):
    with pytest.raises(error) as err:
        find_route(g, src, dst)
    assert isinstance(err.value, RoutingError)


def test_error_details(g):
    with pytest.raises(UnknownStation) as err:
        find_route(g, "a", "zz")
    assert err.value.station_id == "zz"
    with pytest.raises(NoRoute) as err:
        find_route(g, "a", "h")
    assert (err.value.src, err.value.dst) == ("a", "h")


# --- invariants on the real network (fixed seed, test-plan §5) ------------------------

def real_pairs(data, g):
    rng = random.Random(3810)
    ids = sorted(g.nodes)
    pairs = {tuple(rng.sample(ids, 2)) for _ in range(200)}
    termini = sorted({n for line in data["lines"]
                      for n, deg in nx.Graph((e["a"], e["b"]) for e in data["edges"]
                                             if e["line"] == line["id"]).degree if deg == 1})
    return sorted(pairs | set(itertools.combinations(termini, 2)))


def test_real_invariants(real):
    data, g, _ = real
    on_line = {(e["a"], e["b"], e["line"]) for e in data["edges"]} | {(e["b"], e["a"], e["line"]) for e in data["edges"]}
    pairs = real_pairs(data, g)
    assert len(pairs) > 400
    for src, dst in pairs:
        j = find_route(g, src, dst)
        path = j.station_ids
        assert (path[0], path[-1]) == (src, dst)
        assert all(leg.stops >= 1 for leg in j.legs)                          # no empty legs
        assert all(j.legs[i].station_ids[-1] == j.legs[i + 1].station_ids[0] for i in range(j.interchanges))
        assert all(j.legs[i].line != j.legs[i + 1].line for i in range(j.interchanges))
        for leg in j.legs:                                                     # every hop really runs on its leg's line
            assert all((a, b, leg.line) in on_line for a, b in itertools.pairwise(leg.station_ids))
        assert j.total_minutes == pytest.approx(sum(g[a][b]["minutes"] for a, b in itertools.pairwise(path)))
        assert j.total_minutes == pytest.approx(nx.dijkstra_path_length(g, src, dst, weight="minutes"))
        assert j.total_minutes == pytest.approx(find_route(g, dst, src).total_minutes)   # symmetric
    assert max(find_route(g, *p).interchanges for p in pairs) >= 2   # ECP class "2+ changes" is exercised


def test_real_triangle_inequality(real):
    _, g, _ = real
    rng = random.Random(3810)
    ids = sorted(g.nodes)
    for _ in range(100):
        a, b, c = rng.sample(ids, 3)
        assert find_route(g, a, c).total_minutes <= (
            find_route(g, a, b).total_minutes + find_route(g, b, c).total_minutes + 1e-9)


# --- known real routes (validation, T-2) ----------------------------------------------

@pytest.mark.parametrize("src, dst, lines", [
    ("Rajiv Chowk", "Kashmere Gate", ["YELLOW"]),
    ("Dwarka Sector 21", "New Delhi", ["AIRPORT"]),
    ("Majlis Park", "Shiv Vihar", ["PINK"]),
    ("Rithala", "Vaishali", ["RED", "PINK", "BLUE_BR"]),
])
def test_real_known_routes(real, src, dst, lines):
    _, g, ids = real
    assert find_route(g, ids[src], ids[dst]).lines == lines


def test_real_matches_dmrc_journey(real):
    _, g, ids = real
    j = find_route(g, ids["Rajiv Chowk"], ids["Kashmere Gate"])
    assert j.total_minutes == pytest.approx(8.62, rel=0.10)   # DMRC planner 8:37
    assert j.legs[0].stops == 4                                  # New Delhi, Chawri Bazar, Chandni Chowk, Kashmere Gate


def test_real_worst_case_is_fast(real):
    data, g, _ = real
    pair = max(real_pairs(data, g), key=lambda p: find_route(g, *p).total_minutes)
    t = time.perf_counter()
    find_route(g, *pair)
    assert time.perf_counter() - t < 0.2   # target 50 ms (PLAN C3)
