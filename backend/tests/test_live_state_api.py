"""M1 stall guard — the live state reaches the API (additive fields only).

* ``GET /api/runs/{id}/graph``: each node gains ``live`` and the body a run-level ``live_state``.
* ``GET /api/runs/{id}`` and the Home run list: each run gains ``live_state`` (its worst step).
* ``GET /api/inbox``: a run with a step Stalled (no update for 5 minutes) is a ``run_stalled`` item.
"""

import uuid
from datetime import UTC, datetime, timedelta

from home_fixtures import clone_node, fresh_account, library_team, make_run, open_gate

from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, RunEvent


def _invocation(run_id, node_id, status, *, iteration=1, started_ago=0.0) -> int:
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


def _event(run_id, inv_id, seconds_ago, kind="message", payload=None, seq=0) -> None:
    with session_scope() as s:
        s.add(
            RunEvent(
                run_id=run_id,
                invocation_id=inv_id,
                seq=seq,
                kind=kind,
                payload=payload or {"source": "user", "text": "build it"},
                created_at=datetime.now(UTC) - timedelta(seconds=seconds_ago),
            )
        )


def _quiet_run(owner, team, seconds_ago=95):
    run_id, clone = make_run(owner, team, status="running")
    _invocation(run_id, clone_node(clone, "pm"), "done")
    eng = _invocation(run_id, clone_node(clone, "engineer"), "running", started_ago=600)
    _event(run_id, eng, seconds_ago)
    return run_id, clone


def test_the_graph_carries_each_nodes_live_state(client):
    c, owner = fresh_account("live-api")
    run_id, _ = _quiet_run(owner, library_team(c))

    body = c.get(f"/api/runs/{run_id}/graph").json()
    nodes = {n["role_name"]: n for n in body["nodes"]}
    assert nodes["engineer"]["live"]["live_state"] == "quiet"
    assert nodes["engineer"]["live"]["activity"] == "Asked the model for the next step"
    assert set(nodes["engineer"]["live"]) == {
        "live_state",
        "last_event_at",
        "activity",
        "activity_started_at",
        "retry",
        "backup_model",
    }
    assert nodes["pm"]["live"]["live_state"] == "done"
    assert nodes["reviewer"]["live"]["live_state"] == "waiting"
    assert body["live_state"] == "quiet"


def test_an_open_gate_is_needs_you_and_stalled_outranks_it(client):
    c, owner = fresh_account("live-gate")
    run_id, clone = make_run(owner, library_team(c), status="awaiting_human")
    gate = clone_node(clone, "prd_gate")
    _invocation(run_id, gate, "running")
    open_gate(run_id, gate)
    body = c.get(f"/api/runs/{run_id}/graph").json()
    assert {n["role_name"]: n for n in body["nodes"]}["prd_gate"]["live"]["live_state"] == (
        "needs_you"
    )
    assert body["live_state"] == "needs_you"


def test_the_run_payloads_carry_the_runs_worst_state(client):
    c, owner = fresh_account("live-run")
    team = library_team(c)
    run_id, _ = _quiet_run(owner, team)
    done, _ = make_run(owner, team, status="completed")

    assert c.get(f"/api/runs/{run_id}").json()["run"]["live_state"] == "quiet"
    assert c.get(f"/api/runs/{done}").json()["run"]["live_state"] == "done"
    rows = {
        r["run_id"]: r
        for r in c.get("/api/runs", params={"status": "active", "include": "progress"}).json()[
            "runs"
        ]
    }
    assert rows[run_id]["live_state"] == "quiet"


def test_a_stalled_run_is_in_needs_you_and_a_fresh_one_is_not(client):
    c, owner = fresh_account("live-inbox")
    team = library_team(c)
    stalled, _ = _quiet_run(owner, team, seconds_ago=310)
    _quiet_run(owner, team, seconds_ago=5)  # working: not listed
    make_run(owner, team, status="running")  # brand new, no step yet: not listed

    items = {i["key"]: i for i in c.get("/api/inbox").json()["items"]}
    stalled_items = [k for k in items if k.startswith("run_stalled:")]
    assert stalled_items == [f"run_stalled:{stalled}"]
    item = items[f"run_stalled:{stalled}"]
    assert item["kind"] == "run_stalled"
    assert item["run"]["id"] == stalled
    assert item["node"]["label"] == "Engineer"
    assert item["live"]["live_state"] == "stalled"

    other, _ = fresh_account("live-inbox-b")
    assert not [i for i in other.get("/api/inbox").json()["items"] if i["kind"] == "run_stalled"]
