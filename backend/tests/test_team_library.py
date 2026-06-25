"""P1.8b — the team library: first-class, multiple persistent teams + a drop-and-edit template
library. Covers the catalog + the create/list/seed helpers, the ``is_library`` discriminator
(default-false on builders/clones; true on a created-from-template team + the promoted ``"My team"``
data step), the library endpoints (list/create/graph/patch/delete with their guards), and that
clone-on-launch + the legacy + A/B paths build NON-library graphs that never pollute the list.

Offline: the team helpers are pure DB (no LLM / no openhands / no workflow), and the ``POST
/api/runs`` / ``POST /api/ab-runs`` tests stub ``DBOS.start_workflow`` (the ``test_ab_pair`` shape)
so no team executes. Each assertion is mutation-aware — it would FAIL if the seam regressed (a clone
sharing ids with its source, a non-library graph leaking into the list, the node-update touching a
gate, a delete reaching a snapshot)."""

import uuid

from dbos._context import get_local_dbos_context
from sqlalchemy import func, select, text

from tvashtr import routers
from tvashtr.control_plane.teams import (
    build_review_loop_team,
    build_two_node_team,
    clone_team_graph,
    create_team_from_template,
    list_library_teams,
    list_templates,
    seed_library_if_empty,
)
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge, Run, TeamGraph

# Roles that are NOT prompt-editable agents (control primitives the node-update endpoint rejects).
_CONTROL_KINDS = ("gate", "terminal")
_REVIEW_LOOP_ROLES = {"pm", "prd_gate", "engineer", "reviewer", "escalation_gate", "ship", "stop"}
_TWO_NODE_ROLES = {"pm", "prd_gate", "engineer", "ship", "stop"}


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


def _is_library(team_graph_id: str) -> bool:
    with session_scope() as session:
        return session.execute(
            select(TeamGraph.is_library).where(TeamGraph.id == uuid.UUID(team_graph_id))
        ).scalar_one()


def _library_ids() -> set[str]:
    return {t["team_graph_id"] for t in list_library_teams()}


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


# --- Seam 1: the template catalog ---------------------------------------------------------------


def test_list_templates_exposes_the_two_starter_presets():
    """The curated library is the two code-resident builders, in order, in the picker's wire shape
    ({template, name, description}). (Mutation: a missing/renamed key would break the picker.)"""
    templates = list_templates()
    keys = [t["template"] for t in templates]
    assert keys == ["two_node", "review_loop"]
    for t in templates:
        assert t["name"] and t["description"]  # the picker shows both


def test_list_templates_endpoint(client):
    body = client.get("/api/templates").json()
    assert [t["template"] for t in body["templates"]] == ["two_node", "review_loop"]


def test_create_team_from_template_unknown_key_raises():
    """An unknown template key is a KeyError (the router maps it to 400)."""
    try:
        create_team_from_template("does_not_exist", "X")
        raise AssertionError("expected KeyError for an unknown template key")
    except KeyError:
        pass


# --- Seam 2: the is_library discriminator -------------------------------------------------------


def test_builders_and_clone_default_is_library_false():
    """The byte-intact builders never set ``is_library`` (defaults false), and a clone is non-
    library too — so run snapshots / A-B graphs / smoke graphs can NEVER pollute the team list."""
    two = build_two_node_team()
    rl = build_review_loop_team()
    assert _is_library(two) is False
    assert _is_library(rl) is False
    snapshot = clone_team_graph(rl)
    assert _is_library(snapshot) is False


def test_create_team_from_template_flips_is_library_true():
    """``create_team_from_template`` builds via the untouched builder then flips the flag + sets the
    name — so it IS a library team (mutation: if the flip regressed, this row would be non-library
    and invisible to the list)."""
    tid = create_team_from_template("review_loop", "Authored shelf team")
    assert _is_library(tid) is True
    with session_scope() as session:
        graph = session.execute(
            select(TeamGraph).where(TeamGraph.id == uuid.UUID(tid))
        ).scalar_one()
        assert graph.name == "Authored shelf team"
    assert set(_nodes(tid)) == _REVIEW_LOOP_ROLES


