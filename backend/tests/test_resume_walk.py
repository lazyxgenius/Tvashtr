"""M3 (ruling R8) — the acceptance test, offline (no LLM, no openhands): a run that fails at
Engineer round 2 is resumed from that step through the API. The carried steps (the PM's spec, the
approval, Engineer round 1, Reviewer round 1) are never run again and never billed again; the new
run's workspace is rebuilt from the checkpoint; its rounds continue (Engineer 2, Reviewer 2); it
ships. Drives the REAL ``run_team`` with the step fakes ``test_review_loop.py`` uses."""

import uuid
from pathlib import Path

from conftest import auth_user_id, entry_report_result
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team, clone_team_graph
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    Document,
    DocumentVersion,
    Run,
    RunCheckpoint,
)

IDEA = "Add an RSI indicator"


def _tree(ws: Path) -> dict[str, bytes]:
    return {
        str(p.relative_to(ws)): p.read_bytes()
        for p in sorted(ws.rglob("*"))
        if p.is_file() and ".git" not in p.relative_to(ws).parts
    }


def _harness(monkeypatch, tmp_path, fail_round_2_of: set[str]):
    """Fakes for the two openhands-touching steps; returns the call log."""
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")  # Reviewer: changes round 1, approves 2
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    calls: list[dict] = []

    def _setup(run_id):
        ws = tmp_path / run_id
        if not ws.exists():
            ws.mkdir()
            init_workspace_repo(str(ws))
            team_run._write_workspace_gitignore(str(ws))
        return str(ws)

    def _agent(
        run_id,
        node_prompt,
        model,
        iteration,
        idea,
        prd_text,
        workspace_dir,
        vkey,
        reviewer_feedback,
        emits_outcome,
        budget,
        invocation_id=None,
        edits_allowed=True,
        **kwargs,
    ):
        ws = Path(workspace_dir)
        role = (
            "entry"
            if (not edits_allowed and not emits_outcome)
            else ("reviewer" if emits_outcome else "engineer")
        )
        calls.append(
            {
                "run_id": run_id,
                "role": role,
                "iteration": iteration,
                "feedback": reviewer_feedback,
                "spec": prd_text,
                "tree": _tree(ws),
            }
        )
        if role == "entry":
            return entry_report_result(idea)
        if role == "reviewer":
            return team_run._forced_review_outcome(iteration)
        if iteration == 2 and run_id in fail_round_2_of:
            return {
                "status": "failed",
                "outcome": None,
                "reasons": None,
                "error": "the model didn't answer after 3 tries",
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "cost_usd": 0.0,
            }
        (ws / "core").mkdir(exist_ok=True)
        (ws / "core" / "rsi.py").write_text(f"round {iteration}\n")
        (ws / "logo.bin").write_bytes(bytes(range(iteration, 200)))
        return {
            "status": "completed",
            "outcome": None,
            "reasons": None,
            "files_changed": ["core/rsi.py"],
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "total_tokens": 150,
            "cost_usd": 0.25,
        }

    monkeypatch.setattr(team_run, "engineer_setup_step", _setup)
    monkeypatch.setattr(team_run, "agent_run_step", _agent)
    return calls


def _start(run_id: str) -> dict:
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, IDEA)
    return handle.get_result()


def _new_run() -> str:
    graph = build_review_loop_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(graph),
                owner_id=auth_user_id(),
                idea=IDEA,
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def _invocations(run_id: str) -> list[tuple[str, int, str]]:
    with session_scope() as session:
        rows = session.execute(
            select(AgentNode.role_name, AgentInvocation.iteration, AgentInvocation.status)
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .where(AgentInvocation.run_id == run_id)
            .order_by(AgentInvocation.id)
        ).all()
    return [tuple(r) for r in rows]


