"""Security S1-C: the owner-scoping sweep for the teams / nodes / edges routes.

Two fresh accounts per test (A and B, each its own cookie jar). A owns a library team (review_loop
template, with A-only markers in its name, a node prompt and a run idea), a domain and a finished
run. For every route that takes an account-owned id, B asks with A's id(s) and an otherwise valid
request: the answer must be 404, must not echo A's data, and A's rows must be unchanged; then the
same request by the rightful owner is NOT 404 (destructive owner calls run last), which proves B's
404 came from the ownership check. List routes: A sees its own row, B sees none of A's."""

import json
import uuid
from types import SimpleNamespace

import pytest
from connector_helpers import add_connection
from sqlalchemy import or_, select
from toolkit_helpers import fresh_account

from tvashtr.control_plane.domains import create_domain
from tvashtr.control_plane.teams import clone_team_graph
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, Edge, Run, TeamGraph

# ---- setup helpers ------------------------------------------------------------------------------


def _graph(c, tid: str) -> dict:
    resp = c.get(f"/api/teams/{tid}/graph")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _make_team(c, name: str) -> tuple[str, dict, list]:
    """A review_loop library team created through the API by ``c``'s account."""
    resp = c.post("/api/teams", json={"template": "review_loop", "name": name})
    assert resp.status_code == 200, resp.text
    tid = resp.json()["team_graph_id"]
    graph = _graph(c, tid)
    return tid, {n["role_name"]: n for n in graph["nodes"]}, graph["edges"]


def _seed_run(owner_id: uuid.UUID, tid: str, role: str, idea: str) -> str:
    """A finished run of ``tid`` (a clone snapshot, as a launch makes) where ``role`` ran once."""
    clone_id = uuid.UUID(clone_team_graph(tid))
    run_id = uuid.uuid4()
    with session_scope() as session:
        session.add(
            Run(
                id=run_id,
                team_graph_id=clone_id,
                owner_id=owner_id,
                idea=idea,
                workflow_id=str(run_id),
                status="completed",
            )
        )
        clone_node = session.execute(
            select(AgentNode.id).where(
                AgentNode.team_graph_id == clone_id, AgentNode.role_name == role
            )
        ).scalar_one()
        session.add(
            AgentInvocation(
                run_id=str(run_id), node_id=clone_node, iteration=1, status="done", outcome="done"
            )
        )
    return str(run_id)


def _account(prefix: str) -> SimpleNamespace:
    c, uid = fresh_account()
    mark = f"{prefix}-secret-{uuid.uuid4().hex[:10]}"
    team_name = f"{mark}-team"
    tid, nodes, edges = _make_team(c, team_name)
    prompt_marker = f"{mark}-prompt"
    with session_scope() as session:
        session.get(AgentNode, uuid.UUID(nodes["pm"]["id"])).prompt = prompt_marker
    idea = f"{mark}-idea"
    run_id = _seed_run(uid, tid, "pm", idea)
    domain_id = create_domain(uid, f"{mark}-domain", "blank")["domain_id"]
    return SimpleNamespace(
        c=c,
        uid=uid,
        tid=tid,
        nodes=nodes,
        edges=edges,
        run_id=run_id,
        domain_id=domain_id,
        markers=(team_name, prompt_marker, idea, f"{mark}-domain"),
    )


@pytest.fixture
def ab(client):  # `client` launches the app (DBOS) once; A and B are fresh accounts, never it.
    return _account("A"), _account("B")


