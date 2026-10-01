"""M1 stall guard — the derived live state of a running step (R1).

``live_state.derive`` is pure (times in, state out); ``invocation_live`` reads the same inputs
from ``run_events`` for a batch of running invocations. Thresholds: Quiet after 90 s, Stalled after
300 s, a running command never Quiet.
"""

from datetime import UTC, datetime, timedelta

from home_fixtures import clone_node, fresh_account, library_team, make_run
from sqlalchemy import select

from tvashtr.control_plane import live_state
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, RunEvent

T0 = datetime(2026, 10, 2, 10, 53, 30, tzinfo=UTC)


def _ev(kind: str, payload: dict, at: datetime) -> dict:
    return {"kind": kind, "payload": payload, "created_at": at}


def _derive(seconds: float, **kw) -> dict:
    kw.setdefault("started_at", T0)
    return live_state.derive(
        now=T0 + timedelta(seconds=seconds), quiet_after_s=90, stalled_after_s=300, **kw
    )


ASKED = _ev("message", {"source": "user", "text": "Build it"}, T0)


def test_quiet_after_90_seconds_and_stalled_after_300():
    assert _derive(89, last=ASKED)["live_state"] == "working"
    assert _derive(91, last=ASKED)["live_state"] == "quiet"
    assert _derive(299, last=ASKED)["live_state"] == "quiet"
    assert _derive(301, last=ASKED)["live_state"] == "stalled"


def test_last_event_at_is_the_newest_event():
    out = _derive(10, last=ASKED)
    assert out["last_event_at"] == T0.isoformat()
    assert out["activity"] == "Asked the model for the next step"


def test_a_running_command_is_never_quiet_or_stalled():
    command = _ev(
        "action",
        {"tool_name": "terminal", "action": "TerminalAction(command='python -m pytest -q')"},
        T0,
    )
    out = _derive(7200, last=command, terminal=command)
    assert out["live_state"] == "running_command"
    assert out["activity"] == "Running a command: python -m pytest -q"
    assert out["activity_started_at"] == T0.isoformat()


def test_a_finished_command_no_longer_counts():
    observed = _ev("observation", {"tool_name": "terminal", "observation": "41 passed"}, T0)
    assert _derive(301, last=observed, terminal=observed)["live_state"] == "stalled"


def test_a_retry_is_retrying_with_its_attempt():
    retry = _ev(
        "retry",
        {
            "attempt": 2,
            "of": 3,
            "wait_s": 20.0,
            "next_at": "2026-10-02T10:53:50+00:00",
            "reason": "busy",
            "model": "anthropic/claude-sonnet-4",
        },
        T0,
    )
    out = _derive(10, last=retry)
    assert out["live_state"] == "retrying"
    assert out["retry"] == {"attempt": 2, "of": 3, "next_at": "2026-10-02T10:53:50+00:00"}
    assert out["activity"] == "Model busy · trying again in 20 s (2 of 3)"


def test_a_long_silent_retry_is_quiet_not_retrying():
    retry = _ev(
        "retry", {"attempt": 1, "of": 3, "wait_s": 10.0, "next_at": "x", "reason": "busy"}, T0
    )
    out = _derive(95, last=retry)
    assert out["live_state"] == "quiet" and out["retry"] is None


def test_the_backup_model_is_reported():
    assert _derive(5, last=ASKED, backup_model="openai/gpt-4.1-mini")["backup_model"] == (
        "openai/gpt-4.1-mini"
    )
    assert _derive(5, last=ASKED)["backup_model"] is None


def test_a_step_with_no_events_counts_from_its_start():
    """A brand-new step is Working, not Quiet — its clock starts when it started."""
    assert _derive(10)["live_state"] == "working"
    assert _derive(301)["live_state"] == "stalled"
    assert _derive(10)["last_event_at"] == T0.isoformat()


def test_the_worst_state_of_a_run():
    assert live_state.worst(["working", "quiet", "needs_you"]) == "needs_you"
    assert live_state.worst(["working", "stalled", "needs_you"]) == "stalled"
    assert live_state.worst(["working", "retrying"]) == "retrying"
    assert live_state.worst(["running_command", "working"]) == "running_command"
    assert live_state.worst([]) is None


# ---- the batched DB read ----


def _running_invocation(started_at: datetime) -> tuple[str, int]:
    c, owner = fresh_account("live")
    run_id, clone = make_run(owner, library_team(c), status="running")
    node = clone_node(clone, "engineer")
    with session_scope() as s:
        inv = AgentInvocation(
            run_id=run_id, node_id=node, iteration=2, status="running", started_at=started_at
        )
        s.add(inv)
        s.flush()
        return run_id, inv.id