def test_promote_my_team_data_step_flips_only_my_team():
    """The 0013 data step (``UPDATE team_graphs SET is_library = true WHERE name = 'My team'``)
    promotes the P1.8b-1 singleton and nothing else. Build two NON-library rows (default false
    proven), run the migration's exact SQL, and assert ONLY the ``"My team"`` row flips."""
    with session_scope() as session:
        mine = TeamGraph(name="My team")
        other = TeamGraph(name="PM -> Engineer")
        session.add_all([mine, other])
        session.flush()
        mine_id, other_id = str(mine.id), str(other.id)
        # Default false on a fresh row (the migration's server_default behavior).
        assert mine.is_library is False and other.is_library is False
        # The migration's literal data step.
        session.execute(text("UPDATE team_graphs SET is_library = true WHERE name = 'My team'"))
    assert _is_library(mine_id) is True
    assert _is_library(other_id) is False


# --- Seam 3: GET /api/teams (list only library teams + seed-if-empty) ----------------------------


def test_get_teams_seeds_when_empty_and_is_idempotent(client):
    """The list is NEVER empty: clear every library team, then ``GET /api/teams`` seeds exactly one
    (``review_loop`` named ``"My team"``); a second call does NOT seed again."""
    # Clear the shelf (safe — runs reference clones, never library teams).
    with session_scope() as session:
        for g in (
            session.execute(select(TeamGraph).where(TeamGraph.is_library.is_(True))).scalars().all()
        ):
            session.delete(g)
    assert list_library_teams() == []

    teams = client.get("/api/teams").json()["teams"]
    assert len(teams) == 1
    seeded = teams[0]
    assert seeded["name"] == "My team"
    assert seeded["node_count"] == len(_REVIEW_LOOP_ROLES)  # 7 — seeded from review_loop
    assert set(_nodes(seeded["team_graph_id"])) == _REVIEW_LOOP_ROLES

    # Idempotent: a second list does not seed a second "My team".
    again = client.get("/api/teams").json()["teams"]
    assert len(again) == 1 and again[0]["team_graph_id"] == seeded["team_graph_id"]


def test_get_teams_lists_only_library_teams(client):
    """A created library team appears; a builder graph (non-library) and a clone snapshot (non-
    library) do NOT — proving the list is filtered to ``is_library``."""
    lib_id = create_team_from_template("two_node", "Visible team")
    builder_id = build_review_loop_team()  # non-library
    clone_id = clone_team_graph(builder_id)  # non-library snapshot

    listed = _library_ids()
    assert lib_id in listed
    assert builder_id not in listed
    assert clone_id not in listed

    # The summary shape carries a node_count matching the actual nodes.
    summary = next(
        t for t in client.get("/api/teams").json()["teams"] if t["team_graph_id"] == lib_id
    )
    assert summary["node_count"] == len(_TWO_NODE_ROLES)  # two_node = 5


# --- Seam 4: POST /api/teams (create-from-template) ----------------------------------------------


def test_post_create_team_from_template(client):
    resp = client.post("/api/teams", json={"template": "review_loop", "name": "Alpha"})
    assert resp.status_code == 200, resp.text
    summary = resp.json()
    assert summary["name"] == "Alpha" and summary["node_count"] == len(_REVIEW_LOOP_ROLES)
    new_id = summary["team_graph_id"]
    # It is a library team, listed, and its graph is the review-loop topology.
    assert _is_library(new_id) is True
    assert new_id in _library_ids()
    assert set(_nodes(new_id)) == _REVIEW_LOOP_ROLES


def test_post_create_team_unknown_template_400(client):
    resp = client.post("/api/teams", json={"template": "nope", "name": "X"})
    assert resp.status_code == 400, resp.text


# --- Seam 5: GET /api/teams/{id}/graph -----------------------------------------------------------


def test_get_team_graph_exposes_prompt_and_carries_no_run_state(client):
    tid = create_team_from_template("review_loop", "Graph read")
    body = client.get(f"/api/teams/{tid}/graph").json()
    assert body["team_graph_id"] == tid

    by_role = {n["role_name"]: n for n in body["nodes"]}
    assert set(by_role) == _REVIEW_LOOP_ROLES
    # Every node dict exposes `prompt`; agents carry text, control primitives carry null.
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


def test_get_team_graph_404_non_library_and_400_bad_id(client):
    # A builder graph (non-library) is NOT readable here — 404 (not 200), so snapshots/A-B stay out.
    builder_id = build_two_node_team()
    assert client.get(f"/api/teams/{builder_id}/graph").status_code == 404
    # Unknown id -> 404; malformed id -> 400.
    assert client.get(f"/api/teams/{uuid.uuid4()}/graph").status_code == 404
    assert client.get("/api/teams/not-a-uuid/graph").status_code == 400


# --- Seam 6: PATCH /api/teams/{id}/nodes/{node_id} (prompt+model; the guards) --------------------


