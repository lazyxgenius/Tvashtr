"""B-NODES (frontend revamp): the agent panel's node API — templates, the node PATCH/POST changes
(name + tagline, optional prompt/model, the read-only entry agent, ``reads_default``), the new
validity findings, and the additive graph fields."""

import uuid

from conftest import auth_user_id
from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.control_plane.graph_validity import validate_graph
from tvashtr.control_plane.teams import (
    REVIEWER_PROMPT,
    clone_team_graph,
    create_team_from_template,
)
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import AgentInvocation, AgentNode, Run


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"nodes-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register", json={"email": email, "password": "nodes-password"}
        ).status_code
        == 200
    )
    return c


def _nodes(client, tid: str) -> dict[str, dict]:
    return {n["role_name"]: n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]}


def _row(node_id: str) -> AgentNode:
    with session_scope() as session:
        return session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(node_id))
        ).scalar_one()


def _patch(client, tid: str, node_id: str, body: dict):
    return client.patch(f"/api/teams/{tid}/nodes/{node_id}", json=body)


# ---- GET /api/node-templates --------------------------------------------------------------------


def test_node_templates_lists_the_four_with_prompts(client):
    body = client.get("/api/node-templates").json()
    keys = [t["key"] for t in body["templates"]]
    assert keys == ["pm", "architect", "engineer", "reviewer"]
    reviewer = body["templates"][3]
    assert reviewer["title"] == "Reviewer"
    assert reviewer["description"] == "Checks against the spec"
    assert reviewer["node_kind"] == "worker"
    assert reviewer["edits_allowed"] is False
    assert reviewer["verdict_labels"] == ["approved", "changes_requested"]
    assert reviewer["prompt"] == REVIEWER_PROMPT
    assert body["templates"][2]["edits_allowed"] is True


# ---- POST /api/teams/{id}/nodes -----------------------------------------------------------------


def test_create_preset_seeds_title_and_description(client):
    tid = create_team_from_template("two_node", "Preset identity", auth_user_id())
    resp = client.post(
        f"/api/teams/{tid}/nodes", json={"node_kind": "worker", "preset": "reviewer"}
    )
    assert resp.status_code == 200, resp.text
    cfg = resp.json()["config"]
    assert cfg == {"title": "Reviewer", "description": "Checks against the spec"}
    assert resp.json()["role_name"] == "reviewer"


def test_create_accepts_title_description_and_a_blank_model(client):
    tid = create_team_from_template("two_node", "Blank agent", auth_user_id())
    resp = client.post(
        f"/api/teams/{tid}/nodes",
        json={"node_kind": "worker", "title": "  Tester ", "description": "Runs it", "model": ""},
    )
    assert resp.status_code == 200, resp.text
    node = resp.json()
    assert node["model"] == ""
    assert node["config"] == {"title": "Tester", "description": "Runs it"}
    # Without identity fields a blank node keeps config NULL (byte-identical to before).
    plain = client.post(f"/api/teams/{tid}/nodes", json={"node_kind": "worker"}).json()
    assert plain["config"] is None
    assert plain["model"]  # an omitted model still gets the account default


# ---- PATCH: title / description ------------------------------------------------------------------


def test_patch_title_and_description_round_trip_and_clear(client):
    tid = create_team_from_template("review_loop", "Rename agent", auth_user_id())
    reviewer = _nodes(client, tid)["reviewer"]
    resp = _patch(client, tid, reviewer["id"], {"title": " QA lead ", "description": "Gatekeeper"})
    assert resp.status_code == 200, resp.text
    row = _row(reviewer["id"])
    assert row.config["title"] == "QA lead"
    assert row.config["description"] == "Gatekeeper"
    assert row.role_name == "reviewer"  # stable — memory + trajectories key on it
    assert row.prompt == reviewer["prompt"]  # prompt/model not sent → untouched

    assert (
        _patch(client, tid, reviewer["id"], {"title": None, "description": ""}).status_code == 200
    )
    cfg = _row(reviewer["id"]).config or {}
    assert "title" not in cfg and "description" not in cfg


def test_patch_title_validation(client):
    tid = create_team_from_template("review_loop", "Rename rules", auth_user_id())
    reviewer = _nodes(client, tid)["reviewer"]
    blank = _patch(client, tid, reviewer["id"], {"title": "   "})
    assert blank.status_code == 422
    assert blank.json()["detail"] == "An agent name is required."
    long = _patch(client, tid, reviewer["id"], {"title": "x" * 61})
    assert long.status_code == 422
    assert long.json()["detail"] == "Keep the name to 60 characters or fewer."
    desc = _patch(client, tid, reviewer["id"], {"description": "y" * 121})
    assert desc.status_code == 422
    assert desc.json()["detail"] == "Keep the description to 120 characters or fewer."