def _add_event(run_id: str, inv_id: int, seq: int, kind: str, payload: dict, at: datetime):
    with session_scope() as s:
        s.add(
            RunEvent(
                run_id=run_id,
                invocation_id=inv_id,
                seq=seq,
                kind=kind,
                payload=payload,
                created_at=at,
            )
        )


def test_invocation_live_reads_events_for_a_batch(client):
    now = datetime.now(UTC)
    run_id, inv_id = _running_invocation(now - timedelta(minutes=10))
    _add_event(
        run_id, inv_id, 0, "message", {"source": "user", "text": "x"}, now - timedelta(minutes=9)
    )
    _add_event(
        run_id,
        inv_id,
        1,
        "action",
        {"tool_name": "terminal", "action": "TerminalAction(command='make test')"},
        now - timedelta(minutes=8),
    )
    _add_event(
        run_id,
        inv_id,
        2,
        "observation",
        {"tool_name": "terminal", "observation": "ok"},
        now - timedelta(minutes=7),
    )
    live_state.record_host_event(
        run_id,
        inv_id,
        "backup_model",
        {"from_model": "a/b", "to_model": "openai/gpt-4.1-mini", "reason": "busy"},
    )
    with session_scope() as s:
        inv = s.get(AgentInvocation, inv_id)
        out = live_state.invocation_live(s, [inv], now=now + timedelta(seconds=95))[inv_id]
    assert out["live_state"] == "quiet"  # the newest event is the host's switch, 95 s ago
    assert out["backup_model"] == "openai/gpt-4.1-mini"
    assert out["activity"] == "Switched to the backup model, openai/gpt-4.1-mini"


def test_host_events_take_their_own_seq_band(client):
    run_id, inv_id = _running_invocation(datetime.now(UTC))
    live_state.record_host_event(run_id, inv_id, "retry", {"attempt": 1})
    live_state.record_host_event(run_id, inv_id, "retry", {"attempt": 2})
    with session_scope() as s:
        seqs = (
            s.execute(
                select(RunEvent.seq).where(RunEvent.invocation_id == inv_id).order_by(RunEvent.seq)
            )
            .scalars()
            .all()
        )
    assert seqs == [live_state.HOST_EVENT_SEQ_BAND, live_state.HOST_EVENT_SEQ_BAND + 1]


def test_events_of_another_run_with_the_same_invocation_id_are_ignored(client):
    """``run_events.invocation_id`` is not a foreign key: an event another run wrote under the same
    number (legacy / test rows) must not count as this step's news."""
    now = datetime.now(UTC)
    run_id, inv_id = _running_invocation(now - timedelta(minutes=10))
    _add_event(
        run_id, inv_id, 0, "message", {"source": "user", "text": "x"}, now - timedelta(minutes=9)
    )
    _add_event("someone-else", inv_id, 0, "message", {"source": "user", "text": "y"}, now)
    with session_scope() as s:
        inv = s.get(AgentInvocation, inv_id)
        assert live_state.invocation_live(s, [inv], now=now)[inv_id]["live_state"] == "stalled"


def test_a_desktop_job_waiting_for_its_runner_is_waiting_not_stalled():
    """Review finding 4: a Desktop job queued behind another job on the same subscription writes one
    note and then nothing — its own offline expiry owns it; it is never Quiet, Stalled or swept."""
    waiting = _ev(
        "message",
        {
            "source": "tvashtr",
            "text": "Waiting for your Claude Max subscription — one job at a time.",
        },
        T0,
    )
    out = _derive(3600, last=waiting)
    assert out["live_state"] == "waiting"
    assert out["activity"] == "Waiting for your Claude Max subscription — one job at a time."
    assert live_state.stalled_for(out, T0 + timedelta(seconds=3600)) == 0.0


def test_claude_codes_bash_tool_is_a_command():
    command = _ev("action", {"tool_name": "Bash", "action": "Bash(command='npm test')"}, T0)
    assert _derive(7200, last=command, terminal=command)["live_state"] == "running_command"


def test_a_query_domain_step_is_a_live_step():
    assert "domain_query" in live_state.STEP_KINDS


def test_a_running_bash_command_is_found_in_the_events(client):
    now = datetime.now(UTC)
    run_id, inv_id = _running_invocation(now - timedelta(hours=2))
    _add_event(
        run_id,
        inv_id,
        0,
        "action",
        {"tool_name": "Bash", "action": "Bash(command='npm test')"},
        now - timedelta(hours=1),
    )
    with session_scope() as s:
        inv = s.get(AgentInvocation, inv_id)
        out = live_state.invocation_live(s, [inv], now=now)[inv_id]
    assert out["live_state"] == "running_command"
    assert out["activity"] == "Running a command: npm test"
