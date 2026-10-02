"""M3 (ruling R8) — Resume's rules beyond the main path: a resume of a resumed run, what is
carried (a human's spec edit at the gate), the target columns a resumed run keeps, a run still
running with a Stalled step, a workflow recorded before M3, the rebuild of a fresh vs a live
workspace, and why a run can't be resumed."""

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from conftest import auth_user_id
from dbos import DBOS
from home_fixtures import add_invocation, clone_node, make_run
from sqlalchemy import select, update
from test_resume_walk import (
    IDEA,
    _failed_inv,
    _harness,
    _invocations,
    _library_run,
    _new_run,
    _start,
)

from tvashtr import routers
from tvashtr.config import get_settings
from tvashtr.control_plane import checkpoints, resume, team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.db import session_scope
from tvashtr.documents.service import add_version
from tvashtr.models import AgentInvocation, DocumentVersion, Run, RunCheckpoint


def _resume(client, run_id: str, inv: int) -> str:
    resp = client.post(f"/api/runs/{run_id}/resume", json={"invocation_id": inv})
    assert resp.status_code == 201, resp.text
    return resp.json()["run_id"]


def test_a_resumed_run_that_fails_again_resumes_again_and_ships(client, monkeypatch, tmp_path):
    first = _library_run(client)
    fails: set = {first}  # the harness reads this set on every call
    calls = _harness(monkeypatch, tmp_path, fail_round_2_of=fails)
    assert _start(first)["status"] == "failed"
    second = _resume(client, first, _failed_inv(first))
    fails.add(second)
    assert DBOS.retrieve_workflow(second).get_result()["status"] == "failed"
    assert _invocations(second) == [("engineer", 2, "failed")]

    # #3 picks #2 up at ITS Engineer round 2: the step right after #2's carried ones (its seed).
    third = _resume(client, second, _failed_inv(second))
    assert DBOS.retrieve_workflow(third).get_result()["status"] == "completed"
    assert _invocations(third) == [
        ("engineer", 2, "done"),
        ("reviewer", 2, "done"),
        ("ship", 1, "done"),
    ]
    round_1 = next(c["tree"] for c in calls if c["run_id"] == first and c["role"] == "reviewer")
    third_engineer = next(c for c in calls if c["run_id"] == third and c["role"] == "engineer")
    assert third_engineer["tree"] == round_1 and third_engineer["feedback"] is not None

    # The carried lines of #3 still say where each step ran: #1, not #2.
    act = client.get(f"/api/runs/{third}/activity").json()
    with session_scope() as session:
        first_number = resume.number(session, session.get(Run, uuid.UUID(first)))
        second_number = resume.number(session, session.get(Run, uuid.UUID(second)))
    carried = [ln for ln in act["lines"] if ln["kind"] == "carried"]
    assert [ln["from_run"]["number"] for ln in carried] == [first_number] * 4
    assert act["resumed_from"]["number"] == second_number


