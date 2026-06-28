"""The 80%-of-cap budget nudge + the acknowledge endpoint — offline (no LLM, no agent).

The nudge (``maybe_emit_budget_nudge_step``) is the drawer's Low/nudges producer (P1.5b,
J4): a non-blocking, topic-less informational task created once when a capped run reaches
>= 80% of cap (and is not yet over — the ``budget_approval`` blocker owns "over"). It is
dismissed via ``POST /tasks/{id}/acknowledge`` (NOT ``/resolve`` — nothing waits on it).

Spend is forced by inserting ``cost_records`` rows via the metering helper, and the step is
called directly (like ``test_budget`` calls ``budget_check_step``), so this is deterministic
and offline.
"""

import sys
import uuid
from decimal import Decimal

from conftest import auth_user_id

from tvashtr.control_plane.budget_nudge import maybe_emit_budget_nudge_step
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.metering import record_agent_cost
from tvashtr.models import HumanTask, Run


def _make_run(*, cap: Decimal | None) -> str:
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="nudge probe",
                workflow_id=run_id,
                status="running",
                budget_cap_usd=cap,
            )
        )
    return run_id


def _add_cost(run_id: str, amount: Decimal, key: str) -> None:
    record_agent_cost(
        workflow_id=run_id,
        idempotency_key=key,
        model="test/model",
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        cost_usd=float(amount),
    )


def _tasks(client, run_id: str) -> list[dict]:
    resp = client.get(f"/api/runs/{run_id}/tasks")
    assert resp.status_code == 200
    return resp.json()["tasks"]


def _nudges(client, run_id: str) -> list[dict]:
    return [t for t in _tasks(client, run_id) if t["kind"] == "budget_threshold"]


# ---- the nudge producer ----------------------------------------------------


def test_nudge_fires_once_at_80pct_and_is_idempotent(client):
    run_id = _make_run(cap=Decimal("1.00"))
    _add_cost(run_id, Decimal("0.85"), key=f"{run_id}:c1")  # 85% of cap, not over

    maybe_emit_budget_nudge_step(run_id)
    nudges = _nudges(client, run_id)
    assert len(nudges) == 1
    t = nudges[0]
    assert t["priority"] == "low_nudge"
    assert t["blocking"] is False
    assert t["topic"] is None
    assert t["status"] == "pending"

    # Idempotent: a second call creates no duplicate (the existence check dedups).
    maybe_emit_budget_nudge_step(run_id)
    assert len(_nudges(client, run_id)) == 1


def test_nudge_silent_under_threshold(client):
    run_id = _make_run(cap=Decimal("1.00"))
    _add_cost(run_id, Decimal("0.50"), key=f"{run_id}:c1")  # 50% < 80%
    maybe_emit_budget_nudge_step(run_id)
    assert _nudges(client, run_id) == []


def test_nudge_silent_when_over_cap(client):
    # Over the cap: the budget_approval blocker owns that case, so the nudge stays silent.
    run_id = _make_run(cap=Decimal("1.00"))
    _add_cost(run_id, Decimal("1.50"), key=f"{run_id}:c1")
    maybe_emit_budget_nudge_step(run_id)
    assert _nudges(client, run_id) == []


def test_nudge_silent_with_no_cap(client):
    run_id = _make_run(cap=None)
    _add_cost(run_id, Decimal("999.0"), key=f"{run_id}:c1")
    maybe_emit_budget_nudge_step(run_id)
    assert _nudges(client, run_id) == []


# ---- the acknowledge endpoint ----------------------------------------------


def test_acknowledge_dismisses_a_nudge(client):
    run_id = _make_run(cap=Decimal("1.00"))
    _add_cost(run_id, Decimal("0.90"), key=f"{run_id}:c1")
    maybe_emit_budget_nudge_step(run_id)
    task = _nudges(client, run_id)[0]

    resp = client.post(f"/api/runs/{run_id}/tasks/{task['id']}/acknowledge")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"run_id": run_id, "task_id": task["id"], "resolution": "acknowledged"}

    resolved = next(t for t in _tasks(client, run_id) if t["id"] == task["id"])
    assert resolved["status"] == "resolved"
    assert resolved["resolution"] == "acknowledged"

    # Acknowledging an already-resolved task -> 409.
    again = client.post(f"/api/runs/{run_id}/tasks/{task['id']}/acknowledge")
    assert again.status_code == 409


def test_acknowledge_404_for_unknown_task(client):
    run_id = _make_run(cap=Decimal("1.00"))
    resp = client.post(f"/api/runs/{run_id}/tasks/999999999/acknowledge")
    assert resp.status_code == 404


def test_acknowledge_409_on_a_blocking_gate_task(client):
    # A blocking gate task (carries a topic) must go through /resolve, not /acknowledge.
    run_id = _make_run(cap=Decimal("1.00"))
    with session_scope() as session:
        task = HumanTask(
            run_id=run_id,
            kind="prd_approval",
            priority="high_blocker",
            blocking=True,
            topic=f"gate:{run_id}:some-node",
            title="t",
            description="d",
            status="pending",
        )
        session.add(task)
        session.flush()
        task_id = task.id

    resp = client.post(f"/api/runs/{run_id}/tasks/{task_id}/acknowledge")
    assert resp.status_code == 409


def test_resolve_409_on_the_topicless_nudge(client):
    # The nudge is topic-less, so /resolve still 409s (it has no gate topic to signal) —
    # the acknowledge path is the only way to dismiss it.
    run_id = _make_run(cap=Decimal("1.00"))
    _add_cost(run_id, Decimal("0.90"), key=f"{run_id}:c1")
    maybe_emit_budget_nudge_step(run_id)
    task = _nudges(client, run_id)[0]

    resp = client.post(
        f"/api/runs/{run_id}/tasks/{task['id']}/resolve", json={"decision": "approve"}
    )
    assert resp.status_code == 409


# ---- boundary --------------------------------------------------------------


def test_budget_nudge_module_imports_no_openhands():
    """budget_nudge.py must stay inside the offline boundary — no openhands.* at import
    (litellm rides in transitively via metering->gateway, exactly like budget.py)."""
    for name in list(sys.modules):
        if name == "openhands" or name.startswith("openhands."):
            del sys.modules[name]
    sys.modules.pop("tvashtr.control_plane.budget_nudge", None)

    import tvashtr.control_plane.budget_nudge  # noqa: F401

    leaked = [m for m in sys.modules if m == "openhands" or m.startswith("openhands.")]
    assert leaked == [], f"control_plane.budget_nudge must not import openhands.*: {leaked}"
