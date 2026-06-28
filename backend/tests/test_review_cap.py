"""The review-escalation cap — offline workflow tests (NO LLM, NO agent, NO openhands).

Proves D4's **enforced termination**: when forced revisions exceed
``max_review_iterations`` the cyclic Engineer<->Reviewer loop does NOT spin forever — it
stops at the cap and raises the high-priority ``review_escalation`` blocker, whose two
resolutions both finalize correctly:

* **approve -> ship-as-is** (the must-have): the run ships the last completed build and
  finalizes ``completed``;
* **reject -> rejected**: the run stops without shipping.

Mirrors ``test_review_loop.py``'s harness — the REAL ``run_team`` over the 3-node
``review_loop`` team with the Reviewer in **forced mode** (``TVASHTR_FORCE_REVISIONS=5`` >
the default cap of 3) and the agent **stubbed** by monkeypatching the three
openhands-touching steps (``pm_step`` + ``engineer_setup_step`` + ``engineer_run_step``), so
no ``openhands`` is imported and ``test_registry`` stays green.

The cap arithmetic (``max_review_iterations=3``): the Engineer runs exactly 3 times (rounds
1, 2, 3, the Reviewer forcing ``changes_requested`` each round), then the 4th Engineer
iteration trips ``if n > max_iters`` BEFORE any 4th build -> the ``review_escalation`` gate.
"""

import importlib
import os
import sys
import time
import uuid
from pathlib import Path

from conftest import auth_user_id, seed_pm_prd
from dbos import DBOS, SetWorkflowID
from sqlalchemy import func, select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    EngineerRunAttempt,
    HumanTask,
    Run,
)

# > max_review_iterations (3): the Reviewer forces changes_requested every round, so the
# loop only ever stops at the cap (never by a forced approval) — this is what exercises the
# enforced-termination guard rather than the happy approve-exit.
FORCE_OVER_CAP = "5"
MAX_REVIEW_ITERATIONS = 3  # config.py default; the cap the Engineer must stop at


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


def _stub_agent(monkeypatch, workspace: Path) -> list[tuple[int, str | None]]:
    """Stub the three openhands-touching steps (exactly like ``test_review_loop``); return
    the list that records each Engineer call's ``(iteration, reviewer_feedback)`` so a test
    can assert how many times the Engineer ran (the cap proof)."""
    engineer_calls: list[tuple[int, str | None]] = []

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
        # P1.8a unified agent step: the reviewer-style node runs the REAL forced harness
        # (TVASHTR_FORCE_REVISIONS over the cap drives the escalation); the worker records each
        # call (the cap proof) + the attempt row + writes the deliverable.
        if emits_outcome:
            return team_run._forced_review_outcome(iteration)
        engineer_calls.append((iteration, reviewer_feedback))
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

    monkeypatch.setattr(team_run, "pm_step", _fake_pm_step)
    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_engineer_setup_step)
    monkeypatch.setattr(team_run, "agent_run_step", _fake_agent_run_step)
    return engineer_calls


def _by_role(session, team_graph_id) -> dict:
    nodes = (
        session.execute(select(AgentNode).where(AgentNode.team_graph_id == team_graph_id))
        .scalars()
        .all()
    )
    return {n.role_name: n for n in nodes}


def _invocations(session, run_id: str, node_id):
    return (
        session.execute(
            select(AgentInvocation)
            .where(AgentInvocation.run_id == run_id, AgentInvocation.node_id == node_id)
            .order_by(AgentInvocation.iteration)
        )
        .scalars()
        .all()
    )


