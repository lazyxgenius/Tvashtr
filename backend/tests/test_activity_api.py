"""M2 live run view — ``GET /api/runs/{id}/activity`` and the Retrying callout's
``POST /api/runs/{id}/nodes/{node_id}/switch-backup`` (owner-scoped, rows written straight to the
database; no workflow runs)."""

import uuid
from datetime import UTC, datetime, timedelta

from home_fixtures import clone_node, fresh_account, library_team, make_run, open_gate

from tvashtr.control_plane import live_state
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, RunEvent


def _ago(seconds: float) -> datetime:
    return datetime.now(UTC) - timedelta(seconds=seconds)


def _invocation(run_id, node_id, status, *, iteration=1, started_ago=600.0) -> int:
    with session_scope() as s:
        inv = AgentInvocation(
            run_id=run_id,
            node_id=uuid.UUID(node_id),
            iteration=iteration,
            status=status,
            started_at=datetime.now(UTC) - timedelta(seconds=started_ago),
        )
        s.add(inv)
        s.flush()
        return inv.id


def _event(run_id, inv_id, seq, kind, payload, seconds_ago) -> None:
    with session_scope() as s:
        s.add(
            RunEvent(
                run_id=run_id,
                invocation_id=inv_id,
                seq=seq,
                kind=kind,
                payload=payload,
                created_at=datetime.now(UTC) - timedelta(seconds=seconds_ago),
            )
        )


def _engineer_run(c, owner, status="running"):
    run_id, clone = make_run(owner, library_team(c), status=status, created_at=_ago(1000))
    _invocation(run_id, clone_node(clone, "pm"), "done", started_ago=900)
    eng = clone_node(clone, "engineer")
    inv = _invocation(run_id, eng, "running", started_ago=600)
    return run_id, clone, eng, inv


def test_the_activity_of_a_running_run(client):
    c, owner = fresh_account("activity")
    run_id, _clone, eng, inv = _engineer_run(c, owner)
    _event(
        run_id,
        inv,
        0,
        "action",
        {
            "tool_name": "file_editor",
            "thought": "SECRET-THOUGHT",
            "action": "command='str_replace' path='/workspace/core/rsi.py' file_text=None "
            "old_str='a' new_str='a\\nb' insert_line=None kind='FileEditorAction'",
        },
        120,
    )
    _event(
        run_id,
        inv,
        1,
        "action",
        {
            "tool_name": "terminal",
            "thought": "SECRET-THOUGHT",
            "action": "command='python -m pytest -q' is_input=False kind='TerminalAction'",
        },
        60,
    )

    resp = c.get(f"/api/runs/{run_id}/activity")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "SECRET-THOUGHT" not in resp.text
    assert body["run_id"] == run_id and body["status"] == "running"
    assert body["live_state"] == "running_command"
    tail = [(ln["kind"], ln["text"], ln["label"]) for ln in body["lines"][-2:]]
    assert tail == [
        ("edited", "Edited core/rsi.py", "Engineer"),
        ("command", "Running python -m pytest -q", "Engineer"),
    ]
    assert body["lines"][-2]["refs"] == {"file": "core/rsi.py", "added": 1, "removed": 0}
    assert body["lines"][-1]["refs"]["running"] is True
    agents = {a["label"]: a for a in body["agents"]}
    assert agents["Engineer"]["live_state"] == "running_command"
    assert agents["Engineer"]["node_id"] == eng
    assert agents["Reviewer"]["live_state"] == "waiting"
    assert body["total"] == len(body["lines"])
    assert body["pinned"] is None and body["summary"] is None

    # Polling with the cursor: only what is new or still changing comes back, the rest is whole.
    again = c.get(f"/api/runs/{run_id}/activity", params={"after": body["cursor"]}).json()
    assert [ln["kind"] for ln in again["lines"]] == ["command"]
    assert again["total"] == body["total"] and again["agents"] == body["agents"]


def test_an_open_gate_is_pinned(client):
    c, owner = fresh_account("activity-gate")
    run_id, clone = make_run(owner, library_team(c), status="awaiting_human", created_at=_ago(1000))
    _invocation(run_id, clone_node(clone, "pm"), "done", started_ago=900)
    gate = clone_node(clone, "prd_gate")
    _invocation(run_id, gate, "running", started_ago=60)
    task_id = open_gate(run_id, gate)
    body = c.get(f"/api/runs/{run_id}/activity").json()
    assert body["pinned"]["kind"] == "gate" and body["pinned"]["task_id"] == task_id
    assert body["lines"][-1]["text"] == "Waiting for you to approve the spec"
    assert body["live_state"] == "needs_you"