def test_the_spec_carried_is_the_one_the_chosen_step_read_including_your_gate_edit(
    client, monkeypatch, tmp_path
):
    """The PM writes v1; you edit it to v2 at the gate; Engineer round 1 fails. Resuming from it
    carries v2 — what that step read — not only what the PM wrote."""
    old = _new_run()
    calls = _harness(monkeypatch, tmp_path, fail_round_2_of=set())
    harness_agent = team_run.agent_run_step
    real_open = team_run.open_invocation_step

    def _open(run_id, node_id, iteration):
        if run_id == old and _role(node_id) == "engineer":
            # The human edits the spec at the gate, before the Engineer starts.
            with session_scope() as session:
                doc = session.get(Run, uuid.UUID(run_id)).pm_document_id
            add_version(doc, "PRD: edited at the gate", "human", f"{run_id}:human:1")
        return real_open(run_id, node_id, iteration)

    def _agent(run_id, *a, edits_allowed=True, **kw):
        if run_id == old and edits_allowed and not a[8]:  # Engineer round 1 of the old run
            calls.append({"run_id": run_id, "role": "engineer", "iteration": a[2], "spec": a[4]})
            return {
                "status": "failed",
                "outcome": None,
                "reasons": None,
                "error": "boom",
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "cost_usd": 0.0,
            }
        return harness_agent(run_id, *a, edits_allowed=edits_allowed, **kw)

    monkeypatch.setattr(team_run, "open_invocation_step", _open)
    monkeypatch.setattr(team_run, "agent_run_step", _agent)
    assert _start(old)["status"] == "failed"
    new = _resume(client, old, _failed_inv(old))
    assert DBOS.retrieve_workflow(new).get_result()["status"] == "completed"
    spec_read = next(c["spec"] for c in calls if c["run_id"] == new and c["role"] == "engineer")
    assert spec_read == "PRD: edited at the gate"
    with session_scope() as session:
        run = session.get(Run, uuid.UUID(new))
        versions = session.execute(
            select(DocumentVersion.version_no, DocumentVersion.created_by)
            .where(DocumentVersion.document_id == run.pm_document_id)
            .order_by(DocumentVersion.version_no)
        ).all()
    assert [tuple(v) for v in versions] == [(1, "agent:entry"), (2, "human")]


def _role(node_id: str) -> str:
    from tvashtr.models import AgentNode

    with session_scope() as session:
        return session.get(AgentNode, uuid.UUID(node_id)).role_name


def test_a_resumed_run_keeps_its_target_and_a_hosted_one_clones_afresh(client, monkeypatch):
    """A resumed run keeps the old run's base, scope, budget, team and Desktop routing; a hosted
    run's clone folder is never reused (the clone step makes the new run's own)."""
    old = make_run(
        auth_user_id(),
        None,
        status="failed",
        github_repo="lazyxgenius/trade_mcp",
        repo_path="/tmp/.tvashtr_clones/old-run",
        base_ref="main",
        subpath="core",
        budget_cap_usd=5,
        desktop_target=True,
        desktop_subscriptions=["claude"],
    )[0]
    engineer = clone_node(_graph_of(old), "engineer")
    add_invocation(old, engineer, "failed")
    inv = _first_inv(old)
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == old)).scalar_one()
        new = resume.create(session, run, inv, owner_id=run.owner_id, desktop_routed=["grok"])
        assert new.repo_path is None and new.github_repo == "lazyxgenius/trade_mcp"
        assert (new.base_ref, new.subpath, float(new.budget_cap_usd)) == ("main", "core", 5.0)
        assert new.desktop_target is True and new.desktop_subscriptions == ["grok"]
        assert new.local_snapshot_id is None and new.status == "running"
        session.rollback()


def _graph_of(run_id: str) -> str:
    with session_scope() as session:
        return str(
            session.execute(select(Run.team_graph_id).where(Run.workflow_id == run_id)).scalar_one()
        )


def _first_inv(run_id: str) -> int:
    with session_scope() as session:
        return session.execute(
            select(AgentInvocation.id).where(AgentInvocation.run_id == run_id)
        ).scalar_one()


def test_a_run_still_running_with_a_stalled_step_is_stopped_then_picked_up(client, monkeypatch):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    monkeypatch.setattr(get_settings(), "stalled_after_s", 60)
    run_id = make_run(auth_user_id(), None, status="running")[0]
    engineer = clone_node(_graph_of(run_id), "engineer")
    add_invocation(run_id, engineer, "running")
    with session_scope() as session:
        session.execute(
            update(AgentInvocation)
            .where(AgentInvocation.run_id == run_id)
            .values(started_at=datetime.now(UTC) - timedelta(minutes=6))
        )
    reply = client.get(f"/api/runs/{run_id}/resume").json()
    assert reply["available"] is True and reply["stops_run"] is True
    point = reply["points"][0]
    assert point["state"] == "suggested" and point["resumable"] is True
    new = _resume(client, run_id, point["invocation_id"])
    with session_scope() as session:
        assert (
            session.execute(select(Run.status).where(Run.workflow_id == run_id)).scalar_one()
            == "cancelled"
        )
        assert session.get(Run, uuid.UUID(new)).resumed_from_run_id == uuid.UUID(run_id)


