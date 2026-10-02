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
from tvashtr.control_plane.teams import build_review_loop_team
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
