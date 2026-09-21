"""PolyRAG Domains Phase 3 — sync cited ask (embed → retrieve → complete → persist)."""

from __future__ import annotations

import math
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select

from tvashtr.config import get_settings
from tvashtr.control_plane.credentials import (
    NoCredentialError,
    held_provider_slugs,
    provider_for_model,
    resolve_owner_api_key,
)
from tvashtr.control_plane.domain_ingest import normalize_embedding_model
from tvashtr.control_plane.domain_retrieve import (
    citations_from_chunks,
    coerce_graph_config,
    coerce_rerank_config,
    coerce_retrieval_mode,
    retrieve_for_query,
)
from tvashtr.control_plane.domains import _owned_domain
from tvashtr.control_plane.teams import account_default_model
from tvashtr.db import session_scope
from tvashtr.gateway import (
    CompletionRequest,
    EmbeddingRequest,
    GatewayError,
    complete,
    embed,
)
from tvashtr.models import DomainChunk, DomainDocument, DomainMessage

ROLE_USER = "user"
ROLE_ASSISTANT = "assistant"


def resolve_domain_generation_model(owner_id: uuid.UUID, config: dict) -> str:
    """Prefer ``config.generation.model``; else account thinker default / settings."""
    raw = (config or {}).get("generation") or {}
    configured = raw.get("model") if isinstance(raw, dict) else None
    if configured is not None and str(configured).strip():
        return str(configured).strip()
    held = held_provider_slugs(owner_id)
    model = account_default_model(held, "thinker") or (get_settings().default_model or "")
    model = str(model).strip()
    if not model:
        raise ValueError(
            "no generation model configured — set config.generation.model or add a "
            "provider key under Engines"
        )
    return model


def missing_ask_providers(
    owner_id: uuid.UUID, embed_model: str | None, gen_model: str
) -> list[str]:
    held = held_provider_slugs(owner_id)
    needed = {provider_for_model(gen_model)}
    if embed_model:
        needed.add(provider_for_model(embed_model))
    return sorted(p for p in needed if p not in held)


def build_ask_messages(question: str, chunks: list[dict]) -> list[dict]:
    """System prompt with numbered excerpts + user question (no prior chat history)."""
    lines = [
        "You are a helpful assistant answering questions using ONLY the numbered "
        "context excerpts below. Cite sources by number like [1] when you use them. "
        "If the context is insufficient, say you do not have enough information.",
        "",
        "Context:",
    ]
    for i, c in enumerate(chunks, start=1):
        fn = c.get("filename") or "document"
        text = (c.get("text") or "").strip()
        lines.append(f"[{i}] ({fn}) {text}")
    system = "\n".join(lines)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
    ]


