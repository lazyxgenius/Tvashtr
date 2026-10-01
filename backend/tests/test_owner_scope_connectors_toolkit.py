"""Security S1-C owner-scoping sweep — connectors, the tool and skill library, secrets, toolkit.

Two fresh accounts per test. Account B, holding account A's ids (in the path, the query or the
body), must get a 404 that carries none of A's data, and every row A owns must be byte-for-byte
the same afterwards. A making the same request is never a 404, so B's 404 comes from ownership,
not from a bad path or body. List routes show A its rows and B none of them. No network: the
connector provider and GitHub are replaced."""

import uuid
from types import SimpleNamespace

import pytest
from connector_helpers import add_connection
from fastapi.testclient import TestClient
from mcp.types import CallToolResult
from toolkit_helpers import fresh_account, make_node, make_team

from tvashtr.control_plane import connector_oauth, connector_upstream, github_app
from tvashtr.control_plane.mcp_secrets import resolve_owner_mcp_secret
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import (
    AgentNode,
    ConnectorConnection,
    GithubInstallation,
    McpSecret,
    NodeMemory,
    SkillLibraryItem,
    TeamGraph,
    ToolLibraryItem,
)

SHA = "a" * 40


def _account(tag: str) -> SimpleNamespace:
    """A fresh account owning one of everything this family serves: a secret, a tool that uses it
    (and a second, missing one), an inline skill, a connected key connection (Supabase, so it has
    a project picker) and a library team whose agent uses all three."""
    c, uid = fresh_account()
    h = uuid.uuid4().hex[:10]
    secret, missing = f"{tag.upper()}_SECRET_{h.upper()}", f"{tag.upper()}_MISSING_{h.upper()}"
    value = f"{tag}-secret-value-{h}"
    assert c.post("/api/secrets", json={"name": secret, "value": value}).status_code == 200
    config = {
        "url": "https://mcp.example.com/mcp",
        "headers": {"Authorization": f"Bearer ${{{secret}}}", "X-Other": f"${{{missing}}}"},
    }
    tool = c.post("/api/tool-library", json={"name": f"{tag}-tool-{h}", "server_config": config})
    assert tool.status_code == 200, tool.text
    content = f"{tag} private skill body {h}"
    skill = c.post(
        "/api/skill-library",
        json={"name": f"{tag}-skill-{h}", "source": {"type": "inline", "content": content}},
    )
    assert skill.status_code == 200, skill.text
    conn_name = f"{tag} conn {h}"
    conn = add_connection(
        uid,
        "supabase",
        name=conn_name,
        auth_kind="api_key",
        secret={"headers": {"Authorization": f"Bearer {tag}-key-{h}"}},
    )
    team_name, role = f"{tag} team {h}", f"{tag}-role-{h}"
    team = make_team(uid, team_name)
    node = make_node(
        team,
        role,
        tool_config={
            "tvashtr": {
                "library": [tool.json()["id"]],
                "connectors": [{"id": conn, "access": "read"}],
            }
        },
        skills=[{"type": "library", "id": skill.json()["id"]}],
    )
    return SimpleNamespace(
        c=c,
        uid=uid,
        tool=tool.json()["id"],
        tool_name=f"{tag}-tool-{h}",
        skill=skill.json()["id"],
        skill_name=f"{tag}-skill-{h}",
        skill_content=content,
        secret=secret,
        missing=missing,
        value=value,
        conn=conn,
        conn_name=conn_name,
        team=str(team),
        team_name=team_name,
        node=str(node),
        role=role,
    )


def _markers(a: SimpleNamespace) -> list[str]:
    """A's data that B never sends itself, so it must never come back to B."""
    return [
        a.tool_name,
        a.skill_name,
        a.skill_content,
        a.value,
        a.missing,
        a.conn_name,
        a.team_name,
        a.role,
        a.node,
        str(a.uid),
    ]


def _cols(row) -> dict:
    return {col.name: getattr(row, col.name) for col in row.__table__.columns}


