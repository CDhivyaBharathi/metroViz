from pathlib import Path

import networkx as nx
import pytest

from metro.graph import build_graph
from metro.loader import DEFAULT_PATH, load
from metro.model import MAP_SIZE, project, projector, stations_from

MINI = Path(__file__).parent / "fixtures" / "mini.json"


@pytest.fixture
def mini():
    return load(MINI)


@pytest.fixture(scope="module")
def real():
    return load(DEFAULT_PATH)


# --- graph on the fixture ------------------------------------------------------------

def test_nodes_and_edges_match_fixture(mini):
    g = build_graph(mini)
    assert set(g.nodes) == set("abcdefghi")
    assert g.number_of_edges() == 8


def test_edges_carry_minutes_and_line(mini):
    g = build_graph(mini)
    assert g["a"]["g"] == {"minutes": 1, "lines": {"YELLOW"}}
    assert g["g"]["c"] == {"minutes": 1.5, "lines": {"YELLOW"}}
    assert g["c"]["f"] == {"minutes": 3, "lines": {"BLUE"}}


def test_edges_are_symmetric(mini):
    g = build_graph(mini)
    for e in mini["edges"]:
        assert g[e["a"]][e["b"]] is g[e["b"]][e["a"]]


def test_interchange_sits_on_edges_of_each_line(mini):
    g = build_graph(mini)
    lines = set().union(*(g["c"][n]["lines"] for n in g["c"]))
    assert lines == {"RED", "BLUE", "YELLOW"} == set(stations_from(mini)["c"].lines)


def test_disconnected_line_is_its_own_component(mini):
    assert sorted(map(sorted, nx.connected_components(build_graph(mini)))) == [list("abcdefg"), ["h", "i"]]


# --- two lines on one track: one class per branch of the merge -----------------------

@pytest.mark.parametrize("minutes, expected", [
    (3, {"minutes": 2, "lines": {"RED"}}),              # slower second line: dropped
    (2, {"minutes": 2, "lines": {"RED", "YELLOW"}}),    # tie: both kept
    (1, {"minutes": 1, "lines": {"YELLOW"}}),           # faster second line: replaces
])
def test_shared_track(mini, minutes, expected):
    mini["edges"].append({"a": "b", "b": "a", "line": "YELLOW", "minutes": minutes})  # reversed on purpose
    assert build_graph(mini)["a"]["b"] == expected


def test_shared_track_order_does_not_matter(mini):
    mini["edges"].insert(0, {"a": "a", "b": "b", "line": "YELLOW", "minutes": 1})
    assert build_graph(mini)["a"]["b"] == {"minutes": 1, "lines": {"YELLOW"}}


# --- Station model and projection (D5) -----------------------------------------------

def test_station_fields(mini):
    c = stations_from(mini)["c"]
    assert (c.name, c.code, c.lines, c.is_interchange, c.exits) == ("Charlie", "CHR", ("BLUE", "RED", "YELLOW"), True, ())


def test_projection_orientation(mini):
    st = stations_from(mini)
    assert st["a"].x < st["b"].x < st["c"].x < st["d"].x   # east is right
    assert st["e"].y < st["c"].y < st["f"].y                 # north is up
    assert st["b"].y == st["c"].y                            # same latitude, same row


def test_projection_fits_and_keeps_aspect(mini):
    st = stations_from(mini)
    xs, ys = [s.x for s in st.values()], [s.y for s in st.values()]
    assert min(xs) == min(ys) == 0 and max(max(xs), max(ys)) == MAP_SIZE
    # 0.02° of longitude vs 0.03° of latitude, both at ~28.6°N
    assert (st["b"].x - st["a"].x) / (st["f"].y - st["c"].y) == pytest.approx(
        0.02 * 0.8787 / 0.03, rel=0.01)


def test_projection_single_station():  # BVA: zero span must not divide by zero
    assert project([{"id": "a", "lat": 28.6, "lon": 77.1}]) == {"a": (0, 0)}


def test_projector_maps_any_point_in_station_units():
    """The basemap tiles go through the same function as the stations: the bbox corners land on the frame."""
    to_xy = projector([{"id": "a", "lat": 28.0, "lon": 77.0}, {"id": "b", "lat": 29.0, "lon": 77.0}])
    assert to_xy(29.0, 77.0) == (0, 0)  # north-west corner
    assert to_xy(28.0, 77.0) == (0, MAP_SIZE)  # south
    assert to_xy(28.5, 77.0) == (0, MAP_SIZE / 2)  # a point that is not a station


# --- real network ---------------------------------------------------------------------

def test_real_graph_connected(real):
    g = build_graph(real)
    assert g.number_of_nodes() == len(real["stations"]) and nx.is_connected(g)


def test_real_shared_track_keeps_both_lines(real):
    g = build_graph(real)
    assert g.number_of_edges() == len(real["edges"]) - 1   # only one shared pair in the data
    assert g["anand-vihar"]["karkarduma"]["lines"] == {"BLUE_BR", "PINK"}


def test_real_projection_in_bounds_and_distinct(real):
    st = stations_from(real).values()
    assert all(0 <= s.x <= MAP_SIZE and 0 <= s.y <= MAP_SIZE for s in st)
    assert len({(s.x, s.y) for s in st}) == len(st)   # no two stations drawn on the same spot
