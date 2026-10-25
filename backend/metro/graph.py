"""Build the routing graph from a loaded network (PLAN.md C2). Built once at startup, read-only after."""
import networkx as nx


def build_graph(data):
    """Nodes are station ids; each adjacent pair gets one edge with `minutes` (the weight) and `lines`.

    Where two lines share a track between the same two stations (Anand Vihar–Karkarduma: BLUE_BR and
    PINK), the edge keeps the faster time and every line that achieves it, so routing can keep a rider
    on their current line instead of inventing an interchange.
    """
    g = nx.Graph()
    g.add_nodes_from(s["id"] for s in data["stations"])
    for e in data["edges"]:
        current = g.get_edge_data(e["a"], e["b"])
        if current is None or e["minutes"] < current["minutes"]:
            g.add_edge(e["a"], e["b"], minutes=e["minutes"], lines={e["line"]})
        elif e["minutes"] == current["minutes"]:
            current["lines"].add(e["line"])
    return g
