"""PolyRAG Domains Phase 3 — sync cited ask (embed → retrieve → complete → persist)."""

from __future__ import annotations

import math
import time
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, func, select

from tvashtr.config import get_settings
from tvashtr.control_plane.credentials import (
    NoCredentialError,
    held_provider_slugs,
    provider_for_model,
    resolve_owner_api_key,
)
from tvashtr.control_plane.domain_answers import answer_view, plain_answer
from tvashtr.control_plane.domain_ingest import normalize_embedding_model
from tvashtr.control_plane.domain_retrieve import (
    citations_from_chunks,
    coerce_graph_config,
    coerce_rerank_config,
    coerce_retrieval_mode,
    retrieve_for_query,
    searchable_piece,
)
from tvashtr.control_plane.domain_views import answer_model_label
from tvashtr.control_plane.domains import _owned_domain, model_rereading
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
# Follow-ups carry this many earlier question/answer turns (DM-65).
HISTORY_TURNS = 3
NOT_FOUND_RULE = (
    "If the excerpts do not answer the question, start with NOT_FOUND: and say in one sentence "
    "what the closest excerpts cover."
)


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


def build_ask_messages(
    question: str,
    chunks: list[dict],
    history: list[tuple[str, str]] | None = None,
    mark_not_found: bool = False,
) -> list[dict]:
    """System prompt with numbered excerpts, the earlier ``(question, answer)`` turns (answers
    without their markers — those numbers belonged to other excerpts) and the question. With
    ``mark_not_found`` an unanswerable question gets a leading ``NOT_FOUND:`` (OQ-22)."""
    lines = [
        "You are a helpful assistant answering questions using ONLY the numbered "
        "context excerpts below. Cite sources by number like [1] when you use them. "
        + (
            NOT_FOUND_RULE
            if mark_not_found
            else "If the context is insufficient, say you do not have enough information."
        ),
        "",
        "Context:",
    ]
    for i, c in enumerate(chunks, start=1):
        fn = c.get("filename") or "document"
        text = (c.get("text") or "").strip()
        lines.append(f"[{i}] ({fn}) {text}")
    system = "\n".join(lines)
    turns: list[dict] = []
    for q, a in history or []:
        turns += [{"role": "user", "content": q}, {"role": "assistant", "content": a}]
    return [
        {"role": "system", "content": system},
        *turns,
        {"role": "user", "content": question},
    ]


def _as_uuid(raw) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(raw))
    except (TypeError, ValueError):
        return None


def describe_passages(session, citations: list | None) -> list[dict]:
    """The citations with where each passage sits: ``piece_number`` (ordinal + 1),
    ``pieces_in_file`` and ``page`` (PDFs; ``None`` otherwise or once re-read)."""
    items = [dict(c) for c in (citations or []) if isinstance(c, dict)]
    chunk_ids = {u for c in items if (u := _as_uuid(c.get("chunk_id")))}
    doc_ids = {u for c in items if (u := _as_uuid(c.get("document_id")))}
    metas = (
        dict(
            session.execute(
                select(DomainChunk.id, DomainChunk.meta).where(DomainChunk.id.in_(chunk_ids))
            ).all()
        )
        if chunk_ids
        else {}
    )
    counts = (
        dict(
            session.execute(
                select(DomainChunk.document_id, func.count())
                .where(DomainChunk.document_id.in_(doc_ids))
                .group_by(DomainChunk.document_id)
            ).all()
        )
        if doc_ids
        else {}
    )
    for c in items:
        c["piece_number"] = int(c.get("ordinal") or 0) + 1
        c["pieces_in_file"] = counts.get(_as_uuid(c.get("document_id"))) or None
        c["page"] = (metas.get(_as_uuid(c.get("chunk_id"))) or {}).get("page")
    return items


