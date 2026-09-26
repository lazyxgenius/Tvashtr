"""Read-side summaries for the revamped Domains screens (list cards, nav dots, detail header).

Every number the list shows comes from here, computed with a handful of grouped, owner-scoped
queries — never one query per domain:

- ``files``: the domain's files by phase — ``ready``, ``reading`` (being read now), ``waiting``
  (queued, a key is saved), ``waiting_for_key`` (queued, no key for the reading model yet) and
  ``needs_attention`` (the read failed).
- ``pieces``: chunks of ready files.
- ``state``: one word for the badge and the nav dot (:func:`domain_state`).
- ``quality``: test-question count and the latest finished test run's scores.
- ``usage``: steps + agents that use it (:mod:`domain_usage`).
- ``last_activity_at``: the newest of the domain's and its files' ``updated_at``.
- ``reading_model``: the embedding model, its display label and whether its key is saved.

Existing keys of ``domain_to_dict`` (``status``, ``doc_count`` …) are untouched; these are added.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select

from tvashtr.control_plane.domain_embedding import (
    EMBEDDING_CATALOGUE,
    normalize_embedding_model,
)
from tvashtr.control_plane.domain_usage import usage_counts
from tvashtr.control_plane.domains import domain_to_dict
from tvashtr.db import session_scope
from tvashtr.models import (
    Domain,
    DomainChunk,
    DomainDocument,
    DomainEvalCase,
    DomainEvalRun,
    ProviderCredential,
)

# The design's names for the reading (embedding) models (Dm-Settings / DmF-Embed `embedOpts`).
READING_MODEL_LABELS: dict[str, str] = {
    "openai/text-embedding-3-small": "OpenAI text-embedding-3-small",
    "openai/text-embedding-ada-002": "OpenAI text-embedding-ada-002",
    "openrouter/openai/text-embedding-3-small": "OpenRouter text-embedding-3-small",
    "openrouter/openai/text-embedding-ada-002": "OpenRouter text-embedding-ada-002",
    "gemini/gemini-embedding-001": "Gemini embedding-001",
    "huggingface/BAAI/bge-small-en-v1.5": "Hugging Face BGE-small (free)",
}

STATES = (
    "empty",
    "reading",
    "rereading",
    "waiting_for_key",
    "needs_attention",
    "ready",
)


def held_providers(session, owner_id: uuid.UUID) -> set[str]:
    return set(
        session.execute(
            select(ProviderCredential.provider).where(ProviderCredential.owner_id == owner_id)
        ).scalars()
    )


def reading_model_summary(config: dict | None, held: set[str]) -> dict:
    raw = ((config or {}).get("embedding") or {}).get("model")
    slug = normalize_embedding_model(str(raw or ""))
    entry = EMBEDDING_CATALOGUE.get(slug)
    provider = str(entry["provider"]) if entry else slug.split("/", 1)[0].lower()
    return {
        "slug": slug,
        "label": READING_MODEL_LABELS.get(slug, slug),
        "provider": provider,
        "dim": int(entry["dim"]) if entry else None,  # type: ignore[arg-type]
        "key_saved": provider in held,
    }


def domain_state(files: dict, *, rereading: bool) -> str:
    """The badge / nav-dot word. Active reading wins, then a missing key, then a failed file."""
    if files["total"] == 0:
        return "empty"
    if files["reading"] or files["waiting"]:
        return "rereading" if rereading else "reading"
    if files["waiting_for_key"]:
        return "waiting_for_key"
    if files["needs_attention"]:
        return "needs_attention"
    return "ready"


def _iso(ts: datetime | None) -> str | None:
    return ts.isoformat() if ts is not None else None


def summaries(session, owner_id: uuid.UUID, domains: list[Domain]) -> dict[uuid.UUID, dict]:
    """The added summary keys for each of ``domains`` (all owned by ``owner_id``)."""
    ids = [d.id for d in domains]
    if not ids:
        return {}
    held = held_providers(session, owner_id)

    # Files by status, and whether any of them was read before (version > 1 = a re-read).
    per_doc = session.execute(
        select(
            DomainDocument.domain_id,
            DomainDocument.ingest_status,
            func.bool_or(DomainDocument.version > 1),
            func.count(),
            func.max(DomainDocument.updated_at),
        )
        .where(DomainDocument.domain_id.in_(ids))
        .group_by(DomainDocument.domain_id, DomainDocument.ingest_status)
    ).all()

    pieces = dict(
        session.execute(
            select(DomainChunk.domain_id, func.count())
            .join(DomainDocument, DomainDocument.id == DomainChunk.document_id)
            .where(DomainChunk.domain_id.in_(ids), DomainDocument.ingest_status == "ready")
            .group_by(DomainChunk.domain_id)
        ).all()
    )
    cases = dict(
        session.execute(
            select(DomainEvalCase.domain_id, func.count())
            .where(DomainEvalCase.domain_id.in_(ids))
            .group_by(DomainEvalCase.domain_id)
        ).all()
    )
    latest_runs = {
        r.domain_id: r
        for r in session.execute(
            select(DomainEvalRun)
            .where(DomainEvalRun.domain_id.in_(ids), DomainEvalRun.status == "completed")
            .order_by(
                DomainEvalRun.domain_id,
                DomainEvalRun.completed_at.desc().nulls_last(),
                DomainEvalRun.created_at.desc(),
            )
            .distinct(DomainEvalRun.domain_id)
        ).scalars()
    }
    usage = usage_counts(session, owner_id, ids)

    out: dict[uuid.UUID, dict] = {}
    for d in domains:
        reading_model = reading_model_summary(d.config, held)
        files = {
            "total": 0,
            "ready": 0,
            "reading": 0,
            "waiting": 0,
            "waiting_for_key": 0,
            "needs_attention": 0,
        }
        rereading = False
        last_activity = d.updated_at
        for domain_id, status, reread, n, newest in per_doc:
            if domain_id != d.id:
                continue
            files["total"] += n
            if status == "ready":
                files["ready"] += n
            elif status == "error":
                files["needs_attention"] += n
            elif status == "indexing":
                files["reading"] += n
                rereading = rereading or bool(reread)
            elif reading_model["key_saved"]:
                files["waiting"] += n
                rereading = rereading or bool(reread)
            else:
                files["waiting_for_key"] += n
            if newest is not None and newest > last_activity:
                last_activity = newest
        run = latest_runs.get(d.id)
        scores = (run.scores or {}) if run is not None else {}
        out[d.id] = {
            "files": files,
            "pieces": int(pieces.get(d.id, 0)),
            "state": domain_state(files, rereading=rereading),
            "quality": {
                "cases": int(cases.get(d.id, 0)),
                "last_run_at": _iso(run.completed_at or run.created_at) if run else None,
                "hit_at_k": scores.get("hit_at_k"),
                "keyword_hit": scores.get("keyword_hit"),
                "retrieval_mode": scores.get("retrieval_mode"),
                "top_k": scores.get("top_k"),
            },
            "usage": usage[d.id],
            "last_activity_at": _iso(last_activity),
            "reading_model": reading_model,
        }
    return out


def list_summaries(owner_id: uuid.UUID) -> list[dict]:
    """``GET /api/domains`` items: ``domain_to_dict`` plus the summary keys, in creation order."""
    with session_scope() as session:
        rows = list(
            session.execute(
                select(Domain)
                .where(Domain.owner_id == owner_id)
                .order_by(Domain.created_at, Domain.id)
            ).scalars()
        )
        counts = dict(
            session.execute(
                select(DomainDocument.domain_id, func.count())
                .where(DomainDocument.domain_id.in_([r.id for r in rows]))
                .group_by(DomainDocument.domain_id)
            ).all()
        )
        extra = summaries(session, owner_id, rows)
        return [
            {**domain_to_dict(r, doc_count=int(counts.get(r.id, 0))), **extra[r.id]} for r in rows
        ]


def detail_summary(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict | None:
    """``GET /api/domains/{id}``: the list item's keys for one owned domain (``None`` → 404)."""
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return None
        doc_count = int(
            session.execute(
                select(func.count())
                .select_from(DomainDocument)
                .where(DomainDocument.domain_id == row.id)
            ).scalar_one()
        )
        return {
            **domain_to_dict(row, doc_count=doc_count),
            **summaries(session, owner_id, [row])[row.id],
        }
