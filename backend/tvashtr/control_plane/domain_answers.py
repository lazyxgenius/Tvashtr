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
# A marker with the whitespace before it (dropped along with a marker that goes).
_SPACED_MARKER = re.compile(r"(\s*)" + _MARKER.pattern)
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


def plain_answer(content: str | None) -> str:
    """The answer's words alone: ``NOT_FOUND:`` and every marker removed."""
    text = content or ""
    if is_not_covered(text):
        text = text.lstrip()[len(NOT_FOUND) :]
    return _SPACED_MARKER.sub("", text).strip()


def answer_view(content: str | None, citations: list | None) -> dict:
    """What the Ask tab shows for a stored answer (DM-58/59/62): ``covered``; ``answer_text`` with
    ``NOT_FOUND:`` stripped and the markers renumbered 1…m in order of first mention (markers that
    point at no passage are dropped; a not-covered answer keeps none); and ``sources`` — the cited
    passages, numbered the same way, else the two that came up first. Each source keeps its
    citation's keys plus ``number`` and ``citation_index`` (its 1-based place in ``citations``)."""
    items = [c for c in (citations or []) if isinstance(c, dict)]
    text = content or ""
    covered = not is_not_covered(text)
    numbers = [n for n in cited_numbers(text) if 1 <= n <= len(items)] if covered else []
    new = {n: i + 1 for i, n in enumerate(numbers)}

    def renumber(m: re.Match) -> str:
        kept = [str(new[int(p)]) for p in m.group(2).split(",") if int(p) in new]
        return f"{m.group(1)}[{', '.join(kept)}]" if kept else ""

    if not covered:
        text = text.lstrip()[len(NOT_FOUND) :]
    text = _SPACED_MARKER.sub(renumber, text)
    picked = numbers or list(range(1, min(2, len(items)) + 1))
    return {
        "covered": covered,
        "answer_text": text.strip(),
        "sources": [
            {**items[n - 1], "number": i + 1, "citation_index": n} for i, n in enumerate(picked)
        ],
    }