def _state(owner_id: uuid.UUID) -> dict:
    """Every row of this family the owner has, every column."""
    with session_scope() as s:

        def rows(model, *where) -> list[dict]:
            found = s.query(model).filter(*where).order_by(model.id).all()
            return [_cols(r) for r in found]

        return {
            "tools": rows(ToolLibraryItem, ToolLibraryItem.owner_id == owner_id),
            "skills": rows(SkillLibraryItem, SkillLibraryItem.owner_id == owner_id),
            "secrets": rows(McpSecret, McpSecret.owner_id == owner_id),
            "connections": rows(ConnectorConnection, ConnectorConnection.owner_id == owner_id),
            "teams": rows(TeamGraph, TeamGraph.owner_id == owner_id),
            "nodes": rows(
                AgentNode,
                AgentNode.team_graph_id.in_(
                    s.query(TeamGraph.id).filter(TeamGraph.owner_id == owner_id)
                ),
            ),
        }


@pytest.fixture
def upstream(monkeypatch):
    """The connector provider, replaced: an empty tool list and an unreadable project list.
    ``calls`` records every request that reached it."""
    calls: list[tuple] = []

    def list_tools_sync(url, transport, headers, timeout=10):
        calls.append(("list_tools", url))
        return []

    async def call_tool(url, transport, headers, name, arguments, timeout=120):
        calls.append(("call_tool", url))
        return CallToolResult(content=[], isError=True)

    monkeypatch.setattr(connector_upstream, "list_tools_sync", list_tools_sync)
    monkeypatch.setattr(connector_upstream, "call_tool", call_tool)
    return calls


@pytest.fixture
def ab(upstream):
    return _account("a"), _account("b"), upstream


def _fill(template, a: SimpleNamespace, b: SimpleNamespace, me: SimpleNamespace):
    """``{a.x}`` / ``{b.x}`` / ``{me.x}`` (the caller's own) placeholders, in a path or a body."""
    if isinstance(template, str):
        return template.format(a=a, b=b, me=me)
    if isinstance(template, list):
        return [_fill(t, a, b, me) for t in template]
    if isinstance(template, dict):
        return {k: _fill(v, a, b, me) for k, v in template.items()}
    return template


def _call(who: SimpleNamespace, method: str, path: str, body):
    return who.c.request(method, path, json=body)


# ---- id routes: A's id in the path (or query) --------------------------------------------------

# (method, path, body). ``{me.node}`` is the caller's own agent, so the body is valid for whoever
# sends it and only the path id differs between B's attempt and A's control.
ID_ROUTES = [
    ("GET", "/api/skill-library/{a.skill}", None, 200),
    ("POST", "/api/skill-library/{a.skill}/duplicate", None, 201),
    ("GET", "/api/skill-library/{a.skill}/agents", None, 200),
    ("PUT", "/api/skill-library/{a.skill}/agents", {"node_ids": ["{me.node}"]}, 200),
    ("PATCH", "/api/skill-library/{a.skill}", {"name": "renamed-skill"}, 200),
    ("PATCH", "/api/skill-library/{a.skill}", {"source": {"type": "inline", "content": "x"}}, 200),
    ("DELETE", "/api/skill-library/{a.skill}", None, 200),
    ("PUT", "/api/secrets/{a.secret}", {"value": "overwritten-value"}, 200),
    ("DELETE", "/api/secrets/{a.secret}", None, 204),
    ("GET", "/api/tool-library/{a.tool}", None, 200),
    ("POST", "/api/tool-library/{a.tool}/duplicate", None, 201),
    ("PUT", "/api/tool-library/{a.tool}/agents", {"node_ids": ["{me.node}"]}, 200),
    ("PATCH", "/api/tool-library/{a.tool}", {"name": "renamed-tool"}, 200),
    ("PATCH", "/api/tool-library/{a.tool}", {"server_config": {"command": "evil"}}, 200),
    ("DELETE", "/api/tool-library/{a.tool}", None, 200),
    ("GET", "/api/agents?tool_id={a.tool}", None, 200),
    ("GET", "/api/agents?skill_id={a.skill}", None, 200),
    ("GET", "/api/connectors/{a.conn}", None, 200),
    ("PATCH", "/api/connectors/{a.conn}", {"name": "Renamed"}, 200),
    ("PATCH", "/api/connectors/{a.conn}", {"access": "write"}, 200),
    ("DELETE", "/api/connectors/{a.conn}", None, 200),
    ("POST", "/api/connectors/{a.conn}/check", None, 200),
    ("GET", "/api/connectors/{a.conn}/scope-options", None, 200),
    ("GET", "/api/connectors/{a.conn}/agents", None, 200),
    ("PUT", "/api/connectors/{a.conn}/agents", {"node_ids": ["{me.node}"]}, 200),
    # A's row is a key connection: 409 not_oauth is raised only after the owner lookup found it.
    ("POST", "/api/connectors/{a.conn}/oauth/start", None, 409),
]

