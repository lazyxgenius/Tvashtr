"""P1.8b — the persistent authored team: get-or-create, the team-graph read (with ``prompt``),
the node-update endpoint (prompt+model; reject gate/terminal), and clone-on-launch.

Offline: the team helpers are pure DB (no LLM / no openhands / no workflow), and the one
``POST /api/runs`` test stubs ``DBOS.start_workflow`` (the ``test_ab_pair`` pattern) so no team
executes. Each assertion is mutation-aware — it would FAIL if the seam regressed (e.g. clone
sharing ids with the source, or the node-update touching a gate)."""

import uuid

from dbos._context import get_local_dbos_context
from sqlalchemy import func, select

from tvashtr import routers
from tvashtr.control_plane.teams import (
    PERSISTENT_TEAM_NAME,
    build_two_node_team,
    clone_team_graph,
    get_or_create_persistent_team,
)
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge, Run, TeamGraph

# Roles that are NOT prompt-editable agents (control primitives the node-update endpoint rejects).
_CONTROL_KINDS = ("gate", "terminal")


def _nodes(team_graph_id: str) -> dict[str, AgentNode]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_graph_id))
            )
            .scalars()
            .all()
        )
        # Detach a plain snapshot keyed by role_name (session closes after this).
        return {n.role_name: n for n in rows}


def _persistent_team_count() -> int:
    with session_scope() as session:
        return session.execute(
            select(func.count())
            .select_from(TeamGraph)
            .where(TeamGraph.name == PERSISTENT_TEAM_NAME)
        ).scalar_one()


def _stub_launch(monkeypatch):
    """Replace ``DBOS.start_workflow`` with a recorder so ``create_run`` dispatches without running
    a team. Captures the workflow id the enclosing ``with SetWorkflowID(run_id):`` assigned, so the
    test exercises the keying wrapper, not just the persisted column (mirrors ``test_ab_pair``)."""
    launches: list[dict] = []

    def _fake_start_workflow(fn, *args, **kwargs):
        ctx = get_local_dbos_context()
        launches.append(
            {"fn": fn, "workflow_id": ctx.id_assigned_for_next_workflow if ctx else None}
        )
        return None

    monkeypatch.setattr(routers.DBOS, "start_workflow", _fake_start_workflow)
    return launches


# --- Seam 1: get-or-create the single persistent team -------------------------------------------


def test_get_or_create_persistent_team_is_idempotent():
    """The same team id on every call, and a second call creates NO new row — the canvas re-opens
    the same editable team, never a fresh one per call. (Mutation: if get_or_create always built,
    id_a != id_b and the count would climb.)"""
    id_a = get_or_create_persistent_team()
    count_after_first = _persistent_team_count()
    id_b = get_or_create_persistent_team()
    count_after_second = _persistent_team_count()

    assert id_a == id_b
    assert uuid.UUID(id_a)  # a real uuid
    # The second call did not create another persistent-team row.
    assert count_after_second == count_after_first


def test_persistent_team_is_seeded_from_the_review_loop_template():
    """Seeded from ``build_review_loop_team`` topology: the full review-loop role set, agent/
    completion nodes carry a ``prompt``, and the control primitives (gate/terminal) carry none."""
    by_role = _nodes(get_or_create_persistent_team())
    assert set(by_role) == {
        "pm",
        "prd_gate",
        "engineer",
        "reviewer",
        "escalation_gate",
        "ship",
        "stop",
    }
    assert by_role["pm"].kind == "completion" and by_role["pm"].prompt
    assert by_role["engineer"].kind == "agent" and by_role["engineer"].prompt
    assert by_role["reviewer"].kind == "agent" and by_role["reviewer"].prompt
    # Control primitives: no prompt, no model.
    for role in ("prd_gate", "escalation_gate", "ship", "stop"):
        assert by_role[role].kind in _CONTROL_KINDS
        assert by_role[role].prompt is None
        assert by_role[role].model is None


# --- Seam 2: the team-graph read (with prompt, no run state) -------------------------------------


