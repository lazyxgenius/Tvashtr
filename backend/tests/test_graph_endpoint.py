"""GET /api/runs/{run_id}/graph — offline (no LLM, no openhands, no workflow).

Seeds a team graph (the ``build_*`` helpers only insert rows) + a Run row, then
asserts the read-only graph shape the canvas renders — now including the P1.5b
gate/terminal nodes + their ``config``, and the edge ``conditions`` (incl. the
loop-back ``loop_limit`` and the ``escalation`` edge). No key, no workflow start.
"""

import uuid

from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, Run


def _seed(team_graph_id: str) -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                idea="seed idea",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def test_graph_endpoint_two_node_includes_gate_terminal_and_config(client):
    run_id = _seed(build_two_node_team())
    body = client.get(f"/api/runs/{run_id}/graph").json()

    assert body["run_id"] == run_id
    nodes = {n["role_name"]: n for n in body["nodes"]}
    assert set(nodes) == {"pm", "prd_gate", "engineer", "ship", "stop"}
    # completion/agent nodes: config is null; gate/terminal nodes carry config.
    assert nodes["pm"]["kind"] == "completion" and nodes["pm"]["config"] is None
    assert nodes["engineer"]["kind"] == "agent" and nodes["engineer"]["config"] is None
    assert nodes["prd_gate"]["kind"] == "gate"
    assert nodes["prd_gate"]["config"]["gate_kind"] == "prd_approval"
    assert nodes["ship"]["kind"] == "terminal"
    assert nodes["ship"]["config"] == {"terminal_kind": "ship"}
    assert nodes["stop"]["config"] == {"terminal_kind": "stop"}
    # All nodes carry the additive idle/0 status before any run.
    assert all(n["status"] == "idle" and n["iteration"] == 0 for n in body["nodes"])
    # P1.5c: every node carries an `invocations` list; un-reached nodes -> [] (no rows yet).
    assert all(n["invocations"] == [] for n in body["nodes"])
    # 4 edges, each exposing conditions (present, possibly null).
    assert len(body["edges"]) == 4
    assert all("conditions" in e for e in body["edges"])


def test_graph_endpoint_404_for_unknown_run(client):
    resp = client.get(f"/api/runs/{uuid.uuid4()}/graph")
    assert resp.status_code == 404


def test_graph_endpoint_review_loop_gates_terminals_loopback_and_escalation(client):
    run_id = _seed(build_review_loop_team())
    body = client.get(f"/api/runs/{run_id}/graph").json()

    nodes = {n["role_name"]: n for n in body["nodes"]}
    assert set(nodes) == {
        "pm",
        "prd_gate",
        "engineer",
        "reviewer",
        "escalation_gate",
        "ship",
        "stop",
    }
    # Gate + terminal nodes expose their config for the canvas (prompt 2) to render.
    assert nodes["prd_gate"]["config"]["gate_kind"] == "prd_approval"
    assert nodes["escalation_gate"]["config"]["gate_kind"] == "review_escalation"
    assert nodes["ship"]["config"] == {"terminal_kind": "ship"}
    assert nodes["stop"]["config"] == {"terminal_kind": "stop"}
    # P1.5c: the Reviewer is now an agent node carrying agent_kind=reviewer (the canvas reads
    # this through the graph endpoint), and the Engineer carries agent_kind=engineer.
    assert nodes["reviewer"]["kind"] == "agent" and nodes["reviewer"]["engine"] == "openhands"
    assert nodes["reviewer"]["config"] == {"agent_kind": "reviewer"}
    assert nodes["engineer"]["config"] == {"agent_kind": "engineer"}
    for n in body["nodes"]:
        assert {"id", "role_name", "kind", "model", "engine", "position", "config"} <= set(n)
    # P1.8b: the run-graph node dict now ADDITIVELY carries `prompt` too (agents seed it; the
    # gate/terminal control primitives carry null) — the same field the team-graph read exposes.
    assert all("prompt" in n for n in body["nodes"])
    assert nodes["engineer"]["prompt"] and nodes["reviewer"]["prompt"] and nodes["pm"]["prompt"]
    assert nodes["prd_gate"]["prompt"] is None and nodes["ship"]["prompt"] is None

    edges = body["edges"]
    assert len(edges) == 9
    eng_id, rev_id = nodes["engineer"]["id"], nodes["reviewer"]["id"]
    # The loop-back edge: Reviewer -> Engineer carrying the cap as loop_limit. P1.8a dropped its
    # "when" (it's now the catch-all out of the Reviewer), so find it by topology, not by label.
    loopback = [e for e in edges if e["source_node_id"] == rev_id and e["target_node_id"] == eng_id]
    assert len(loopback) == 1
    assert "loop_limit" in loopback[0]["conditions"]
    assert "when" not in loopback[0]["conditions"]
    # The escalation edge_type out of the agent is present.
    escalation = [e for e in edges if e["edge_type"] == "escalation"]
    assert len(escalation) == 1
    assert escalation[0]["source_node_id"] == eng_id
    assert escalation[0]["target_node_id"] == nodes["escalation_gate"]["id"]