def test_patch_team_node_persists_prompt_and_model(client):
    tid = create_team_from_template("review_loop", "Editable")
    eng = next(
        n
        for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]
        if n["role_name"] == "engineer"
    )
    original_prompt, original_model = eng["prompt"], eng["model"]
    new_prompt = f"sentinel prompt {uuid.uuid4().hex}"
    new_model = "openai/gpt-4o-mini"

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}", json={"prompt": new_prompt, "model": new_model}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["prompt"] == new_prompt and resp.json()["model"] == new_model
    # Mutation-aware: the edit genuinely CHANGED the values.
    assert new_prompt != original_prompt and new_model != original_model
    # Persisted: a fresh read reflects the edit (not just the response echo).
    refetched = next(
        n
        for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]
        if n["role_name"] == "engineer"
    )
    assert refetched["prompt"] == new_prompt and refetched["model"] == new_model


def test_patch_team_node_rejects_gate_and_terminal_409(client):
    tid = create_team_from_template("review_loop", "Guards")
    nodes = client.get(f"/api/teams/{tid}/graph").json()["nodes"]
    for role in ("prd_gate", "escalation_gate", "ship", "stop"):
        node = next(n for n in nodes if n["role_name"] == role)
        resp = client.patch(
            f"/api/teams/{tid}/nodes/{node['id']}", json={"prompt": "x", "model": "y"}
        )
        assert resp.status_code == 409, f"{role}: {resp.status_code} {resp.text}"
    # The rejected control nodes still carry no prompt/model (the write never landed).
    after = {n["role_name"]: n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]}
    assert after["prd_gate"]["prompt"] is None and after["ship"]["model"] is None


def test_patch_team_node_404_for_foreign_node_and_non_library_team_and_400_bad_id(client):
    team_a = create_team_from_template("review_loop", "Team A")
    team_b = create_team_from_template("two_node", "Team B")
    eng_a = next(
        n
        for n in client.get(f"/api/teams/{team_a}/graph").json()["nodes"]
        if n["role_name"] == "engineer"
    )

    # A node of team A addressed under team B -> 404 (node not in that team); the node is unchanged.
    resp = client.patch(
        f"/api/teams/{team_b}/nodes/{eng_a['id']}", json={"prompt": "x", "model": "y"}
    )
    assert resp.status_code == 404
    with session_scope() as session:
        still = session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(eng_a["id"]))
        ).scalar_one()
        assert still.prompt != "x"

    # A non-library (builder) team id -> 404 (the team API only edits library teams).
    builder_id = build_review_loop_team()
    builder_eng = _nodes(builder_id)["engineer"]
    assert (
        client.patch(
            f"/api/teams/{builder_id}/nodes/{builder_eng.id}", json={"prompt": "x", "model": "y"}
        ).status_code
        == 404
    )
    # Unknown node id -> 404; malformed node id -> 400; malformed team id -> 400.
    assert (
        client.patch(
            f"/api/teams/{team_a}/nodes/{uuid.uuid4()}", json={"prompt": "x", "model": "y"}
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/api/teams/{team_a}/nodes/not-a-uuid", json={"prompt": "x", "model": "y"}
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/api/teams/not-a-uuid/nodes/{eng_a['id']}", json={"prompt": "x", "model": "y"}
        ).status_code
        == 400
    )


# --- Seam 7: DELETE /api/teams/{id} --------------------------------------------------------------


def test_delete_library_team_cascades_nodes_and_edges(client):
    tid = create_team_from_template("review_loop", "Deletable")
    assert _is_library(tid) is True

    resp = client.delete(f"/api/teams/{tid}")
    assert resp.status_code == 200, resp.text

    # Gone from the list + the graph read 404s; its nodes/edges are cascaded away.
    assert tid not in _library_ids()
    assert client.get(f"/api/teams/{tid}/graph").status_code == 404
    with session_scope() as session:
        assert (
            session.execute(
                select(func.count())
                .select_from(AgentNode)
                .where(AgentNode.team_graph_id == uuid.UUID(tid))
            ).scalar_one()
            == 0
        )
        assert (
            session.execute(
                select(func.count()).select_from(Edge).where(Edge.team_graph_id == uuid.UUID(tid))
            ).scalar_one()
            == 0
        )


def test_delete_404_for_non_library_or_bad_id_and_leaves_it(client):
    # A builder graph (non-library) cannot be deleted via the team API -> 404; it still exists.
    builder_id = build_two_node_team()
    assert client.delete(f"/api/teams/{builder_id}").status_code == 404
    assert _nodes(builder_id)  # untouched
    # Unknown id -> 404; malformed id -> 400.
    assert client.delete(f"/api/teams/{uuid.uuid4()}").status_code == 404
    assert client.delete("/api/teams/not-a-uuid").status_code == 400