def test_team_graph_endpoint_exposes_prompt_and_carries_no_run_state(client):
    body = client.get("/api/team/graph").json()
    assert uuid.UUID(body["team_graph_id"])

    by_role = {n["role_name"]: n for n in body["nodes"]}
    assert set(by_role) == {
        "pm",
        "prd_gate",
        "engineer",
        "reviewer",
        "escalation_gate",
        "ship",
        "stop",
    }
    # Every node dict exposes `prompt` (NEW); agents carry text, control primitives carry null.
    assert all("prompt" in n for n in body["nodes"])
    assert (
        by_role["pm"]["prompt"] and by_role["engineer"]["prompt"] and by_role["reviewer"]["prompt"]
    )
    assert by_role["prd_gate"]["prompt"] is None and by_role["ship"]["prompt"] is None
    # NOT running: no run-state keys on any node.
    assert all(
        "status" not in n and "iteration" not in n and "invocations" not in n for n in body["nodes"]
    )
    # Edges carry routing conditions, exactly like the run-graph read.
    assert len(body["edges"]) == 9
    assert all("conditions" in e for e in body["edges"])


# --- Seam 3: node update (prompt + model; reject gate/terminal) ----------------------------------


def test_update_team_node_persists_prompt_and_model(client):
    eng = next(
        n for n in client.get("/api/team/graph").json()["nodes"] if n["role_name"] == "engineer"
    )
    original_prompt, original_model = eng["prompt"], eng["model"]
    new_prompt = f"sentinel prompt {uuid.uuid4().hex}"
    new_model = "openai/gpt-4o-mini"

    resp = client.patch(
        f"/api/team/nodes/{eng['id']}", json={"prompt": new_prompt, "model": new_model}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["prompt"] == new_prompt and resp.json()["model"] == new_model
    # Mutation-aware: the edit genuinely CHANGED the values.
    assert new_prompt != original_prompt and new_model != original_model

    # Persisted: a fresh read reflects the edit (not just the response echo).
    refetched = next(
        n for n in client.get("/api/team/graph").json()["nodes"] if n["role_name"] == "engineer"
    )
    assert refetched["prompt"] == new_prompt and refetched["model"] == new_model


def test_update_team_node_rejects_gate_and_terminal(client):
    nodes = client.get("/api/team/graph").json()["nodes"]
    for role in ("prd_gate", "escalation_gate", "ship", "stop"):
        node = next(n for n in nodes if n["role_name"] == role)
        resp = client.patch(f"/api/team/nodes/{node['id']}", json={"prompt": "x", "model": "y"})
        assert resp.status_code == 409, f"{role}: {resp.status_code} {resp.text}"
    # The rejected control nodes still carry no prompt/model (the write never landed).
    after = {n["role_name"]: n for n in client.get("/api/team/graph").json()["nodes"]}
    assert after["prd_gate"]["prompt"] is None and after["ship"]["model"] is None


def test_update_team_node_404_for_unknown_or_foreign_node_and_400_for_bad_id(client):
    # A node from a DIFFERENT (legacy) graph is not part of the persistent team -> 404.
    foreign = _nodes(build_two_node_team())["engineer"]
    resp = client.patch(f"/api/team/nodes/{foreign.id}", json={"prompt": "x", "model": "y"})
    assert resp.status_code == 404
    # The foreign node was NOT edited.
    with session_scope() as session:
        still = session.execute(select(AgentNode).where(AgentNode.id == foreign.id)).scalar_one()
        assert still.prompt != "x"

    # An entirely unknown node id -> 404; a malformed id -> 400.
    assert (
        client.patch(
            f"/api/team/nodes/{uuid.uuid4()}", json={"prompt": "x", "model": "y"}
        ).status_code
        == 404
    )
    assert (
        client.patch("/api/team/nodes/not-a-uuid", json={"prompt": "x", "model": "y"}).status_code
        == 400
    )


# --- Seam 4: clone-on-launch --------------------------------------------------------------------


def _edge_role_topology(team_graph_id: str) -> set[tuple]:
    """The graph's topology as (source_role, target_role, edge_type, conditions) tuples — id-free,
    so two graphs with DIFFERENT node ids but the same wiring compare equal."""
    by_id_role = {n.id: n.role_name for n in _nodes(team_graph_id).values()}
    with session_scope() as session:
        edges = (
            session.execute(select(Edge).where(Edge.team_graph_id == uuid.UUID(team_graph_id)))
            .scalars()
            .all()
        )
        return {
            (
                by_id_role[e.source_node_id],
                by_id_role[e.target_node_id],
                e.edge_type,
                None if e.conditions is None else tuple(sorted(e.conditions.items())),
            )
            for e in edges
        }


def test_clone_team_graph_is_faithful_with_remapped_ids_and_leaves_source_untouched():
    team_id = get_or_create_persistent_team()
    # Author an edit so the clone has a distinctive value to copy faithfully.
    sentinel = f"authored {uuid.uuid4().hex}"
    with session_scope() as session:
        eng = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(team_id), AgentNode.role_name == "engineer"
            )
        ).scalar_one()
        eng.prompt = sentinel
        eng.model = "nvidia_nim/meta/llama-3.3-70b-instruct"

    clone_id = clone_team_graph(team_id)
    assert clone_id != team_id  # a NEW team graph

    src, clone = _nodes(team_id), _nodes(clone_id)
    assert set(src) == set(clone)  # same roles

    # Every cloned node is a FRESH row (disjoint ids) but a faithful copy of its source counterpart.
    src_ids = {n.id for n in src.values()}
    clone_ids = {n.id for n in clone.values()}
    assert src_ids.isdisjoint(clone_ids)
    for role, s in src.items():
        c = clone[role]
        assert c.id != s.id
        assert (c.role_name, c.kind, c.model, c.engine, c.prompt, c.position, c.config) == (
            s.role_name,
            s.kind,
            s.model,
            s.engine,
            s.prompt,
            s.position,
            s.config,
        )
    # The authored edit rode into the clone faithfully.
    assert clone["engineer"].prompt == sentinel

    # Topology preserved with the edges REMAPPED onto the cloned ids (same id-free wiring), and
    # every clone edge points only at clone nodes.
    assert _edge_role_topology(clone_id) == _edge_role_topology(team_id)
    with session_scope() as session:
        clone_edges = (
            session.execute(select(Edge).where(Edge.team_graph_id == uuid.UUID(clone_id)))
            .scalars()
            .all()
        )
        assert clone_edges  # non-empty
        for e in clone_edges:
            assert e.source_node_id in clone_ids and e.target_node_id in clone_ids

    # Immutability: mutating the SOURCE after cloning does NOT perturb the clone (a separate copy).
    with session_scope() as session:
        s_eng = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(team_id), AgentNode.role_name == "engineer"
            )
        ).scalar_one()
        s_eng.prompt = "MUTATED AFTER CLONE"
    assert _nodes(clone_id)["engineer"].prompt == sentinel