def test_a_run_failing_at_engineer_round_2_resumes_from_there_and_ships(
    client, monkeypatch, tmp_path
):
    old = _new_run()
    calls = _harness(monkeypatch, tmp_path, fail_round_2_of={old})
    assert _start(old)["status"] == "failed"
    assert _invocations(old) == [
        ("pm", 1, "done"),
        ("prd_gate", 1, "done"),
        ("engineer", 1, "done"),
        ("reviewer", 1, "done"),
        ("engineer", 2, "failed"),
    ]
    # A checkpoint per finished step (the gate has none); round 1's work is in the reviewer's.
    with session_scope() as session:
        cps = (
            session.execute(select(RunCheckpoint).where(RunCheckpoint.run_id == uuid.UUID(old)))
            .scalars()
            .all()
        )
        assert len(cps) == 3 and all(cp.invocation_id is not None for cp in cps)
        failed_inv = session.execute(
            select(AgentInvocation.id).where(
                AgentInvocation.run_id == old, AgentInvocation.status == "failed"
            )
        ).scalar_one()
    round_1_tree = next(c["tree"] for c in calls if c["role"] == "reviewer")
    assert round_1_tree["core/rsi.py"] == b"round 1\n"

    # The run view offers Engineer, round 2 — the step that failed.
    reply = client.get(f"/api/runs/{old}/resume").json()
    assert reply["available"] is True
    suggested = next(p for p in reply["points"] if p["state"] == "suggested")
    assert suggested["invocation_id"] == failed_inv and suggested["resumable"] is True
    assert suggested["confirm"]["step_label"] == "Engineer, round 2"

    resp = client.post(f"/api/runs/{old}/resume", json={"invocation_id": failed_inv})
    assert resp.status_code == 201, resp.text
    new = resp.json()["run_id"]
    result = DBOS.retrieve_workflow(new).get_result()
    assert result["status"] == "completed"

    # Carried steps were never run again: the new run's only rows are Engineer 2, Reviewer 2, Ship.
    assert _invocations(new) == [
        ("engineer", 2, "done"),
        ("reviewer", 2, "done"),
        ("ship", 1, "done"),
    ]
    new_calls = [c for c in calls if c["run_id"] == new]
    assert [(c["role"], c["iteration"]) for c in new_calls] == [("engineer", 2), ("reviewer", 2)]
    # The rebuilt workspace equals the checkpoint the reviewer saw; the reviewer's notes carried.
    assert new_calls[0]["tree"] == round_1_tree
    assert new_calls[0]["feedback"] is not None
    assert new_calls[0]["spec"] == f"PRD: {IDEA}"
    with session_scope() as session:
        new_run = session.get(Run, uuid.UUID(new))
        old_run = session.get(Run, uuid.UUID(old))
        assert new_run.resumed_from_run_id == old_run.id
        assert new_run.resumed_from_step == failed_inv
        assert new_run.team_graph_id != old_run.team_graph_id
        assert new_run.ship_tag == f"ship-{new}"
        # Billed only for what ran again: the Engineer's round 2 (the forced Reviewer costs 0).
        billed = session.execute(
            select(AgentNode.role_name, AgentInvocation.iteration)
            .select_from(CostRecord)
            .join(AgentInvocation, AgentInvocation.id == CostRecord.invocation_id)
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .where(CostRecord.workflow_id == new)
        ).all()
        assert [tuple(b) for b in billed] == [("engineer", 2)]
        # The spec the old run wrote, under the new run.
        doc = session.get(Document, new_run.pm_document_id)
        assert doc.run_id == new_run.id
        versions = session.execute(
            select(DocumentVersion.version_no, DocumentVersion.content).where(
                DocumentVersion.document_id == doc.id
            )
        ).all()
        assert [tuple(v) for v in versions] == [(1, f"PRD: {IDEA}")]
    ws = tmp_path / new
    assert (ws / "core" / "rsi.py").read_text() == "round 2\n"


def _library_run(client) -> str:
    """A run of a library team (so it is "run #n"), owned by the ``client`` account."""
    resp = client.post("/api/teams", json={"template": "review_loop", "name": "Indicator sprint"})
    assert resp.status_code in (200, 201), resp.text
    team = resp.json()["team_graph_id"]
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(clone_team_graph(team)),
                owner_id=auth_user_id(),
                idea=IDEA,
                workflow_id=run_id,
                status="running",
                library_team_id=uuid.UUID(team),
            )
        )
    return run_id


def _failed_inv(run_id: str) -> int:
    with session_scope() as session:
        return session.execute(
            select(AgentInvocation.id).where(
                AgentInvocation.run_id == run_id, AgentInvocation.status == "failed"
            )
        ).scalar_one()


def _roles(run_id: str) -> dict[str, str]:
    with session_scope() as session:
        run = session.get(Run, uuid.UUID(run_id))
        return {
            n.role_name: str(n.id)
            for n in session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id)
            ).scalars()
        }