def _snapshot(acct: SimpleNamespace) -> dict:
    """Every row of A's that a team/node/edge route could touch, plus anything elsewhere that
    points at A's nodes or domain (a foreign edge, a node bound to A's domain, a duplicate)."""
    tid = uuid.UUID(acct.tid)

    def dump(value) -> str:
        return json.dumps(value, sort_keys=True, default=str)

    with session_scope() as s:
        g = s.get(TeamGraph, tid)
        team = None if g is None else (g.name, g.is_library, str(g.owner_id), g.template_key)
        nodes = s.execute(select(AgentNode).where(AgentNode.team_graph_id == tid)).scalars().all()
        node_ids = [n.id for n in nodes]
        node_rows = sorted(
            (
                str(n.id),
                n.role_name,
                n.kind,
                n.prompt,
                n.model,
                n.engine,
                dump(n.position),
                dump(n.config),
                dump(n.tool_config),
                dump(n.skills),
                n.edits_allowed,
            )
            for n in nodes
        )
        edges = sorted(
            (
                str(e.id),
                str(e.team_graph_id),
                str(e.source_node_id),
                str(e.target_node_id),
                e.edge_type,
                dump(e.conditions),
            )
            for e in s.execute(
                select(Edge).where(
                    or_(
                        Edge.team_graph_id == tid,
                        Edge.source_node_id.in_(node_ids),
                        Edge.target_node_id.in_(node_ids),
                    )
                )
            ).scalars()
        )
        run = s.get(Run, uuid.UUID(acct.run_id))
        bound_to_domain = sorted(
            str(i)
            for i in s.execute(
                select(AgentNode.id).where(
                    AgentNode.config["domain_id"].astext == str(acct.domain_id)
                )
            ).scalars()
        )
        duplicates = sorted(
            str(i)
            for i in s.execute(
                select(TeamGraph.id).where(TeamGraph.duplicated_from_id == tid)
            ).scalars()
        )
        a_teams = sorted(
            str(i)
            for i in s.execute(select(TeamGraph.id).where(TeamGraph.owner_id == acct.uid)).scalars()
        )
    return {
        "team": team,
        "nodes": node_rows,
        "edges": edges,
        "run": None if run is None else (run.status, str(run.team_graph_id), run.idea),
        "bound_to_domain": bound_to_domain,
        "duplicates": duplicates,
        "teams_owned": a_teams,
    }


def _assert_no_leak(resp, acct: SimpleNamespace) -> None:
    for marker in acct.markers:
        assert marker not in resp.text, f"response leaks {marker!r}: {resp.text[:500]}"


# ---- 1. B calls with A's ids in the PATH --------------------------------------------------------

# (method, path, json body) — `{team}` / `{node}` / `{edge}` / `{node2}` are A's; the body is valid
# for the route, so the owner check is what B reaches. `{node}` is A's pm (an agent node: the
# context preview refuses non-agents with 422, which would mask the owner check).
PATH_CASES = [
    ("POST", "/api/teams/{team}/duplicate", {"name": "B's copy"}),
    ("GET", "/api/teams/{team}/nodes/{node}/runs", None),
    ("POST", "/api/teams/{team}/nodes/{node}/context-preview", {"prompt": "B draft"}),
    ("GET", "/api/teams/{team}/graph", None),
    ("PATCH", "/api/teams/{team}/nodes/{node}", {"prompt": "B overwrote this"}),
    ("DELETE", "/api/teams/{team}", None),
    ("PATCH", "/api/teams/{team}", {"name": "B renamed this"}),
    ("GET", "/api/teams/{team}/runs", None),
    ("POST", "/api/teams/{team}/nodes", {"node_kind": "thinker"}),
    ("DELETE", "/api/teams/{team}/nodes/{node}", None),
    (
        "POST",
        "/api/teams/{team}/edges",
        {"source_node_id": "{node}", "target_node_id": "{node2}", "role": "forward"},
    ),
    ("DELETE", "/api/teams/{team}/edges/{edge}", None),
    ("POST", "/api/teams/{team}/positions", {"positions": {"{node}": {"x": 999, "y": 999}}}),
    ("GET", "/api/teams/{team}/validate", None),
]


def _fill(value, ids: dict):
    if isinstance(value, str):
        for key, real in ids.items():
            value = value.replace("{" + key + "}", real)
        return value
    if isinstance(value, dict):
        return {_fill(k, ids): _fill(v, ids) for k, v in value.items()}
    return value


def _call(c, method: str, path: str, body):
    return c.request(method, path, json=body) if body is not None else c.request(method, path)