def test_patch_title_on_a_terminal(client):
    tid = create_team_from_template("two_node", "Rename others", auth_user_id())
    ship = _nodes(client, tid)["ship"]
    assert _patch(client, tid, ship["id"], {"title": "Open a PR"}).status_code == 200
    row = _row(ship["id"])
    assert row.config["title"] == "Open a PR"
    assert row.config["terminal_kind"] == "ship"
    assert row.role_name == "ship"


# ---- PATCH: prompt/model optional, empty prompt, entry lock, reads_default --------------------


def test_patch_without_prompt_or_model_applies_the_rest(client):
    tid = create_team_from_template("review_loop", "Remember alone", auth_user_id())
    engineer = _nodes(client, tid)["engineer"]
    resp = _patch(client, tid, engineer["id"], {"memory_remember_enabled": True})
    assert resp.status_code == 200, resp.text
    row = _row(engineer["id"])
    assert row.config["memory_remember_enabled"] is True
    assert row.prompt == engineer["prompt"] and row.model == engineer["model"]


def test_patch_rejects_null_and_blank_prompt(client):
    tid = create_team_from_template("review_loop", "Prompt rules", auth_user_id())
    engineer = _nodes(client, tid)["engineer"]
    null = _patch(client, tid, engineer["id"], {"prompt": None})
    assert null.status_code == 422
    assert null.json()["detail"] == "prompt and model are required for an agent node"
    blank = _patch(client, tid, engineer["id"], {"prompt": "  \n "})
    assert blank.status_code == 422
    assert blank.json()["detail"] == "Instructions can’t be empty."
    assert _row(engineer["id"]).prompt == engineer["prompt"]
    # A blank model is accepted (the agent then "needs a model").
    assert _patch(client, tid, engineer["id"], {"model": ""}).status_code == 200
    assert _row(engineer["id"]).model == ""


def test_patch_edits_on_the_entry_agent_is_409(client):
    tid = create_team_from_template("review_loop", "Entry lock", auth_user_id())
    nodes = _nodes(client, tid)
    resp = _patch(client, tid, nodes["pm"]["id"], {"edits_allowed": True})
    assert resp.status_code == 409
    assert resp.json()["detail"] == (
        "The first agent writes the shared spec the team reads, so it stays read-only."
    )
    assert _row(nodes["pm"]["id"]).edits_allowed is False
    assert _patch(client, tid, nodes["pm"]["id"], {"edits_allowed": False}).status_code == 200
    assert _patch(client, tid, nodes["reviewer"]["id"], {"edits_allowed": True}).status_code == 200


def test_patch_reads_default_sets_and_clears(client):
    tid = create_team_from_template("review_loop", "Reads nothing", auth_user_id())
    engineer = _nodes(client, tid)["engineer"]
    assert _patch(client, tid, engineer["id"], {"reads_default": False}).status_code == 200
    assert _row(engineer["id"]).config["reads_default"] is False
    assert _patch(client, tid, engineer["id"], {"reads_default": None}).status_code == 200
    assert "reads_default" not in (_row(engineer["id"]).config or {})


def test_patch_other_accounts_team_is_404(client):
    tid = create_team_from_template("review_loop", "Private", auth_user_id())
    engineer = _nodes(client, tid)["engineer"]
    other = _fresh()
    assert _patch(other, tid, engineer["id"], {"title": "Mine now"}).status_code == 404


# ---- Validity -----------------------------------------------------------------------------------


def _v_node(nid: str, kind: str, **extra) -> dict:
    return {"id": nid, "kind": kind, "config": extra.pop("config", None), **extra}


def _v_edge(eid: str, src: str, dst: str, conditions=None, edge_type: str = "work") -> dict:
    return {
        "id": eid,
        "source_node_id": src,
        "target_node_id": dst,
        "edge_type": edge_type,
        "conditions": conditions,
    }