def _resolve_gate_when_pending(
    client, run_id: str, *, kind: str, decision: str, timeout: float = 20.0
) -> dict:
    """Poll the real tasks endpoint until a *pending* task of ``kind`` exists, then resolve it
    via the real resolve endpoint (which only signals the workflow via ``DBOS.send``). Mirrors
    ``test_gates.py``'s HTTP-driven resolution; used to approve the PRD gate and reject the
    escalation gate while the workflow runs in the background (``start_workflow``)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.get(f"/api/runs/{run_id}/tasks")
        assert resp.status_code == 200
        for task in resp.json()["tasks"]:
            if task["status"] == "pending" and task["kind"] == kind:
                r = client.post(
                    f"/api/runs/{run_id}/tasks/{task['id']}/resolve",
                    json={"decision": decision},
                )
                assert r.status_code == 200, r.text
                return r.json()
        time.sleep(0.05)
    raise AssertionError(f"no pending {kind!r} task appeared within {timeout}s")


def test_cap_exhaustion_escalates_then_approve_ships_as_is(client, monkeypatch, tmp_path):
    """THE must-have (D4 enforced termination): forced revisions past the cap -> the Engineer
    runs exactly ``max_review_iterations`` times (not a 4th, not unbounded) -> a
    ``review_escalation`` high-priority blocker is raised -> approve ships the last build
    as-is and finalizes ``completed`` with exactly one ship."""
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", FORCE_OVER_CAP)
    # Auto-approve is all-or-nothing, which is exactly right here: it approves BOTH the PRD
    # gate and the escalation gate -> the escalation resolves "approved" = ship-as-is.
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))
    engineer_calls = _stub_agent(monkeypatch, workspace)

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()

    assert result["status"] == "completed"

    # The cap HELD: the Engineer ran exactly max_review_iterations times — never a 4th build.
    assert [c[0] for c in engineer_calls] == [1, 2, 3]

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        by_role = _by_role(session, run.team_graph_id)
        eng_invs = _invocations(session, run_id, by_role["engineer"].id)
        rev_invs = _invocations(session, run_id, by_role["reviewer"].id)
        n_attempts = session.execute(
            select(func.count())
            .select_from(EngineerRunAttempt)
            .where(EngineerRunAttempt.run_id == run_id)
        ).scalar_one()
        n_agent_cost = session.execute(
            select(func.count())
            .select_from(CostRecord)
            .where(CostRecord.idempotency_key.like(f"{run_id}:agent-cost:%"))
        ).scalar_one()
        escalation = session.execute(
            select(HumanTask).where(
                HumanTask.run_id == run_id,
                HumanTask.kind == "review_escalation",
            )
        ).scalar_one()

    # Shipped exactly once (ship-as-is), terminal completed.
    assert run.status == "completed"
    assert run.ship_tag == f"ship-{run_id}"
    # One attempt + one cost row per Engineer iteration (3) — the cap bounded the spend.
    assert n_attempts == 3
    assert n_agent_cost == 3
    # Engineer invocations 1,2,3 all done; the cap fires BEFORE a 4th invocation row.
    assert [i.iteration for i in eng_invs] == [1, 2, 3]
    assert [i.status for i in eng_invs] == ["done", "done", "done"]
    # Reviewer forced changes_requested every round (no approve-exit; the cap is what stopped it).
    assert [i.iteration for i in rev_invs] == [1, 2, 3]
    assert [i.outcome for i in rev_invs] == [
        "changes_requested",
        "changes_requested",
        "changes_requested",
    ]
    # The review_escalation blocker was genuinely raised (the resolved blocker M1 needs).
    assert escalation.kind == "review_escalation"
    assert escalation.priority == "high_blocker"
    assert escalation.resolution == "approved"


def test_cap_exhaustion_reject_finalizes_rejected_without_shipping(client, monkeypatch, tmp_path):
    """The reject resolution: same forced-cap setup, but the escalation gate is REJECTED ->
    the run finalizes ``rejected`` and ships nothing.

    Auto-approve can't express this (it's all-or-nothing), so both gates are driven over the
    real HTTP resolve endpoint, ``test_gates.py``-style, while the workflow runs in the
    background: approve the PRD gate, then reject the escalation."""
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", FORCE_OVER_CAP)
    # Deliberately NOT setting TVASHTR_AUTO_APPROVE_GATES — we resolve each gate by hand.

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))
    engineer_calls = _stub_agent(monkeypatch, workspace)

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")

    # Approve the PRD gate so the loop runs, then reject the escalation that the cap raises
    # after Engineer x3 (the stubbed Engineer is instant, so the escalation opens promptly).
    _resolve_gate_when_pending(client, run_id, kind="prd_approval", decision="approve")
    reject = _resolve_gate_when_pending(client, run_id, kind="review_escalation", decision="reject")
    assert reject["resolution"] == "rejected"

    result = handle.get_result()
    assert result["status"] == "rejected"

    # The cap still held even on the reject path: exactly 3 Engineer builds, no 4th.
    assert [c[0] for c in engineer_calls] == [1, 2, 3]

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        escalation = session.execute(
            select(HumanTask).where(
                HumanTask.run_id == run_id,
                HumanTask.kind == "review_escalation",
            )
        ).scalar_one()

    assert run.status == "rejected"
    # Nothing shipped on the reject path.
    assert run.ship_tag is None
    assert run.ship_commit_sha is None
    assert escalation.kind == "review_escalation"
    assert escalation.priority == "high_blocker"
    assert escalation.resolution == "rejected"


def test_cap_tests_import_no_openhands():
    """Guard (mirrors ``test_registry``): the executor surface these cap tests drive must not
    pull ``openhands.*`` at import — the agent is stubbed, the boundary stays intact."""
    for module_name in ("tvashtr.control_plane.team_run", "tvashtr.control_plane.teams"):
        for name in list(sys.modules):
            if name == "openhands" or name.startswith("openhands."):
                del sys.modules[name]
        sys.modules.pop(module_name, None)
        importlib.import_module(module_name)
        leaked = [m for m in sys.modules if m == "openhands" or m.startswith("openhands.")]
        assert leaked == [], f"{module_name} must not import openhands.* at import time: {leaked}"