def test_why_a_run_cannot_be_resumed(client):
    owner = auth_user_id()
    going = make_run(owner, None, status="running")[0]
    done = make_run(owner, None, status="completed")[0]
    folder = make_run(owner, None, status="failed", local_snapshot_id=uuid.uuid4())[0]
    pre_m3 = make_run(owner, None, status="failed")[0]
    graph = _graph_of(pre_m3)
    add_invocation(pre_m3, clone_node(graph, "pm"), "done")
    add_invocation(pre_m3, clone_node(graph, "engineer"), "failed")  # no checkpoint before it
    reasons = {
        rid: client.get(f"/api/runs/{rid}/resume").json() for rid in (going, done, folder, pre_m3)
    }
    assert (
        reasons[going]["available"] is False
        and reasons[going]["reason"] == "The run is still going"
    )
    assert reasons[done]["reason"] == "The run finished"
    assert reasons[folder]["reason"] == "Resume isn't available for a run on a folder yet"
    # A run from before M3: its PM step is the first agent step (a fresh start); the Engineer's
    # step after it has no checkpoint to start from.
    points = {p["label"]: p for p in reasons[pre_m3]["points"]}
    assert points["PM"]["resumable"] is True and points["Engineer"]["resumable"] is False
    resp = client.post(f"/api/runs/{going}/resume", json={"invocation_id": 1})
    assert resp.status_code == 409 and resp.json()["detail"] == "The run is still going"


def test_a_workflow_recorded_before_m3_writes_no_checkpoint(client, monkeypatch, tmp_path):
    """Its recorded graph has no ``checkpoints`` key, so its replay calls nothing new."""
    run_id = _new_run()
    _harness(monkeypatch, tmp_path, fail_round_2_of=set())
    real_load = team_run.load_graph_step

    def _old_graph(rid):
        graph = dict(real_load(rid))
        graph.pop("checkpoints")
        graph.pop("resumed")
        return graph

    monkeypatch.setattr(team_run, "load_graph_step", _old_graph)
    assert _start(run_id)["status"] == "completed"
    with session_scope() as session:
        assert (
            session.execute(
                select(RunCheckpoint).where(RunCheckpoint.run_id == uuid.UUID(run_id))
            ).first()
            is None
        )


def test_a_fresh_workspace_is_rebuilt_from_the_newest_checkpoint_and_a_live_one_is_left(
    client, monkeypatch, tmp_path
):
    """A recovery that re-made the workspace on another machine gets the run's last finished
    step back; the workspace the run is working in (it carries a marker) is never patched."""
    run_id = _new_run()
    _harness(monkeypatch, tmp_path, fail_round_2_of=set())
    assert _start(run_id)["status"] == "completed"
    live = tmp_path / run_id
    (live / "scratch.txt").write_text("in progress\n")
    checkpoints.restore(run_id, str(live))
    assert (live / "scratch.txt").exists()  # a live workspace: left alone

    fresh = tmp_path / "rebuilt"
    fresh.mkdir()
    init_workspace_repo(str(fresh))
    team_run._write_workspace_gitignore(str(fresh))
    checkpoints.restore(run_id, str(fresh))
    assert (fresh / "core" / "rsi.py").read_text() == "round 2\n"
    assert (Path(fresh) / "logo.bin").read_bytes() == (live / "logo.bin").read_bytes()


