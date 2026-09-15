"""Phase 6 — Domain eval golden sets + deterministic quality scores."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from tvashtr.control_plane.domains import _owned_domain
from tvashtr.db import session_scope
from tvashtr.models import DomainEvalCase, DomainEvalRun

MAX_EVAL_CASES = 50


def score_hit_at_k(
    expected_doc_ids: list[str] | None, citations: list[dict]
) -> bool | None:
    ids = [str(x).strip() for x in (expected_doc_ids or []) if str(x).strip()]
    if not ids:
        return None
    cited = {str(c.get("document_id") or "") for c in citations}
    return any(eid in cited for eid in ids)


def score_keyword_hit(
    expected_keywords: list[str] | None, citations: list[dict]
) -> bool | None:
    kws = [str(k).strip() for k in (expected_keywords or []) if str(k).strip()]
    if not kws:
        return None
    hay = " ".join(str(c.get("excerpt") or "") for c in citations).lower()
    return all(k.lower() in hay for k in kws)


def aggregate_eval_scores(
    per_case: list[dict], *, top_k: int, retrieval_mode: str
) -> dict:
    hit_vals = [p["hit"] for p in per_case if p.get("hit") is not None]
    kw_vals = [p["keyword_hit"] for p in per_case if p.get("keyword_hit") is not None]
    return {
        "cases_total": len(per_case),
        "cases_scored_hit": len(hit_vals),
        "cases_scored_keyword": len(kw_vals),
        "hit_at_k": (sum(1 for v in hit_vals if v) / len(hit_vals)) if hit_vals else None,
        "keyword_hit": (sum(1 for v in kw_vals if v) / len(kw_vals)) if kw_vals else None,
        "top_k": top_k,
        "retrieval_mode": retrieval_mode,
        "per_case": per_case,
    }


def eval_case_to_dict(row: DomainEvalCase) -> dict:
    return {
        "case_id": str(row.id),
        "domain_id": str(row.domain_id),
        "question": row.question,
        "expected_answer": row.expected_answer,
        "expected_citation_doc_ids": list(row.expected_citation_doc_ids or []),
        "expected_keywords": list(row.expected_keywords or []),
        "ordinal": int(row.ordinal or 0),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def eval_run_to_dict(row: DomainEvalRun) -> dict:
    return {
        "run_id": str(row.id),
        "domain_id": str(row.domain_id),
        "status": row.status,
        "scores": row.scores,
        "error_message": row.error_message,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


def _normalize_doc_ids(raw: list | None) -> list[str]:
    out: list[str] = []
    for x in raw or []:
        s = str(x).strip()
        if not s:
            continue
        try:
            out.append(str(uuid.UUID(s)))
        except ValueError as e:
            raise ValueError(f"invalid document id: {s}") from e
    return out


def _normalize_keywords(raw: list | None) -> list[str]:
    return [str(k).strip() for k in (raw or []) if str(k).strip()]


def list_eval_cases(owner_id: uuid.UUID, domain_id: uuid.UUID) -> list[dict] | None:
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            return None
        rows = (
            session.execute(
                select(DomainEvalCase)
                .where(DomainEvalCase.domain_id == domain_id)
                .order_by(DomainEvalCase.ordinal, DomainEvalCase.created_at, DomainEvalCase.id)
            )
            .scalars()
            .all()
        )
        return [eval_case_to_dict(r) for r in rows]


def create_eval_case(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    *,
    question: str,
    expected_answer: str | None = None,
    expected_citation_doc_ids: list | None = None,
    expected_keywords: list | None = None,
    ordinal: int = 0,
) -> dict:
    q = (question or "").strip()
    if not q:
        raise ValueError("question must be non-empty")
    doc_ids = _normalize_doc_ids(expected_citation_doc_ids)
    kws = _normalize_keywords(expected_keywords)
    ans = (expected_answer or "").strip() or None
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise LookupError("domain not found")
        n = session.execute(
            select(func.count())
            .select_from(DomainEvalCase)
            .where(DomainEvalCase.domain_id == domain_id)
        ).scalar_one()
        if int(n) >= MAX_EVAL_CASES:
            raise ValueError(f"eval case limit is {MAX_EVAL_CASES}")
        row = DomainEvalCase(
            domain_id=domain_id,
            question=q,
            expected_answer=ans,
            expected_citation_doc_ids=doc_ids,
            expected_keywords=kws,
            ordinal=int(ordinal or 0),
        )
        session.add(row)
        session.flush()
        return eval_case_to_dict(row)


def delete_eval_case(
    owner_id: uuid.UUID, domain_id: uuid.UUID, case_id: uuid.UUID
) -> bool:
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            return False
        row = session.execute(
            select(DomainEvalCase).where(
                DomainEvalCase.id == case_id,
                DomainEvalCase.domain_id == domain_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return False
        session.delete(row)
        session.flush()
        return True
