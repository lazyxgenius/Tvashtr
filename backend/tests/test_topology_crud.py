"""Topology editing — node/edge CRUD, position persistence, blank-team seed, the run-start guard
(P1.8d). The canvas became fully editable, so the backend gained team-scoped, library-guarded CRUD
+ a server-authoritative validity guard at launch. Each mutation re-reads the row (genuine
persistence, not the response echo); each edge role is asserted to round-trip to the exact
``(edge_type, conditions)`` the executor routes on. Offline: pure DB + the in-process client."""

import uuid

from conftest import auth_user_id
from sqlalchemy import select

from tvashtr.control_plane.teams import ENGINEER_PROMPT, clone_team_graph, create_team_from_template
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge


def _create_blank(client, name: str) -> str:
    resp = client.post("/api/teams", json={"template": "blank", "name": name})
    assert resp.status_code == 200, resp.text
    return resp.json()["team_graph_id"]


def _graph(client, tid: str) -> dict:
    return client.get(f"/api/teams/{tid}/graph").json()


def _node_row(node_id: str) -> AgentNode | None:
    with session_scope() as session:
        return session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(node_id))
        ).scalar_one_or_none()


def _edge_rows(tid: str) -> list[Edge]:
    with session_scope() as session:
        return list(
            session.execute(select(Edge).where(Edge.team_graph_id == uuid.UUID(tid))).scalars()
        )


# --- Blank-team seed -----------------------------------------------------------------------------


def test_blank_team_seeds_minimal_valid_skeleton(client):
    """A 'Blank team' is NEVER a 0-node canvas (the gate would reject it) — it seeds the minimal
    valid skeleton: one root thinker → a Ship terminal (2 nodes, 1 edge), and validates clean."""
    tid = _create_blank(client, "Blank seed")
    graph = _graph(client, tid)
    kinds = sorted(n["kind"] for n in graph["nodes"])
    assert kinds == ["completion", "terminal"]
    assert len(graph["edges"]) == 1
    assert client.get(f"/api/teams/{tid}/validate").json()["runnable"] is True


# --- Node create ---------------------------------------------------------------------------------