def test_a_step_that_was_never_resumable_is_refused_without_creating_anything(
    client, monkeypatch, tmp_path
):
    old = _new_run()
    _harness(monkeypatch, tmp_path, fail_round_2_of={old})
    assert _start(old)["status"] == "failed"
    with session_scope() as session:
        gate = session.execute(
            select(AgentInvocation.id)
            .where(AgentInvocation.run_id == old)
            .order_by(AgentInvocation.id)
            .offset(1)
            .limit(1)
        ).scalar_one()
    resp = client.post(f"/api/runs/{old}/resume", json={"invocation_id": gate})
    assert resp.status_code == 409
    with session_scope() as session:
        assert (
            session.execute(select(Run).where(Run.resumed_from_run_id == uuid.UUID(old))).first()
            is None
        )
    assert IDEA


def test_the_forced_failure_fails_one_round_of_one_role_and_never_in_a_resumed_run(
    client, monkeypatch
):
    run_id = make_run(auth_user_id(), None, status="running")[0]
    engineer = clone_node(_graph_of(run_id), "engineer")
    pm = clone_node(_graph_of(run_id), "pm")
    assert team_run._forced_failure(run_id, engineer, 2) is None  # unset: inert
    monkeypatch.setattr(get_settings(), "force_fail_role", "engineer")
    monkeypatch.setattr(get_settings(), "force_fail_round", 2)
    failed = team_run._forced_failure(run_id, engineer, 2)
    assert failed["status"] == "failed" and failed["total_tokens"] == 0
    assert team_run._forced_failure(run_id, engineer, 1) is None
    assert team_run._forced_failure(run_id, pm, 2) is None
    with session_scope() as session:
        session.execute(
            update(Run)
            .where(Run.workflow_id == run_id)
            .values(resumed_from_run_id=uuid.UUID(make_run(auth_user_id(), None)[0]))
        )
    assert team_run._forced_failure(run_id, engineer, 2) is None


# ---------------------------------------------------------------------------- review fixes


def _resumed_but_never_started(client, monkeypatch, tmp_path) -> tuple[str, str]:
    """#12 fails at Engineer round 2 and is resumed as #13, whose workflow never runs."""
    old = _new_run()
    _harness(monkeypatch, tmp_path, fail_round_2_of={old})
    assert _start(old)["status"] == "failed"
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    return old, _resume(client, old, _failed_inv(old))


def test_a_child_that_ended_before_its_first_step_does_not_strand_the_run(
    client, monkeypatch, tmp_path
):
    old, new = _resumed_but_never_started(client, monkeypatch, tmp_path)
    assert client.get(f"/api/runs/{old}/resume").json()["available"] is False  # #13 in flight
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(new)).values(status="cancelled"))
    again = client.get(f"/api/runs/{old}/resume").json()
    assert again["available"] is True, again["reason"]
    keys = {i["key"] for i in client.get("/api/inbox").json()["items"]}
    with session_scope() as session:
        status = session.get(Run, uuid.UUID(old)).status
    assert status != "failed" or f"run_failed:{old}" in keys


def test_your_edit_made_while_the_step_was_stalled_is_carried(client, monkeypatch):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    monkeypatch.setattr(get_settings(), "stalled_after_s", 60)
    run_id = make_run(auth_user_id(), None, status="running")[0]
    graph = _graph_of(run_id)
    from tvashtr.documents.service import create_document_with_initial_version

    doc = create_document_with_initial_version(
        "Mini-PRD", "prd", "v1", "agent:entry", f"{run_id}:pm-prd-v1", run_id=uuid.UUID(run_id)
    )
    with session_scope() as session:
        session.execute(update(Run).where(Run.workflow_id == run_id).values(pm_document_id=doc.id))
        session.execute(  # the PM wrote v1 before the Engineer started
            update(DocumentVersion)
            .where(DocumentVersion.document_id == doc.id)
            .values(created_at=datetime.now(UTC) - timedelta(minutes=10))
        )
    add_invocation(run_id, clone_node(graph, "engineer"), "running")
    with session_scope() as session:
        session.execute(
            update(AgentInvocation)
            .where(AgentInvocation.run_id == run_id)
            .values(started_at=datetime.now(UTC) - timedelta(minutes=6))
        )
    # While the Engineer is stuck you clarify the spec (the agent's own words written during the
    # step it is re-running are not carried; yours are).
    add_version(doc.id, "v2 clarified", "human", f"{run_id}:human:1")
    add_version(doc.id, "agent half-way", "agent:entry", f"{run_id}:spec:x:9")
    point = client.get(f"/api/runs/{run_id}/resume").json()["points"][0]
    new = _resume(client, run_id, point["invocation_id"])
    with session_scope() as session:
        run = session.get(Run, uuid.UUID(new))
        versions = session.execute(
            select(DocumentVersion.version_no, DocumentVersion.content)
            .where(DocumentVersion.document_id == run.pm_document_id)
            .order_by(DocumentVersion.version_no)
        ).all()
    assert [tuple(v) for v in versions] == [(1, "v1"), (2, "v2 clarified")]


