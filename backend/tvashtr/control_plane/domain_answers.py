"""Pure helpers for Domains answers (revamp round 2): which of the retrieved passages an answer
actually cites. No I/O — the stored answer text and its ``citations`` list are enough.

An answer cites passage ``n`` (1-based, the order the excerpts were given to the model) with a
``[n]`` marker; ``[1, 3]`` and ``[1][3]`` cite both. An answer that starts with ``NOT_FOUND:`` is
"not covered" and cites nothing (OQ-22). An answer with no marker at all is treated as covered and
its sources are the two passages that came up first (OQ-23).
"""

from __future__ import annotations

import re

_MARKER = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
NOT_FOUND = "NOT_FOUND:"


def is_not_covered(content: str | None) -> bool:
    return (content or "").lstrip().upper().startswith(NOT_FOUND)


def cited_numbers(content: str | None) -> list[int]:
    """The passage numbers the answer cites, in order of first mention, without repeats."""
    seen: dict[int, None] = {}
    for group in _MARKER.findall(content or ""):
        for part in group.split(","):
            seen.setdefault(int(part), None)
    return list(seen)


def cited_sources(content: str | None, citations: list | None) -> list[dict]:
    """The ``citations`` entries the answer cites (see the module docstring for the rules)."""
    items = [c for c in (citations or []) if isinstance(c, dict)]
    if is_not_covered(content):
        return []
    numbers = [n for n in cited_numbers(content) if 1 <= n <= len(items)]
    if not numbers:
        return items[:2]
    return [items[n - 1] for n in numbers]
