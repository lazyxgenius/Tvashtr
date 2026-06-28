"""Authoring-view "last run" brief + the ``cloned_from_node_id`` linkage (Option A, Milestone 2).

Proves the AUTHORING graph endpoint (``GET /api/teams/{id}/graph``) joins a run's CLONE-node
invocations back to the AUTHORED node via ``cloned_from_node_id`` and surfaces the latest one as
``last_run`` — correct across multiple runs and surviving a later run that skipped a node.

* decision-a (keystone): a full REAL run over a clone of a library team → the authored PM (thinker)
  and Engineer (worker) nodes carry their ``last_run`` brief; a never-run authored node → ``None``.
* decision-b (latest-across-runs + survives-a-skip): run1 full; run2 fails before the Engineer (its
  setup raises) so run2 SKIPS the Engineer → the Engineer's authoring ``last_run`` STILL reflects
  run1, while the PM's reflects run2 (``ORDER BY started_at DESC``, not arbitrary/first).

Mutation (shown in-transcript): revert ``clone_team_graph``'s ``cloned_from_node_id`` set → the join
matches nothing → every authored node's ``last_run`` is ``None`` → these assertions go RED.

Offline harness: the REAL ``run_team`` over the real clone, with only the agents faked (``pm_step``
+ ``agent_run_step`` + ``engineer_setup_step``) — no LLM, no openhands — mirroring
``test_work_brief_executor``.
"""

import os
import uuid
from pathlib import Path

from conftest import auth_user_id, seed_pm_prd
from dbos import DBOS, SetWorkflowID

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import clone_team_graph, create_team_from_template
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, EngineerRunAttempt, Run

_FILES_CHANGED = ["greeting.txt", "main.py"]
_EXPECTED_WORKER_BRIEF = "Built the feature — changed 2 file(s): greeting.txt, main.py"
_THINKER_BRIEF = "Drafted the spec from the idea."


def _full_run_fakes(monkeypatch, workspace):
    """Wire the offline agent fakes for a FULL real run: the Reviewer runs the forced harness, the
    Engineer writes the deliverable + reports ``files_changed`` (so its brief is the files variant),
    the PM seeds the PRD."""

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
        if emits_outcome:
            return team_run._forced_review_outcome(iteration)
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


def _run_clone(library_id: str) -> tuple[str, str]:
    """Clone-on-launch (``clone_team_graph``) + a Run against the CLONE — what ``create_run`` does,
    minus the workflow start. Returns ``(clone_team_graph_id, run_id)``."""
    clone_id = clone_team_graph(library_id)
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(clone_id),
                owner_id=auth_user_id(),
                idea="build greeting.txt",
                workflow_id=run_id,
                status="running",
            )
        )
    return clone_id, run_id


def _authored_last_run(client, library_id: str) -> dict[str, dict | None]:
    """``GET`` the authoring graph; return ``{role_name -> last_run dict | None}``."""
    res = client.get(f"/api/teams/{library_id}/graph")
    assert res.status_code == 200, res.text
    return {n["role_name"]: n["last_run"] for n in res.json()["nodes"]}


def test_authoring_last_run_links_clone_invocations_to_authored_nodes(
    client, monkeypatch, tmp_path
):
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))
    _full_run_fakes(monkeypatch, workspace)

    library_id = create_team_from_template("review_loop", "m2-keystone", auth_user_id())
    clone_id, run_id = _run_clone(library_id)
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    assert handle.get_result()["status"] == "completed"

    # An EXTRA authored node added AFTER the only run -> it has NO clone -> last_run None.
    with session_scope() as session:
        session.add(
            AgentNode(
                team_graph_id=uuid.UUID(library_id),
                role_name="never_ran",
                kind="completion",
                prompt="x",
                model="m",
                engine=None,
                position={"x": 999, "y": 0},
                config=None,
            )
        )

    last = _authored_last_run(client, library_id)

    # The authored PM (thinker) node's last_run is its first-thinker brief, tagged with this run.
    assert last["pm"] is not None
    assert last["pm"]["outcome_detail"] == _THINKER_BRIEF
    assert last["pm"]["run_id"] == run_id
    assert last["pm"]["iteration"] == 1
    # The authored Engineer (worker) node's last_run is its files-changed brief.
    assert last["engineer"] is not None
    assert last["engineer"]["outcome_detail"] == _EXPECTED_WORKER_BRIEF
    # The never-run extra authored node has no clone -> last_run None.
    assert last["never_ran"] is None


def test_authoring_last_run_is_latest_across_runs_and_survives_a_skip(
    client, monkeypatch, tmp_path
):
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    library_id = create_team_from_template("review_loop", "m2-decision-b", auth_user_id())

    # --- Run 1: a FULL real run -> PM + Engineer (+ Reviewer) invocations on clone1. ---
    ws1 = tmp_path / "ws1"
    ws1.mkdir()
    init_workspace_repo(str(ws1))
    _full_run_fakes(monkeypatch, ws1)
    _clone1, run1 = _run_clone(library_id)
    with SetWorkflowID(run1):
        h1 = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    assert h1.get_result()["status"] == "completed"

    # --- Run 2: the PM runs and closes its brief, then the Engineer SETUP raises -> the Engineer
    #     invocation never OPENS, so run2 SKIPS the Engineer entirely. ---
    def _fake_pm_step(run_id, idea, pm_model, pm_prompt):
        return seed_pm_prd(run_id, idea)

    def _raise_engineer_setup(run_id):
        raise RuntimeError("decision-b: skip the Engineer in run2")

    monkeypatch.setattr(team_run, "pm_step", _fake_pm_step)
    monkeypatch.setattr(team_run, "engineer_setup_step", _raise_engineer_setup)
    _clone2, run2 = _run_clone(library_id)
    with SetWorkflowID(run2):
        h2 = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    # run2 fails (the Engineer setup raised) — get_result re-raises; the PM invocation persisted.
    run2_failed = False
    try:
        h2.get_result()
    except Exception:
        run2_failed = True
    assert run2_failed, "run2 should fail at the Engineer setup, skipping the Engineer"

    last = _authored_last_run(client, library_id)

    # The Engineer ran ONLY in run1 (run2 skipped it) -> its authoring brief SURVIVES run2.
    assert last["engineer"] is not None
    assert last["engineer"]["run_id"] == run1
    assert last["engineer"]["outcome_detail"] == _EXPECTED_WORKER_BRIEF
    # The PM ran in BOTH -> last_run is run2's (latest by started_at), NOT run1's — proves the
    # DISTINCT ON … ORDER BY started_at DESC picks the most recent execution, not an arbitrary one.
    assert last["pm"] is not None
    assert last["pm"]["run_id"] == run2
