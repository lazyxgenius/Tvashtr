"""PolyRAG Domains Phase 3 — dense cosine retrieve over ready DomainChunks."""

from __future__ import annotations

import math
import uuid

from sqlalchemy import func, select

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


RETRIEVAL_MODES = ("dense", "lexical", "hybrid")
DEFAULT_RETRIEVAL_MODE = "dense"
RRF_K = 60
DEFAULT_RERANK: dict = {"enabled": False, "model": None, "top_n": 20}


def coerce_retrieval_mode(
    config: dict | None, default: str = DEFAULT_RETRIEVAL_MODE
) -> str:
    raw = (config or {}).get("retrieval") or {}
    if not isinstance(raw, dict):
        return default
    mode = str(raw.get("mode") or default).strip().lower()
    return mode if mode in RETRIEVAL_MODES else default


def coerce_rerank_config(config: dict | None) -> dict:
    raw = (config or {}).get("retrieval") or {}
    block = raw.get("rerank") if isinstance(raw, dict) else None
    enabled = False
    model = None
    top_n = 20
    if isinstance(block, dict):
        enabled = bool(block.get("enabled"))
        m = block.get("model")
        if isinstance(m, str) and m.strip():
            model = m.strip()
        else:
            model = None
        try:
            n = int(block.get("top_n", 20))
            if n >= 1:
                top_n = n
        except (TypeError, ValueError):
            pass
    return {"enabled": enabled, "model": model, "top_n": top_n}


def candidate_k(top_k: int, rerank: dict) -> int:
    try:
        k = int(top_k)
    except (TypeError, ValueError):
        k = 8
    k = max(1, k)
    if not rerank or not rerank.get("enabled"):
        return k
    try:
        n = int(rerank.get("top_n") or k)
    except (TypeError, ValueError):
        n = k
    return max(k, max(1, n))


def rrf_fuse(ranked_lists: list[list[dict]], k: int = RRF_K) -> list[dict]:
    """Reciprocal Rank Fusion. First-seen chunk fields win; score := RRF sum."""
    k = k if isinstance(k, int) and k >= 1 else RRF_K
    scores: dict[str, float] = {}
    by_id: dict[str, dict] = {}
    for ranked in ranked_lists:
        if not ranked:
            continue
        for rank, item in enumerate(ranked, start=1):
            cid = str(item.get("chunk_id") or "")
            if not cid:
                continue
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank)
            if cid not in by_id:
                by_id[cid] = dict(item)
    fused = []
    for cid, sc in scores.items():
        row = dict(by_id[cid])
        row["score"] = sc
        fused.append(row)
    fused.sort(key=lambda r: float(r.get("score") or 0.0), reverse=True)
    return fused


def apply_rerank(chunks: list[dict], query: str, rerank: dict) -> list[dict]:
    """v1 passthrough. Reserved hook: a future LiteLLM rerank may use rerank['model'].

    Today no first-party rerank API exists in-repo — always return chunks unchanged
    (caller already expanded candidate_k when enabled).
    """
    return chunks


def retrieve_lexical_chunks(
    domain_id: uuid.UUID, query: str, top_k: int
) -> list[dict]:
    """Return up to ``top_k`` ready chunks ranked by ``ts_rank`` descending.

    Uses ``plainto_tsquery('english', query)`` against generated ``text_tsv``.
    Does not require a non-null embedding.
    """
    try:
        k = int(top_k) if top_k is not None else 8
    except (TypeError, ValueError):
        k = 8
    k = max(1, k)
    q = (query or "").strip()
    if not q:
        return []
    tsq = func.plainto_tsquery("english", q)
    rank = func.ts_rank(DomainChunk.text_tsv, tsq)
    with session_scope() as session:
        stmt = (
            select(DomainChunk, DomainDocument.filename, rank.label("rank"))
            .join(DomainDocument, DomainDocument.id == DomainChunk.document_id)
            .where(
                DomainChunk.domain_id == domain_id,
                DomainDocument.ingest_status == "ready",
                DomainChunk.text_tsv.op("@@")(tsq),
            )
            .order_by(rank.desc())
            .limit(k)
        )
        rows = session.execute(stmt).all()
        out: list[dict] = []
        for chunk, filename, raw_rank in rows:
            score = None
            if raw_rank is not None:
                try:
                    score = float(raw_rank)
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