def _ids_of(acct: SimpleNamespace) -> dict:
    return {
        "team": acct.tid,
        "node": acct.nodes["pm"]["id"],
        "node2": acct.nodes["reviewer"]["id"],
        "edge": acct.edges[0]["id"],
    }


@pytest.mark.parametrize("method,path,body", PATH_CASES, ids=[f"{m} {p}" for m, p, _ in PATH_CASES])
def test_b_gets_404_for_a_path_ids(ab, method, path, body):
    a, b = ab
    ids = _ids_of(a)
    url, payload = _fill(path, ids), _fill(body, ids)
    before = _snapshot(a)
    b_before = _snapshot(b)

    resp = _call(b.c, method, url, payload)
    assert resp.status_code == 404, f"B {method} {url} -> {resp.status_code}: {resp.text[:500]}"
    _assert_no_leak(resp, a)
    assert _snapshot(a) == before, "B's call changed A's rows"
    assert _snapshot(b)["teams_owned"] == b_before["teams_owned"], "B gained a team from A's"

    # Positive control (destructive ones last, by construction): the owner is not refused.
    own = _call(a.c, method, url, payload)
    assert own.status_code != 404, f"A {method} {url} -> {own.status_code}: {own.text[:500]}"
    assert own.status_code < 400, f"A {method} {url} -> {own.status_code}: {own.text[:500]}"


# ---- 2. B's own team in the path, A's node / edge as the second path id -----------------------

MIXED_CASES = [
    ("GET", "/api/teams/{team}/nodes/{node}/runs", None),
    ("POST", "/api/teams/{team}/nodes/{node}/context-preview", {"prompt": "B draft"}),
    ("PATCH", "/api/teams/{team}/nodes/{node}", {"prompt": "B overwrote this"}),
    ("DELETE", "/api/teams/{team}/nodes/{node}", None),
    ("DELETE", "/api/teams/{team}/edges/{edge}", None),
]


@pytest.mark.parametrize(
    "method,path,body", MIXED_CASES, ids=[f"{m} {p}" for m, p, _ in MIXED_CASES]
)
def test_b_own_team_with_a_node_or_edge_is_404(ab, method, path, body):
    a, b = ab
    foreign = {**_ids_of(a), "team": b.tid}  # B's team, A's node/edge
    url, payload = _fill(path, foreign), _fill(body, foreign)
    before = _snapshot(a)

    resp = _call(b.c, method, url, payload)
    assert resp.status_code == 404, f"B {method} {url} -> {resp.status_code}: {resp.text[:500]}"
    _assert_no_leak(resp, a)
    assert _snapshot(a) == before, "B's call changed A's rows"

    # Positive control: the same request on B's OWN node/edge is not refused.
    own_ids = _ids_of(b)
    own = _call(b.c, method, _fill(path, own_ids), _fill(body, own_ids))
    assert own.status_code != 404, f"B own {method} -> {own.status_code}: {own.text[:500]}"
    assert own.status_code < 400, f"B own {method} -> {own.status_code}: {own.text[:500]}"


# ---- 3. B's own team in the path, A's ids in the BODY / query -----------------------------------


@pytest.mark.parametrize("which", ["both_a", "target_a", "source_a"])
def test_edge_create_with_a_nodes_in_body_is_404(ab, which):
    a, b = ab
    src = (a if which in ("both_a", "source_a") else b).nodes["pm"]["id"]
    tgt = (a if which in ("both_a", "target_a") else b).nodes["reviewer"]["id"]
    before = _snapshot(a)
    b_edges = _snapshot(b)["edges"]

    resp = b.c.post(
        f"/api/teams/{b.tid}/edges",
        json={"source_node_id": src, "target_node_id": tgt, "role": "forward"},
    )
    assert resp.status_code == 404, f"B edge -> {resp.status_code}: {resp.text[:500]}"
    _assert_no_leak(resp, a)
    assert _snapshot(a) == before, "an edge now points at A's node"
    assert _snapshot(b)["edges"] == b_edges

    own = b.c.post(
        f"/api/teams/{b.tid}/edges",
        json={
            "source_node_id": b.nodes["pm"]["id"],
            "target_node_id": b.nodes["reviewer"]["id"],
            "role": "forward",
        },
    )
    assert own.status_code == 200, own.text


