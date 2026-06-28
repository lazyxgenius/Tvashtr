"""Human-in-the-loop gate machinery — unit tests with **zero LLM / zero agent**.

A minimal ``gate_probe_workflow`` (open gate -> wait -> close -> return the
resolution) exercises the full ``open_gate_step`` / ``recv`` / ``send`` /
``close_gate_step`` / ``cancel_workflow`` / ``HumanTask`` path against a real DBOS
+ Postgres, without importing ``openhands`` or calling a model. The ``client``
fixture launches DBOS once; the probe workflow is registered at import (before
launch) like the other control-plane workflows.
"""

import time
import uuid

import pytest
from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from dbos._error import DBOSAwaitedWorkflowCancelledError
from sqlalchemy import select

from tvashtr.control_plane.gates import close_gate_step, open_gate_step, wait_at_gate
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import Run


@DBOS.workflow()
def gate_probe_workflow(topic: str, wait_seconds: float) -> dict:
    """Open a blocking gate, wait for a human resolution, close it, return it."""
    run_id = DBOS.workflow_id
    return wait_at_gate(
        run_id,
        topic,
        kind="gate_approval",
        priority="high_blocker",
        blocking=True,
        title="probe gate",
        description="probe gate for the offline gate tests",
        timeout_seconds=wait_seconds,
    )


# ---- helpers ---------------------------------------------------------------


def _make_run() -> str:
    """Create a team graph + a ``running`` Run row; return its run_id (== wf id)."""
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="gate probe",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def _run_status(run_id: str) -> str | None:
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        return run.status if run is not None else None


def _tasks(client, run_id: str) -> list[dict]:
    """Read tasks through the real HTTP endpoint (covers the serializer too)."""
    resp = client.get(f"/api/runs/{run_id}/tasks")
    assert resp.status_code == 200
    return resp.json()["tasks"]


def _wait_until(predicate, *, timeout: float = 10.0, interval: float = 0.05) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(interval)
    raise AssertionError("condition not met within timeout")


# ---- tests -----------------------------------------------------------------


def test_open_gate_creates_pending_task_and_pauses_run(client):
    run_id = _make_run()
    topic = f"gate:{run_id}:open"

    task_id = open_gate_step(
        run_id,
        kind="gate_approval",
        topic=topic,
        priority="high_blocker",
        blocking=True,
        title="approve me",
        description="desc",
    )
    assert isinstance(task_id, int)

    tasks = _tasks(client, run_id)
    assert len(tasks) == 1
    task = tasks[0]
    assert task["id"] == task_id
    assert task["status"] == "pending"
    assert task["blocking"] is True
    assert task["topic"] == topic
    assert task["kind"] == "gate_approval"
    assert task["priority"] == "high_blocker"
    assert task["resolution"] is None and task["resolved_at"] is None
    # A blocking gate pauses the run.
    assert _run_status(run_id) == "awaiting_human"


def test_open_and_close_gate_are_idempotent(client):
    run_id = _make_run()
    topic = f"gate:{run_id}:idem"

    id1 = open_gate_step(
        run_id,
        kind="gate_approval",
        topic=topic,
        priority="high_blocker",
        blocking=True,
        title="t",
        description="d",
    )
    id2 = open_gate_step(
        run_id,
        kind="gate_approval",
        topic=topic,
        priority="high_blocker",
        blocking=True,
        title="t",
        description="d",
    )
    assert id1 == id2  # insert-or-return: same task
    assert len(_tasks(client, run_id)) == 1  # no duplicate row

    close_gate_step(run_id, topic=topic, resolution="approved", note="ok")
    # A second close is a no-op (only pending rows match).
    close_gate_step(run_id, topic=topic, resolution="approved", note="ok")

    task = _tasks(client, run_id)[0]
    assert task["status"] == "resolved"
    assert task["resolution"] == "approved"
    assert task["resolution_note"] == "ok"
    assert task["resolved_at"] is not None
    assert _run_status(run_id) == "running"


