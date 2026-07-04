"""The generic thinker — offline keystone for the high-blast-radius executor change (P1.8c).

Drives the REAL ``run_team`` over the ``thinker_chain`` team (PM → Architect → prd_gate →
Engineer → ship), faking ONLY the LLM (``team_run.complete``) and the worker
(``team_run.agent_run_step`` + ``team_run.engineer_setup_step``). The PM (``pm_step``) and the
Architect (``thinker_refine_step``) run for REAL through the executor — so this proves the
non-start completion node (the Architect) genuinely runs and REFINES the shared spec, the residue
this milestone removes.

Mutation note (verified in-transcript): restoring the old non-start-completion ``else``-fail in
``run_graph`` makes the Architect node FAIL the run -> this test goes RED (no v2, run not
``completed``). The generalized first-vs-later dispatch is what keeps it GREEN.
"""

import os
import uuid
from pathlib import Path

from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from sqlalchemy import func, select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_thinker_chain_team
from tvashtr.db import session_scope
from tvashtr.documents.service import get_document_with_versions
from tvashtr.gateway.types import CompletionResult
from tvashtr.models import AgentInvocation, AgentNode, DocumentVersion, EngineerRunAttempt, Run

# Unique markers the fakes plant so the assertions can't pass on a stale/echoed value.
_PM_MARKER = "SPEC-PM"
_ARCHITECT_MARKER = "SPEC-ARCHITECT"


def _completion(text: str) -> CompletionResult:
    """A minimal real ``CompletionResult`` — the same object the gateway returns, so ``record_cost``
    reads its token/cost attrs exactly as in production (no SimpleNamespace shim)."""
    return CompletionResult(
        text=text,
        model_requested="fake/thinker",
        model_used="fake/thinker",
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        cost_usd=0.0,
        raw_provider="fake",
        latency_ms=1.0,
    )


def _make_thinker_chain_run() -> str:
    team_graph_id = build_thinker_chain_team()
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


def test_thinker_chain_runs_the_non_start_thinker_and_ships(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")

    # A real git workspace the stubbed worker writes into + the run ships from (no openhands).
    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    worker_prd: list[str] = []

    def _fake_complete(request):
        # PM call -> SPEC-PM only; Architect call -> restate SPEC-PM AND append SPEC-ARCHITECT.
        # Distinguish by the node prompt the executor put into the message (the only LLM callers
        # here are pm_step and thinker_refine_step).
        content = request.messages[0]["content"].lower()
        if "architect" in content:
            return _completion(
                f"{_PM_MARKER} (restated)\n\n## Technical design\n{_ARCHITECT_MARKER}"
            )
        return _completion(f"{_PM_MARKER}: write greeting.txt")

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
    ):
        # The Engineer is the only agent node, with no conditional out-edge -> emits_outcome False,
        # so it never short-circuits. Capture the spec it received (proves it read the REFINED spec
        # via read_latest_prd_step), record the attempt, and write the deliverable so ship has work.
        worker_prd.append(prd_text)
        with session_scope() as session:
            session.add(EngineerRunAttempt(run_id=run_id, pid=os.getpid()))
        (Path(workspace_dir) / "greeting.txt").write_text(f"build {iteration}\n")
        return {
            "status": "completed",
            "outcome": None,
            "reasons": None,
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
            "cost_usd": 0.0,
        }

    monkeypatch.setattr(team_run, "complete", _fake_complete)
    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_engineer_setup_step)
    monkeypatch.setattr(team_run, "agent_run_step", _fake_agent_run_step)

    run_id = _make_thinker_chain_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()

    assert result["status"] == "completed"

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        document_id = run.pm_document_id
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
        architect_invs = _invocations(by_role["architect"].id)
        n_versions = session.execute(
            select(func.count())
            .select_from(DocumentVersion)
            .where(DocumentVersion.document_id == document_id)
        ).scalar_one()

    # (3) Terminal completed, shipped exactly once.
    assert run.status == "completed"
    assert run.ship_tag == f"ship-{run_id}"

    # (1) The spec doc has EXACTLY 2 versions: PM v1 + the non-start Architect's v2 (it ran AND
    #     appended). If the Architect had failed/not-run, there would be only 1.
    assert n_versions == 2
    doc = get_document_with_versions(document_id)
    assert [v.version_no for v in doc.versions] == [1, 2]
    assert doc.versions[0].created_by == "agent:pm"
    assert doc.versions[1].created_by == "agent:thinker"

    # (2) The worker read the REFINED spec via read_latest_prd_step — its prd_text carries BOTH
    #     markers (the PM's, restated, AND the Architect's appended design).
    assert len(worker_prd) == 1
    assert _PM_MARKER in worker_prd[0]
    assert _ARCHITECT_MARKER in worker_prd[0]

    # (4) Both thinkers' invocations closed done/prd_written (the PM and the non-start Architect).
    assert [(i.iteration, i.status, i.outcome) for i in pm_invs] == [(1, "done", "prd_written")]
    assert [(i.iteration, i.status, i.outcome) for i in architect_invs] == [
        (1, "done", "prd_written")
    ]
