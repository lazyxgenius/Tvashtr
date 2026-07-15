"""M-endpoint-editable — offline proof that a PATCHed terminal disposition drives the next run.

A blank library team (thinker → Ship) is flipped Ship→Stop via the real PATCH endpoint, cloned
(the launch snapshot path), and driven through the REAL ``run_team`` with the agent step stubbed
(no LLM / no provider key). The walk ends at the flipped endpoint and finalizes ``rejected`` /
``stopped`` — proving the executor already reads ``config["terminal_kind"]`` (untouched this
milestone) and that the flip is what the next run honours.
"""

import uuid
from pathlib import Path

from conftest import auth_user_id, entry_report_result
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import clone_team_graph
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Run


def test_flipped_stop_endpoint_finalizes_rejected_offline(client, monkeypatch, tmp_path):
    """Ship→Stop via PATCH; a run that reaches that endpoint finalizes rejected, not completed."""
    # 1. Blank library team: one thinker → one Ship terminal.
    create = client.post("/api/teams", json={"template": "blank", "name": "Endpoint run proof"})
    assert create.status_code == 200, create.text
    tid = create.json()["team_graph_id"]
    graph = client.get(f"/api/teams/{tid}/graph").json()
    ship = next(n for n in graph["nodes"] if n["kind"] == "terminal")
    assert ship["config"]["terminal_kind"] == "ship" and ship["role_name"] == "ship"

    # 2. Flip Ship → Stop via the real PATCH (this is the milestone surface).
    flip = client.patch(f"/api/teams/{tid}/nodes/{ship['id']}", json={"terminal_kind": "stop"})
    assert flip.status_code == 200, flip.text
    # DB re-read (not the echo).
    with session_scope() as session:
        row = session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(ship["id"]))
        ).scalar_one()
        assert row.config["terminal_kind"] == "stop"
        assert row.role_name == "stop"

    # 3. Clone-on-launch snapshot (what create_run does) + seed a Run row.
    clone_id = clone_team_graph(tid)
    with session_scope() as session:
        # Clone must carry the flipped disposition.
        clone_term = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(clone_id),
                AgentNode.kind == "terminal",
            )
        ).scalar_one()
        assert clone_term.config["terminal_kind"] == "stop"
        assert clone_term.role_name == "stop"

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
        # Blank skeleton: only the entry thinker runs the agent path (edits-off).
        if not edits_allowed:
            return entry_report_result(idea)
        # No worker on this graph; if we get here something regressed.
        (Path(workspace_dir) / "greeting.txt").write_text("should not ship\n")
        return {
            "status": "completed",
            "outcome": None,
            "reasons": None,
            "files_changed": ["greeting.txt"],
            "prompt_tokens": 1,
            "completion_tokens": 1,
            "total_tokens": 2,
            "cost_usd": 0.0,
        }

    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_engineer_setup_step)
    monkeypatch.setattr(team_run, "agent_run_step", _fake_agent_run_step)

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

    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()

    # The flipped-to-stop endpoint finalizes rejected/stopped — NOT completed/ship.
    assert result["status"] == "rejected", f"expected rejected from flipped stop: {result}"
    assert result.get("ship_tag") is None
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        assert run.status == "rejected"
        assert run.ship_tag is None