def test_gate_blocks_until_resolved_then_resumes(client):
    run_id = _make_run()
    topic = f"gate:{run_id}:prd-approval"

    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(gate_probe_workflow, topic, 30.0)

    # The workflow opens the gate and blocks on recv.
    _wait_until(lambda: _run_status(run_id) == "awaiting_human")
    task = _tasks(client, run_id)[0]
    assert task["status"] == "pending"

    # Resolve through the real endpoint (which only signals via DBOS.send).
    resp = client.post(
        f"/api/runs/{run_id}/tasks/{task['id']}/resolve",
        json={"decision": "approve", "note": "lgtm"},
    )
    assert resp.status_code == 200
    assert resp.json()["resolution"] == "approved"

    # The recv unblocks and the workflow returns the resolution.
    assert handle.get_result() == {"resolution": "approved", "note": "lgtm"}

    task = _tasks(client, run_id)[0]
    assert task["status"] == "resolved"
    assert task["resolution"] == "approved"
    assert task["resolution_note"] == "lgtm"
    assert _run_status(run_id) == "running"

    status = DBOS.get_workflow_status(run_id)
    assert status is not None and status.status == "SUCCESS"


def test_gate_reject_resolution(client):
    run_id = _make_run()
    topic = f"gate:{run_id}:reject"

    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(gate_probe_workflow, topic, 30.0)

    _wait_until(lambda: _run_status(run_id) == "awaiting_human")
    task = _tasks(client, run_id)[0]

    resp = client.post(
        f"/api/runs/{run_id}/tasks/{task['id']}/resolve", json={"decision": "reject"}
    )
    assert resp.status_code == 200
    assert resp.json()["resolution"] == "rejected"

    assert handle.get_result() == {"resolution": "rejected", "note": None}

    task = _tasks(client, run_id)[0]
    assert task["status"] == "resolved"
    assert task["resolution"] == "rejected"


def test_resolve_unknown_or_nonpending_task_errors(client):
    run_id = _make_run()
    topic = f"gate:{run_id}:guard"

    # Unknown task id -> 404.
    resp = client.post(f"/api/runs/{run_id}/tasks/999999/resolve", json={"decision": "approve"})
    assert resp.status_code == 404

    # Resolve an already-resolved task -> 409.
    open_gate_step(
        run_id,
        kind="gate_approval",
        topic=topic,
        priority="high_blocker",
        blocking=True,
        title="t",
        description="d",
    )
    close_gate_step(run_id, topic=topic, resolution="approved", note=None)
    task = _tasks(client, run_id)[0]
    resp = client.post(
        f"/api/runs/{run_id}/tasks/{task['id']}/resolve", json={"decision": "approve"}
    )
    assert resp.status_code == 409


def test_cancel_at_gate_stops_workflow_and_marks_run_cancelled(client):
    run_id = _make_run()
    topic = f"gate:{run_id}:cancel"

    # Short per-wait so the cancel lands at the next recv boundary quickly.
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(gate_probe_workflow, topic, 1.0)

    _wait_until(lambda: _run_status(run_id) == "awaiting_human")

    resp = client.post(f"/api/runs/{run_id}/cancel")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "cancelled"
    assert body["workflow_status"] == "CANCELLED"
    # The kill switch sets Run.status directly (the workflow runs no further step).
    assert _run_status(run_id) == "cancelled"

    # The workflow must NOT progress past the gate: its next recv boundary aborts
    # with the cancellation error instead of running the engineer/ship steps.
    with pytest.raises(DBOSAwaitedWorkflowCancelledError):
        handle.get_result()

    # DBOS status stays CANCELLED; the cancel endpoint closes the pending gate
    # task so a dead run leaves nothing actionable.
    status = DBOS.get_workflow_status(run_id)
    assert status is not None and status.status == "CANCELLED"
    task = _tasks(client, run_id)[0]
    assert task["status"] == "resolved"
    assert task["resolution"] == "cancelled"
