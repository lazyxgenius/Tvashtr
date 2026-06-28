"""Budget cost-cap enforcement — unit tests with **zero LLM / zero agent**.

Mirrors ``test_gates.py``: a minimal ``budget_probe_workflow`` exercises the real
between-steps enforcement path (``budget_check_step`` -> on breach
``wait_at_gate`` -> approve continues / reject finalizes ``over_budget``) against a
real DBOS + Postgres, without importing ``openhands`` or calling a model. Spend is
forced by inserting ``cost_records`` rows directly via the metering helper, so the
cap check is exercised deterministically and offline.
"""

import sys
import time
import uuid
from decimal import Decimal

from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane.budget import budget_check_step, mark_budget_overridden_step
from tvashtr.control_plane.team_run import apply_budget_hook, finalize_run_step
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.metering import record_agent_cost, running_cost
from tvashtr.models import Run


@DBOS.workflow()
def budget_probe_workflow(node_id: str) -> dict:
    """Mirror ``run_team``'s between-spend budget hook (P1.5b), WITHOUT LLM/agent:
    ``apply_budget_hook`` does the check + (on breach) the gate; reject -> finalize
    ``over_budget``, approve -> continue. Returns the branch taken so the test can
    assert it. (``node_id`` stands in for the spend-bearing node the hook fires after —
    it scopes the gate topic ``budget:{run_id}:{node_id}:1``.)"""
    run_id = DBOS.workflow_id
    rejected = apply_budget_hook(run_id, node_id=node_id, iteration=1)
    if rejected:
        finalize_run_step(run_id, status="over_budget")
        return {"status": "over_budget"}
    return {"status": "continued"}


# ---- helpers ---------------------------------------------------------------


def _make_run(*, cap: Decimal | None = None, overridden: bool = False) -> str:
    """Create a team graph + a ``running`` Run row with the given cap / override
    flag; return its run_id (== workflow id)."""
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="budget probe",
                workflow_id=run_id,
                status="running",
                budget_cap_usd=cap,
                budget_overridden=overridden,
            )
        )
    return run_id


def _add_cost(run_id: str, amount: Decimal, key: str) -> None:
    """Record one cost row for the run via the real metering helper."""
    record_agent_cost(
        workflow_id=run_id,
        idempotency_key=key,
        model="test/model",
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        cost_usd=float(amount),
    )


def _run_field(run_id: str, attr: str):
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        return getattr(run, attr) if run is not None else None


def _tasks(client, run_id: str) -> list[dict]:
    resp = client.get(f"/api/runs/{run_id}/tasks")
    assert resp.status_code == 200
    return resp.json()["tasks"]


def _pending_budget_task(client, run_id: str) -> dict:
    pending = [
        t
        for t in _tasks(client, run_id)
        if t["status"] == "pending" and t["kind"] == "budget_approval"
    ]
    assert len(pending) == 1, f"expected one pending budget task, got {pending}"
    return pending[0]


def _wait_until(predicate, *, timeout: float = 10.0, interval: float = 0.05) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(interval)
    raise AssertionError("condition not met within timeout")


# ---- budget_check_step -----------------------------------------------------


def test_budget_check_under_cap_is_not_over(client):
    run_id = _make_run(cap=Decimal("1.00"))
    _add_cost(run_id, Decimal("0.10"), key=f"{run_id}:c1")

    result = budget_check_step(run_id)
    assert result["over"] is False
    assert result["cap"] == 1.0
    assert abs(result["spent"] - 0.10) < 1e-9


def test_budget_check_over_cap_is_over(client):
    run_id = _make_run(cap=Decimal("0.001"))
    _add_cost(run_id, Decimal("0.01"), key=f"{run_id}:c1")

    result = budget_check_step(run_id)
    assert result["over"] is True
    assert result["cap"] == 0.001
    assert abs(result["spent"] - 0.01) < 1e-9


def test_budget_check_no_cap_is_never_over(client):
    run_id = _make_run(cap=None)
    _add_cost(run_id, Decimal("999.0"), key=f"{run_id}:c1")

    result = budget_check_step(run_id)
    assert result["over"] is False
    assert result["cap"] is None
    assert abs(result["spent"] - 999.0) < 1e-6


def test_budget_check_overridden_is_not_over(client):
    run_id = _make_run(cap=Decimal("0.001"), overridden=True)
    _add_cost(run_id, Decimal("0.01"), key=f"{run_id}:c1")

    result = budget_check_step(run_id)
    # Spend exceeds the cap, but the human already overrode -> not over.
    assert result["over"] is False


