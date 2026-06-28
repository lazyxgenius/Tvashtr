"""P1.7a — live-document steering (the BACKEND seam, offline; NO LLM, NO openhands).

Proves the three things this milestone owns:
  * the save-edited-PRD endpoint ``POST /api/documents/{id}/versions`` appends the next version;
  * ``read_latest_prd_step`` returns the LATEST version's content (the live re-source);
  * the keystone — a human edit made BETWEEN Engineer round 1 and the revision round reaches the
    round-2 Engineer (it re-sources the NEW PRD, not the PM's original snapshot), driven through
    the REAL ``run_team`` on the forced-revision path with openhands stubbed (mirrors
    ``test_review_loop``); and a structural guard that the re-read stays a recorded ``@DBOS.step``
    (the determinism requirement).
"""

import os
import uuid
from pathlib import Path
from uuid import uuid4

from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select, update

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
from tvashtr.db import session_scope
from tvashtr.documents.service import add_version, create_document_with_initial_version
from tvashtr.models import EngineerRunAttempt, Run

# --- 1. the save-version endpoint ------------------------------------------------------------


def test_post_document_version_appends_next_version(client):
    doc = create_document_with_initial_version(
        "Mini-PRD", "prd", "the original PRD", "agent:pm", f"test:{uuid4().hex}:v1"
    )

    resp = client.post(f"/api/documents/{doc.id}/versions", json={"content": "the edited PRD"})
    assert resp.status_code == 200
    body = resp.json()
    # version_no = prev (1) + 1; the posted content; the four FE-typed fields, document echoed.
    assert body["version_no"] == 2
    assert body["content"] == "the edited PRD"
    assert body["document_id"] == str(doc.id)
    assert set(body) == {"document_id", "version_no", "content", "created_at"}

    # A SECOND POST appends again (fresh idempotency key per request -> never dedups a save).
    resp2 = client.post(f"/api/documents/{doc.id}/versions", json={"content": "edited again"})
    assert resp2.status_code == 200
    assert resp2.json()["version_no"] == 3


def test_post_document_version_404_on_missing_document(client):
    resp = client.post(f"/api/documents/{uuid4()}/versions", json={"content": "x"})
    assert resp.status_code == 404


def test_post_document_version_400_on_bad_uuid(client):
    # Mirrors GET /api/documents/{id}: a malformed id is a 400, not a 404.
    resp = client.post("/api/documents/not-a-uuid/versions", json={"content": "x"})
    assert resp.status_code == 400


# --- 2. the recorded live re-source step -----------------------------------------------------


def test_read_latest_prd_step_returns_latest_version(client):
    """Write v1, append v2, assert the step returns v2's content (the latest is the live PRD)."""
    doc = create_document_with_initial_version(
        "Mini-PRD", "prd", "PRD original", "agent:pm", f"test:{uuid4().hex}:v1"
    )
    team_graph_id = build_two_node_team()
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
                pm_document_id=doc.id,
            )
        )

    # Only v1 so far -> the step returns it.
    assert team_run.read_latest_prd_step(run_id) == "PRD original"

    # A human appends v2 -> the step now re-sources the NEW content (not the original).
    add_version(doc.id, "PRD steered v2", created_by="human", idempotency_key=f"test:{uuid4().hex}")
    assert team_run.read_latest_prd_step(run_id) == "PRD steered v2"


def test_read_latest_prd_step_is_a_dbos_step():
    """Determinism guard: the re-read MUST stay a recorded ``@DBOS.step`` so a crash-resume
    replays the SAME PRD version. Assert it carries the same DBOS step-decoration markers a known
    sibling step (``pm_step``) has and that a known plain helper (``next_node``) lacks — robust
    against any single attribute's semantics shifting between DBOS versions."""
    markers = ("__wrapped__", "dbos_func_decorator_info", "dbos_function_name")
    # sanity: a known step carries them; a known plain function carries none.
    assert all(hasattr(team_run.pm_step, m) for m in markers)
    assert not any(hasattr(team_run.next_node, m) for m in markers)
    # the re-read carries the same step markers -> it is a recorded step.
    assert all(hasattr(team_run.read_latest_prd_step, m) for m in markers)


# --- 3. the keystone: a mid-run human edit steers the revision round -------------------------


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


# The human's mid-run edit — distinct from the PM's v1 content so the re-source is observable.
_STEERED_PRD = "PRD v2 — human steered mid-run: ship a DIFFERENT greeting"


def test_mid_run_prd_edit_reaches_the_revision_engineer(client, monkeypatch, tmp_path):
    """The steering proof. A human appends a new PRD version between Engineer round 1 and the
    forced revision round; the round-2 Engineer must receive the NEW content (re-sourced live),
    NOT the PM's original snapshot. Revert the re-source (pass the PM snapshot) and the round-2
    assertion below FAILS — the non-vacuity mutation."""
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    # Each Engineer call's (iteration, prd_text-it-received) — the observable of the re-source.
    engineer_prds: list[tuple[int, str]] = []

    def _fake_pm_step(run_id, idea, pm_model, pm_prompt):
        # Real document write (minus the LLM) so read_latest_prd_step resolves to a real version.
        doc = create_document_with_initial_version(
            "Mini-PRD", "prd", f"PRD v1 for: {idea}", "agent:pm", f"{run_id}:pm-prd-v1"
        )
        with session_scope() as session:
            session.execute(
                update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=doc.id)
            )
        return {"document_id": str(doc.id), "prd_text": f"PRD v1 for: {idea}"}

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
        # P1.8a: ONE generic agent step. The reviewer-style node runs the real forced harness; the
        # engineer-style worker records the PRD IT RECEIVED (``prd_text`` — the observable of the
        # live re-source), writes the attempt row + deliverable, and — between round 1 and the
        # revision round — a human edits the PRD so the round-2 worker must re-source the NEW one.
        if emits_outcome:
            return team_run._forced_review_outcome(iteration)
        engineer_prds.append((iteration, prd_text))
        with session_scope() as session:
            session.add(EngineerRunAttempt(run_id=run_id, pid=os.getpid()))
        # Between round 1 and the revision round: a human edits the PRD -> a new version.
        if iteration == 1:
            with session_scope() as session:
                doc_id = session.execute(
                    select(Run.pm_document_id).where(Run.workflow_id == run_id)
                ).scalar_one()
            add_version(
                doc_id, _STEERED_PRD, created_by="human", idempotency_key=f"human-edit:{run_id}:t"
            )
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

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()

    assert result["status"] == "completed"

    # The Engineer ran twice. Round 1 re-sourced the PM's v1; round 2 re-sourced the LIVE human
    # edit — the document, not the once-captured snapshot, is the source of truth (J3).
    assert [it for it, _ in engineer_prds] == [1, 2]
    assert engineer_prds[0][1] == "PRD v1 for: build greeting.txt"
    assert engineer_prds[1][1] == _STEERED_PRD  # <-- the keystone; FAILS if the re-source reverts