def test_another_account_gets_a_404(client):
    c, owner = fresh_account("activity-a")
    other, _ = fresh_account("activity-b")
    run_id, *_ = _engineer_run(c, owner)
    resp = other.get(f"/api/runs/{run_id}/activity")
    assert resp.status_code == 404 and run_id not in resp.text


# ---------------------------------------------------------------------------- switch-backup


def _retry(run_id, inv, backup="openai/gpt-4.1-mini"):
    live_state.record_host_event(
        run_id,
        inv,
        "retry",
        {"attempt": 1, "of": 3, "wait_s": 10.0, "reason": "busy", "backup_model": backup},
    )


def test_switch_backup_ends_the_wait_of_a_retrying_step(client):
    c, owner = fresh_account("switch")
    run_id, _clone, eng, inv = _engineer_run(c, owner)
    _retry(run_id, inv)
    signal = live_state.switch_signal(run_id, inv)
    try:
        resp = c.post(f"/api/runs/{run_id}/nodes/{eng}/switch-backup")
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"switched": True}
        assert signal.is_set()
    finally:
        live_state.clear_switch(run_id, inv)


def test_switch_backup_is_a_409_when_there_is_nothing_to_switch(client):
    c, owner = fresh_account("switch-409")
    run_id, clone, eng, inv = _engineer_run(c, owner)
    url = f"/api/runs/{run_id}/nodes/{eng}/switch-backup"
    nothing = {"detail": "nothing to switch"}

    # Running, but its newest event is not a retry.
    _event(run_id, inv, 0, "action", {"tool_name": "terminal", "action": "command='ls'"}, 5)
    resp = c.post(url)
    assert (resp.status_code, resp.json()) == (409, nothing)

    # A retry with no backup to switch to.
    _retry(run_id, inv, backup=None)
    live_state.switch_signal(run_id, inv)
    try:
        assert c.post(url).status_code == 409
    finally:
        live_state.clear_switch(run_id, inv)

    # A retry with a backup, but the step's call isn't running in this process.
    _retry(run_id, inv)
    assert c.post(url).json() == nothing

    # A node that never ran, and one whose step is over.
    reviewer = clone_node(clone, "reviewer")
    assert c.post(f"/api/runs/{run_id}/nodes/{reviewer}/switch-backup").json() == nothing
    pm = clone_node(clone, "pm")
    assert c.post(f"/api/runs/{run_id}/nodes/{pm}/switch-backup").status_code == 409


def test_switch_backup_is_a_404_for_another_account_or_another_runs_node(client):
    c, owner = fresh_account("switch-a")
    other, other_id = fresh_account("switch-b")
    run_id, _clone, eng, inv = _engineer_run(c, owner)
    _retry(run_id, inv)
    signal = live_state.switch_signal(run_id, inv)
    try:
        resp = other.post(f"/api/runs/{run_id}/nodes/{eng}/switch-backup")
        assert resp.status_code == 404 and run_id not in resp.text
        # B's own run, A's node: still a 404, and A's step is untouched.
        b_run, *_ = _engineer_run(other, other_id)
        resp = other.post(f"/api/runs/{b_run}/nodes/{eng}/switch-backup")
        assert resp.status_code == 404
        assert other.post(f"/api/runs/{b_run}/nodes/not-a-uuid/switch-backup").status_code == 404
        assert not signal.is_set()
    finally:
        live_state.clear_switch(run_id, inv)


def test_the_activity_read_never_selects_the_thought(client, monkeypatch):
    from tvashtr.control_plane import activity

    c, owner = fresh_account("activity-thought")
    run_id, _clone, _eng, inv = _engineer_run(c, owner)
    _event(
        run_id,
        inv,
        0,
        "action",
        {
            "tool_name": "terminal",
            "thought": "SECRET-THOUGHT " * 60,
            "action": "command='make lint' is_input=False kind='TerminalAction'",
        },
        60,
    )
    seen = []
    real_build = activity.build

    def spy(run, nodes, edges, invocations, events, *rest, **kw):
        seen.extend(events)
        return real_build(run, nodes, edges, invocations, events, *rest, **kw)

    monkeypatch.setattr(activity, "build", spy)
    body = c.get(f"/api/runs/{run_id}/activity").json()
    assert body["lines"][-1]["text"] == "Running make lint"
    assert seen and all("thought" not in (e.payload or {}) for e in seen)
    assert any("make lint" in str((e.payload or {}).get("action")) for e in seen)
