from pathlib import Path

import pytest

from metro.loader import DEFAULT_PATH, load
from metro.model import Station, stations_from
from metro.search import MAX_QUERY, search, suggest_closest

MINI = Path(__file__).parent / "fixtures" / "mini.json"


def st(id, name, code, lines=("RED",)):
    return Station(id, name, code, 28.6, 77.2, tuple(lines), len(lines) > 1, 0, 0)


@pytest.fixture
def mini():
    return stations_from(load(MINI))


@pytest.fixture(scope="module")
def real():
    return stations_from(load(DEFAULT_PATH))


def names(results):
    return [r["name"] for r in results]


# --- ranking and matching (ECP) -------------------------------------------------------

RANKED = {s.id: s for s in [
    st("dwk", "Dwarka", "DWK"),
    st("dwm", "Dwarka Mor", "DWM"),
    st("bd", "Bagh Dwarka", "BGD"),      # substring only; alphabetically first, so rank must beat name order
    st("zoo", "Zoo Gate", "DW"),         # exact code for "dw"; alphabetically last, so rank must beat name order
    st("x", "Unrelated", "UXQ"),
]}


def test_exact_code_beats_prefix_beats_substring():
    assert names(search(RANKED, "dw")) == ["Zoo Gate", "Dwarka", "Dwarka Mor", "Bagh Dwarka"]


def test_ties_break_alphabetically():
    assert names(search(RANKED, "dwarka")) == ["Dwarka", "Dwarka Mor", "Bagh Dwarka"]


def test_code_prefix_and_substring_match():
    assert names(search(RANKED, "uxq")) == ["Unrelated"]    # exact code
    assert names(search(RANKED, "ux")) == ["Unrelated"]     # code prefix
    assert names(search(RANKED, "xq")) == ["Unrelated"]     # code substring, not in the name


@pytest.mark.parametrize("q", ["rit", "RIT", "  rit ", "Rith", "ri"])
def test_name_or_code_case_and_whitespace_insensitive(real, q):
    assert names(search(real, q))[0] == "Rithala"      # code RI, name prefix


def test_interchange_appears_once_with_all_lines(real):
    hits = [r for r in search(real, "kashmere") if r["name"] == "Kashmere Gate"]
    assert len(hits) == 1
    assert sorted(hits[0]["lines"]) == ["RED", "VIOLET", "YELLOW"]


def test_result_shape(mini):
    assert search(mini, "alp") == [{"id": "a", "name": "Alpha", "code": "ALP", "lines": ["RED", "YELLOW"]}]


# --- odd input (ER6, error guessing) ---------------------------------------------------

@pytest.mark.parametrize("q", ["", "   ", None])
def test_empty_query_returns_nothing(mini, q):
    assert search(mini, q) == []


@pytest.mark.parametrize("q", ["Dr. ", "&", "(", "[a-z", ".*", "\\", "ñ", "a.i.i"])
def test_punctuation_and_regex_chars_are_literal(real, q):
    results = search(real, q)                        # must not raise; "(" and ".*" match no name
    assert all(q.strip().lower() in (r["name"] + r["code"]).lower() for r in results)


def test_aiims_dots_match_literally(real):
    assert names(search(real, "A.I.I"))[0] == "A.I.I.M.S."


def test_huge_input_is_truncated_not_crashed(mini):
    assert search(mini, "a" * 10_000) == []
    assert search(mini, "alpha" + " " * 10_000) == search(mini, "alpha")   # strip happens first


# --- boundaries (BVA) --------------------------------------------------------------------

@pytest.mark.parametrize("q, found", [
    ("x" * 49, True),          # under the limit
    ("x" * 50, True),          # at the limit
    ("x" * 49 + "!", False),   # 50 chars, kept whole: "!" is not in the name
    ("x" * 50 + "!", True),    # 51 chars: the "!" is cut off, so it matches again
])
def test_query_truncated_at_max_length(q, found):
    stations = {"long": st("long", "x" * 60, "LNG")}
    assert len(q) in (49, 50, 51) and MAX_QUERY == 50
    assert bool(search(stations, q)) is found


@pytest.mark.parametrize("n, returned", [(7, 7), (8, 8), (9, 8)])
def test_limit_boundary(n, returned):
    stations = {f"s{i}": st(f"s{i}", f"Station {i:02d}", f"S{i:02d}") for i in range(n)}
    assert len(search(stations, "station")) == returned
    assert len(search(stations, "station", limit=n)) == n


def test_one_char_query(mini):
    assert names(search(mini, "g")) == ["Golf"]   # prefix; no other mini name or code contains g


# --- suggestions (ER2) ------------------------------------------------------------------

def test_no_match_gives_closest_name(real):
    assert search(real, "Rithla") == []
    assert suggest_closest(real, "Rithla") == {"id": "rithala", "name": "Rithala"}


def test_suggestion_is_case_and_space_insensitive(real):
    assert suggest_closest(real, "  rajiv chwok ")["name"] == "Rajiv Chowk"


def test_gibberish_has_no_suggestion(real):
    assert suggest_closest(real, "qzxjv") is None
    assert suggest_closest(real, "") is None
