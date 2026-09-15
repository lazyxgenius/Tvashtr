"""PolyRAG Domains Phase 3 — sync cited ask (embed → retrieve → complete → persist)."""

from __future__ import annotations

import time
import uuid
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
    retrieve_domain_chunks,
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
    owner_id: uuid.UUID, embed_model: str, gen_model: str
) -> list[str]:
    held = held_provider_slugs(owner_id)
    needed = {provider_for_model(embed_model), provider_for_model(gen_model)}
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


# ask_domain implemented in Task 4
