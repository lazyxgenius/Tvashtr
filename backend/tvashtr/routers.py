"""HTTP surface for the model gateway + document layer (P0.2).

Kept in its own router module so ``main.py`` stays focused on app/DBOS wiring.
GET endpoints return plain dicts (matching the P0.1 style) to avoid coupling the
API to ORM/gateway types.
"""

import os
import uuid

from dbos import DBOS, SetWorkflowID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from tvashtr import db
from tvashtr.control_plane.doc_writer import generate_doc
from tvashtr.control_plane.team_run import run_team
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.documents.service import get_document_with_versions, list_documents
from tvashtr.models import CostRecord, Document, DocumentVersion, Run, RunEvent

router = APIRouter()


class GenerateDocRequest(BaseModel):
    topic: str


class StartResponse(BaseModel):
    workflow_id: str


class CreateRunRequest(BaseModel):
    idea: str | None = None


# Pinned, deterministically-checkable deliverable (env-overridable). Keeping the
# target fixed is what makes skeleton-run (and P0.4b) deterministic despite LLM
# variance: the PM restates this exact path + line, the Engineer creates it.
DEFAULT_IDEA = os.environ.get(
    "TVASHTR_SKELETON_IDEA",
    "Add a file named greeting.txt at the repository root, containing exactly this "
    "single line and nothing else:\nShipped by the Tvashtr PM->Engineer team",
)


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
    """Build a fresh 2-node team, create the run row, and start ``run_team`` with
    an explicit workflow id == run_id, so ``DBOS.workflow_id`` keys every write."""
    idea = body.idea or DEFAULT_IDEA
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())

    with db.session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                idea=idea,
                workflow_id=run_id,
                status="running",
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
