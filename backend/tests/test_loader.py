import json
from pathlib import Path

import networkx as nx
import pytest

from metro.loader import DEFAULT_PATH, DataError, load

MINI = Path(__file__).parent / "fixtures" / "mini.json"


def mini():
    return json.loads(MINI.read_text())


def load_dict(tmp_path, data):
    p = tmp_path / "metro.json"
    p.write_text(json.dumps(data))
    return load(p)


def break_with(fn):
    data = mini()
    fn(data)
    return data


# --- fixture loads, interchange flag derived ----------------------------------------

def test_fixture_loads_and_flags_interchanges():
    data = load(MINI)
    flags = {s["id"]: s["is_interchange"] for s in data["stations"]}
    assert flags["b"] is False          # 1 line
    assert flags["a"] is True           # 2 lines
    assert flags["c"] is True           # 3 lines
    assert sum(flags.values()) == 2


def test_unknown_top_level_keys_are_ignored(tmp_path):
    data = mini()
    data["meta"] = {"source": "test"}
    data["stations"][0]["exits"] = ["Gate 1"]   # optional field (D2)
    assert load_dict(tmp_path, data)["stations"][0]["exits"] == ["Gate 1"]


# --- one broken fixture per rule ------------------------------------------------------

BROKEN = {
    "duplicate station id": (lambda d: d["stations"][1].update(id="a"), "duplicate station id 'a'"),
    "duplicate station code": (lambda d: d["stations"][1].update(code="alp"), "duplicate station code 'ALP'"),
    "duplicate line id": (lambda d: d["lines"].append(dict(d["lines"][0])), "duplicate line id 'RED'"),
    "dangling edge": (lambda d: d["edges"][0].update(b="zz"), "unknown station 'zz'"),
    "unknown edge line": (lambda d: d["edges"][0].update(line="PURPLE"), "unknown line"),
    "unknown station line": (lambda d: d["stations"][1]["lines"].append("PURPLE"), "unknown line 'PURPLE'"),
    "edge line not on station": (lambda d: d["edges"].append({"a": "b", "b": "d", "line": "BLUE", "minutes": 1}),
                                 "station 'b' is not on line BLUE"),
    "zero minutes": (lambda d: d["edges"][0].update(minutes=0), "minutes must be > 0"),
    "negative minutes": (lambda d: d["edges"][0].update(minutes=-1), "minutes must be > 0"),
    "self loop": (lambda d: d["edges"][0].update(b="a"), "connects a station to itself"),
    "orphan station": (lambda d: d["stations"].append(
        {"id": "z", "name": "Zulu", "code": "ZUL", "lat": 28.0, "lon": 77.0, "lines": ["RED"]}),
        "station 'z' has no connections"),
    "line without connection": (lambda d: d["stations"][1]["lines"].append("BLUE"),
                                "station 'b' lists line BLUE but has no BLUE connection"),
    "station with no lines": (lambda d: d["stations"][1].update(lines=[]), "station 'b' has no lines"),
    "missing coordinates": (lambda d: d["stations"][0].pop("lat"), "field 'lat' missing or wrong type"),
    "string minutes": (lambda d: d["edges"][0].update(minutes="2"), "field 'minutes' missing or wrong type"),
    "bool coordinate": (lambda d: d["stations"][0].update(lon=True), "field 'lon' missing or wrong type"),
    "coordinates out of range": (lambda d: d["stations"][0].update(lat=123.0), "out-of-range coordinates"),
    "missing edges list": (lambda d: d.pop("edges"), "'edges' must be a non-empty list"),
    "edge not an object": (lambda d: d["edges"].append("a-b"), "edges[8] is not an object"),
}


@pytest.mark.parametrize("case", BROKEN, ids=list(BROKEN))
def test_each_rule_reports_its_problem(tmp_path, case):
    mutate, expected = BROKEN[case]
    with pytest.raises(DataError) as err:
        load_dict(tmp_path, break_with(mutate))
    assert any(expected in p for p in err.value.problems), err.value.problems


# --- gap tests from the white-box review (notes: BVA, MC/DC, mutants M4–M7) ------------

@pytest.mark.parametrize("field, value", [
    ("lat", 90), ("lat", -90), ("lon", 180), ("lon", -180),   # on the boundary: valid
])
def test_coordinate_boundaries_accepted(tmp_path, field, value):
    load_dict(tmp_path, break_with(lambda d: d["stations"][0].update({field: value})))


@pytest.mark.parametrize("field, value", [
    ("lat", 90.0001), ("lat", -90.0001), ("lon", 180.0001), ("lon", -180.0001),  # just outside
])
def test_coordinate_just_outside_rejected(tmp_path, field, value):
    with pytest.raises(DataError, match="out-of-range coordinates"):
        load_dict(tmp_path, break_with(lambda d: d["stations"][0].update({field: value})))


def test_tiny_positive_minutes_accepted(tmp_path):  # kills M5 (minutes > 0.5)
    load_dict(tmp_path, break_with(lambda d: d["edges"][0].update(minutes=0.01)))


