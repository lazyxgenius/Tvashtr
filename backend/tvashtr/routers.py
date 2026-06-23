"""HTTP surface for the model gateway + document layer (P0.2).

Kept in its own router module so ``main.py`` stays focused on app/DBOS wiring.
GET endpoints return plain dicts (matching the P0.1 style) to avoid coupling the
API to ORM/gateway types.
"""

import os
import uuid
from decimal import Decimal
from typing import Literal

from dbos import DBOS, SetWorkflowID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, update

from tvashtr import db
from tvashtr.config import get_settings
from tvashtr.control_plane.doc_writer import generate_doc
from tvashtr.control_plane.team_run import run_team
from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
from tvashtr.documents.service import get_document_with_versions, list_documents
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    Document,
    DocumentVersion,
    Edge,
    HumanTask,
    Run,
    RunEvent,
)

# Run statuses that are already terminal: a kill switch must not clobber them.
_TERMINAL_RUN_STATUSES = ("completed", "failed", "rejected", "over_budget")
# Map the resolve API's decision verb to the durable resolution recorded on the task.
_DECISION_TO_RESOLUTION = {"approve": "approved", "reject": "rejected"}

router = APIRouter()


class GenerateDocRequest(BaseModel):
    topic: str


class StartResponse(BaseModel):
    workflow_id: str


class CreateRunRequest(BaseModel):
    idea: str | None = None
    # Per-run dollar cap (P1.2). When omitted, falls back to
    # ``Settings.default_run_budget_usd`` (itself ``None`` = no cap by default).
    budget_cap_usd: Decimal | None = None
    # Which hardcoded team the run builds (P1.5a). Default ``two_node`` keeps
    # skeleton-run/skeleton-crash (which POST neither field) byte-for-byte unchanged;
    # ``review_loop`` builds the 3-node PM -> Engineer <-> Reviewer cyclic team that
    # ``make loop-run`` (and, next prompt, the UI) requests.
    team_shape: Literal["two_node", "review_loop"] = "two_node"


class ResolveTaskRequest(BaseModel):
    decision: Literal["approve", "reject"]
    note: str | None = None


# Pinned, deterministically-checkable deliverable (env-overridable). Keeping the
# target fixed is what makes skeleton-run (and P0.4b) deterministic despite LLM
# variance: the PM restates this exact path + line, the Engineer creates it.
DEFAULT_IDEA = os.environ.get(
    "TVASHTR_SKELETON_IDEA",
    "Add a file named greeting.txt at the repository root, containing exactly this "
    "single line and nothing else:\nShipped by the Tvashtr PM->Engineer team",
)


def resolve_run_idea(body_idea: str | None) -> str:
    """The canonical ``Run.idea`` seeding rule (pure, unit-tested): an explicit idea from the
    request body wins; otherwise fall back to the pinned ``DEFAULT_IDEA`` skeleton. The
    capstone feature run (``make loop-feature-docker``) POSTs ``config.TASK_LIST_IDEA`` as
    ``body_idea``, so the same one rule seeds either the skeleton or the real feature into
    ``Run.idea`` — no migration (``Run.idea`` is already the canonical-idea seat)."""
    return body_idea or DEFAULT_IDEA


def _cost_to_dict(row: CostRecord) -> dict:
    return {
        "id": row.id,
        "workflow_id": row.workflow_id,
        "idempotency_key": row.idempotency_key,
        "model_requested": row.model_requested,
        "model_used": row.model_used,
        "prompt_tokens": row.prompt_tokens,
        "completion_tokens": row.completion_tokens,
        "total_tokens": row.total_tokens,
        "cost_usd": float(row.cost_usd),
        "created_at": row.created_at.isoformat(),
    }


def _document_meta(doc: Document) -> dict:
    return {
        "id": str(doc.id),
        "title": doc.title,
        "doc_type": doc.doc_type,
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat(),
    }


def _version_to_dict(version: DocumentVersion) -> dict:
    return {
        "id": str(version.id),
        "version_no": version.version_no,
        "content": version.content,
        "created_by": version.created_by,
        "created_at": version.created_at.isoformat(),
    }


