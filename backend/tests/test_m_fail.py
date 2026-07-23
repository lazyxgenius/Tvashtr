"""M-fail: a FAILED agent node must keep its WORK, its MONEY and its REASON.

Proven live (run 6fd2c911): the Engineer tripped ``MaxIterationsReached(20)`` while verifying
already-finished edits; every edit was discarded, $0.0104 was recorded as $0, and no reason was
stored. The adapter-level halves (work + money) live in ``test_docker_adapter.py`` /
``test_fly_adapter.py``; this file holds the two that don't belong to a single adapter:

  * change 1: the agent-loop iteration cap default (a config resolution the local adapter owns);
  * change 4: run_graph persisting a failed node's ``error`` as the invocation ``outcome_detail``.
"""

import importlib
import uuid

from conftest import auth_user_id, entry_report_result
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, Run

# The concrete failure reason the run must carry all the way to the invocation row.
_ENGINEER_ERROR = "MaxIterationsReached: hit the iteration cap while verifying finished edits"


# ---- change 1: the agent-loop iteration cap ----


def test_max_iterations_defaults_to_150_and_honors_the_env_override(monkeypatch):
    """20 was too few: run 6fd2c911 tripped ``MaxIterationsReached(20)`` while the agent was
    VERIFYING already-finished edits, so the run failed a task it had actually completed. The
    default is bumped to 150 (a runaway backstop, not a work budget); the
    ``TVASHTR_AGENT_MAX_ITERATIONS`` override is preserved. ``_MAX_ITERATIONS`` resolves the env at
    import, so the module is reloaded under each condition and restored afterwards."""
    from tvashtr.engines import openhands_adapter as m

    try:
        monkeypatch.delenv("TVASHTR_AGENT_MAX_ITERATIONS", raising=False)
        importlib.reload(m)
        assert m._MAX_ITERATIONS == 150  # the new default
        monkeypatch.setenv("TVASHTR_AGENT_MAX_ITERATIONS", "7")
        importlib.reload(m)
        assert m._MAX_ITERATIONS == 7  # the override still wins
    finally:
        # Restore the real default so the reload can't leak a stale cap into the rest of the suite.
        monkeypatch.delenv("TVASHTR_AGENT_MAX_ITERATIONS", raising=False)
        importlib.reload(m)


# ---- change 4: a failed node records its REASON on the invocation row ----


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


def test_a_failed_agent_node_records_its_error_as_outcome_detail(client, monkeypatch, tmp_path):
    """When an agent node returns a non-completed status, ``run_graph`` must persist the engine's
    ``error`` as that invocation's ``outcome_detail``, so the REASON a node failed lives on the row
    the run inspector reads, not only in a transient ``DBOS.logger.error`` line (run 6fd2c911 stored
    no reason at all). Same offline harness as ``test_work_brief_executor`` (real ``run_team``
    over the review_loop, PM stubbed, PRD gate auto-approved), but the Engineer FAILS."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

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
        budget,
        invocation_id=None,
        edits_allowed=True,
        **kwargs,
    ):
        # Entry (PM) succeeds so the graph reaches the Engineer.
        if not edits_allowed and not emits_outcome:
            return entry_report_result(idea)
        # A reviewer would emit — unreached, because the Engineer fails first.
        if emits_outcome:
            return team_run._forced_review_outcome(iteration)
        # The Engineer (non-emitting worker) FAILS with a concrete, self-explaining reason.
        return {
            "status": "failed",
            "outcome": None,
            "reasons": None,
            "error": _ENGINEER_ERROR,
            "files_changed": [],
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
        }

    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_engineer_setup_step)
    monkeypatch.setattr(team_run, "agent_run_step", _fake_agent_run_step)

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()
    assert result["status"] == "failed"
    assert result.get("error") == _ENGINEER_ERROR

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )
        by_role = {n.role_name: n for n in nodes}
        eng_invs = (
            session.execute(
                select(AgentInvocation)
                .where(
                    AgentInvocation.run_id == run_id,
                    AgentInvocation.node_id == by_role["engineer"].id,
                )
                .order_by(AgentInvocation.iteration)
            )
            .scalars()
            .all()
        )

    # The failing node ran once and its REASON is on the row — not just in a log line.
    assert len(eng_invs) == 1
    assert eng_invs[0].status == "failed"
    assert eng_invs[0].outcome_detail == _ENGINEER_ERROR
