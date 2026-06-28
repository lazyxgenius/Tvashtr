"""Executor-level proof of the per-node work-brief (Option A): the PM (thinker) AND the Engineer
(non-emitting worker) both persist a deterministic ``outcome_detail`` brief through the REAL
``run_team`` over the ``review_loop`` team, while the Reviewer (emitting worker) keeps its verdict
reasons — i.e. the brief is populated for MORE than just the Reviewer.

Same offline harness as ``test_review_loop`` (real ``run_team``, Reviewer forced, PRD gate
auto-approved, agent + PM stubbed — no LLM / no openhands). The worker fake here returns a real
``files_changed`` list so the Engineer's brief exercises the NON-EMPTY files-changed variant.

Mutation note (shown in-transcript): reverting the two close-site ``outcome_detail`` additions in
``run_graph`` (the thinker close + the non-emitting worker close) makes the PM's and Engineer's
``outcome_detail`` go NULL -> this test goes RED. The Reviewer-reasons assertion is the byte-stable
guard that the EMITTING worker is left untouched.
"""

import os
import uuid
from pathlib import Path

from conftest import auth_user_id, seed_pm_prd
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, EngineerRunAttempt, Run

_FILES_CHANGED = ["greeting.txt", "main.py"]
_EXPECTED_WORKER_BRIEF = "Built the feature — changed 2 file(s): greeting.txt, main.py"


def _make_review_loop_run() -> str:
    team_graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="build greeting.txt",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def test_executor_populates_work_brief_for_thinker_and_worker(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    def _fake_pm_step(run_id, idea, pm_model, pm_prompt):
        return seed_pm_prd(run_id, idea)

    def _fake_engineer_setup_step(run_id):
        return str(workspace)

    def _fake_agent_run_step(
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
    ):
        # Emitting node (Reviewer): the real forced harness -> verdict reasons (NOT a work-brief).
        if emits_outcome:
            return team_run._forced_review_outcome(iteration)
        # Non-emitting worker (Engineer): write the deliverable + report files_changed so the close
        # composes the NON-EMPTY files-changed brief (the variant test_review_loop's no-files fake
        # can't reach).
        with session_scope() as session:
            session.add(EngineerRunAttempt(run_id=run_id, pid=os.getpid()))
        (Path(workspace_dir) / "greeting.txt").write_text(f"build {iteration}\n")
        return {
            "status": "completed",
            "outcome": None,
            "reasons": None,
            "files_changed": list(_FILES_CHANGED),
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
            "cost_usd": 0.0,
        }

    monkeypatch.setattr(team_run, "pm_step", _fake_pm_step)
    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_engineer_setup_step)
    monkeypatch.setattr(team_run, "agent_run_step", _fake_agent_run_step)

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()
    assert result["status"] == "completed"

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )
        by_role = {n.role_name: n for n in nodes}

        def _invocations(node_id):
            return (
                session.execute(
                    select(AgentInvocation)
                    .where(AgentInvocation.run_id == run_id, AgentInvocation.node_id == node_id)
                    .order_by(AgentInvocation.iteration)
                )
                .scalars()
                .all()
            )

        pm_invs = _invocations(by_role["pm"].id)
        eng_invs = _invocations(by_role["engineer"].id)
        rev_invs = _invocations(by_role["reviewer"].id)

    # The thinker (PM, the first/root thinker) wrote the first-thinker brief.
    assert [i.outcome_detail for i in pm_invs] == ["Drafted the spec from the idea."]

    # The non-emitting worker (Engineer) wrote the NON-EMPTY files-changed brief on every round (it
    # ran twice: build + revision) — the brief is populated for MORE than just the Reviewer.
    assert len(eng_invs) == 2
    assert all(i.outcome_detail == _EXPECTED_WORKER_BRIEF for i in eng_invs)

    # The EMITTING worker (Reviewer) is byte-stable: its outcome_detail stays the verdict reasons
    # (forced-revision marker on the changes_requested round, NULL on approve) — NOT a work-brief.
    assert [i.outcome for i in rev_invs] == ["changes_requested", "approved"]
    assert rev_invs[0].outcome_detail is not None
    assert "forced revision" in rev_invs[0].outcome_detail
    assert rev_invs[1].outcome_detail is None