@router.post("/api/spike/generate-doc", response_model=StartResponse)
def start_generate_doc(body: GenerateDocRequest) -> StartResponse:
    """Start the generate_doc workflow in the background; return its id."""
    handle = DBOS.start_workflow(generate_doc, body.topic)
    return StartResponse(workflow_id=handle.workflow_id)


@router.get("/api/spike/generate-doc/{workflow_id}")
def get_generate_doc(workflow_id: str) -> dict:
    """Return DBOS status, the workflow result (if finished), and its cost rows."""
    status = DBOS.get_workflow_status(workflow_id)
    state = status.status if status is not None else "NOT_FOUND"
    result = status.output if status is not None and state == "SUCCESS" else None

    with db.session_scope() as session:
        rows = (
            session.execute(
                select(CostRecord)
                .where(CostRecord.workflow_id == workflow_id)
                .order_by(CostRecord.id)
            )
            .scalars()
            .all()
        )
        costs = [_cost_to_dict(r) for r in rows]

    return {
        "workflow_id": workflow_id,
        "status": state,
        "result": result,
        "costs": costs,
    }


@router.get("/api/documents")
def get_documents() -> dict:
    return {"documents": [_document_meta(d) for d in list_documents()]}


@router.get("/api/documents/{document_id}")
def get_document(document_id: str) -> dict:
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid document id") from exc

    doc = get_document_with_versions(doc_uuid)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")

    payload = _document_meta(doc)
    payload["versions"] = [_version_to_dict(v) for v in doc.versions]
    return payload


@router.get("/api/costs")
def get_costs(workflow_id: str | None = None) -> dict:
    """Return cost rows — all of them, or just those for ``workflow_id``."""
    with db.session_scope() as session:
        stmt = select(CostRecord).order_by(CostRecord.id)
        if workflow_id is not None:
            stmt = stmt.where(CostRecord.workflow_id == workflow_id)
        rows = session.execute(stmt).scalars().all()
        return {"costs": [_cost_to_dict(r) for r in rows]}


@router.get("/api/spike/run-events/{run_id}")
def get_run_events(run_id: str) -> dict:
    """Return the persisted, ordered engine events for a run (P0.3)."""
    with db.session_scope() as session:
        rows = (
            session.execute(
                select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.seq)
            )
            .scalars()
            .all()
        )
        return {
            "run_id": run_id,
            "events": [
                {
                    "seq": r.seq,
                    "kind": r.kind,
                    "payload": r.payload,
                    "created_at": r.created_at.isoformat(),
                }
                for r in rows
            ],
        }


def _run_to_dict(run: Run) -> dict:
    return {
        "id": str(run.id),
        "team_graph_id": str(run.team_graph_id),
        "idea": run.idea,
        "status": run.status,
        "pm_document_id": str(run.pm_document_id) if run.pm_document_id else None,
        "ship_commit_sha": run.ship_commit_sha,
        "ship_tag": run.ship_tag,
        "cost_total_usd": float(run.cost_total_usd) if run.cost_total_usd is not None else None,
        "created_at": run.created_at.isoformat(),
        "updated_at": run.updated_at.isoformat(),
    }


@router.post("/api/runs")
def create_run(body: CreateRunRequest) -> dict:
    """Build the requested team (default the 2-node team; ``review_loop`` the 3-node
    cyclic team), create the run row, and start ``run_team`` with an explicit workflow
    id == run_id, so ``DBOS.workflow_id`` keys every write."""
    idea = resolve_run_idea(body.idea)
    if body.team_shape == "review_loop":
        team_graph_id = build_review_loop_team()
    else:
        team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())

    # Per-run cap: the request body wins, else the configured default (P1.2 DP-A).
    cap = body.budget_cap_usd
    if cap is None:
        cap = get_settings().default_run_budget_usd

    with db.session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                idea=idea,
                workflow_id=run_id,
                status="running",
                budget_cap_usd=cap,
            )
        )

    with SetWorkflowID(run_id):
        DBOS.start_workflow(run_team, idea)

    return {"run_id": run_id}