# S1-C accepted exceptions: B is refused without a 404, so B's answer for A's id must instead equal
# B's answer for an id nobody has (no existence oracle). Value: why the route keeps its contract.
NO_ORACLE_ROUTES = {
    ("DELETE", "/api/skill-library/{a.skill}"): "owner-filtered delete, 200 for an absent id",
    ("DELETE", "/api/secrets/{a.secret}"): "idempotent owner-filtered delete, 204",
    ("DELETE", "/api/tool-library/{a.tool}"): "owner-filtered delete, 200 for an absent id",
}


def _ghost(a: SimpleNamespace) -> SimpleNamespace:
    """A's namespace with every path id swapped for one that exists for nobody."""
    h = uuid.uuid4().hex[:10].upper()
    return SimpleNamespace(
        **{
            **vars(a),
            "skill": str(uuid.uuid4()),
            "tool": str(uuid.uuid4()),
            "secret": f"GHOST_SECRET_{h}",
        }
    )


def _normalised(text: str, who: SimpleNamespace) -> str:
    for ident in (who.skill, who.tool, who.secret):
        text = text.replace(ident, "<id>")
    return text


@pytest.mark.parametrize(
    ("method", "path", "body", "a_status"),
    ID_ROUTES,
    ids=[f"{m} {p} {b}" for m, p, b, _ in ID_ROUTES],
)
def test_b_with_a_path_id_is_a_404_and_a_is_unchanged(ab, method, path, body, a_status):
    a, b, upstream = ab
    before_a, before_b = _state(a.uid), _state(b.uid)

    resp = _call(b, method, _fill(path, a, b, b), _fill(body, a, b, b))
    exception = NO_ORACLE_ROUTES.get((method, path))
    if exception:
        ghost = _ghost(a)
        absent = _call(b, method, _fill(path, ghost, b, b), _fill(body, ghost, b, b))

    # The security property first: nothing of A's moved, nothing was written to B from A's row
    # (a copy, a grant to A's item), and no provider was asked for A's row.
    assert _state(a.uid) == before_a
    assert _state(b.uid) == before_b
    assert upstream == []

    # Positive control (after B's call: it may delete): A's own identical request reaches the
    # handler, so the path and body are valid and only the caller differs.
    mine = _call(a, method, _fill(path, a, b, a), _fill(body, a, b, a))
    assert mine.status_code == a_status, f"A got {mine.status_code}: {mine.text}"
    if method == "DELETE":
        assert _state(a.uid) != before_a  # A's delete really removed A's row

    if exception:
        # S1-C exception: idempotent owner-filtered delete (per route: NO_ORACLE_ROUTES), no oracle
        assert (resp.status_code, _normalised(resp.text, a)) == (
            absent.status_code,
            _normalised(absent.text, ghost),
        ), f"{exception}: A's id {resp.text!r}, absent {absent.text!r}"
    else:
        assert resp.status_code == 404, f"B got {resp.status_code}: {resp.text} (A: {mine.text})"
    for marker in _markers(a):
        assert marker not in resp.text


# ---- id routes: B's own path object, A's agent ids in the body --------------------------------

BODY_ID_ROUTES = [
    ("PUT", "/api/skill-library/{b.skill}/agents"),
    ("PUT", "/api/tool-library/{b.tool}/agents"),
    ("PUT", "/api/connectors/{b.conn}/agents"),
]