def test_empty_list_rejected(tmp_path):  # MC/DC: `not items` alone decides; kills M7
    with pytest.raises(DataError, match="'lines' must be a non-empty list"):
        load_dict(tmp_path, break_with(lambda d: d.update(lines=[])))


def test_non_utf8_file(tmp_path):  # kills M6 (UnicodeDecodeError path)
    p = tmp_path / "metro.json"
    p.write_bytes(b'{"lines": "\xff"}')
    with pytest.raises(DataError, match="not valid JSON"):
        load(p)


def test_all_problems_reported_at_once(tmp_path):
    def two_faults(d):
        d["edges"][0]["minutes"] = 0
        d["edges"][1]["b"] = "zz"
    with pytest.raises(DataError) as err:
        load_dict(tmp_path, break_with(two_faults))
    assert len(err.value.problems) >= 2


def test_top_level_not_an_object(tmp_path):
    with pytest.raises(DataError, match="top level"):
        load_dict(tmp_path, [1, 2, 3])


def test_missing_file(tmp_path):
    with pytest.raises(DataError, match="not found"):
        load(tmp_path / "nope.json")


def test_malformed_json(tmp_path):
    p = tmp_path / "metro.json"
    p.write_text('{"lines": [')
    with pytest.raises(DataError, match="not valid JSON"):
        load(p)


def test_fixture_file_untouched_by_load():
    before = mini()
    load(MINI)
    assert mini() == before and "is_interchange" not in before["stations"][0]


# --- real dataset: the data-quality gate ---------------------------------------------

@pytest.fixture(scope="module")
def real():
    return load(DEFAULT_PATH)


def test_real_data_validates(real):
    assert 250 <= len(real["stations"]) <= 400


def test_real_data_each_line_connected(real):
    expected_components = {"MAGENTA": 2}  # D8: Krishna Park Ext–Deepali Chowk not open yet
    for line in real["lines"]:
        g = nx.Graph((e["a"], e["b"]) for e in real["edges"] if e["line"] == line["id"])
        n = nx.number_connected_components(g)
        assert n == expected_components.get(line["id"], 1), f"{line['id']}: {n} components"


def test_real_data_whole_network_connected(real):
    g = nx.Graph((e["a"], e["b"]) for e in real["edges"])
    g.add_nodes_from(s["id"] for s in real["stations"])
    assert nx.is_connected(g)


@pytest.mark.parametrize("name, lines", [
    ("Kashmere Gate", {"RED", "VIOLET", "YELLOW"}),
    ("Rajiv Chowk", {"BLUE", "YELLOW"}),
    ("Yamuna Bank", {"BLUE", "BLUE_BR"}),
])
def test_real_data_known_interchanges(real, name, lines):
    s = next(s for s in real["stations"] if s["name"] == name)
    assert set(s["lines"]) == lines and s["is_interchange"]


@pytest.mark.parametrize("line, ends", [
    ("RED", {"Rithala", "Shaheed Sthal"}),
    ("YELLOW", {"Samaypur Badli", "Millennium City Centre Gurugram"}),
    ("BLUE_BR", {"Yamuna Bank", "Vaishali"}),
])
def test_real_data_line_termini(real, line, ends):
    names = {s["id"]: s["name"] for s in real["stations"]}
    g = nx.Graph((e["a"], e["b"]) for e in real["edges"] if e["line"] == line)
    assert {names[n] for n, deg in g.degree if deg == 1} == ends


def test_real_data_time_sources(real):
    sources = [e.get("time_source") for e in real["edges"]]
    assert set(sources) <= {"gtfs", "estimate"}
    assert sources.count("gtfs") / len(sources) >= 0.9


def test_real_data_estimates_only_on_post_2023_sections(real):
    # GTFS is Aug 2023; only newer openings may be estimated (README, PLAN C1)
    est = [e for e in real["edges"] if e["time_source"] == "estimate"]
    assert len(est) == 20
    assert {e["line"] for e in est} == {"AIRPORT", "GREEN", "MAGENTA", "PINK", "RAPID"}


def test_real_data_exits_shape(real):
    for s in real["stations"]:
        for x in s.get("exits", []):
            assert set(x) == {"gate", "location"} and all(isinstance(v, str) and v for v in x.values()), s["id"]


def test_real_data_matches_dmrc_journey(real):
    # DMRC journey planner: Rajiv Chowk -> Kashmere Gate 8:37 (8.62 min); allow ±10%
    ids = {s["name"]: s["id"] for s in real["stations"]}
    g = nx.Graph()
    g.add_weighted_edges_from(((e["a"], e["b"], e["minutes"]) for e in real["edges"]), weight="minutes")
    t = nx.dijkstra_path_length(g, ids["Rajiv Chowk"], ids["Kashmere Gate"], weight="minutes")
    assert t == pytest.approx(8.62, rel=0.10)