# --- Seam 8: clone-on-launch + legacy + A/B all build NON-library graphs -------------------------


def test_clone_is_faithful_remapped_ids_non_library_and_source_untouched():
    tid = create_team_from_template("review_loop", "To clone")
    # Author an edit so the clone has a distinctive value to copy faithfully.
    sentinel = f"authored {uuid.uuid4().hex}"
    with session_scope() as session:
        eng = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(tid), AgentNode.role_name == "engineer"
            )
        ).scalar_one()
        eng.prompt = sentinel
        eng.model = "nvidia_nim/meta/llama-3.3-70b-instruct"

    clone_id = clone_team_graph(tid)
    assert clone_id != tid
    assert _is_library(clone_id) is False  # a run snapshot never joins the library list

    src, clone = _nodes(tid), _nodes(clone_id)
    assert set(src) == set(clone)
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
    assert clone["engineer"].prompt == sentinel
    # Topology preserved with edges REMAPPED onto the cloned ids.
    assert _edge_role_topology(clone_id) == _edge_role_topology(tid)
    with session_scope() as session:
        clone_edges = (
            session.execute(select(Edge).where(Edge.team_graph_id == uuid.UUID(clone_id)))
            .scalars()
            .all()
        )
        assert clone_edges
        for e in clone_edges:
            assert e.source_node_id in clone_ids and e.target_node_id in clone_ids
    # Mutating the SOURCE after cloning does NOT perturb the clone.
    with session_scope() as session:
        s_eng = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(tid), AgentNode.role_name == "engineer"
            )
        ).scalar_one()
        s_eng.prompt = "MUTATED AFTER CLONE"
    assert _nodes(clone_id)["engineer"].prompt == sentinel


def test_create_run_clones_library_team_and_leaves_it_untouched(client, monkeypatch):
    launches = _stub_launch(monkeypatch)
    tid = create_team_from_template("review_loop", "Run me")
    before_ids = {n.id for n in _nodes(tid).values()}

    resp = client.post("/api/runs", json={"team_graph_id": tid})
    assert resp.status_code == 200, resp.text
    run_id = resp.json()["run_id"]

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        run_team_graph_id = str(run.team_graph_id)

    # The run is launched on a CLONE (a non-library snapshot), not the library team itself.
    assert run_team_graph_id != tid
    assert _is_library(run_team_graph_id) is False
    assert run_team_graph_id not in _library_ids()
    # …and the workflow was dispatched (run_team), keyed on the run id by SetWorkflowID.
    assert len(launches) == 1
    assert launches[0]["fn"] is routers.run_team and launches[0]["workflow_id"] == run_id
    # The clone is faithful; the library team is byte-untouched and STILL listed.
    assert _edge_role_topology(run_team_graph_id) == _edge_role_topology(tid)
    assert {n.id for n in _nodes(tid).values()} == before_ids
    assert tid in _library_ids()


def test_create_run_legacy_and_ab_paths_build_non_library_graphs(client, monkeypatch):
    _stub_launch(monkeypatch)
    # Legacy default path: a fresh two_node team, non-library, NOT in the list.
    run_id = client.post("/api/runs", json={}).json()["run_id"]
    with session_scope() as session:
        legacy_id = str(
            session.execute(select(Run).where(Run.id == uuid.UUID(run_id)))
            .scalar_one()
            .team_graph_id
        )
    assert set(_nodes(legacy_id)) == _TWO_NODE_ROLES
    assert _is_library(legacy_id) is False and legacy_id not in _library_ids()

    # A/B pair: both sides' team graphs are non-library so they can NEVER pollute the team list.
    ab = client.post("/api/ab-runs", json={}).json()
    assert len(ab["runs"]) == 2
    listed = _library_ids()
    for side in ab["runs"]:
        with session_scope() as session:
            tg_id = str(
                session.execute(select(Run).where(Run.id == uuid.UUID(side["run_id"])))
                .scalar_one()
                .team_graph_id
            )
        assert _is_library(tg_id) is False and tg_id not in listed


def test_seed_library_if_empty_is_a_noop_when_nonempty():
    """When the library already has a team, ``seed_library_if_empty`` adds nothing."""
    create_team_from_template("two_node", "Already here")
    before = len(list_library_teams())
    seed_library_if_empty()
    assert len(list_library_teams()) == before