@pytest.mark.parametrize(("method", "path"), BODY_ID_ROUTES, ids=[p for _, p in BODY_ID_ROUTES])
@pytest.mark.parametrize("node_ids", [["{a.node}"], ["{b.node}", "{a.node}"]], ids=["a", "b+a"])
def test_b_with_a_node_ids_in_the_body_is_a_404_and_a_is_unchanged(ab, method, path, node_ids):
    a, b, upstream = ab
    before_a, before_b = _state(a.uid), _state(b.uid)

    resp = _call(b, method, _fill(path, a, b, b), {"node_ids": _fill(node_ids, a, b, b)})

    assert _state(a.uid) == before_a
    assert _state(b.uid) == before_b  # refused whole: not even B's own agent was written
    assert resp.status_code == 404, f"B got {resp.status_code}: {resp.text}"
    for marker in _markers(a):
        assert marker not in resp.text

    # Positive control: the same route and B's path object with B's own agent is not a 404.
    mine = _call(b, method, _fill(path, a, b, b), {"node_ids": [b.node]})
    assert mine.status_code == 200, mine.text
    assert upstream == []


# ---- list routes ---------------------------------------------------------------------------------


def test_tool_library_list_is_the_callers_only(ab):
    a, b, _ = ab
    mine = a.c.get("/api/tool-library").json()["tools"]
    assert [t["id"] for t in mine] == [a.tool]
    theirs = b.c.get("/api/tool-library")
    assert theirs.status_code == 200
    assert [t["id"] for t in theirs.json()["tools"]] == [b.tool]
    for marker in _markers(a):
        assert marker not in theirs.text


def test_skill_library_list_is_the_callers_only(ab):
    a, b, _ = ab
    assert [s["id"] for s in a.c.get("/api/skill-library").json()["skills"]] == [a.skill]
    theirs = b.c.get("/api/skill-library")
    assert theirs.status_code == 200
    assert [s["id"] for s in theirs.json()["skills"]] == [b.skill]
    for marker in _markers(a):
        assert marker not in theirs.text


def test_secrets_list_is_the_callers_only(ab):
    a, b, _ = ab
    mine = a.c.get("/api/secrets").json()
    assert [s["name"] for s in mine["secrets"]] == [a.secret]
    assert [m["name"] for m in mine["missing"]] == [a.missing]
    theirs = b.c.get("/api/secrets")
    assert theirs.status_code == 200
    assert [s["name"] for s in theirs.json()["secrets"]] == [b.secret]
    assert [m["name"] for m in theirs.json()["missing"]] == [b.missing]
    for marker in [*_markers(a), a.secret, a.tool]:
        assert marker not in theirs.text


def test_connectors_list_is_the_callers_only(ab):
    a, b, _ = ab
    assert [c["id"] for c in a.c.get("/api/connectors").json()["connections"]] == [a.conn]
    theirs = b.c.get("/api/connectors")
    assert theirs.status_code == 200
    assert [c["id"] for c in theirs.json()["connections"]] == [b.conn]
    for marker in [*_markers(a), a.conn]:
        assert marker not in theirs.text


def test_catalog_marks_only_the_callers_connection(ab):
    # Both accounts connected Supabase: each card names the caller's own connection. Only A
    # connected Notion: B's Notion card must say "not connected", not A's id.
    a, b, _ = ab
    a_notion = add_connection(a.uid, "notion", name="A notion")

    def cards(who, q):
        resp = who.c.get(f"/api/connectors/catalog?q={q}")
        assert resp.status_code == 200, resp.text
        items = {i["key"]: i for i in resp.json()["items"]}
        return items, resp.text

    mine, _ = cards(a, "supabase")
    assert mine["supabase"]["connection_id"] == a.conn
    mine, _ = cards(a, "notion")
    assert mine["notion"]["connection_id"] == a_notion  # positive control
    for q, expected in (("supabase", b.conn), ("notion", None)):
        theirs, text = cards(b, q)
        assert theirs[q]["connection_id"] == expected
        assert a.conn not in text and a_notion not in text
    assert theirs["notion"]["connection_status"] is None


def test_agents_list_is_the_callers_only(ab):
    a, b, _ = ab
    mine = a.c.get("/api/agents").json()["teams"]
    assert [(t["team_id"], [g["node_id"] for g in t["agents"]]) for t in mine] == [
        (a.team, [a.node])
    ]
    theirs = b.c.get("/api/agents")
    assert theirs.status_code == 200
    assert [t["team_id"] for t in theirs.json()["teams"]] == [b.team]
    for marker in [*_markers(a), a.team]:
        assert marker not in theirs.text


