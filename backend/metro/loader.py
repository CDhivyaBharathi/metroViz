"""Load and validate the metro network JSON (PLAN.md C1).

Validation runs before any graph is built, and reports every problem at once so a
maintainer can fix the data file in one pass (ER1).
"""
import json
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "metro.json"

# field -> accepted types; unknown keys (e.g. top-level "meta", optional "exits") are ignored
LINE_FIELDS = {"id": str, "name": str, "color": str}
STATION_FIELDS = {"id": str, "name": str, "code": str, "lat": (int, float), "lon": (int, float), "lines": list}
EDGE_FIELDS = {"a": str, "b": str, "line": str, "minutes": (int, float)}


class DataError(Exception):
    def __init__(self, problems):
        self.problems = problems
        super().__init__("metro data invalid:\n  " + "\n  ".join(problems))


def load(path=DEFAULT_PATH):
    """Read, validate and return the network dict. Raises DataError on any problem."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise DataError([f"data file not found: {path}"]) from None
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise DataError([f"data file is not valid JSON: {e}"]) from None
    problems = validate(data)
    if problems:
        raise DataError(problems)
    for s in data["stations"]:
        s["is_interchange"] = len(s["lines"]) > 1
    return data


def validate(data):
    """Return a list of human-readable problems; empty means valid."""
    if not isinstance(data, dict):
        return ["top level must be an object with lines, stations, edges"]
    problems = _check_structure(data)
    if problems:
        return problems  # structure is broken; the checks below would just cascade

    line_ids = _dupes(problems, "line id", [l["id"] for l in data["lines"]])
    _dupes(problems, "station id", [s["id"] for s in data["stations"]])
    _dupes(problems, "station code", [s["code"].upper() for s in data["stations"]])
    stations = {s["id"]: s for s in data["stations"]}
    _check_stations(problems, data["stations"], line_ids)
    used = _check_edges(problems, data["edges"], line_ids, stations)
    _check_connections(problems, data["stations"], used)
    return problems


def _check_structure(data):
    problems = []
    for key, fields in (("lines", LINE_FIELDS), ("stations", STATION_FIELDS), ("edges", EDGE_FIELDS)):
        items = data.get(key)
        if not isinstance(items, list) or not items:
            problems.append(f"'{key}' must be a non-empty list")
            continue
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                problems.append(f"{key}[{i}] is not an object")
                continue
            for f, typ in fields.items():
                # bool is an int subclass; never a valid coordinate or duration
                if not isinstance(item.get(f), typ) or isinstance(item.get(f), bool):
                    problems.append(f"{key}[{i}] field '{f}' missing or wrong type")
    return problems


def _check_stations(problems, stations, line_ids):
    for s in stations:
        if not s["lines"]:
            problems.append(f"station '{s['id']}' has no lines")
        for l in s["lines"]:
            if l not in line_ids:
                problems.append(f"station '{s['id']}' lists unknown line '{l}'")
        if not (-90 <= s["lat"] <= 90 and -180 <= s["lon"] <= 180):
            problems.append(f"station '{s['id']}' has out-of-range coordinates")


def _check_edges(problems, edges, line_ids, stations):
    """Check each edge; return the (station, line) pairs that actually have an edge."""
    used = set()
    for i, e in enumerate(edges):
        where = f"edge {i} ({e['a']}–{e['b']}, {e['line']})"
        if e["line"] not in line_ids:
            problems.append(f"{where}: unknown line")
        if e["a"] == e["b"]:
            problems.append(f"{where}: connects a station to itself")
        if not e["minutes"] > 0:  # Dijkstra needs positive weights
            problems.append(f"{where}: minutes must be > 0")
        for end in (e["a"], e["b"]):
            if end not in stations:
                problems.append(f"{where}: unknown station '{end}'")
            elif e["line"] not in stations[end]["lines"]:
                problems.append(f"{where}: station '{end}' is not on line {e['line']}")
            used.add((end, e["line"]))
    return used


def _check_connections(problems, stations, used):
    for s in stations:
        if not any((s["id"], l) in used for l in s["lines"]):
            problems.append(f"station '{s['id']}' has no connections")
        for l in s["lines"]:
            if (s["id"], l) not in used and any((s["id"], x) in used for x in s["lines"]):
                problems.append(f"station '{s['id']}' lists line {l} but has no {l} connection")


def _dupes(problems, what, values):
    seen = set()
    for v in values:
        if v in seen:
            problems.append(f"duplicate {what} '{v}'")
        seen.add(v)
    return seen
