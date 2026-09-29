"""Phase 6 — Domain eval golden sets + deterministic quality scores.

Revamp round 2 (Quality tab, DM-70…DM-79): cases gain ``expected_files`` (names, and whether each
file still exists) and can be edited; test runs are asynchronous — ``start_eval_run`` starts the
durable workflow ``run_domain_eval_workflow``, one step per case, each appending its result
(with the top 3 passages search found) to ``scores.per_case`` so the page can show progress.
``scores.config`` snapshots the settings the run used, for "Compare with".
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from dbos import DBOS
from sqlalchemy import func, select

from tvashtr.control_plane.domain_ask import (
    DomainAskError,
    coerce_retrieval_top_k,
    retrieve_domain,
)
from tvashtr.control_plane.domain_retrieve import coerce_retrieval_mode
from tvashtr.control_plane.domains import _owned_domain
from tvashtr.db import session_scope
from tvashtr.models import Domain, DomainDocument, DomainEvalCase, DomainEvalRun

MAX_EVAL_CASES = 50
# The Quality tab's words (DM-68, DM-71, OQ-26).
QUESTION_REQUIRED = "Write the question first."
NOTHING_TO_CHECK = "Add a file or a key word, so there’s something to check."
CASE_LIMIT = "You can have up to 50 test questions."
NO_CASES = "Add a test question first."
# A run still "running" after this long died with its process (the old sync runs had no workflow).
RUN_STALE_AFTER = timedelta(minutes=15)
RUN_STOPPED = "The test run stopped before it finished."
# Passages kept per case for "What search found (top 3 of k)" (DM-77).
TOP_PASSAGES = 3


def score_hit_at_k(expected_doc_ids: list[str] | None, citations: list[dict]) -> bool | None:
    ids = [str(x).strip() for x in (expected_doc_ids or []) if str(x).strip()]
    if not ids:
        return None
    cited = {str(c.get("document_id") or "") for c in citations}
    return any(eid in cited for eid in ids)


def score_keyword_hit(expected_keywords: list[str] | None, citations: list[dict]) -> bool | None:
    kws = [str(k).strip() for k in (expected_keywords or []) if str(k).strip()]
    if not kws:
        return None
    hay = " ".join(str(c.get("excerpt") or "") for c in citations).lower()
    return all(k.lower() in hay for k in kws)


def aggregate_eval_scores(per_case: list[dict], *, top_k: int, retrieval_mode: str) -> dict:
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


def eval_case_to_dict(row: DomainEvalCase, names: dict[str, str] | None = None) -> dict:
    """``names`` maps the domain's existing document ids to file names (for ``expected_files``)."""
    ids = list(row.expected_citation_doc_ids or [])
    return {
        "case_id": str(row.id),
        "domain_id": str(row.domain_id),
        "question": row.question,
        "expected_answer": row.expected_answer,
        "expected_citation_doc_ids": ids,
        "expected_files": [
            {
                "document_id": i,
                "filename": (names or {}).get(i),
                "exists": i in (names or {}),
            }
            for i in ids
        ],
        "expected_keywords": list(row.expected_keywords or []),
        "ordinal": int(row.ordinal or 0),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _file_names(session, domain_id: uuid.UUID) -> dict[str, str]:
    rows = session.execute(
        select(DomainDocument.id, DomainDocument.filename).where(
            DomainDocument.domain_id == domain_id
        )
    ).all()
    return {str(i): n for i, n in rows}


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
        names = _file_names(session, domain_id)
        return [eval_case_to_dict(r, names) for r in rows]


def create_eval_case(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    *,
    question: str,
    expected_answer: str | None = None,
    expected_citation_doc_ids: list | None = None,
    expected_keywords: list | None = None,
    ordinal: int = 0,
    require_check: bool = False,
) -> dict:
    """``require_check`` (the HTTP route) also needs a file or a key word to check (DM-68)."""
    q = (question or "").strip()
    if not q:
        raise ValueError(QUESTION_REQUIRED)
    doc_ids = _normalize_doc_ids(expected_citation_doc_ids)
    kws = _normalize_keywords(expected_keywords)
    ans = (expected_answer or "").strip() or None
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise LookupError("domain not found")
        if require_check and not doc_ids and not kws:
            raise ValueError(NOTHING_TO_CHECK)
        n = session.execute(
            select(func.count())
            .select_from(DomainEvalCase)
            .where(DomainEvalCase.domain_id == domain_id)
        ).scalar_one()
        if int(n) >= MAX_EVAL_CASES:
            raise ValueError(CASE_LIMIT)
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
        return eval_case_to_dict(row, _file_names(session, domain_id))


def update_eval_case(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    case_id: uuid.UUID,
    *,
    question: str | None = None,
    expected_citation_doc_ids: list | None = None,
    expected_keywords: list | None = None,
) -> dict:
    """Edit a test question (DM-78): only the given fields change; the same rules as creating.

    Raises ``LookupError("domain not found" | "case not found")`` and ``ValueError`` (the copy)."""
    doc_ids = (
        _normalize_doc_ids(expected_citation_doc_ids)
        if expected_citation_doc_ids is not None
        else None
    )
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            raise LookupError("domain not found")
        row = session.execute(
            select(DomainEvalCase).where(
                DomainEvalCase.id == case_id, DomainEvalCase.domain_id == domain_id
            )
        ).scalar_one_or_none()
        if row is None:
            raise LookupError("case not found")
        q = row.question if question is None else question.strip()
        ids = list(row.expected_citation_doc_ids or []) if doc_ids is None else doc_ids
        kws = (
            list(row.expected_keywords or [])
            if expected_keywords is None
            else _normalize_keywords(expected_keywords)
        )
        if not q:
            raise ValueError(QUESTION_REQUIRED)
        if not ids and not kws:
            raise ValueError(NOTHING_TO_CHECK)
        row.question = q
        row.expected_citation_doc_ids = ids
        row.expected_keywords = kws
        session.flush()
        return eval_case_to_dict(row, _file_names(session, domain_id))


def delete_eval_case(owner_id: uuid.UUID, domain_id: uuid.UUID, case_id: uuid.UUID) -> bool:
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


def latest_eval_run_for_owner(
    owner_id: uuid.UUID, domain_id: uuid.UUID
) -> tuple[bool, dict | None]:
    """Return (domain_owned, run_or_none)."""
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            return False, None
        row = session.execute(
            select(DomainEvalRun)
            .where(DomainEvalRun.domain_id == domain_id)
            .order_by(DomainEvalRun.created_at.desc(), DomainEvalRun.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        return True, (eval_run_to_dict(row) if row else None)


def config_snapshot(config: dict | None) -> dict:
    """The settings a run used (``scores.config``), for "Compare with" (DM-73)."""
    cfg = dict(config or {})
    return {k: cfg[k] for k in ("chunking", "embedding", "retrieval", "generation") if k in cfg}


def _case_snapshots(session, domain_id: uuid.UUID) -> list[dict]:
    cases = (
        session.execute(
            select(DomainEvalCase)
            .where(DomainEvalCase.domain_id == domain_id)
            .order_by(DomainEvalCase.ordinal, DomainEvalCase.created_at, DomainEvalCase.id)
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(c.id),
            "question": c.question,
            "expected_citation_doc_ids": list(c.expected_citation_doc_ids or []),
            "expected_keywords": list(c.expected_keywords or []),
        }
        for c in cases
    ]


def score_case(owner_id: uuid.UUID, domain_id: uuid.UUID, snap: dict) -> dict:
    """Search for one test question and score it; ``top`` = the first passages search found."""
    entry: dict[str, Any] = {
        "case_id": str(snap["id"]),
        "question": snap["question"],
        "hit": None,
        "keyword_hit": None,
        "citation_doc_ids": [],
        "top": [],
        "latency_ms": None,
        "error": None,
    }
    try:
        result = retrieve_domain(owner_id, domain_id, snap["question"])
        cites = list(result.get("citations") or [])
        entry["citation_doc_ids"] = [str(c.get("document_id") or "") for c in cites]
        entry["top"] = [
            {
                "number": i + 1,
                "document_id": str(c.get("document_id") or ""),
                "filename": c.get("filename"),
                "excerpt": c.get("excerpt") or "",
            }
            for i, c in enumerate(cites[:TOP_PASSAGES])
        ]
        entry["latency_ms"] = result.get("latency_ms")
        entry["hit"] = score_hit_at_k(snap["expected_citation_doc_ids"], cites)
        entry["keyword_hit"] = score_keyword_hit(snap["expected_keywords"], cites)
    except DomainAskError as e:
        detail = e.detail
        entry["error"] = detail.get("message") if isinstance(detail, dict) else str(detail)
    except Exception as e:  # any search failure is this case's error, never a stuck run
        entry["error"] = str(e)[:2000] or e.__class__.__name__
    return entry


def run_domain_eval(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict:
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise LookupError("domain not found")
        cfg = dict(domain.config or {})
        top_k = coerce_retrieval_top_k(cfg)
        mode = coerce_retrieval_mode(cfg)
        case_snapshots = _case_snapshots(session, domain_id)
        if not case_snapshots:
            raise ValueError("no eval cases — add golden questions before running eval")
        if len(case_snapshots) > MAX_EVAL_CASES:
            raise ValueError(f"eval case limit is {MAX_EVAL_CASES}")
        run = DomainEvalRun(domain_id=domain_id, status="running")
        session.add(run)
        session.flush()
        run_id = run.id

    per_case = [score_case(owner_id, domain_id, snap) for snap in case_snapshots]

    scores = aggregate_eval_scores(per_case, top_k=top_k, retrieval_mode=mode)
    scores["config"] = config_snapshot(cfg)
    with session_scope() as session:
        run = session.get(DomainEvalRun, run_id)
        assert run is not None
        run.status = "completed"
        run.scores = scores
        run.completed_at = datetime.now(UTC)
        session.flush()
        return eval_run_to_dict(run)


# ---- Asynchronous test runs (the Quality tab, DM-74/DM-75) ----


def _run_numbers(session, domain_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """Run id → its number within the domain (1 = the first run)."""
    ids = (
        session.execute(
            select(DomainEvalRun.id)
            .where(DomainEvalRun.domain_id == domain_id)
            .order_by(DomainEvalRun.created_at, DomainEvalRun.id)
        )
        .scalars()
        .all()
    )
    return {rid: i + 1 for i, rid in enumerate(ids)}


def run_view(run: DomainEvalRun, number: int, *, full: bool = True) -> dict:
    """A run for the Quality tab: flat scores, progress and (``full``) every case's result."""
    scores = dict(run.scores or {})
    per_case = list(scores.get("per_case") or [])
    status, error = run.status, run.error_message
    if status == "running" and run.created_at < datetime.now(UTC) - RUN_STALE_AFTER:
        # Its workflow died (the row can't finish itself): say so, so the page stops waiting.
        status, error = "failed", error or RUN_STOPPED
    view = {
        "run_id": str(run.id),
        "number": number,
        "status": status,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "hit_at_k": scores.get("hit_at_k"),
        "keyword_hit": scores.get("keyword_hit"),
        "retrieval_mode": scores.get("retrieval_mode"),
        "top_k": scores.get("top_k"),
        "config": scores.get("config"),
        "progress": {"done": len(per_case), "total": int(scores.get("cases_total") or 0)},
        "error_message": error,
    }
    if full:
        view["domain_id"] = str(run.domain_id)
        view["scores"] = run.scores
    return view


def start_eval_run(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict:
    """Start running every test question (``POST …/eval/runs``). A run already going is returned
    instead of starting a second one. Raises ``LookupError`` / ``ValueError(NO_CASES)``."""
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            raise LookupError("domain not found")
        domain = session.execute(
            select(Domain).where(Domain.id == domain_id).with_for_update()
        ).scalar_one()
        running = session.execute(
            select(DomainEvalRun)
            .where(
                DomainEvalRun.domain_id == domain_id,
                DomainEvalRun.status == "running",
                DomainEvalRun.created_at > datetime.now(UTC) - RUN_STALE_AFTER,
            )
            .order_by(DomainEvalRun.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if running is not None:
            return run_view(running, _run_numbers(session, domain_id)[running.id])
        snaps = _case_snapshots(session, domain_id)
        if not snaps:
            raise ValueError(NO_CASES)
        cfg = dict(domain.config or {})
        run = DomainEvalRun(
            domain_id=domain_id,
            status="running",
            scores={
                "cases_total": len(snaps),
                "top_k": coerce_retrieval_top_k(cfg),
                "retrieval_mode": coerce_retrieval_mode(cfg),
                "config": config_snapshot(cfg),
                "per_case": [],
            },
        )
        session.add(run)
        session.flush()
        run_id = run.id
        view = run_view(run, _run_numbers(session, domain_id)[run.id])
    try:
        DBOS.start_workflow(
            run_domain_eval_workflow, str(owner_id), str(domain_id), str(run_id), snaps
        )
    except Exception:
        with session_scope() as session:
            row = session.get(DomainEvalRun, run_id)
            if row is not None:
                row.status = "failed"
                row.error_message = "The test run couldn’t start."
        raise
    return view


def list_eval_runs(owner_id: uuid.UUID, domain_id: uuid.UUID, limit: int = 20) -> list[dict] | None:
    """The domain's runs, newest first (``None`` when the domain isn't the owner's)."""
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            return None
        numbers = _run_numbers(session, domain_id)
        rows = (
            session.execute(
                select(DomainEvalRun)
                .where(DomainEvalRun.domain_id == domain_id)
                .order_by(DomainEvalRun.created_at.desc(), DomainEvalRun.id.desc())
                .limit(max(1, min(int(limit), 100)))
            )
            .scalars()
            .all()
        )
        return [run_view(r, numbers[r.id], full=False) for r in rows]


def get_eval_run(owner_id: uuid.UUID, domain_id: uuid.UUID, run_id: uuid.UUID) -> dict:
    """One run with every case's result. Raises ``LookupError("domain not found" | "run not
    found")``."""
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            raise LookupError("domain not found")
        row = session.execute(
            select(DomainEvalRun).where(
                DomainEvalRun.id == run_id, DomainEvalRun.domain_id == domain_id
            )
        ).scalar_one_or_none()
        if row is None:
            raise LookupError("run not found")
        return run_view(row, _run_numbers(session, domain_id)[row.id])


@DBOS.step()
def eval_case_step(owner_id: str, domain_id: str, run_id: str, snap: dict) -> dict:
    """Score one case and append it to the run (replacing an earlier try at the same case)."""
    entry = score_case(uuid.UUID(owner_id), uuid.UUID(domain_id), snap)
    with session_scope() as session:
        run = session.execute(
            select(DomainEvalRun).where(DomainEvalRun.id == uuid.UUID(run_id)).with_for_update()
        ).scalar_one_or_none()
        if run is not None:
            scores = dict(run.scores or {})
            kept = [p for p in scores.get("per_case") or [] if p.get("case_id") != entry["case_id"]]
            scores["per_case"] = [*kept, entry]
            run.scores = scores
    return {"case_id": entry["case_id"], "error": entry["error"]}


@DBOS.step()
def finish_eval_run_step(run_id: str) -> dict:
    """Add up the cases; a run where every case failed is ``failed`` with the first reason."""
    with session_scope() as session:
        run = session.execute(
            select(DomainEvalRun).where(DomainEvalRun.id == uuid.UUID(run_id)).with_for_update()
        ).scalar_one_or_none()
        if run is None:
            return {"status": "gone"}
        scores = dict(run.scores or {})
        per_case = list(scores.get("per_case") or [])
        out = aggregate_eval_scores(
            per_case,
            top_k=int(scores.get("top_k") or 8),
            retrieval_mode=str(scores.get("retrieval_mode") or "dense"),
        )
        out["config"] = scores.get("config")
        errors = [p["error"] for p in per_case if p.get("error")]
        failed = bool(per_case) and len(errors) == len(per_case)
        run.status = "failed" if failed else "completed"
        run.error_message = errors[0][:2000] if failed else None
        run.scores = out
        run.completed_at = datetime.now(UTC)
        return {"status": run.status}


@DBOS.workflow()
def run_domain_eval_workflow(owner_id: str, domain_id: str, run_id: str, cases: list[dict]) -> dict:
    """Run every test question, one step each, then add up the scores."""
    for snap in cases:
        eval_case_step(owner_id, domain_id, run_id, snap)
    return finish_eval_run_step(run_id)