def test_validate_graph_no_model_error_and_no_instructions_warning():
    nodes = [
        _v_node("a", "completion", model="", prompt=""),
        _v_node("t", "terminal", config={"terminal_kind": "ship"}),
    ]
    verdict = validate_graph(nodes, [_v_edge("e1", "a", "t")])
    assert [e["code"] for e in verdict["errors"]] == ["no_model"]
    assert verdict["errors"][0]["message"] == "This agent needs a model before the team can run."
    assert [w["code"] for w in verdict["warnings"]] == ["no_instructions"]
    assert verdict["runnable"] is False
    # A dict that does not carry model/prompt is not judged on them (legacy callers).
    legacy = validate_graph(
        [_v_node("a", "completion"), _v_node("t", "terminal")], [_v_edge("e1", "a", "t")]
    )
    assert legacy["errors"] == [] and legacy["warnings"] == []


def test_validate_graph_writes_on_emitting_node_warning():
    nodes = [
        _v_node("pm", "completion", model="m/x", prompt="p"),
        _v_node("rev", "agent", model="m/x", prompt="p", config={"writes_to": "review-notes"}),
        _v_node("ship", "terminal"),
        _v_node("stop", "terminal"),
    ]
    edges = [
        _v_edge("e1", "pm", "rev"),
        _v_edge("e2", "rev", "ship", {"when": "approved"}),
        _v_edge("e3", "rev", "stop"),
    ]
    verdict = validate_graph(nodes, edges)
    assert verdict["runnable"] is True
    codes = [(w["code"], w["node_id"]) for w in verdict["warnings"]]
    assert ("writes_on_emitting_node", "rev") in codes


def test_validate_endpoint_reports_blank_model(client):
    resp = client.post("/api/teams", json={"template": "blank", "name": "Needs model"})
    tid = resp.json()["team_graph_id"]
    root = next(
        n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"] if n["kind"] != "terminal"
    )
    verdict = client.get(f"/api/teams/{tid}/validate").json()
    assert "no_instructions" in [w["code"] for w in verdict["warnings"]]  # blank root has no prompt
    assert _patch(client, tid, root["id"], {"model": ""}).status_code == 200
    verdict = client.get(f"/api/teams/{tid}/validate").json()
    assert verdict["runnable"] is False
    assert [e["code"] for e in verdict["errors"]] == ["no_model"]


# ---- Graph reads (additive fields) ------------------


def _seed_run_with_invocations(tid: str, statuses: list[tuple[str, str | None]]) -> tuple[str, str]:
    """Clone ``tid`` into a run snapshot, create an owned Run, and add one invocation per
    ``(status, outcome)`` on the clone of its ``reviewer`` node. Returns ``(run_id, node)``."""
    clone_id = clone_team_graph(tid)
    run_id = uuid.uuid4()
    with session_scope() as session:
        session.add(
            Run(
                id=run_id,
                team_graph_id=uuid.UUID(clone_id),
                owner_id=auth_user_id(),
                idea="Add an RSI indicator",
                workflow_id=str(run_id),
                status="completed",
            )
        )
        clone_reviewer = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(clone_id), AgentNode.role_name == "reviewer"
            )
        ).scalar_one()
        clone_node_id = str(clone_reviewer.id)
        for i, (status, outcome) in enumerate(statuses, start=1):
            session.add(
                AgentInvocation(
                    run_id=str(run_id),
                    node_id=clone_reviewer.id,
                    iteration=i,
                    status=status,
                    outcome=outcome,
                    outcome_detail=f"round {i}",
                )
            )
    return str(run_id), clone_node_id


def test_team_graph_has_name_and_last_run_status(client):
    tid = create_team_from_template("review_loop", "Indicator sprint team", auth_user_id())
    _seed_run_with_invocations(tid, [("done", "changes_requested"), ("failed", None)])
    graph = client.get(f"/api/teams/{tid}/graph").json()
    assert graph["name"] == "Indicator sprint team"
    reviewer = next(n for n in graph["nodes"] if n["role_name"] == "reviewer")
    last = reviewer["last_run"]
    assert last["status"] in ("done", "failed")
    assert "ended_at" in last


def test_run_graph_has_origin_node_id_and_invocation_id(client):
    tid = create_team_from_template("review_loop", "Origin map", auth_user_id())
    authored = _nodes(client, tid)["reviewer"]
    run_id, _clone = _seed_run_with_invocations(tid, [("done", "approved")])
    graph = client.get(f"/api/runs/{run_id}/graph").json()
    reviewer = next(n for n in graph["nodes"] if n["role_name"] == "reviewer")
    assert reviewer["origin_node_id"] == authored["id"]
    assert isinstance(reviewer["invocations"][0]["invocation_id"], int)
