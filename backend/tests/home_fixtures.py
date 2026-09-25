"""Shared builders for the Home-area tests (runs list, inbox, spend): a fresh signed-in account, a
library team, runs launched from it (on a real clone, as ``create_run`` does), cost rows, gate tasks
and invocations — all written straight to the database so no workflow runs."""

import uuid
from datetime import datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.control_plane.teams import clone_team_graph
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import AgentInvocation, AgentNode, CostRecord, HumanTask, Run


def fresh_account(prefix: str = "home") -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"{prefix}-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "home-password"})
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


def library_team(c: TestClient, name: str = "Indicator sprint team", template="review_loop") -> str:
    resp = c.post("/api/teams", json={"template": template, "name": name})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["team_graph_id"]


def make_run(
    owner_id: uuid.UUID,
    library_team_id: str | None,
    *,
    status: str = "running",
    idea: str = "Add an RSI indicator with tests",
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
    **extra,
) -> tuple[str, str]:
    """Insert a run of ``library_team_id`` (on a fresh clone of it); returns ``(run_id, clone)``."""
    if library_team_id is not None:
        clone = clone_team_graph(library_team_id)
    else:
        from tvashtr.control_plane.teams import build_two_node_team

        clone = build_two_node_team()
    run_id = uuid.uuid4()
    values = dict(
        id=run_id,
        team_graph_id=uuid.UUID(clone),
        owner_id=owner_id,
        idea=idea,
        workflow_id=str(run_id),
        status=status,
        library_team_id=uuid.UUID(library_team_id) if library_team_id else None,
        **extra,
    )
    if created_at is not None:
        values["created_at"] = created_at
    if updated_at is not None:
        values["updated_at"] = updated_at
    with session_scope() as session:
        session.add(Run(**values))
    return str(run_id), clone


def clone_node(clone: str, role: str) -> str:
    with session_scope() as session:
        return str(
            session.execute(
                select(AgentNode.id).where(
                    AgentNode.team_graph_id == uuid.UUID(clone), AgentNode.role_name == role
                )
            ).scalar_one()
        )


def add_cost(run_id: str, usd: str, created_at: datetime | None = None) -> None:
    row = CostRecord(
        workflow_id=run_id,
        idempotency_key=f"home-test:{uuid.uuid4().hex}",
        model_requested="openrouter/x",
        model_used="openrouter/x",
        prompt_tokens=1,
        completion_tokens=1,
        total_tokens=2,
        cost_usd=Decimal(usd),
    )
    if created_at is not None:
        row.created_at = created_at
    with session_scope() as session:
        session.add(row)


def open_gate(run_id: str, gate_node_id: str, kind: str = "prd_approval") -> int:
    with session_scope() as session:
        task = HumanTask(
            run_id=run_id,
            kind=kind,
            priority="high_blocker",
            blocking=True,
            topic=f"gate:{run_id}:{gate_node_id}",
            title="Approve the PRD before the Engineer builds",
            description="d",
            status="pending",
        )
        session.add(task)
        session.flush()
        return task.id


def add_invocation(
    run_id: str, node_id: str, status: str, *, iteration: int = 1, outcome_detail=None
) -> None:
    with session_scope() as session:
        session.add(
            AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(node_id),
                iteration=iteration,
                status=status,
                outcome_detail=outcome_detail,
            )
        )