def test_a_hosted_run_whose_repo_left_the_installation_is_refused_before_anything_stops(
    client, monkeypatch
):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    monkeypatch.setattr(get_settings(), "stalled_after_s", 60)
    monkeypatch.setattr(routers.github_app, "find_repo_in_installations", lambda ids, repo: None)
    run_id = make_run(
        auth_user_id(), None, status="running", github_repo="lazyxgenius/trade_mcp", base_ref="main"
    )[0]
    add_invocation(run_id, clone_node(_graph_of(run_id), "engineer"), "running")
    with session_scope() as session:
        session.execute(
            update(AgentInvocation)
            .where(AgentInvocation.run_id == run_id)
            .values(started_at=datetime.now(UTC) - timedelta(minutes=6))
        )
    inv = _first_inv(run_id)
    resp = client.post(f"/api/runs/{run_id}/resume", json={"invocation_id": inv})
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["message"] == "github_repo is not in your installations"
    with session_scope() as session:
        assert (
            session.execute(select(Run.status).where(Run.workflow_id == run_id)).scalar_one()
            == "running"
        )


def test_a_rebuild_that_fails_after_the_run_opened_a_step_never_raises(
    client, monkeypatch, tmp_path
):
    """A recovery replays recorded steps; failing the run there would call a step the recording
    doesn't have. Only a resumed run's FIRST entry (no step of its own yet) fails readably."""
    old, new = _resumed_but_never_started(client, monkeypatch, tmp_path)
    with session_scope() as session:
        session.execute(
            update(RunCheckpoint)
            .where(RunCheckpoint.run_id == uuid.UUID(new))
            .values(diff=b"diff --git a/nope b/nope\n--- a/nope\n+++ b/nope\n@@ -1 +1 @@\n-x\n+y\n")
        )
    ws = tmp_path / "fresh"
    ws.mkdir()
    init_workspace_repo(str(ws))
    import pytest

    with pytest.raises(checkpoints.CheckpointError):
        checkpoints.restore(new, str(ws))  # first entry: the run has no step of its own
    graph = _graph_of(new)
    add_invocation(new, clone_node(graph, "engineer"), "running", iteration=2)
    ws2 = tmp_path / "fresh2"
    ws2.mkdir()
    init_workspace_repo(str(ws2))
    checkpoints.restore(new, str(ws2))  # a replay elsewhere: logged, never raised


def test_a_carried_node_that_runs_again_reads_as_waiting_with_its_notes_on_the_canvas(
    client, monkeypatch, tmp_path
):
    old, new = _resumed_but_never_started(client, monkeypatch, tmp_path)
    nodes = {n["role_name"]: n for n in client.get(f"/api/runs/{new}/graph").json()["nodes"]}
    assert nodes["reviewer"]["carried"]["text"] == "Round 1 notes carried over"
    assert nodes["engineer"]["carried"]["text"] == "Round 1 carried over"
    assert nodes["pm"]["carried"]["text"].startswith("From ")


def test_the_seed_diff_is_not_read_on_a_poll(client):
    assert RunCheckpoint.__mapper__.attrs["diff"].deferred is True