def test_create_worker_preset_seeds_engineer_prompt(client):
    """A worker dropped with the 'engineer' preset is an agent/openhands node pre-filled with the
    byte-intact ENGINEER_PROMPT (drop-and-edit at node granularity). Re-read the row — persisted."""
    tid = _create_blank(client, "Worker preset")
    resp = client.post(
        f"/api/teams/{tid}/nodes",
        json={"node_kind": "worker", "preset": "engineer", "position": {"x": 300, "y": 0}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "agent" and body["engine"] == "openhands"
    assert body["role_name"] == "engineer" and body["prompt"] == ENGINEER_PROMPT
    row = _node_row(body["id"])
    assert row.kind == "agent" and row.engine == "openhands" and row.prompt == ENGINEER_PROMPT


def test_create_blank_thinker_has_empty_prompt(client):
    """A blank thinker primitive is a completion node with an empty (editable) prompt, no engine."""
    tid = _create_blank(client, "Blank thinker")
    resp = client.post(f"/api/teams/{tid}/nodes", json={"node_kind": "thinker"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "completion" and body["engine"] is None and body["prompt"] == ""


def test_create_gate_and_terminals(client):
    """Gate carries its title/description config; a terminal carries terminal_kind (ship vs stop is
    a real choice) and is REQUIRED — a terminal with no terminal_kind is a 400."""
    tid = _create_blank(client, "Gate + terminals")
    gate = client.post(
        f"/api/teams/{tid}/nodes",
        json={"node_kind": "gate", "title": "Sign off?", "description": "Approve to go."},
    )
    assert gate.status_code == 200, gate.text
    assert gate.json()["kind"] == "gate" and gate.json()["config"]["title"] == "Sign off?"

    stop = client.post(
        f"/api/teams/{tid}/nodes", json={"node_kind": "terminal", "terminal_kind": "stop"}
    )
    assert stop.status_code == 200, stop.text
    assert stop.json()["kind"] == "terminal" and stop.json()["config"]["terminal_kind"] == "stop"

    bad = client.post(f"/api/teams/{tid}/nodes", json={"node_kind": "terminal"})
    assert bad.status_code == 400, bad.text


# --- Edge create — the four roles round-trip to (edge_type, conditions) ---------------------------


def test_edge_roles_round_trip(client):
    """Each plain-language edge role maps to exactly the (edge_type, conditions) the executor routes
    on: forward → null; branch → {when: LABEL}; loop_back → {loop_limit: N}; escalation →
    edge_type='escalation'. A label-less branch is a 400."""
    tid = _create_blank(client, "Edge roles")
    nodes = _graph(client, tid)["nodes"]
    src, tgt = nodes[0]["id"], nodes[1]["id"]

    def mk(role, **extra):
        return client.post(
            f"/api/teams/{tid}/edges",
            json={"source_node_id": src, "target_node_id": tgt, "role": role, **extra},
        )

    fwd = mk("forward")
    assert (
        fwd.status_code == 200
        and fwd.json()["edge_type"] == "work"
        and fwd.json()["conditions"] is None
    )

    branch = mk("branch", label="approved")
    assert branch.status_code == 200 and branch.json()["conditions"] == {"when": "approved"}

    assert mk("branch").status_code == 400  # branch with no label

    loop = mk("loop_back")
    assert loop.status_code == 200 and loop.json()["conditions"] == {"loop_limit": 3}  # default
    loop5 = mk("loop_back", loop_limit=5)
    assert loop5.json()["conditions"] == {"loop_limit": 5}

    esc = mk("escalation")
    assert esc.status_code == 200 and esc.json()["edge_type"] == "escalation"


def test_edge_endpoint_off_team_is_404(client):
    """An edge whose endpoint is a node from ANOTHER team is refused 404 — you can only wire a
    team's own nodes."""
    tid_a = _create_blank(client, "Edge team A")
    tid_b = _create_blank(client, "Edge team B")
    foreign = _graph(client, tid_a)["nodes"][0]["id"]
    local = _graph(client, tid_b)["nodes"][1]["id"]
    resp = client.post(
        f"/api/teams/{tid_b}/edges",
        json={"source_node_id": foreign, "target_node_id": local, "role": "forward"},
    )
    assert resp.status_code == 404, resp.text


# --- Delete (node cascades its edges; edge) -------------------------------------------------------


def test_delete_node_cascades_its_edges(client):
    """Deleting the thinker drops its node row AND the thinker→ship edge (FK ondelete=CASCADE)."""
    tid = _create_blank(client, "Delete cascade")
    thinker = next(n for n in _graph(client, tid)["nodes"] if n["kind"] == "completion")
    assert len(_edge_rows(tid)) == 1
    resp = client.delete(f"/api/teams/{tid}/nodes/{thinker['id']}")
    assert resp.status_code == 200, resp.text
    assert _node_row(thinker["id"]) is None
    assert _edge_rows(tid) == []  # the edge cascaded


def test_delete_edge(client):
    """Deleting the team's edge removes that edge row; 404 for an edge not on the team."""
    tid = _create_blank(client, "Delete edge")
    edge_id = _graph(client, tid)["edges"][0]["id"]
    resp = client.delete(f"/api/teams/{tid}/edges/{edge_id}")
    assert resp.status_code == 200, resp.text
    assert _edge_rows(tid) == []
    assert client.delete(f"/api/teams/{tid}/edges/{uuid.uuid4()}").status_code == 404


# --- Positions persist ---------------------------------------------------------------------------


def test_positions_persist_on_drag(client):
    """A batch positions write lands on the node rows (canvas layout durability)."""
    tid = _create_blank(client, "Positions")
    node_id = _graph(client, tid)["nodes"][0]["id"]
    resp = client.post(
        f"/api/teams/{tid}/positions", json={"positions": {node_id: {"x": 123, "y": 456}}}
    )
    assert resp.status_code == 200 and resp.json()["updated"] == [node_id]
    assert _node_row(node_id).position == {"x": 123, "y": 456}


# --- Guards: library-team only -------------------------------------------------------------------


def test_crud_is_library_guarded(client):
    """CRUD is library-only: an unknown id and a non-library run-snapshot clone both 404, so a run
    snapshot / A-B graph can never be edited via the team API."""
    assert (
        client.post(f"/api/teams/{uuid.uuid4()}/nodes", json={"node_kind": "thinker"}).status_code
        == 404
    )

    library = create_team_from_template("two_node", "Guard source", auth_user_id())
    snapshot = clone_team_graph(library)  # is_library = False
    assert (
        client.post(f"/api/teams/{snapshot}/nodes", json={"node_kind": "thinker"}).status_code
        == 404
    )
    assert client.get(f"/api/teams/{snapshot}/validate").status_code == 404


# --- Run-start validity guard --------------------------------------------------------------------


def test_create_run_refuses_an_invalid_graph_422(client):
    """The server re-validates at launch: a graph made invalid (an unconnected just-dropped node →
    two entry points) is refused 422 with its structured errors — you cannot launch a broken graph
    even via the API. The matching FE verdict (the validate endpoint) agrees."""
    tid = _create_blank(client, "Invalid launch")
    client.post(f"/api/teams/{tid}/nodes", json={"node_kind": "worker"})  # unconnected → 2 roots

    verdict = client.get(f"/api/teams/{tid}/validate").json()
    assert verdict["runnable"] is False and verdict["errors"]

    resp = client.post("/api/runs", json={"team_graph_id": tid, "idea": "x"})
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["errors"], resp.text
