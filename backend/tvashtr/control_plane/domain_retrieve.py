"""PolyRAG Domains Phase 3 — dense cosine retrieve over ready DomainChunks."""

from __future__ import annotations

import math
import uuid

from sqlalchemy import select

from tvashtr.db import session_scope
from tvashtr.models import DomainChunk, DomainDocument

EXCERPT_MAX = 400


def truncate_excerpt(text: str, max_chars: int = EXCERPT_MAX) -> str:
    t = text or ""
    if len(t) <= max_chars:
        return t
    return t[:max_chars]


def retrieve_domain_chunks(
    domain_id: uuid.UUID, query_embedding: list[float], top_k: int
) -> list[dict]:
    """Return up to ``top_k`` ready chunks ranked by cosine distance ascending.

    Only chunks whose parent ``DomainDocument.ingest_status == "ready"`` and whose
    ``embedding`` is non-null are considered. Mirrors ``memory_retrieval`` use of
    ``embedding.cosine_distance(qvec)``.
    """
    try:
        k = int(top_k) if top_k is not None else 8
    except (TypeError, ValueError):
        k = 8
    k = max(1, k)
    qvec = query_embedding
    with session_scope() as session:
        dist = DomainChunk.embedding.cosine_distance(qvec)
        stmt = (
            select(DomainChunk, DomainDocument.filename, dist.label("distance"))
            .join(DomainDocument, DomainDocument.id == DomainChunk.document_id)
            .where(
                DomainChunk.domain_id == domain_id,
                DomainChunk.embedding.isnot(None),
                DomainDocument.ingest_status == "ready",
            )
            .order_by(dist)
            .limit(k)
        )
        rows = session.execute(stmt).all()
        out: list[dict] = []
        for chunk, filename, distance in rows:
            score = None
            if distance is not None:
                try:
                    score = float(1.0 - float(distance))
                    if not math.isfinite(score):
                        score = None
                except (TypeError, ValueError):
                    score = None
            out.append(
                {
                    "chunk_id": str(chunk.id),
                    "document_id": str(chunk.document_id),
                    "filename": filename,
                    "ordinal": int(chunk.ordinal),
                    "text": chunk.text,
                    "score": score,
                }
            )
        return out


def citations_from_chunks(chunks: list[dict]) -> list[dict]:
    """Build locked citation JSON (excerpt truncated)."""
    cites: list[dict] = []
    for c in chunks:
        item = {
            "document_id": c["document_id"],
            "filename": c["filename"],
            "chunk_id": c["chunk_id"],
            "ordinal": c["ordinal"],
            "excerpt": truncate_excerpt(c.get("text") or ""),
        }
        if c.get("score") is not None:
            item["score"] = c["score"]
        cites.append(item)
    return cites