def answer_fields(session, content: str, citations: list | None, meta: dict | None) -> dict:
    """The Ask tab's keys for one answer: ``covered``, ``answer_text``, ``sources`` (see
    ``answer_view``), ``searched`` (every passage found, in rank order), ``used_history``,
    ``model`` and ``model_label`` (``None`` for answers from before the answer meta)."""
    searched = describe_passages(session, citations)
    meta = meta or {}
    return {
        **answer_view(content, searched),
        "searched": searched,
        "used_history": meta.get("used_history") if meta else None,
        "model": meta.get("model"),
        "model_label": answer_model_label(meta.get("model")),
    }


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
                searchable_piece(),
            )
        ).scalar_one()
    )


def list_domain_messages(owner_id: uuid.UUID, domain_id: uuid.UUID) -> list[dict] | None:
    """The chat, oldest first; answers carry the Ask tab's keys (``answer_fields``)."""
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
        return [
            {**message_to_dict(r), **answer_fields(session, r.content, r.citations, r.meta)}
            if r.role == ROLE_ASSISTANT
            else message_to_dict(r)
            for r in rows
        ]


def clear_domain_messages(owner_id: uuid.UUID, domain_id: uuid.UUID) -> bool:
    """Clear chat (DM-67): delete every message of an owned domain; ``False`` → 404."""
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            return False
        session.execute(delete(DomainMessage).where(DomainMessage.domain_id == domain_id))
        return True


def _history(session, domain_id: uuid.UUID) -> list[tuple[str, str]]:
    """The last ``HISTORY_TURNS`` question/answer pairs of the chat, oldest first."""
    rows = (
        session.execute(
            select(DomainMessage)
            .where(DomainMessage.domain_id == domain_id)
            .order_by(DomainMessage.created_at.desc(), DomainMessage.id.desc())
            .limit(HISTORY_TURNS * 2)
        )
        .scalars()
        .all()
    )
    turns: list[tuple[str, str]] = []
    rows = list(reversed(rows))
    for q, a in zip(rows, rows[1:], strict=False):
        if q.role == ROLE_USER and a.role == ROLE_ASSISTANT:
            turns.append((q.content, plain_answer(a.content)))
    return turns[-HISTORY_TURNS:]


def coerce_retrieval_top_k(config: dict | None, default: int = 8) -> int:
    """Return a positive int top_k from domain config; default on bad/missing values."""
    raw = (config or {}).get("retrieval") or {}
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


def _ask_usage(completion, emb_result) -> dict:
    embed_tokens = int(getattr(emb_result, "prompt_tokens", 0) or 0)
    embed_cost = _finite_or_none(getattr(emb_result, "cost_usd", 0)) or 0.0
    return {
        "prompt_tokens": int(completion.prompt_tokens or 0) + embed_tokens,
        "completion_tokens": int(completion.completion_tokens or 0),
        "total_tokens": int(completion.total_tokens or 0) + embed_tokens,
        "cost_usd": (_finite_or_none(completion.cost_usd) or 0.0) + embed_cost,
    }


class DomainAskError(Exception):
    def __init__(self, code: str, detail: str | dict):
        self.code = code
        self.detail = detail
        super().__init__(str(detail))


def _check_not_paused(domain_id: uuid.UUID, domain) -> None:
    """Asking and team lookups pause while a new reading model re-reads the files (DM-88): the
    old vectors are gone and half the files aren't searchable yet."""
    if model_rereading(domain_id):
        raise DomainAskError("paused", f"Ask is paused while {domain.name} re-reads its files.")


