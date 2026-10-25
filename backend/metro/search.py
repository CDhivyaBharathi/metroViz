"""Station search for the combobox (PLAN.md C4, FR1/ER2/ER6): substring on name or code, ranked."""
import difflib

MAX_QUERY = 50   # longer input is never a station name; truncating bounds the work per request (ER6)
LIMIT = 8        # one screen of suggestions

EXACT_CODE, PREFIX, SUBSTRING, NONE = range(4)


def search(stations, q, limit=LIMIT):
    """Stations (id -> Station) whose name or code contains q, best match first. Empty query -> []."""
    q = clean(q)
    if not q:
        return []
    ranked = sorted((_rank(s, q), s.name, s.id) for s in stations.values() if _rank(s, q) != NONE)
    return [_result(stations[sid]) for _, _, sid in ranked[:limit]]


def suggest_closest(stations, q):
    """Nearest station name to a query that matched nothing (ER2), or None."""
    by_name = {s.name.lower(): s for s in stations.values()}
    match = difflib.get_close_matches(clean(q), by_name, n=1)  # stdlib; default cutoff 0.6
    return {"id": by_name[match[0]].id, "name": by_name[match[0]].name} if match else None


def clean(q):
    return (q or "").strip()[:MAX_QUERY].lower()


def _rank(station, q):
    """Plain substring tests, not regex, so punctuation in queries or names can't break anything."""
    name, code = station.name.lower(), station.code.lower()
    if q == code:
        return EXACT_CODE
    if name.startswith(q) or code.startswith(q):
        return PREFIX
    if q in name or q in code:
        return SUBSTRING
    return NONE


def _result(s):
    return {"id": s.id, "name": s.name, "code": s.code, "lines": list(s.lines)}