def message_to_dict(row: DomainMessage) -> dict:
    return {
        "message_id": str(row.id),
        "domain_id": str(row.domain_id),
        "role": row.role,
        "content": row.content,
        "citations": row.citations,
        "latency_ms": row.latency_ms,
        "cost_usd": float(row.cost_usd) if row.cost_usd is not None else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def count_ready_chunks(session, domain_id: uuid.UUID) -> int:
    return int(
        session.execute(
            select(func.count())
            .select_from(DomainChunk)
            .join(DomainDocument, DomainDocument.id == DomainChunk.document_id)
            .where(
                DomainChunk.domain_id == domain_id,
                DomainChunk.embedding.isnot(None),
                DomainDocument.ingest_status == "ready",
            )
        ).scalar_one()
    )


def list_domain_messages(owner_id: uuid.UUID, domain_id: uuid.UUID) -> list[dict] | None:
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return None
        rows = (
            session.execute(
                select(DomainMessage)
                .where(DomainMessage.domain_id == domain_id)
                .order_by(DomainMessage.created_at, DomainMessage.id)
            )
            .scalars()
            .all()
        )
        return [message_to_dict(r) for r in rows]





def coerce_retrieval_top_k(config: dict | None, default: int = 8) -> int:
    """Return a positive int top_k from domain config; default on bad/missing values."""
    raw = ((config or {}).get("retrieval") or {})
    if not isinstance(raw, dict):
        return default
    val = raw.get("top_k", default)
    if val is None or val is False:
        return default
    try:
        k = int(val)
    except (TypeError, ValueError):
        return default
    return k if k >= 1 else default


def _finite_or_none(value) -> float | None:
    """Return float(value) when finite; else None (NaN/inf/non-numeric → None)."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return f


class DomainAskError(Exception):
    def __init__(self, code: str, detail: str | dict):
        self.code = code
        self.detail = detail
        super().__init__(str(detail))


def ask_domain(owner_id: uuid.UUID, domain_id: uuid.UUID, question: str) -> dict:
    """Sync cited ask. Raises DomainAskError for mapped HTTP statuses."""
    q = (question or "").strip()
    if not q:
        raise DomainAskError("bad_request", "question must be non-empty")

    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise DomainAskError("not_found", "domain not found")
        cfg = dict(domain.config or {})
        ready_n = count_ready_chunks(session, domain_id)
        if ready_n < 1:
            raise DomainAskError("empty_corpus", "ingest documents before asking")
        top_k = coerce_retrieval_top_k(cfg)
        emb_model = normalize_embedding_model(
            str((cfg.get("embedding") or {}).get("model") or "text-embedding-3-small")
        )

    try:
        gen_model = resolve_domain_generation_model(owner_id, cfg)
    except ValueError as e:
        raise DomainAskError("no_model", str(e)) from e

    mode = coerce_retrieval_mode(cfg)
    rerank_cfg = coerce_rerank_config(cfg)
    graph_cfg = coerce_graph_config(cfg)
    needs_embed = mode in ("dense", "hybrid")
    missing = missing_ask_providers(
        owner_id, emb_model if needs_embed else None, gen_model
    )
    if missing:
        raise DomainAskError(
            "missing_providers",
            {
                "message": (
                    "you have no API key for: "
                    + ", ".join(missing)
                    + (
                        " — needed to embed the question and generate an answer. "
                        if needs_embed
                        else " — needed to generate an answer. "
                    )
                    + "Add keys under Engines before asking."
                ),
                "missing_providers": missing,
            },
        )

    try:
        chat_key = resolve_owner_api_key(owner_id, gen_model)
        embed_key = None
        if needs_embed:
            embed_key = resolve_owner_api_key(owner_id, emb_model)
    except NoCredentialError as e:
        raise DomainAskError(
            "missing_providers",
            {
                "message": (
                    f"you have no API key for: {e.provider} — needed for domain ask. "
                    "Add a key under Engines before asking."
                ),
                "missing_providers": [e.provider],
            },
        ) from e

    started = time.perf_counter()
    query_embedding = None
    if needs_embed:
        try:
            emb_result = embed(
                EmbeddingRequest(model=emb_model, input=[q], api_key=embed_key)
            )
        except GatewayError as e:
            raise DomainAskError("gateway", f"embedding failed: {e}") from e
        if not emb_result.vectors:
            raise DomainAskError("gateway", "embedding provider returned no vectors")
        query_embedding = emb_result.vectors[0]

    chunks = retrieve_for_query(
        domain_id,
        q,
        query_embedding=query_embedding,
        top_k=top_k,
        mode=mode,
        rerank=rerank_cfg,
        graph=graph_cfg,
    )
    if not chunks:
        raise DomainAskError("empty_corpus", "ingest documents before asking")

    messages = build_ask_messages(q, chunks)
    try:
        completion = complete(
            CompletionRequest(model=gen_model, messages=messages, api_key=chat_key)
        )
    except GatewayError as e:
        raise DomainAskError("gateway", f"generation failed: {e}") from e

    wall_ms = int((time.perf_counter() - started) * 1000)
    raw_lat = completion.latency_ms
    if raw_lat is None or raw_lat == 0:
        latency_ms: int | None = wall_ms
    else:
        lat_f = _finite_or_none(raw_lat)
        # Finite → int; non-finite NaN/inf → None (never int(nan)).
        latency_ms = int(lat_f) if lat_f is not None else None
    cost_f = _finite_or_none(completion.cost_usd)
    cost_val: Decimal | None = (
        Decimal(str(cost_f)) if cost_f is not None else None
    )

    citations = citations_from_chunks(chunks)
    # Cosine of zero/degenerate vectors can yield NaN; JSONB rejects it.
    for cite in citations:
        sc = cite.get("score")
        if isinstance(sc, float) and not math.isfinite(sc):
            cite.pop("score", None)
    answer = completion.text or ""

    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise DomainAskError("not_found", "domain not found")
        # Stagger created_at: Postgres now() is transaction-start, so both rows
        # would otherwise share a timestamp and UUID order is nondeterministic.
        ts = datetime.now(timezone.utc)
        user_row = DomainMessage(
            domain_id=domain_id,
            role=ROLE_USER,
            content=q,
            citations=None,
            created_at=ts,
        )
        asst_row = DomainMessage(
            domain_id=domain_id,
            role=ROLE_ASSISTANT,
            content=answer,
            citations=citations,
            latency_ms=latency_ms,
            cost_usd=cost_val,
            created_at=ts + timedelta(microseconds=1),
        )
        session.add(user_row)
        session.add(asst_row)
        session.flush()
        return {
            "answer": answer,
            "citations": citations,
            "message_id": str(asst_row.id),
            "user_message_id": str(user_row.id),
            "latency_ms": latency_ms,
            "cost_usd": float(cost_val) if cost_val is not None else None,
            "model": completion.model_used,
        }


def missing_retrieve_providers(owner_id: uuid.UUID, embed_model: str) -> list[str]:
    held = held_provider_slugs(owner_id)
    needed = {provider_for_model(embed_model)}
    return sorted(p for p in needed if p not in held)


def retrieve_domain(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    query: str,
    top_k: int | None = None,
) -> dict:
    """Retrieve citations via retrieve_for_query. No generation / no DomainMessage writes.

    Raises DomainAskError with the same codes as ask where applicable
    (``bad_request``, ``not_found``, ``empty_corpus``, ``missing_providers``, ``gateway``).
    """
    q = (query or "").strip()
    if not q:
        raise DomainAskError("bad_request", "query must be non-empty")

    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise DomainAskError("not_found", "domain not found")
        cfg = dict(domain.config or {})
        ready_n = count_ready_chunks(session, domain_id)
        if ready_n < 1:
            raise DomainAskError("empty_corpus", "ingest documents before asking")
        cfg_top_k = coerce_retrieval_top_k(cfg)
        emb_model = normalize_embedding_model(
            str((cfg.get("embedding") or {}).get("model") or "text-embedding-3-small")
        )

    effective_k = cfg_top_k
    if top_k is not None:
        try:
            k = int(top_k)
            if k >= 1:
                effective_k = k
        except (TypeError, ValueError):
            pass

    mode = coerce_retrieval_mode(cfg)
    rerank_cfg = coerce_rerank_config(cfg)
    graph_cfg = coerce_graph_config(cfg)
    needs_embed = mode in ("dense", "hybrid")
    query_embedding = None
    started = time.perf_counter()
    if needs_embed:
        missing = missing_retrieve_providers(owner_id, emb_model)
        if missing:
            raise DomainAskError(
                "missing_providers",
                {
                    "message": (
                        "you have no API key for: "
                        + ", ".join(missing)
                        + " — needed to embed the query. "
                        "Add keys under Engines before retrieving."
                    ),
                    "missing_providers": missing,
                },
            )

        try:
            embed_key = resolve_owner_api_key(owner_id, emb_model)
        except NoCredentialError as e:
            raise DomainAskError(
                "missing_providers",
                {
                    "message": (
                        f"you have no API key for: {e.provider} — needed for domain retrieve. "
                        "Add a key under Engines before retrieving."
                    ),
                    "missing_providers": [e.provider],
                },
            ) from e

        try:
            emb_result = embed(
                EmbeddingRequest(model=emb_model, input=[q], api_key=embed_key)
            )
        except GatewayError as e:
            raise DomainAskError("gateway", f"embedding failed: {e}") from e
        if not emb_result.vectors:
            raise DomainAskError("gateway", "embedding provider returned no vectors")
        query_embedding = emb_result.vectors[0]

    chunks = retrieve_for_query(
        domain_id,
        q,
        query_embedding=query_embedding,
        top_k=effective_k,
        mode=mode,
        rerank=rerank_cfg,
        graph=graph_cfg,
    )
    if not chunks:
        raise DomainAskError("empty_corpus", "ingest documents before asking")

    citations = citations_from_chunks(chunks)
    for cite in citations:
        sc = cite.get("score")
        if isinstance(sc, float) and not math.isfinite(sc):
            cite.pop("score", None)

    latency_ms = int((time.perf_counter() - started) * 1000)
    return {
        "citations": citations,
        "latency_ms": latency_ms,
    }
