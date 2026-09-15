"""PolyRAG Domains — Phase 1 config + CRUD helpers (no ingest/ask)."""

from __future__ import annotations

from copy import deepcopy

DOMAIN_TEMPLATE_KEYS: tuple[str, ...] = (
    "financial",
    "legal",
    "scientific",
    "support",
    "blank",
)


def default_config_for_template(template: str) -> dict:
    base = {
        "chunking": {"strategy": "fixed", "size": 800, "overlap": 100},
        "embedding": {"model": "text-embedding-3-small"},
        "retrieval": {"top_k": 8, "mode": "dense"},
        "generation": {"model": None},
    }
    if template == "legal":
        base["chunking"] = {"strategy": "fixed", "size": 500, "overlap": 80}
    elif template == "scientific":
        base["chunking"] = {"strategy": "fixed", "size": 1000, "overlap": 150}
    elif template == "financial":
        base["chunking"] = {"strategy": "fixed", "size": 700, "overlap": 100}
    elif template == "support":
        base["chunking"] = {"strategy": "fixed", "size": 600, "overlap": 100}
    return deepcopy(base)
