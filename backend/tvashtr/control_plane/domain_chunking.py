"""PolyRAG Domains Phase 2 — fixed-size character chunking with overlap."""

from __future__ import annotations


def chunk_text(text: str, *, size: int, overlap: int) -> list[str]:
    if size <= 0:
        raise ValueError("chunk size must be positive")
    if overlap < 0 or overlap >= size:
        raise ValueError("chunk overlap must be >= 0 and < size")
    cleaned = text.strip()
    if not cleaned:
        return []
    chunks: list[str] = []
    start = 0
    n = len(cleaned)
    step = size - overlap
    while start < n:
        end = min(start + size, n)
        piece = cleaned[start:end]
        if piece.strip():
            chunks.append(piece)
        if end >= n:
            break
        start += step
    return chunks


def chunk_spans(text: str, *, size: int, overlap: int) -> list[tuple[int, str]]:
    """``chunk_text`` with each piece's start offset in ``text`` (revamp: page numbers).

    The pieces are exactly ``chunk_text``'s; the offset counts from the start of ``text`` itself
    (the leading whitespace ``chunk_text`` strips is added back), so callers can map a piece to the
    page it starts on.
    """
    if size <= 0:
        raise ValueError("chunk size must be positive")
    if overlap < 0 or overlap >= size:
        raise ValueError("chunk overlap must be >= 0 and < size")
    cleaned = text.strip()
    if not cleaned:
        return []
    lead = len(text) - len(text.lstrip())
    spans: list[tuple[int, str]] = []
    start = 0
    n = len(cleaned)
    step = size - overlap
    while start < n:
        end = min(start + size, n)
        piece = cleaned[start:end]
        if piece.strip():
            spans.append((lead + start, piece))
        if end >= n:
            break
        start += step
    return spans