def test_graph_endpoint_node_status_reflects_latest_invocation(client):
    run_id = _seed(build_review_loop_team())
    eng = next(
        n
        for n in client.get(f"/api/runs/{run_id}/graph").json()["nodes"]
        if n["role_name"] == "engineer"
    )

    # Two invocations for the engineer; the latest (iteration 2) is the live state.
    with session_scope() as session:
        session.add(
            AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(eng["id"]),
                iteration=1,
                status="done",
                outcome="built",
            )
        )
        session.add(
            AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(eng["id"]),
                iteration=2,
                status="running",
                outcome=None,
            )
        )

    eng2 = next(
        n
        for n in client.get(f"/api/runs/{run_id}/graph").json()["nodes"]
        if n["role_name"] == "engineer"
    )
    assert eng2["status"] == "running"
    assert eng2["iteration"] == 2


def test_graph_endpoint_node_invocations_are_ordered_per_round_history(client):
    """P1.5c (§14.1): each node carries an `invocations` list, ascending by iteration,
    each row exposing the persisted `outcome` — the read surface the verdict view renders.
    """
    run_id = _seed(build_review_loop_team())
    rev = next(
        n
        for n in client.get(f"/api/runs/{run_id}/graph").json()["nodes"]
        if n["role_name"] == "reviewer"
    )
    # Two reviewer rounds with DISTINCT outcomes, inserted OUT OF ORDER (round 2 first) to
    # prove the endpoint sorts ascending by iteration rather than echoing insertion order.
    with session_scope() as session:
        session.add(
            AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(rev["id"]),
                iteration=2,
                status="done",
                outcome="approved",
            )
        )
        session.add(
            AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(rev["id"]),
                iteration=1,
                status="done",
                outcome="changes_requested",
                outcome_detail="missing tests for the edge case",
            )
        )

    body = client.get(f"/api/runs/{run_id}/graph").json()
    nodes = {n["role_name"]: n for n in body["nodes"]}
    # Every node dict carries an `invocations` list (additive, present on all nodes).
    assert all("invocations" in n for n in body["nodes"])

    rounds = nodes["reviewer"]["invocations"]
    assert [r["iteration"] for r in rounds] == [1, 2]  # ascending, regardless of insert order
    assert [r["outcome"] for r in rounds] == ["changes_requested", "approved"]
    # Each row carries the full shape the FE type expects — incl. §14.3's `outcome_detail`
    # (the persisted verdict REASONS): present on the changes_requested round, NULL on approved.
    assert set(rounds[0]) == {
        "iteration",
        "status",
        "outcome",
        "outcome_detail",
        "started_at",
        "ended_at",
    }
    assert rounds[0]["outcome_detail"] == "missing tests for the edge case"
    assert rounds[1]["outcome_detail"] is None
    assert rounds[0]["status"] == "done" and rounds[0]["started_at"] is not None

    # A node the executor never reached (the engineer here) -> empty history.
    assert nodes["engineer"]["invocations"] == []