def ask_domain(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    question: str,
    *,
    use_history: bool = False,
    persist: bool = False,
    mark_not_found: bool = False,
    on_event=None,
) -> dict:
    """Sync cited ask. Raises DomainAskError for mapped HTTP statuses.

    ``use_history``: earlier chat turns go to the model and the previous question joins the search
    (DM-65). ``persist=True`` writes the question and the answer to the domain's chat — only the
    chat endpoint does; Query domain nodes and agent tools stay out of it (finding 8, OQ-13).
    ``mark_not_found``: the NOT_FOUND rule (OQ-22). The answer carries the Ask tab's keys
    (``answer_fields``) next to the original ones. ``on_event`` (M1 stall guard) hears the model
    call's retries and backup switch — a Query domain node writes them as run events."""
    q = (question or "").strip()
    if not q:
        raise DomainAskError("bad_request", "question must be non-empty")

    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise DomainAskError("not_found", "domain not found")
        _check_not_paused(domain_id, domain)
        cfg = dict(domain.config or {})
        ready_n = count_ready_chunks(session, domain_id)
        if ready_n < 1:
            raise DomainAskError("empty_corpus", "ingest documents before asking")
        top_k = coerce_retrieval_top_k(cfg)
        emb_model = normalize_embedding_model(
            str((cfg.get("embedding") or {}).get("model") or "text-embedding-3-small")
        )
        history = _history(session, domain_id) if use_history else []
    search = f"{history[-1][0]} {q}" if history else q

    try:
        gen_model = resolve_domain_generation_model(owner_id, cfg)
    except ValueError as e:
        raise DomainAskError("no_model", str(e)) from e

    mode = coerce_retrieval_mode(cfg)
    rerank_cfg = coerce_rerank_config(cfg)
    graph_cfg = coerce_graph_config(cfg)
    needs_embed = mode in ("dense", "hybrid")
    missing = missing_ask_providers(owner_id, emb_model if needs_embed else None, gen_model)
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
    emb_result = None
    if needs_embed:
        try:
            emb_result = embed(EmbeddingRequest(model=emb_model, input=[search], api_key=embed_key))
        except GatewayError as e:
            raise DomainAskError("gateway", f"embedding failed: {e}") from e
        if not emb_result.vectors:
            raise DomainAskError("gateway", "embedding provider returned no vectors")
        query_embedding = emb_result.vectors[0]

    chunks = retrieve_for_query(
        domain_id,
        search,
        query_embedding=query_embedding,
        top_k=top_k,
        mode=mode,
        rerank=rerank_cfg,
        graph=graph_cfg,
    )
    if not chunks:
        raise DomainAskError("empty_corpus", "ingest documents before asking")

    messages = build_ask_messages(q, chunks, history, mark_not_found)
    try:
        completion = complete(
            CompletionRequest(
                model=gen_model, messages=messages, api_key=chat_key, on_event=on_event
            )
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
    cost_val: Decimal | None = Decimal(str(cost_f)) if cost_f is not None else None

    citations = citations_from_chunks(chunks)
    # Cosine of zero/degenerate vectors can yield NaN; JSONB rejects it.
    for cite in citations:
        sc = cite.get("score")
        if isinstance(sc, float) and not math.isfinite(sc):
            cite.pop("score", None)
    answer = completion.text or ""
    meta = {"model": gen_model, "used_history": bool(history), "source": "chat"}
    result = {
        "answer": answer,
        "citations": citations,
        "message_id": None,
        "user_message_id": None,
        "latency_ms": latency_ms,
        "cost_usd": float(cost_val) if cost_val is not None else None,
        "model": completion.model_used,
        # What the ask spent, question embedding included — a Query domain node puts it on the run
        # (finding 7).
        "usage": _ask_usage(completion, emb_result),
    }

    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise DomainAskError("not_found", "domain not found")
        result.update(answer_fields(session, answer, citations, meta))
        # answer_fields' "model" is the model asked for; keep the provider's own name here.
        result["model"] = completion.model_used
        if not persist:
            return result
        # Stagger created_at: Postgres now() is transaction-start, so both rows
        # would otherwise share a timestamp and UUID order is nondeterministic.
        ts = datetime.now(UTC)
        user_row = DomainMessage(
            domain_id=domain_id,
            role=ROLE_USER,
            content=q,
            citations=None,
            created_at=ts,
            meta={"source": "chat"},
        )
        asst_row = DomainMessage(
            domain_id=domain_id,
            role=ROLE_ASSISTANT,
            content=answer,
            citations=citations,
            latency_ms=latency_ms,
            cost_usd=cost_val,
            created_at=ts + timedelta(microseconds=1),
            meta=meta,
        )
        session.add(user_row)
        session.add(asst_row)
        session.flush()
        result["message_id"] = str(asst_row.id)
        result["user_message_id"] = str(user_row.id)
        return result


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
        _check_not_paused(domain_id, domain)
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
            emb_result = embed(EmbeddingRequest(model=emb_model, input=[q], api_key=embed_key))
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
