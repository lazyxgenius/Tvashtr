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
from tvashtr.models import AgentInvocation, AgentNode, Edge, Run, RunEvent

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


def test_releasing_a_fly_run_reaps_its_app(monkeypatch):
    """Review finding 3: the sandbox cache is per process; on Fly the sweep also runs the Fly
    reaper, which deletes the app of every run that is no longer live (this one just ended)."""
    from tvashtr.control_plane import fly_reaper

    closed, reaped = [], []
    monkeypatch.setattr(stall_sweep.sandbox_cache, "close_run_sandboxes", closed.append)
    monkeypatch.setattr(fly_reaper, "sweep_orphaned_fly_apps", lambda: reaped.append(True) or 1)
    monkeypatch.setattr(
        stall_sweep, "get_settings", lambda: type("S", (), {"agent_sandbox_mode": "fly"})()
    )
    stall_sweep._close_sandboxes("r1")
    assert closed == ["r1"] and reaped == [True]


def test_releasing_a_local_run_does_not_touch_fly(monkeypatch):
    from tvashtr.control_plane import fly_reaper

    reaped = []
    monkeypatch.setattr(stall_sweep.sandbox_cache, "close_run_sandboxes", lambda r: None)
    monkeypatch.setattr(fly_reaper, "sweep_orphaned_fly_apps", lambda: reaped.append(True))
    monkeypatch.setattr(
        stall_sweep, "get_settings", lambda: type("S", (), {"agent_sandbox_mode": "local"})()
    )
    stall_sweep._close_sandboxes("r1")
    assert reaped == []


# ---- M11 (ruling R13): an agent with a failure path, and its own time limit ---------------------


def _with_failure_path(clone: str, node: str) -> None:
    """Give the clone's Engineer a failure path (to its Stop), as a run of a team with one has."""
    with session_scope() as s:
        stop = s.execute(
            select(AgentNode.id).where(
                AgentNode.team_graph_id == uuid.UUID(clone), AgentNode.role_name == "stop"
            )
        ).scalar_one()
        s.add(
            Edge(
                team_graph_id=uuid.UUID(clone),
                source_node_id=uuid.UUID(node),
                target_node_id=stop,
                edge_type="failure",
            )
        )


def _step(owner, team, *, started_ago: float, silent_for: float, path: bool, limit=None):
    run_id, clone = make_run(owner, team, status="running")
    node = clone_node(clone, "engineer")
    if path:
        _with_failure_path(clone, node)
    with session_scope() as s:
        if limit is not None:
            row = s.get(AgentNode, uuid.UUID(node))
            row.config = {**(row.config or {}), "time_limit_s": limit}
        inv = AgentInvocation(
            run_id=run_id,
            node_id=uuid.UUID(node),
            iteration=1,
            status="running",
            started_at=NOW - timedelta(seconds=started_ago),
        )
        s.add(inv)
        s.flush()
        s.add(
            RunEvent(
                run_id=run_id,
                invocation_id=inv.id,
                seq=0,
                kind="message",
                payload={"source": "user", "text": "build it"},
                created_at=NOW - timedelta(seconds=silent_for),
            )
        )
        return run_id, node, inv.id


def _state(run_id: str, inv_id: int) -> tuple:
    with session_scope() as s:
        run = s.get(Run, uuid.UUID(run_id))
        inv = s.get(AgentInvocation, inv_id)
        return run.status, run.failure_code, inv.status, inv.outcome, inv.outcome_detail


def test_a_stalled_step_with_a_failure_path_ends_the_step_not_the_run(client, released):
    c, owner = fresh_account("sweep-path")
    run_id, _, inv_id = _step(owner, library_team(c), started_ago=3000, silent_for=1201, path=True)

    assert run_id not in stall_sweep.sweep_stalled_steps(now=NOW)  # the run did not end

    message = "The Engineer stopped responding: no update for 20 minutes"
    assert _state(run_id, inv_id) == ("running", None, "failed", "stalled", message)
    assert run_id in released["close"]  # the step returns failed, so the walk takes the path
    assert run_id not in released["cancel"]  # the walk carries on
    with session_scope() as s:
        event = s.execute(
            select(RunEvent).where(RunEvent.invocation_id == inv_id, RunEvent.kind == "stalled")
        ).scalar_one()
        assert event.payload["message"] == message
    assert _in_flight(owner) == 1


def test_an_agent_running_past_its_time_limit_takes_its_failure_path(client, released):
    c, owner = fresh_account("sweep-limit")
    run_id, _, inv_id = _step(
        owner, library_team(c), started_ago=601, silent_for=5, path=True, limit=600
    )
    assert run_id not in stall_sweep.sweep_stalled_steps(now=NOW)
    message = "The Engineer ran longer than its time limit of 10 minutes"
    assert _state(run_id, inv_id) == ("running", None, "failed", "timed_out", message)
    assert run_id in released["close"] and run_id not in released["cancel"]


def test_the_time_limit_defaults_to_the_stall_ceiling(client, released):
    c, owner = fresh_account("sweep-default")
    team = library_team(c)
    under, _, under_inv = _step(owner, team, started_ago=1199, silent_for=5, path=True)
    over, _, over_inv = _step(owner, team, started_ago=1201, silent_for=5, path=True)
    stall_sweep.sweep_stalled_steps(now=NOW)
    assert _state(under, under_inv)[2] == "running"
    assert _state(over, over_inv)[2:] == (
        "failed",
        "timed_out",
        "The Engineer ran longer than its time limit of 20 minutes",
    )


def test_a_step_within_its_time_limit_is_left_alone(client, released):
    c, owner = fresh_account("sweep-within")
    run_id, _, inv_id = _step(
        owner, library_team(c), started_ago=3500, silent_for=5, path=True, limit=3600
    )
    stall_sweep.sweep_stalled_steps(now=NOW)
    assert _state(run_id, inv_id)[:3] == ("running", None, "running")
    assert run_id not in released["close"]


def test_without_a_failure_path_the_time_limit_changes_nothing(client, released):
    """Exactly today's behaviour: only R1's stall ceiling ends a step of an agent with no failure
    path, however long it has worked (its time limit is set on the failure path's menu)."""
    c, owner = fresh_account("sweep-nolimit")
    run_id, _, inv_id = _step(
        owner, library_team(c), started_ago=7200, silent_for=5, path=False, limit=300
    )
    stall_sweep.sweep_stalled_steps(now=NOW)
    assert _state(run_id, inv_id)[:3] == ("running", None, "running")
    assert run_id not in released["close"] + released["cancel"]