@router.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    """Return the DBOS workflow status, the run row, and the run's cost rows."""
    status = DBOS.get_workflow_status(run_id)
    workflow_status = status.status if status is not None else "NOT_FOUND"

    with db.session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        cost_rows = (
            session.execute(
                select(CostRecord).where(CostRecord.workflow_id == run_id).order_by(CostRecord.id)
            )
            .scalars()
            .all()
        )
        costs = [_cost_to_dict(r) for r in cost_rows]
        run_dict = _run_to_dict(run) if run is not None else None

    return {
        "run_id": run_id,
        "workflow_status": workflow_status,
        "run": run_dict,
        "costs": costs,
    }


@router.get("/api/runs/{run_id}/graph")
def get_run_graph(run_id: str) -> dict:
    """Read-only team graph (nodes + edges) for a run — what the canvas draws.

    Additive P1.5a fields (existing field names/shapes unchanged — the current
    frontend ignores unknown keys): each node carries its live ``status`` +
    ``iteration`` from its latest ``AgentInvocation`` (the backend now owns per-node
    truth; default ``"idle"``/``0`` when the executor has not reached it), and each
    edge carries its routing ``conditions``."""
    with db.session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")

        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )
        edges = (
            session.execute(select(Edge).where(Edge.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )
        invocations = (
            session.execute(select(AgentInvocation).where(AgentInvocation.run_id == run_id))
            .scalars()
            .all()
        )
        # The node's live state = its latest invocation (max iteration for that node).
        latest_by_node: dict[str, AgentInvocation] = {}
        for inv in invocations:
            key = str(inv.node_id)
            if key not in latest_by_node or inv.iteration > latest_by_node[key].iteration:
                latest_by_node[key] = inv

        # Deterministic left-to-right order (PM at x=0 before Engineer/Reviewer).
        nodes = sorted(nodes, key=lambda n: (n.position.get("x", 0), str(n.id)))

        return {
            "run_id": run_id,
            "team_graph_id": str(run.team_graph_id),
            "nodes": [
                {
                    "id": str(n.id),
                    "role_name": n.role_name,
                    "kind": n.kind,
                    "model": n.model,
                    "engine": n.engine,
                    "position": n.position,
                    # P1.5b: gate/terminal node metadata (gate_kind/title/description or
                    # terminal_kind), so the canvas (prompt 2) can render gate + terminal
                    # nodes; NULL for completion/agent nodes.
                    "config": n.config,
                    "status": (
                        latest_by_node[str(n.id)].status if str(n.id) in latest_by_node else "idle"
                    ),
                    "iteration": (
                        latest_by_node[str(n.id)].iteration if str(n.id) in latest_by_node else 0
                    ),
                }
                for n in nodes
            ],
            "edges": [
                {
                    "id": str(e.id),
                    "source_node_id": str(e.source_node_id),
                    "target_node_id": str(e.target_node_id),
                    "edge_type": e.edge_type,
                    "conditions": e.conditions,
                }
                for e in edges
            ],
        }


def _humantask_to_dict(task: HumanTask) -> dict:
    return {
        "id": task.id,
        "run_id": task.run_id,
        "kind": task.kind,
        "priority": task.priority,
        "blocking": task.blocking,
        "topic": task.topic,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "resolution": task.resolution,
        "resolution_note": task.resolution_note,
        "created_at": task.created_at.isoformat(),
        "resolved_at": task.resolved_at.isoformat() if task.resolved_at else None,
    }


@router.get("/api/runs/{run_id}/tasks")
def get_run_tasks(run_id: str) -> dict:
    """Tasks-for-Human items for a run, oldest first (what the P1.1b panel draws)."""
    with db.session_scope() as session:
        rows = (
            session.execute(
                select(HumanTask).where(HumanTask.run_id == run_id).order_by(HumanTask.id)
            )
            .scalars()
            .all()
        )
        return {"run_id": run_id, "tasks": [_humantask_to_dict(t) for t in rows]}


@router.post("/api/runs/{run_id}/tasks/{task_id}/resolve")
def resolve_task(run_id: str, task_id: int, body: ResolveTaskRequest) -> dict:
    """Resolve a pending gate task by **signaling** the waiting workflow.

    This endpoint is a pure signal: it validates the task is pending and calls
    ``DBOS.send``. The workflow's ``close_gate_step`` is the single writer that
    marks the ``HumanTask`` resolved, so the table can't disagree with the run.
    """
    with db.session_scope() as session:
        task = session.execute(
            select(HumanTask).where(HumanTask.id == task_id, HumanTask.run_id == run_id)
        ).scalar_one_or_none()
        if task is None:
            raise HTTPException(status_code=404, detail="task not found")
        if task.status != "pending":
            raise HTTPException(status_code=409, detail=f"task already {task.status}")
        if task.topic is None:
            raise HTTPException(status_code=409, detail="task has no gate topic to signal")
        topic = task.topic

    resolution = _DECISION_TO_RESOLUTION[body.decision]
    DBOS.send(run_id, {"resolution": resolution, "note": body.note}, topic=topic)
    return {
        "run_id": run_id,
        "task_id": task_id,
        "decision": body.decision,
        "resolution": resolution,
        "signaled": True,
    }


@router.post("/api/runs/{run_id}/tasks/{task_id}/acknowledge")
def acknowledge_task(run_id: str, task_id: int) -> dict:
    """Acknowledge (dismiss) a non-blocking, topic-less ``low_nudge`` task — the drawer's
    Low/nudges side (P1.5b, e.g. the 80%-of-cap ``budget_threshold`` nudge).

    Unlike a gate task, **nothing waits** on a nudge, so this marks it resolved DIRECTLY
    (NO ``DBOS.send``). 404 if no such task for the run; 409 if the task is a gate (it is
    ``blocking`` OR carries a ``topic`` — those must go through ``/resolve``, which signals
    the workflow); 409 if already resolved."""
    with db.session_scope() as session:
        task = session.execute(
            select(HumanTask).where(HumanTask.id == task_id, HumanTask.run_id == run_id)
        ).scalar_one_or_none()
        if task is None:
            raise HTTPException(status_code=404, detail="task not found")
        if task.blocking or task.topic is not None:
            raise HTTPException(
                status_code=409, detail="gate task: resolve via /resolve, not /acknowledge"
            )
        if task.status != "pending":
            raise HTTPException(status_code=409, detail=f"task already {task.status}")
        session.execute(
            update(HumanTask)
            .where(HumanTask.id == task_id)
            .values(status="resolved", resolution="acknowledged", resolved_at=func.now())
        )
    return {"run_id": run_id, "task_id": task_id, "resolution": "acknowledged"}


@router.post("/api/runs/{run_id}/cancel")
def cancel_run(run_id: str) -> dict:
    """Kill switch: cancel the run's workflow and mark the run ``cancelled``.

    ``DBOS.cancel_workflow`` flips the workflow to ``CANCELLED`` (so recovery's
    PENDING-only scan never resurrects it, and its next step/recv boundary aborts)
    but does NOT interrupt a blocked ``recv``; the workflow may run no further step
    to record the status, so we set ``Run.status`` here directly, and we close the
    run's pending gate tasks (``resolution="cancelled"``) so a dead run leaves no
    actionable task. An **already-terminal** run is left fully untouched — no
    cancel, no status write — so cancelling a just-completed run can't flip a
    ``completed`` run's workflow to ``CANCELLED``.
    """
    blocked = (*_TERMINAL_RUN_STATUSES, "cancelled")
    with db.session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        already_terminal = run is not None and run.status in blocked

    if not already_terminal:
        DBOS.cancel_workflow(run_id)
        with db.session_scope() as session:
            session.execute(
                update(Run)
                .where(Run.workflow_id == run_id, Run.status.notin_(blocked))
                .values(status="cancelled")
            )
            session.execute(
                update(HumanTask)
                .where(HumanTask.run_id == run_id, HumanTask.status == "pending")
                .values(status="resolved", resolution="cancelled", resolved_at=func.now())
            )

    with db.session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        run_status = run.status if run is not None else None

    workflow_status = DBOS.get_workflow_status(run_id)
    return {
        "run_id": run_id,
        "status": run_status,
        "workflow_status": workflow_status.status if workflow_status is not None else "NOT_FOUND",
    }