def test_node_create_with_a_domain_in_body_is_404(ab):
    a, b = ab
    before = _snapshot(a)
    b_nodes = _snapshot(b)["nodes"]

    resp = b.c.post(
        f"/api/teams/{b.tid}/nodes", json={"node_kind": "domain_query", "domain_id": a.domain_id}
    )
    assert resp.status_code == 404, f"B node -> {resp.status_code}: {resp.text[:500]}"
    _assert_no_leak(resp, a)
    assert _snapshot(a) == before, "a node is now bound to A's domain"
    assert _snapshot(b)["nodes"] == b_nodes

    own = b.c.post(
        f"/api/teams/{b.tid}/nodes", json={"node_kind": "domain_query", "domain_id": b.domain_id}
    )
    assert own.status_code == 200, own.text


def test_node_patch_with_a_domain_in_body_is_404(ab):
    a, b = ab
    made = b.c.post(f"/api/teams/{b.tid}/nodes", json={"node_kind": "domain_query"})
    assert made.status_code == 200, made.text
    dq = made.json()["id"]
    before = _snapshot(a)
    b_nodes = _snapshot(b)["nodes"]

    resp = b.c.patch(f"/api/teams/{b.tid}/nodes/{dq}", json={"domain_id": a.domain_id})
    assert resp.status_code == 404, f"B patch -> {resp.status_code}: {resp.text[:500]}"
    _assert_no_leak(resp, a)
    assert _snapshot(a) == before, "B's node is now bound to A's domain"
    assert _snapshot(b)["nodes"] == b_nodes

    own = b.c.patch(f"/api/teams/{b.tid}/nodes/{dq}", json={"domain_id": b.domain_id})
    assert own.status_code == 200, own.text
    assert own.json()["config"]["domain_id"] == b.domain_id


def _cross_run(a: SimpleNamespace, b: SimpleNamespace) -> str:
    """A run OWNED BY A on a snapshot of B's team, where a clone of B's pm ran. A launch refuses
    another account's team, so this is seeded: A's run of A's own team would ALSO fail the "not this
    agent's run" check, so only this run proves the run-owner check is what refuses B."""
    return _seed_run(a.uid, b.tid, "pm", f"{a.markers[2]}-cross")


def _give_run_to(run_id: str, uid: uuid.UUID) -> None:
    with session_scope() as s:
        s.get(Run, uuid.UUID(run_id)).owner_id = uid


def test_node_runs_with_a_run_id_in_query_is_404(ab):
    a, b = ab
    cross = _cross_run(a, b)
    url = f"/api/teams/{b.tid}/nodes/{b.nodes['pm']['id']}/runs"
    for rid in (a.run_id, cross):
        resp = b.c.get(url, params={"run_id": rid})
        assert resp.status_code == 404, f"B runs?run_id={rid} -> {resp.status_code}: {resp.text}"
        _assert_no_leak(resp, a)

    # B's agent history lists only B's run, though a clone of B's agent ran in A's newer one.
    listed = b.c.get(url)
    assert listed.status_code == 200, listed.text
    assert {r["run_id"] for r in listed.json()["runs"]} == {b.run_id}
    assert listed.json()["run"]["run_id"] == b.run_id
    _assert_no_leak(listed, a)

    # Positive controls: A's own history works, and the SAME cross run once it is B's is served —
    # so the 404 above was the run-owner check and nothing else.
    a_own = a.c.get(
        f"/api/teams/{a.tid}/nodes/{a.nodes['pm']['id']}/runs", params={"run_id": a.run_id}
    )
    assert a_own.status_code == 200 and a_own.json()["run"]["run_id"] == a.run_id
    _give_run_to(cross, b.uid)
    own = b.c.get(url, params={"run_id": cross})
    assert own.status_code == 200, own.text
    assert own.json()["run"]["run_id"] == cross