def test_toolkit_summary_counts_only_the_callers_rows(ab):
    a, b, _ = ab
    # A gets more of everything than B, so a count that mixed accounts would show.
    assert (
        a.c.post(
            "/api/tool-library", json={"name": "extra-tool", "server_config": {"command": "uvx"}}
        ).status_code
        == 200
    )
    assert (
        a.c.post(
            "/api/skill-library",
            json={"name": "extra-skill", "source": {"type": "inline", "content": "x"}},
        ).status_code
        == 200
    )
    add_connection(a.uid, "notion", status="needs_signin")
    with session_scope() as s:
        for status in ("pending_review", "active", "superseded"):
            s.add(NodeMemory(owner_id=a.uid, content=f"a memory {status}", status=status))

    mine = a.c.get("/api/toolkit/summary").json()
    theirs = b.c.get("/api/toolkit/summary")
    assert theirs.status_code == 200
    assert theirs.json() == {
        "tools": 1,
        "tools_needing_attention": 1,
        "skills": 1,
        "memory": {"inbox": 0, "active": 0, "archive": 0},
        "secrets_missing": 1,
        "connectors": 1,
        "connectors_needing_attention": 0,
    }
    assert mine["tools"] == 2 and mine["skills"] == 2
    assert mine["connectors"] == 2 and mine["connectors_needing_attention"] == 1
    assert mine["memory"] == {"inbox": 1, "active": 1, "archive": 1}


# ---- own routes: B naming A's rows only ever reaches B's own -----------------------------------


def test_creating_with_a_name_a_has_makes_bs_own_and_leaves_as_alone(ab):
    a, b, _ = ab
    before = _state(a.uid)

    # Create-only: a 409 here would mean A's name counted as taken for B. The tool names A's
    # secret: B has no secret of that name yet, so it must read as missing (not A's "present").
    config = {"command": "uvx", "env": {"TOKEN": f"${{{a.secret}}}"}}
    tool = b.c.post("/api/tool-library", json={"name": a.tool_name, "server_config": config})
    assert tool.status_code == 200, tool.text
    assert tool.json()["missing_secrets"] == [a.secret]
    assert tool.json()["status"] == "needs_attention"
    b_missing = b.c.get("/api/secrets").json()["missing"]
    assert a.secret in [m["name"] for m in b_missing]
    secret = b.c.post("/api/secrets", json={"name": a.secret, "value": "b-value"})
    skill = b.c.post(
        "/api/skill-library",
        json={"name": a.skill_name, "source": {"type": "inline", "content": "b body"}},
    )
    # The upsert path: ``replace`` must find B's row, never A's.
    replaced = b.c.post(
        "/api/skill-library?on_conflict=replace",
        json={"name": a.skill_name, "source": {"type": "inline", "content": "b body 2"}},
    )

    assert _state(a.uid) == before
    assert resolve_owner_mcp_secret(a.uid, a.secret) == a.value
    assert resolve_owner_mcp_secret(b.uid, a.secret) == "b-value"
    assert secret.status_code == 200, secret.text
    assert tool.status_code == 200 and tool.json()["id"] != a.tool, tool.text
    assert skill.status_code == 200 and skill.json()["id"] != a.skill, skill.text
    assert replaced.status_code == 200 and replaced.json()["id"] == skill.json()["id"]
    for resp in (secret, tool, skill, replaced):
        for marker in (a.value, a.skill_content, a.tool, a.skill):
            assert marker not in resp.text


def test_importing_names_a_has_makes_bs_own_and_leaves_as_alone(ab):
    a, b, _ = ab
    before = _state(a.uid)

    # ``error``: a 409 would mean A's names counted as B's conflicts.
    tools = b.c.post(
        "/api/tool-library/import",
        json={"servers": {a.tool_name: {"command": "uvx"}}, "on_conflict": "error"},
    )
    skills = b.c.post(
        "/api/skill-library/import",
        json={
            "url": "https://github.com/acme/skills",
            "sha": SHA,
            "skills": [a.skill_name],
            "on_conflict": "error",
        },
    )

    assert _state(a.uid) == before
    assert tools.status_code == 200 and tools.json()["conflicts"] == [], tools.text
    assert [r["name"] for r in tools.json()["added"]] == [a.tool_name]
    assert a.tool not in tools.text
    assert skills.status_code == 200 and skills.json()["skipped"] == [], skills.text
    assert [r["name"] for r in skills.json()["added"]] == [a.skill_name]
    assert a.skill not in skills.text and a.skill_content not in skills.text


