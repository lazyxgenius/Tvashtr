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

import re
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import func, select

from tvashtr.control_plane.credentials import provider_for_model
from tvashtr.control_plane.domain_answers import cited_sources
from tvashtr.control_plane.domain_embedding import (
    EMBEDDING_CATALOGUE,
    normalize_embedding_model,
    read_seconds,
)
from tvashtr.control_plane.domain_retrieve import searchable_piece
from tvashtr.control_plane.domain_usage import usage_counts
from tvashtr.control_plane.domains import (
    READ_TESTS_AFTER,
    _owned_domain,
    document_to_dict,
    domain_to_dict,
    is_model_mark,
)
from tvashtr.db import session_scope
from tvashtr.models import (
    Domain,
    DomainChunk,
    DomainDocument,
    DomainEvalCase,
    DomainEvalRun,
    DomainMessage,
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
            .where(DomainChunk.domain_id.in_(ids), searchable_piece())
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


# The design's names for the answer (generation) models (Dm-Ask / DmF-Model `genOpts`).
ANSWER_MODEL_LABELS: dict[str, str] = {
    "groq/openai/gpt-oss-120b": "Groq gpt-oss-120b",
    "openai/gpt-4o-mini": "OpenAI gpt-4o-mini",
    "openrouter/openai/gpt-4o-mini": "OpenRouter gpt-4o-mini",
}


def answer_model_label(slug: str | None) -> str | None:
    """ "OpenAI gpt-4o-mini": the design's label, else "<vendor> <model name>" for any slug."""
    if not slug:
        return None
    if slug in ANSWER_MODEL_LABELS:
        return ANSWER_MODEL_LABELS[slug]
    provider = provider_for_model(slug)
    return f"{VENDOR_NAMES.get(provider, provider)} {slug.rsplit('/', 1)[-1]}"


def answer_model_summary(owner_id: uuid.UUID, config: dict | None, held: set[str]) -> dict:
    """What answers questions: the configured model (``None`` = account default), what it resolves
    to now, its label and whether its key is saved (DM-63, OQ-11)."""
    from tvashtr.control_plane.domain_ask import resolve_domain_generation_model

    raw = (config or {}).get("generation") or {}
    picked = str(raw.get("model") or "").strip() if isinstance(raw, dict) else ""
    configured = picked or None
    try:
        resolved: str | None = resolve_domain_generation_model(owner_id, config or {})
    except ValueError:
        resolved = None
    provider = provider_for_model(resolved) if resolved else None
    return {
        "configured": configured,
        "resolved": resolved,
        "label": answer_model_label(resolved),
        "provider": provider,
        "key_saved": bool(provider and provider in held),
    }


def first_read_done(docs: list[DomainDocument]) -> bool:
    """Whether the domain's first read has finished — the setup strip shows until then (DM-37).

    Sticky without schema: once some file was read before the files now waiting were added (or a
    file was read twice), later uploads and re-reads don't bring the setup strip back.
    """
    if not docs:
        return False
    busy = [d for d in docs if d.ingest_status in ("pending", "indexing")]
    if not busy:
        return True
    if any(d.version > 1 for d in docs):
        return True
    oldest_busy = min(d.created_at for d in busy)
    return any(d.ingest_status in ("ready", "error") and d.updated_at < oldest_busy for d in docs)


def rereading_summary(
    docs: list[DomainDocument], pieces: dict[uuid.UUID, tuple[int, int]], config: dict | None
) -> dict | None:
    """The re-read still running, or ``None`` (DM-39, DmF-Embed-4, DmF-Piece-3): its files are the
    ones at the domain's highest version (``reread_version``). ``done`` = files of it read since,
    ``eta_seconds`` = the pieces left at the reading model's pace, ``reason`` = ``reading_model``
    when a new reading model is being read (asking pauses) else ``files``, and ``run_tests_after``
    whether the tests run when it's done."""
    top = max((d.version for d in docs), default=1)
    batch = [d for d in docs if d.version == top]
    left = [d for d in batch if d.ingest_status in ("pending", "indexing")]
    if top <= 1 or not left:
        return None
    size = int(((config or {}).get("chunking") or {}).get("size") or 800)
    remaining = 0
    for d in left:
        total, done = pieces.get(d.id, (0, 0))
        if d.ingest_status == "indexing" and done < total:
            remaining += total - done
        else:  # not read yet: about as many pieces as last time (or its size in pieces)
            remaining += total or max(1, d.byte_size // size)
    model = normalize_embedding_model(
        str(((config or {}).get("embedding") or {}).get("model") or "")
    )
    return {
        "total": len(batch),
        "done": len(batch) - len(left),
        "eta_seconds": read_seconds(remaining, model),
        "reason": "reading_model" if any(is_model_mark(d.error_message) for d in left) else "files",
        "run_tests_after": any(d.error_message == READ_TESTS_AFTER for d in left),
    }


def detail_summary(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict | None:
    """``GET /api/domains/{id}``: the list item's keys for one owned domain (``None`` → 404), plus
    ``setup`` (the four setup-strip steps), ``answer_model``, ``last_question_at`` and
    ``rereading`` (:func:`rereading_summary`)."""
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return None
        docs = list(
            session.execute(
                select(DomainDocument).where(DomainDocument.domain_id == row.id)
            ).scalars()
        )
        base = {
            **domain_to_dict(row, doc_count=len(docs)),
            **summaries(session, owner_id, [row])[row.id],
        }
        last_question = session.execute(
            select(func.max(DomainMessage.created_at)).where(
                DomainMessage.domain_id == row.id, DomainMessage.role == "user"
            )
        ).scalar_one()
        held = held_providers(session, owner_id)
        base["setup"] = {
            "key": base["reading_model"]["key_saved"],
            "files_read": first_read_done(docs),
            "tested": base["quality"]["cases"] > 0 or last_question is not None,
            "used": base["usage"]["uses"] > 0,
        }
        base["answer_model"] = answer_model_summary(owner_id, row.config, held)
        base["last_question_at"] = _iso(last_question)
        base["rereading"] = rereading_summary(docs, _piece_counts(session, row.id), row.config)
        return base


# ---- Files (the Sources tab) ----

# The providers' names as people know them, for the humanised reasons (DM-43).
VENDOR_NAMES: dict[str, str] = {
    "openai": "OpenAI",
    "openrouter": "OpenRouter",
    "gemini": "Gemini",
    "huggingface": "Hugging Face",
    "groq": "Groq",
}

_KINDS = {"pdf": "PDF", "md": "MD", "html": "HTML", "txt": "TXT"}
DOCUMENT_STATUS_FILTERS = ("all", "ready", "reading", "needs_attention")


def file_kind(filename: str) -> str:
    """The table's kind tile: ``PDF`` / ``MD`` / ``HTML`` / ``TXT``."""
    return _KINDS.get(Path(filename).suffix.lstrip(".").lower(), "TXT")


def humanize_ingest_error(raw: str | None, provider: str | None) -> dict:
    """A failed read's stored error, in the Sources table's words (DM-43).

    ``kind`` is ``key_rejected`` | ``no_text`` | ``rate_limited`` | ``unsupported`` |
    ``wrong_dim`` | ``other``; ``fix`` is ``"engines_key"`` when the fix is a key in Engines.
    """
    text = (raw or "").strip()
    low = text.lower()
    vendor = VENDOR_NAMES.get(provider or "", provider or "The provider")
    if "no extractable text" in low:
        return {
            "kind": "no_text",
            "message": "No text found. It may be a scanned image. Export it as text-based PDF.",
            "fix": None,
        }
    code = re.search(r"\b(401|403)\b", low)
    if code or any(
        w in low for w in ("invalid api key", "incorrect api key", "authentication", "unauthorized")
    ):
        return {
            "kind": "key_rejected",
            "message": f"{vendor} rejected the key ({code.group(1) if code else '401'}).",
            "fix": "engines_key",
        }
    if re.search(r"\b429\b", low) or "rate limit" in low or "ratelimit" in low:
        return {
            "kind": "rate_limited",
            "message": f"{vendor} is busy right now. Re-read it in a minute.",
            "fix": None,
        }
    if "unsupported file type" in low:
        return {
            "kind": "unsupported",
            "message": "Only PDF, Markdown, text or HTML files can be read.",
            "fix": None,
        }
    first = (text.splitlines() or ["unknown error"])[0].strip().rstrip(".")[:160]
    kind = "wrong_dim" if ("embedding dim" in low or "vector count" in low) else "other"
    return {"kind": kind, "message": f"Couldn’t read this file: {first}.", "fix": None}


def document_phase(status: str, version: int, key_saved: bool) -> str:
    """``ready`` | ``reading`` | ``rereading`` | ``waiting`` | ``waiting_for_key`` |
    ``needs_attention`` — the Status cell (DM-42)."""
    if status == "ready":
        return "ready"
    if status == "error":
        return "needs_attention"
    if status == "indexing":
        return "rereading" if version > 1 else "reading"
    return "waiting" if key_saved else "waiting_for_key"


def _filter_of(phase: str) -> str:
    if phase == "ready":
        return "ready"
    if phase == "needs_attention":
        return "needs_attention"
    return "reading"


def _document_item(
    doc: DomainDocument,
    total: int,
    done: int,
    provider: str,
    key: bool,
    key_saved_at: datetime | None = None,
) -> dict:
    phase = document_phase(doc.ingest_status, doc.version, key)
    reading = phase in ("reading", "rereading")
    problem = (
        humanize_ingest_error(doc.error_message, provider) if phase == "needs_attention" else None
    )
    # A key saved after the failure is the fix already made: the row offers Re-read (DmF-Fail-2).
    if problem and problem["fix"] and key_saved_at and key_saved_at > doc.updated_at:
        problem["fix"] = None
    return {
        **document_to_dict(doc),
        "kind": file_kind(doc.filename),
        "phase": phase,
        "pieces": total if phase == "ready" else None,
        "pieces_total": total,
        "pieces_done": done,
        "progress": (round(done / total, 4) if total else 0.0) if reading else None,
        "problem": problem,
    }


def _piece_counts(session, domain_id: uuid.UUID) -> dict[uuid.UUID, tuple[int, int]]:
    return {
        doc_id: (int(total), int(done))
        for doc_id, total, done in session.execute(
            select(DomainChunk.document_id, func.count(), func.count(DomainChunk.embedding))
            .where(DomainChunk.domain_id == domain_id)
            .group_by(DomainChunk.document_id)
        ).all()
    }


def document_views(
    owner_id: uuid.UUID, domain_id: uuid.UUID, *, q: str | None = None, status: str = "all"
) -> dict | None:
    """``GET /api/domains/{id}/documents``: every file (oldest first) with its phase, pieces,
    progress and humanised problem, the unfiltered ``counts`` for the Show filter and the ready
    ``total_pieces``. ``q`` matches file names and file text (DM-46); ``status`` narrows by the
    Show filter (DM-47). ``None`` when the domain isn't the owner's."""
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return None
        rm = reading_model_summary(domain.config, held_providers(session, owner_id))
        docs = list(
            session.execute(
                select(DomainDocument)
                .where(DomainDocument.domain_id == domain_id)
                .order_by(DomainDocument.created_at, DomainDocument.id)
            ).scalars()
        )
        pieces = _piece_counts(session, domain_id)
        key_saved_at = session.execute(
            select(func.max(ProviderCredential.updated_at)).where(
                ProviderCredential.owner_id == owner_id,
                ProviderCredential.provider == rm["provider"],
            )
        ).scalar()
        items = [
            _document_item(
                d, *pieces.get(d.id, (0, 0)), rm["provider"], rm["key_saved"], key_saved_at
            )
            for d in docs
        ]
        counts = {"all": len(items), "ready": 0, "reading": 0, "needs_attention": 0}
        for item in items:
            counts[_filter_of(item["phase"])] += 1
        total_pieces = sum(item["pieces"] or 0 for item in items)

        query = (q or "").strip()
        if query:
            text_hits = set(
                session.execute(
                    select(DomainChunk.document_id)
                    .where(
                        DomainChunk.domain_id == domain_id,
                        DomainChunk.text_tsv.op("@@")(func.plainto_tsquery("english", query)),
                    )
                    .distinct()
                ).scalars()
            )
            matched = []
            for item in items:
                if query.lower() in item["filename"].lower():
                    matched.append({**item, "matched": "name"})
                elif uuid.UUID(item["document_id"]) in text_hits:
                    matched.append({**item, "matched": "text"})
            items = matched
        if status != "all":
            items = [i for i in items if _filter_of(i["phase"]) == status]
        return {
            "documents": items,
            "counts": counts,
            "total_pieces": total_pieces,
            "query": query,
            "status": status,
        }


RECENT_ANSWERS = 20


def document_pieces(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    document_id: uuid.UUID,
    *,
    q: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict | None:
    """``GET …/documents/{doc}/pieces``: the file's pieces in order (``q`` keeps the pieces whose
    text contains it, case-insensitively), and how many of the last 20 answers cited the file
    (DM-51). ``None`` when the domain or the file isn't the owner's."""
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return None
        doc = session.execute(
            select(DomainDocument).where(
                DomainDocument.id == document_id, DomainDocument.domain_id == domain_id
            )
        ).scalar_one_or_none()
        if doc is None:
            return None
        rm = reading_model_summary(domain.config, held_providers(session, owner_id))
        total, done = _piece_counts(session, domain_id).get(doc.id, (0, 0))
        query = (q or "").strip()
        where = [DomainChunk.document_id == doc.id]
        if query:
            escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            where.append(DomainChunk.text.ilike(f"%{escaped}%", escape="\\"))
        matching = session.execute(
            select(func.count()).select_from(DomainChunk).where(*where)
        ).scalar_one()
        rows = session.execute(
            select(DomainChunk.ordinal, DomainChunk.text, DomainChunk.meta)
            .where(*where)
            .order_by(DomainChunk.ordinal)
            .offset(max(0, offset))
            .limit(max(1, min(limit, 200)))
        ).all()
        answers = list(
            session.execute(
                select(DomainMessage.content, DomainMessage.citations)
                .where(DomainMessage.domain_id == domain_id, DomainMessage.role == "assistant")
                .order_by(DomainMessage.created_at.desc(), DomainMessage.id.desc())
                .limit(RECENT_ANSWERS)
            ).all()
        )
        doc_key = str(doc.id)
        used = sum(
            1
            for content, citations in answers
            if any(c.get("document_id") == doc_key for c in cited_sources(content, citations))
        )
        return {
            "document": _document_item(doc, total, done, rm["provider"], rm["key_saved"]),
            "pieces": [
                {
                    "ordinal": ordinal,
                    "number": ordinal + 1,
                    "chars": len(body),
                    "page": (meta or {}).get("page"),
                    "text": body,
                }
                for ordinal, body, meta in rows
            ],
            "total": int(matching),
            "query": query,
            "used_in_answers": {"count": used, "of": len(answers)},
        }
