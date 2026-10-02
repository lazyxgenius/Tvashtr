"""MA ruling R19: a stopped run can be resumed. R8 already lists a stopped (``cancelled``) run's
resume points and the API resumes it; the run view's Activity read now pins a ``stopped`` callout
carrying the resume hint (Prob-Stopped: "You stopped this run at <step>", Safe / Next, Resume from
<step>). Stopped runs do NOT join Needs you — the person stopped it on purpose."""

from conftest import auth_user_id
from home_fixtures import add_invocation, clone_node, make_run
from sqlalchemy import select, update

from tvashtr import routers
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, Run


def _graph_of(run_id: str) -> str:
    with session_scope() as session:
        return str(
            session.execute(select(Run.team_graph_id).where(Run.workflow_id == run_id)).scalar_one()
        )


def _stopped_run(monkeypatch) -> tuple[str, int]:
    """A run whose Engineer was working when you pressed Stop: the run is ``cancelled`` (what Stop
    writes) and the step it stopped at is still open."""
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    run_id = make_run(auth_user_id(), None, status="running")[0]
    add_invocation(run_id, clone_node(_graph_of(run_id), "engineer"), "running")
    with session_scope() as session:
        session.execute(update(Run).where(Run.workflow_id == run_id).values(status="cancelled"))
        inv = session.execute(
            select(AgentInvocation.id).where(AgentInvocation.run_id == run_id)
        ).scalar_one()
    return run_id, inv


def test_a_stopped_run_pins_resume_from_the_step_it_stopped_at(client, monkeypatch):
    run_id, inv = _stopped_run(monkeypatch)
    act = client.get(f"/api/runs/{run_id}/activity").json()
    pinned = act["pinned"]
    assert pinned is not None, act
    assert pinned["kind"] == "stopped"
    assert pinned["resume"] is not None and pinned["resume"]["invocation_id"] == inv
    assert pinned["title"] == f"You stopped this run at {pinned['resume']['label']}"
    assert pinned["body"] == "Nothing was shipped."
    assert pinned["label"] == "Engineer"
    assert set(pinned) >= {"node_id", "task_id", "backup_model", "gate_kind", "safe"}
    engineer = next(a for a in act["agents"] if a["label"] == "Engineer")
    assert engineer["live_state"] == "stopped"
    assert pinned["node_id"] == engineer["node_id"]


def test_the_stopped_runs_resume_point_resumes(client, monkeypatch):
    run_id, inv = _stopped_run(monkeypatch)
    reply = client.get(f"/api/runs/{run_id}/resume").json()
    assert reply["available"] is True and reply["stops_run"] is False
    assert any(p["invocation_id"] == inv and p["resumable"] for p in reply["points"])
    resp = client.post(f"/api/runs/{run_id}/resume", json={"invocation_id": inv})
    assert resp.status_code == 201, resp.text
    # Picked up again: the callout stays, without a Resume (never a dead button).
    pinned = client.get(f"/api/runs/{run_id}/activity").json()["pinned"]
    assert (pinned["kind"], pinned["resume"], pinned["title"]) == (
        "stopped",
        None,
        "You stopped this run",
    )


def test_a_stopped_run_does_not_join_needs_you(client, monkeypatch):
    run_id, _ = _stopped_run(monkeypatch)
    items = client.get("/api/inbox").json()["items"]
    assert [i for i in items if run_id in str(i)] == []


def test_a_run_stopped_at_its_gate_does_not_name_an_earlier_step(monkeypatch):
    """Review fix: stopped while the approval gate waited, the step it stopped at is the gate, not
    the last agent that finished — so the title names no step (Resume still offers the PM)."""
    from home_fixtures import fresh_account, library_team

    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    c, owner = fresh_account("stopped-gate")
    run_id, clone = make_run(owner, library_team(c), status="running")
    add_invocation(run_id, clone_node(clone, "pm"), "done")
    add_invocation(run_id, clone_node(clone, "prd_gate"), "running")
    with session_scope() as session:
        session.execute(update(Run).where(Run.workflow_id == run_id).values(status="cancelled"))
    pinned = c.get(f"/api/runs/{run_id}/activity").json()["pinned"]
    assert pinned["kind"] == "stopped"
    assert pinned["title"] == "You stopped this run"