# ---- running_cost ----------------------------------------------------------


def test_running_cost_sums_rows_and_is_zero_with_none(client):
    run_id = _make_run(cap=None)
    assert running_cost(run_id) == Decimal("0")  # no rows -> coalesced 0

    _add_cost(run_id, Decimal("0.002000"), key=f"{run_id}:c1")
    _add_cost(run_id, Decimal("0.003000"), key=f"{run_id}:c2")
    assert running_cost(run_id) == Decimal("0.005000")


# ---- mark_budget_overridden_step (idempotency) -----------------------------


def test_mark_budget_overridden_is_idempotent(client):
    run_id = _make_run(cap=Decimal("0.001"))
    assert _run_field(run_id, "budget_overridden") is False

    mark_budget_overridden_step(run_id)
    assert _run_field(run_id, "budget_overridden") is True
    # A second call is a no-op (stays True, no error).
    mark_budget_overridden_step(run_id)
    assert _run_field(run_id, "budget_overridden") is True


# ---- the breach flow (approve continues / reject -> over_budget) -----------


def test_breach_reject_finalizes_over_budget(client):
    run_id = _make_run(cap=Decimal("0.001"))
    _add_cost(run_id, Decimal("0.01"), key=f"{run_id}:agent")

    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(budget_probe_workflow, "pre-ship")

    # The breach opens a blocking budget gate and pauses the run.
    _wait_until(lambda: _run_field(run_id, "status") == "awaiting_human")
    task = _pending_budget_task(client, run_id)
    assert task["priority"] == "high_blocker"
    assert task["topic"] == f"budget:{run_id}:pre-ship:1"

    # Reject via the real resolve endpoint (a pure DBOS.send signal).
    resp = client.post(
        f"/api/runs/{run_id}/tasks/{task['id']}/resolve", json={"decision": "reject"}
    )
    assert resp.status_code == 200

    assert handle.get_result() == {"status": "over_budget"}
    assert _run_field(run_id, "status") == "over_budget"
    assert _run_field(run_id, "budget_overridden") is False  # reject does NOT override
    task = _tasks(client, run_id)[0]  # the now-resolved budget task
    assert task["status"] == "resolved"
    assert task["resolution"] == "rejected"


def test_breach_approve_continues_and_records_override(client):
    run_id = _make_run(cap=Decimal("0.001"))
    _add_cost(run_id, Decimal("0.01"), key=f"{run_id}:agent")

    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(budget_probe_workflow, "pre-engineer")

    _wait_until(lambda: _run_field(run_id, "status") == "awaiting_human")
    task = _pending_budget_task(client, run_id)
    assert task["topic"] == f"budget:{run_id}:pre-engineer:1"

    resp = client.post(
        f"/api/runs/{run_id}/tasks/{task['id']}/resolve",
        json={"decision": "approve", "note": "ok, continue"},
    )
    assert resp.status_code == 200

    assert handle.get_result() == {"status": "continued"}
    # Approve records the override (so the rest of the run is not re-gated) and the
    # gate-close returns the run to "running".
    assert _run_field(run_id, "budget_overridden") is True
    assert _run_field(run_id, "status") == "running"
    task = _tasks(client, run_id)[0]
    assert task["status"] == "resolved"
    assert task["resolution"] == "approved"


def test_under_budget_continues_without_a_gate(client):
    """No breach -> apply_budget_hook returns False and opens no task (and the 80% nudge,
    well under threshold here, stays silent too)."""
    run_id = _make_run(cap=Decimal("1.00"))
    _add_cost(run_id, Decimal("0.01"), key=f"{run_id}:cheap")

    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(budget_probe_workflow, "pre-ship")

    assert handle.get_result() == {"status": "continued"}
    assert _tasks(client, run_id) == []  # no budget gate opened
    assert _run_field(run_id, "budget_overridden") is False


# ---- boundary --------------------------------------------------------------


def test_budget_module_imports_no_openhands():
    """budget.py must stay inside the offline boundary — no openhands.* at import."""
    for name in list(sys.modules):
        if name == "openhands" or name.startswith("openhands."):
            del sys.modules[name]
    sys.modules.pop("tvashtr.control_plane.budget", None)

    import tvashtr.control_plane.budget  # noqa: F401

    leaked = [m for m in sys.modules if m == "openhands" or m.startswith("openhands.")]
    assert leaked == [], f"control_plane.budget must not import openhands.*: {leaked}"