def test_the_failed_run_offers_resume_until_it_is_picked_up_and_the_new_run_reads_carried(
    client, monkeypatch, tmp_path
):
    old = _library_run(client)
    _harness(monkeypatch, tmp_path, fail_round_2_of={old})
    assert _start(old)["status"] == "failed"
    failed_inv = _failed_inv(old)

    # Before: the Failed callout and Needs you offer "Resume from Engineer, round 2".
    act = client.get(f"/api/runs/{old}/activity").json()
    assert act["pinned"]["kind"] == "failed"
    assert act["pinned"]["resume"] == {"invocation_id": failed_inv, "label": "Engineer, round 2"}
    assert "spec (v1)" in act["pinned"]["safe"] and "round 1 changes" in act["pinned"]["safe"]
    inbox = client.get("/api/inbox").json()["items"]
    item = next(i for i in inbox if i["key"] == f"run_failed:{old}")
    assert item["resume"] == {"invocation_id": failed_inv, "label": "Engineer, round 2"}
    number = client.get(f"/api/runs/{old}").json()["run"]["number"]
    assert isinstance(number, int)

    resp = client.post(f"/api/runs/{old}/resume", json={"invocation_id": failed_inv})
    assert resp.status_code == 201, resp.text
    new = resp.json()["run_id"]
    assert resp.json()["number"] == number + 1
    assert DBOS.retrieve_workflow(new).get_result()["status"] == "completed"

    # After: the old run is picked up — no second Resume, and it leaves Needs you.
    assert client.get(f"/api/runs/{old}/activity").json()["pinned"]["resume"] is None
    again = client.get(f"/api/runs/{old}/resume").json()
    assert again["available"] is False and again["reason"] == f"Picked up again as run #{number + 1}"
    assert client.post(f"/api/runs/{old}/resume", json={"invocation_id": failed_inv}).status_code == 409
    keys = {i["key"] for i in client.get("/api/inbox").json()["items"]}
    assert f"run_failed:{old}" not in keys

    # The new run: number, link, carried lines, the Resumed line, Carried over agents.
    run = client.get(f"/api/runs/{new}").json()["run"]
    assert run["number"] == number + 1
    resumed_from = {"run_id": old, "number": number, "step_label": "Engineer, round 2"}
    assert run["resumed_from"] == resumed_from
    act = client.get(f"/api/runs/{new}/activity").json()
    assert act["number"] == number + 1 and act["resumed_from"] == resumed_from
    roles = _roles(new)
    carried = [ln for ln in act["lines"] if ln["kind"] == "carried"]
    assert [(ln["id"], ln["node_id"], ln["text"]) for ln in carried] == [
        ("c:0", roles["pm"], "Wrote the spec (v1)"),
        ("c:1", roles["prd_gate"], "You approved the spec"),
        ("c:2", roles["engineer"], "Round 1 · edited 1 file"),
        ("c:3", roles["reviewer"], "Round 1 · asked for 1 fix"),
    ]
    assert all(ln["from_run"] == {"run_id": old, "number": number} for ln in carried)
    kinds = [ln["kind"] for ln in act["lines"]]
    assert kinds[:5] == ["carried"] * 4 + ["resumed"]
    resumed_line = act["lines"][4]
    assert resumed_line["text"] == f"Resumed from run #{number} at Engineer, round 2"
    assert "run:start" not in {ln["id"] for ln in act["lines"]}
    assert not [ln for ln in act["lines"] if ln["kind"] == "wrote_doc"]  # the copy isn't news
    assert all(ln["from_run"] is None for ln in act["lines"][4:])
    agents = {a["node_id"]: a for a in act["agents"]}
    assert agents[roles["pm"]]["live_state"] == "carried_over"
    assert agents[roles["pm"]]["activity"] == f"From run #{number} · spec v1"
    assert agents[roles["prd_gate"]]["live_state"] == "carried_over"
    assert agents[roles["prd_gate"]]["activity"] == f"Approved in run #{number}"
    assert agents[roles["engineer"]]["live_state"] == "done"

    # The canvas and Home read the carried nodes as reached.
    graph = {n["id"]: n for n in client.get(f"/api/runs/{new}/graph").json()["nodes"]}
    assert graph[roles["pm"]]["carried"] == {
        "from_run_id": old,
        "number": number,
        "text": f"From run #{number}",
    }
    assert graph[roles["prd_gate"]]["carried"]["text"] == f"Approved in run #{number}"
    assert graph[roles["engineer"]]["carried"] is None
    rows = client.get("/api/runs", params={"include": "progress", "limit": 100}).json()["runs"]
    chips = {c["node_id"]: c for c in next(r for r in rows if r["run_id"] == new)["progress"]}
    assert chips[roles["pm"]]["state"] == "done" and chips[roles["pm"]]["carried"] is True
    assert chips[roles["engineer"]]["carried"] is False