def test_connecting_what_a_has_connected_makes_bs_own(ab, monkeypatch):
    a, b, upstream = ab
    a_notion = add_connection(a.uid, "notion", name="A notion")
    monkeypatch.setattr(connector_oauth, "discover", lambda url, entry=None: None)
    before = _state(a.uid)

    resp = b.c.post("/api/connectors", json={"key": "notion"})

    assert _state(a.uid) == before
    assert resp.status_code == 201, resp.text  # not 409 already_connected naming A's row
    assert resp.json()["id"] != a_notion and a_notion not in resp.text


def test_skill_repo_scan_uses_only_the_callers_github_installation(ab, monkeypatch):
    """A private repo only A's GitHub App installation can read, and a public repo holding a skill
    named like A's library skill. B never gets A's installation, and ``in_library`` is B's own."""
    a, b, _ = ab
    a_install = 800_000_000 + uuid.uuid4().int % 100_000_000
    with session_scope() as s:
        s.add(GithubInstallation(owner_id=a.uid, installation_id=a_install))
    minted: list[int] = []
    a_token = f"token-{a_install}"

    def token(installation_id):
        minted.append(installation_id)
        return f"token-{installation_id}"

    def http(method, url, token=None, **_):
        path = url.removeprefix(github_app._GITHUB_API)
        name = next((n for n in ("private-skills", "public-skills") if f"/acme/{n}" in path), "")
        if not name or (name == "private-skills" and token != a_token):
            raise github_app.GithubAppError("GitHub API HTTP 404", status=404)
        rest = path.removeprefix(f"/repos/acme/{name}")
        if rest == "":
            return {"full_name": f"acme/{name}", "default_branch": "main"}
        if rest == "/commits/main":
            return {"sha": SHA}
        if rest == f"/git/trees/{SHA}?recursive=1":
            return {"tree": [{"path": f"skills/{a.skill_name}/SKILL.md", "type": "blob"}]}
        raise github_app.GithubAppError("GitHub API HTTP 404", status=404)  # file contents

    monkeypatch.setattr(github_app, "get_installation_token", token)
    monkeypatch.setattr(github_app, "_http", http)
    private = {"url": "https://github.com/acme/private-skills"}
    public = {"url": "https://github.com/acme/public-skills"}

    theirs = b.c.post("/api/skill-library/scan", json=private)
    assert theirs.status_code == 404, theirs.text
    assert theirs.json()["detail"]["code"] == "repo_not_found"
    assert a_install not in minted
    for marker in _markers(a):
        assert marker not in theirs.text
    # Positive control: the repo exists and A's own scan reads it through A's installation.
    mine = a.c.post("/api/skill-library/scan", json=private)
    assert mine.status_code == 200, mine.text
    assert a_install in minted
    assert [(x["name"], x["in_library"]) for x in mine.json()["skills"]] == [(a.skill_name, True)]

    # ``in_library`` is the caller's own library: A's skill name is not "in" B's.
    minted.clear()
    theirs = b.c.post("/api/skill-library/scan", json=public)
    assert theirs.status_code == 200, theirs.text
    assert [(x["name"], x["in_library"]) for x in theirs.json()["skills"]] == [
        (a.skill_name, False)
    ]
    assert minted == []


# ---- public routes -------------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/tool-catalog", "/api/skill-presets"])
def test_public_catalogues_are_the_same_for_everyone(ab, path):
    """Static, unauthenticated catalogues: no session needed, and A's rows never show up."""
    a, b, _ = ab
    anon = TestClient(app)
    anon.cookies.clear()
    public = anon.get(path)
    assert public.status_code == 200, public.text
    assert a.c.get(path).json() == public.json() == b.c.get(path).json()
    for marker in [*_markers(a), a.secret, a.tool, a.skill, a.conn]:
        assert marker not in public.text