def test_context_preview_with_a_run_id_in_body_is_404(ab):
    a, b = ab
    cross = _cross_run(a, b)
    url = f"/api/teams/{b.tid}/nodes/{b.nodes['pm']['id']}/context-preview"
    for rid in (a.run_id, cross):
        resp = b.c.post(url, json={"run_id": rid})
        assert resp.status_code == 404, f"B preview run_id={rid} -> {resp.status_code}: {resp.text}"
        _assert_no_leak(resp, a)

    # No run_id = the team's latest run: A's newer run on B's team is never the one compiled in.
    latest = b.c.post(url, json={})
    assert latest.status_code == 200, latest.text
    _assert_no_leak(latest, a)
    assert b.markers[2] in latest.text

    own = b.c.post(url, json={"run_id": b.run_id})
    assert own.status_code == 200, own.text
    assert b.markers[2] in own.text  # B's own run idea is what the preview compiled with
    _give_run_to(cross, b.uid)  # the same cross run, now B's, is served: the 404 was ownership
    mine = b.c.post(url, json={"run_id": cross})
    assert mine.status_code == 200, mine.text
    assert f"{a.markers[2]}-cross" in mine.text


# A's toolkit rows named in a node body: B's node pointing at A's connection / library tool /
# domain (``tool_config``) or library skill (``skills``), and the preview drafting with A's skill.
FETCH = {"command": "uvx", "args": ["mcp-server-fetch"]}
TOOLKIT_BODY = {
    "connection": lambda i: {"tool_config": {"tvashtr": {"connectors": [{"id": i}]}}},
    "tool": lambda i: {"tool_config": {"tvashtr": {"library": [i]}}},
    "domain": lambda i: {"tool_config": {"tvashtr": {"domains": [i]}}},
    "skill": lambda i: {"skills": [{"type": "library", "id": i}]},
}


def _toolkit_row(acct: SimpleNamespace, kind: str) -> tuple[str, tuple, str]:
    """``acct``'s own ``kind`` row: (its id, text that must not reach another account, the owner's
    view of it — which must not change when another account names it)."""
    tag = uuid.uuid4().hex[:8]
    if kind == "connection":
        name = f"{acct.markers[0]}-conn"
        cid = add_connection(acct.uid, name=name)
        return cid, (name,), f"/api/connectors/{cid}/agents"
    if kind == "tool":
        name = f"tool-{tag}"
        resp = acct.c.post("/api/tool-library", json={"name": name, "server_config": FETCH})
        assert resp.status_code == 200, resp.text
        return resp.json()["id"], (name,), "/api/tool-library"
    if kind == "skill":
        name, content = f"skill-{tag}", f"{acct.markers[0]}-skill-content"
        source = {"type": "inline", "name": name, "content": content, "mode": "always"}
        resp = acct.c.post("/api/skill-library", json={"name": name, "source": source})
        assert resp.status_code == 200, resp.text
        return resp.json()["id"], (name, content), "/api/skill-library"
    return acct.domain_id, (acct.markers[3],), f"/api/domains/{acct.domain_id}/usage"


@pytest.mark.parametrize(
    "route,kind",
    [
        ("patch", "connection"),
        ("patch", "tool"),
        ("patch", "domain"),
        ("patch", "skill"),
        ("preview", "skill"),
    ],
)
def test_node_body_with_a_toolkit_id_is_404(ab, route, kind):
    a, b = ab
    a_id, a_text, a_view = _toolkit_row(a, kind)
    b_id, b_text, _ = _toolkit_row(b, kind)
    pm = b.nodes["pm"]["id"]
    url = f"/api/teams/{b.tid}/nodes/{pm}" + ("/context-preview" if route == "preview" else "")
    method = "POST" if route == "preview" else "PATCH"
    before, view_before = _snapshot(a), a.c.get(a_view).json()

    resp = b.c.request(method, url, json=TOOLKIT_BODY[kind](a_id))
    _assert_no_leak(resp, a)
    for text in a_text:
        assert text not in resp.text, f"response leaks A's {kind} {text!r}: {resp.text[:500]}"
    assert _snapshot(a) == before, "B's call changed A's rows"
    assert a.c.get(a_view).json() == view_before, f"B's agent now shows in A's {kind} view"

    # Positive control: the same body naming B's OWN row is accepted (and, for the preview,
    # resolved — so A's skill would have shown had it been resolved).
    own = b.c.request(method, url, json=TOOLKIT_BODY[kind](b_id))
    assert own.status_code == 200, own.text
    if route == "preview":
        assert all(text in own.text for text in b_text), own.text[:500]

    # The uniform contract, checked last so the checks above are evidence either way.
    assert resp.status_code == 404, f"B {method} {url} ({kind}) -> {resp.status_code}: {resp.text}"