def test_create_run_clones_authored_team_and_leaves_it_untouched(client, monkeypatch):
    launches = _stub_launch(monkeypatch)
    team_id = get_or_create_persistent_team()
    before_ids = {n.id for n in _nodes(team_id).values()}

    resp = client.post("/api/runs", json={"team_graph_id": team_id})
    assert resp.status_code == 200, resp.text
    run_id = resp.json()["run_id"]

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        run_team_graph_id = str(run.team_graph_id)

    # The run is launched on a CLONE, not the authored team itself.
    assert run_team_graph_id != team_id
    # …and the workflow was dispatched (run_team), keyed on the run id by SetWorkflowID.
    assert len(launches) == 1
    assert launches[0]["fn"] is routers.run_team and launches[0]["workflow_id"] == run_id

    # The clone is faithful (same roles, fresh ids); the authored team is byte-untouched.
    assert _edge_role_topology(run_team_graph_id) == _edge_role_topology(team_id)
    after_ids = {n.id for n in _nodes(team_id).values()}
    assert after_ids == before_ids  # the authored team's nodes are exactly as they were


def test_create_run_legacy_team_shape_path_still_builds_fresh(client, monkeypatch):
    _stub_launch(monkeypatch)
    persistent_id = get_or_create_persistent_team()

    # No team_graph_id -> the legacy default builds a FRESH two_node team (not the persistent one).
    run_id = client.post("/api/runs", json={}).json()["run_id"]
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        legacy_graph_id = str(run.team_graph_id)
    assert legacy_graph_id != persistent_id
    assert set(_nodes(legacy_graph_id)) == {"pm", "prd_gate", "engineer", "ship", "stop"}

    # team_shape=review_loop still builds a fresh review_loop team, also distinct from persistent.
    run_id2 = client.post("/api/runs", json={"team_shape": "review_loop"}).json()["run_id"]
    with session_scope() as session:
        run2 = session.execute(select(Run).where(Run.id == uuid.UUID(run_id2))).scalar_one()
        rl_graph_id = str(run2.team_graph_id)
    assert rl_graph_id not in (persistent_id, legacy_graph_id)
    assert "reviewer" in _nodes(rl_graph_id)
