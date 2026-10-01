"""M1 stall guard — the periodic sweep ends a step Stalled for 20 minutes (R1).

The sweep fails the step and the run (``failure_code="stalled"``), records a ``stalled`` event,
cancels the run's workflow so the walk can't carry on, releases its sandboxes and so frees its slot.
DBOS and the sandbox cache are stubbed; the sweep function is called directly (the scheduled
registration is off in the offline suite — conftest sets ``TVASHTR_STALL_SWEEP=0``).
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from home_fixtures import clone_node, fresh_account, library_team, make_run
from sqlalchemy import func, select

from tvashtr.control_plane import stall_sweep
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, Run, RunEvent

NOW = datetime.now(UTC)


@pytest.fixture
def released(monkeypatch):
    calls: dict[str, list[str]] = {"cancel": [], "close": []}
    monkeypatch.setattr(stall_sweep, "_cancel_workflow", calls["cancel"].append)
    monkeypatch.setattr(stall_sweep, "_close_sandboxes", calls["close"].append)
    return calls


def _stale_step(owner, team, *, silent_for: float, kind="message", payload=None, status="running"):
    run_id, clone = make_run(owner, team, status=status)
    node = clone_node(clone, "engineer")
    with session_scope() as s:
        inv = AgentInvocation(
            run_id=run_id,
            node_id=uuid.UUID(node),
            iteration=2,
            status="running",
            started_at=NOW - timedelta(hours=3),
        )
        s.add(inv)
        s.flush()
        s.add(
            RunEvent(
                run_id=run_id,
                invocation_id=inv.id,
                seq=0,
                kind=kind,
                payload=payload or {"source": "user", "text": "build it"},
                created_at=NOW - timedelta(seconds=silent_for),
            )
        )
        return run_id, node, inv.id


def _in_flight(owner) -> int:
    with session_scope() as s:
        return s.execute(
            select(func.count())
            .select_from(Run)
            .where(Run.owner_id == owner, Run.status.in_(("pending", "running", "awaiting_human")))
        ).scalar_one()


def test_a_step_silent_for_20_minutes_is_ended_and_its_slot_freed(client, released):
    c, owner = fresh_account("sweep")
    run_id, node, inv_id = _stale_step(owner, library_team(c), silent_for=1201)
    assert _in_flight(owner) == 1

    assert run_id in stall_sweep.sweep_stalled_steps(now=NOW)

    with session_scope() as s:
        run = s.get(Run, uuid.UUID(run_id))
        inv = s.get(AgentInvocation, inv_id)
        stalled = s.execute(
            select(RunEvent).where(RunEvent.invocation_id == inv_id, RunEvent.kind == "stalled")
        ).scalar_one()
        assert (run.status, run.failure_code) == ("failed", "stalled")
        assert run.failure_message == "The Engineer stopped responding: no update for 20 minutes"
        assert str(run.failed_node_id) == node
        assert (inv.status, inv.outcome) == ("failed", "stalled")
        assert inv.outcome_detail == run.failure_message and inv.ended_at is not None
        assert stalled.payload["message"] == run.failure_message
    assert run_id in released["cancel"] and run_id in released["close"]
    assert _in_flight(owner) == 0
    body = c.get(f"/api/runs/{run_id}").json()["run"]
    assert body["failure"]["code"] == "stalled" and body["live_state"] == "failed"


def test_a_step_under_the_ceiling_is_left_alone(client, released):
    c, owner = fresh_account("sweep-under")
    run_id, _, _ = _stale_step(owner, library_team(c), silent_for=1199)
    assert run_id not in stall_sweep.sweep_stalled_steps(now=NOW)
    with session_scope() as s:
        assert s.get(Run, uuid.UUID(run_id)).status == "running"
    assert run_id not in released["cancel"] + released["close"]


def test_a_running_command_is_never_swept(client, released):
    c, owner = fresh_account("sweep-cmd")
    run_id, _, _ = _stale_step(
        owner,
        library_team(c),
        silent_for=7200,
        kind="action",
        payload={"tool_name": "terminal", "action": "TerminalAction(command='make e2e')"},
    )
    assert run_id not in stall_sweep.sweep_stalled_steps(now=NOW)
    with session_scope() as s:
        assert s.get(Run, uuid.UUID(run_id)).status == "running"


def test_a_run_that_already_ended_is_not_touched(client, released):
    c, owner = fresh_account("sweep-done")
    run_id, _, _ = _stale_step(owner, library_team(c), silent_for=5000, status="completed")
    assert run_id not in stall_sweep.sweep_stalled_steps(now=NOW)
    with session_scope() as s:
        assert s.get(Run, uuid.UUID(run_id)).status == "completed"


def test_the_ceiling_is_dialable(client, released, monkeypatch):
    c, owner = fresh_account("sweep-dial")
    run_id, _, _ = _stale_step(owner, library_team(c), silent_for=40)
    monkeypatch.setattr(
        stall_sweep,
        "get_settings",
        lambda: type(
            "S", (), {"stall_fail_after_s": 30, "quiet_after_s": 5, "stalled_after_s": 10}
        )(),
    )
    assert run_id in stall_sweep.sweep_stalled_steps(now=NOW)
    with session_scope() as s:
        assert s.get(Run, uuid.UUID(run_id)).failure_message == (
            "The Engineer stopped responding: no update for 1 minute"
        )


def test_the_periodic_sweep_is_off_in_the_offline_suite():
    assert not hasattr(stall_sweep, "periodic_stall_sweep")


def test_the_periodic_body_delegates_to_the_sweep(monkeypatch):
    seen = []
    monkeypatch.setattr(stall_sweep, "sweep_stalled_steps", lambda: seen.append(True) or [])
    stall_sweep._periodic_stall_sweep(datetime.now(UTC), datetime.now(UTC))
    assert seen == [True]


def test_two_stalled_rounds_of_one_node_are_ended_once(client, released):
    """Review / full-suite finding: two running invocations of the same node (a leftover round) must
    not trip the sweep over a shared ORM object."""
    c, owner = fresh_account("sweep-twice")
    run_id, node, _ = _stale_step(owner, library_team(c), silent_for=1300)
    with session_scope() as s:
        s.add(
            AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(node),
                iteration=3,
                status="running",
                started_at=NOW - timedelta(hours=2),
            )
        )
    assert run_id in stall_sweep.sweep_stalled_steps(now=NOW)


def test_the_sweep_leaves_a_step_that_closed_meanwhile(client, released):
    """Review finding 12: guarded on the step too — a round that finished between the look and the
    write keeps its run alive."""
    c, owner = fresh_account("sweep-race")
    run_id, node, inv_id = _stale_step(owner, library_team(c), silent_for=1300)
    with session_scope() as s:
        s.get(AgentInvocation, inv_id).status = "done"
    node_row = (uuid.UUID(node), "engineer", "agent", {})
    assert stall_sweep._end(run_id, inv_id, node_row, 1300, 1200, NOW) is False
    with session_scope() as s:
        assert s.get(Run, uuid.UUID(run_id)).status == "running"


def test_the_sweep_leaves_a_step_that_spoke_meanwhile(client, released):
    c, owner = fresh_account("sweep-spoke")
    run_id, node, inv_id = _stale_step(owner, library_team(c), silent_for=1300)
    with session_scope() as s:
        s.add(
            RunEvent(
                run_id=run_id,
                invocation_id=inv_id,
                seq=1,
                kind="action",
                payload={"tool_name": "file_editor"},
            )
        )
    node_row = (uuid.UUID(node), "engineer", "agent", {})
    assert stall_sweep._end(run_id, inv_id, node_row, 1300, 1200, NOW) is False
    with session_scope() as s:
        assert s.get(Run, uuid.UUID(run_id)).status == "running"