def test_positions_with_a_node_in_body_leaves_a_unchanged(ab):
    """B's own team, A's node id in the positions batch: A's node must not move."""
    a, b = ab
    before = _snapshot(a)
    resp = b.c.post(
        f"/api/teams/{b.tid}/positions",
        json={"positions": {a.nodes["pm"]["id"]: {"x": 999, "y": 999}}},
    )
    assert resp.status_code < 500, resp.text
    _assert_no_leak(resp, a)
    assert a.nodes["pm"]["id"] not in resp.json().get("updated", [])
    assert _snapshot(a) == before, "B moved A's node"


def test_positions_with_a_node_in_body_is_refused_404(ab):
    """The uniform contract: A's node id in B's positions body is refused with 404."""
    a, b = ab
    resp = b.c.post(
        f"/api/teams/{b.tid}/positions",
        json={"positions": {a.nodes["pm"]["id"]: {"x": 999, "y": 999}}},
    )
    assert resp.status_code == 404, f"B positions(A node) -> {resp.status_code}: {resp.text}"

    own = b.c.post(
        f"/api/teams/{b.tid}/positions",
        json={"positions": {b.nodes["pm"]["id"]: {"x": 5, "y": 6}}},
    )
    assert own.status_code == 200 and own.json()["updated"] == [b.nodes["pm"]["id"]]


# ---- 4. list ------------------------------------------------------------------------------------


def test_team_list_is_owner_scoped(ab):
    a, b = ab
    a_list = a.c.get("/api/teams")
    assert a_list.status_code == 200
    assert a.tid in {t["team_graph_id"] for t in a_list.json()["teams"]}  # positive control
    assert a.markers[0] in a_list.text

    b_list = b.c.get("/api/teams")
    assert b_list.status_code == 200
    b_ids = {t["team_graph_id"] for t in b_list.json()["teams"]}
    assert b.tid in b_ids
    assert a.tid not in b_ids
    _assert_no_leak(b_list, a)


# ---- 5. own: create / static catalogues take no foreign id --------------------------------------


def test_create_team_is_owned_by_caller_only(ab):
    a, b = ab
    name = f"B-created-{uuid.uuid4().hex[:8]}"
    resp = b.c.post("/api/teams", json={"template": "blank", "name": name})
    assert resp.status_code == 200, resp.text
    new_id = resp.json()["team_graph_id"]
    with session_scope() as s:
        assert s.get(TeamGraph, uuid.UUID(new_id)).owner_id == b.uid
    assert new_id in {t["team_graph_id"] for t in b.c.get("/api/teams").json()["teams"]}
    assert new_id not in {t["team_graph_id"] for t in a.c.get("/api/teams").json()["teams"]}
    assert a.c.get(f"/api/teams/{new_id}/graph").status_code == 404


@pytest.mark.parametrize(
    "path", ["/api/templates", "/api/templates?for=desktop", "/api/node-templates"]
)
def test_catalogues_carry_no_other_account_data(ab, path):
    a, b = ab
    resp = b.c.get(path)
    assert resp.status_code == 200, resp.text
    _assert_no_leak(resp, a)
    assert a.tid not in resp.text and a.domain_id not in resp.text
