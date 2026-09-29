"""Revamp Domains "Use in teams" (DM-92…97): where a domain is used, adding it to a team as a Query
domain step, giving agents access, and the per-domain access reaching the Domains MCP. Every route
is owner-scoped."""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tvashtr.control_plane import domain_mcp
from tvashtr.control_plane.domain_mcp import DomainMcpToolError, resolve_domain_ref
from tvashtr.control_plane.domain_usage import step_title
from tvashtr.control_plane.graph_validity import graph_dicts, validate_graph
from tvashtr.control_plane.node_tools import DOMAINS_HEADER, build_mcp_config
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import AgentNode, Edge, EngineSubscriptionStatus, Run, TeamGraph


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domain-teams-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register", json={"email": email, "password": "domains-password"}
        ).status_code
        == 200
    )
    return c, uuid.UUID(c.get("/api/auth/me").json()["id"])


def _domain(c: TestClient, name: str = "Support docs", template: str = "support") -> str:
    resp = c.post("/api/domains", json={"name": name, "template": template})
    assert resp.status_code == 200, resp.text
    return resp.json()["domain_id"]


def _team(owner: uuid.UUID, name: str, *, library: bool = True) -> uuid.UUID:
    with session_scope() as s:
        t = TeamGraph(name=name, is_library=library, owner_id=owner)
        s.add(t)
        s.flush()
        return t.id


def _node(
    team: uuid.UUID,
    kind: str,
    role: str,
    x: int = 0,
    *,
    config=None,
    tool_config=None,
    model=None,
) -> uuid.UUID:
    with session_scope() as s:
        n = AgentNode(
            team_graph_id=team,
            role_name=role,
            kind=kind,
            model=model,
            config=config,
            tool_config=tool_config,
            position={"x": x, "y": 0},
        )
        s.add(n)
        s.flush()
        return n.id


def _edge(team, source, target, *, edge_type="work", conditions=None) -> uuid.UUID:
    with session_scope() as s:
        e = Edge(
            team_graph_id=team,
            source_node_id=source,
            target_node_id=target,
            edge_type=edge_type,
            conditions=conditions,
        )
        s.add(e)
        s.flush()
        return e.id


def _docs_team(owner: uuid.UUID) -> dict:
    """Product manager → Writer → Reviewer → Ship, one way out each (the design's Docs team)."""
    t = _team(owner, "Docs team")
    pm = _node(t, "completion", "pm", 0, model="xai/grok-4.7")
    writer = _node(
        t, "agent", "worker", 260, config={"title": "Writer"}, model="anthropic/claude-sonnet-5"
    )
    reviewer = _node(t, "agent", "reviewer", 520, model="xai/grok-4.7")
    ship = _node(t, "terminal", "ship", 780, config={"terminal_kind": "ship"})
    first = _edge(t, pm, writer)
    _edge(t, writer, reviewer)
    _edge(t, reviewer, ship)
    return {"team": t, "pm": pm, "writer": writer, "reviewer": reviewer, "ship": ship, "e": first}


def _loop_team(owner: uuid.UUID) -> dict:
    """PM → Approval gate → Engineer ⇄ Reviewer → Ship (a reviewer with a verdict)."""
    t = _team(owner, "Indicator sprint team")
    pm = _node(t, "completion", "pm", 0)
    gate = _node(t, "gate", "gate", 260, config={"gate_kind": "approval"})
    eng = _node(t, "agent", "engineer", 520)
    rev = _node(t, "agent", "reviewer", 780)
    ship = _node(t, "terminal", "ship", 1040, config={"terminal_kind": "ship"})
    _edge(t, pm, gate)
    _edge(t, gate, eng, conditions={"when": "approved"})
    _edge(t, eng, rev)
    _edge(t, rev, ship, conditions={"when": "approved"})
    _edge(t, rev, eng, conditions={"loop_limit": 3})
    return {"team": t, "pm": pm, "gate": gate, "eng": eng, "rev": rev}


# ---- GET …/usage (DM-92) ----


def test_usage_lists_steps_and_agents_in_canvas_order():
    c, owner = _fresh()
    did = _domain(c)
    other = _domain(c, "Vendor contracts", "legal")
    docs = _team(owner, "Docs team")
    step = _node(
        docs,
        "domain_query",
        "domain_query",
        260,
        config={"domain_id": did, "title": "Look up support docs", "pass_to_spec": True},
    )
    _node(docs, "domain_query", "domain_query", 520, config={"domain_id": other})
    sprint = _team(owner, "Indicator sprint team")
    pm = _node(
        sprint,
        "completion",
        "pm",
        0,
        model="xai/grok-4.7",
        tool_config={"tvashtr": {"domains": [did]}},
    )
    legacy = _node(sprint, "agent", "reviewer", 520, tool_config={"tvashtr": {"domains": True}})
    _node(sprint, "agent", "engineer", 260, tool_config={"tvashtr": {"domains": [other]}})
    # A run snapshot never counts.
    clone = _team(owner, "Docs team", library=False)
    _node(clone, "domain_query", "domain_query", config={"domain_id": did})

    body = c.get(f"/api/domains/{did}/usage").json()
    assert body["steps"] == [
        {
            "node_id": str(step),
            "team_id": str(docs),
            "team_name": "Docs team",
            "title": "Look up support docs",
            "pass_to_spec": True,
        }
    ]
    assert [(a["node_id"], a["title"], a["scope"]) for a in body["agents"]] == [
        (str(pm), "Product manager", "this"),
        (str(legacy), "Reviewer", "all"),
    ]
    assert body["agents"][0]["team_name"] == "Indicator sprint team"
    assert body["agents"][0]["model"] == "xai/grok-4.7"
    assert body["agents"][0]["subscription"] is None


def test_usage_step_without_pass_to_spec_and_an_untitled_step():
    c, owner = _fresh()
    did = _domain(c)
    t = _team(owner, "Support bot")
    _node(t, "domain_query", "domain_query", config={"domain_id": did})
    step = c.get(f"/api/domains/{did}/usage").json()["steps"][0]
    assert step["title"] == "Query domain"
    assert step["pass_to_spec"] is False


def test_agent_on_a_connected_desktop_plan_says_so():
    c, owner = _fresh()
    did = _domain(c)
    t = _team(owner, "Indicator sprint team")
    _node(t, "completion", "pm", model="xai/grok-4.7", tool_config={"tvashtr": {"domains": [did]}})
    _node(t, "agent", "engineer", 260, model="anthropic/claude-sonnet-5")
    with session_scope() as s:
        s.add(EngineSubscriptionStatus(owner_id=owner, provider="grok", connected=True))
    agents = c.get(f"/api/domains/{did}/agents").json()["agents"]
    assert [(a["title"], a["subscription"], a["scope"]) for a in agents] == [
        ("Product manager", "grok", "this"),
        ("Engineer", None, None),
    ]


def test_use_in_teams_reads_are_owner_scoped():
    c, _ = _fresh()
    did = _domain(c)
    other, _ = _fresh()
    for path in ("usage", "step-places", "agents"):
        resp = other.get(f"/api/domains/{did}/{path}")
        assert resp.status_code == 404, path
        assert resp.json()["detail"] == "domain not found"
    assert other.put(f"/api/domains/{did}/agents", json={"node_ids": []}).status_code == 404


# ---- GET …/step-places (DM-94, OQ-20) ----


def test_step_places_follow_the_main_path():
    c, owner = _fresh()
    did = _domain(c)
    docs = _docs_team(owner)
    loop = _loop_team(owner)
    teams = c.get(f"/api/domains/{did}/step-places").json()["teams"]
    assert [t["name"] for t in teams] == ["Docs team", "Indicator sprint team"]
    assert teams[0]["path"] == ["Product manager", "Writer", "Reviewer"]
    assert teams[0]["places"] == [
        {"after_node_id": str(docs["pm"]), "after": "Product manager", "next": "Writer"},
        {"after_node_id": str(docs["writer"]), "after": "Writer", "next": "Reviewer"},
        {"after_node_id": str(docs["reviewer"]), "after": "Reviewer", "next": "Ship"},
    ]
    # The gate and the reviewer with a verdict have no single way out.
    assert teams[1]["path"] == ["Product manager", "Engineer", "Reviewer"]
    assert [(p["after_node_id"], p["next"]) for p in teams[1]["places"]] == [
        (str(loop["pm"]), "Approval"),
        (str(loop["eng"]), "Reviewer"),
    ]


def test_a_team_with_no_agents_has_no_places():
    c, owner = _fresh()
    did = _domain(c)
    _team(owner, "Empty team")
    [team] = c.get(f"/api/domains/{did}/step-places").json()["teams"]
    assert team["path"] == [] and team["places"] == []


# ---- POST …/steps (DM-94/95) ----


def test_add_step_splits_the_edge_after_the_agent():
    c, owner = _fresh()
    did = _domain(c)
    docs = _docs_team(owner)
    resp = c.post(
        f"/api/domains/{did}/steps",
        json={
            "team_id": str(docs["team"]),
            "after_node_id": str(docs["pm"]),
            "prompt": "  What do our support docs say about {idea}?  ",
            "pass_to_spec": True,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["after"] == {"node_id": str(docs["pm"]), "title": "Product manager"}
    assert body["connected_to"] == {"node_id": str(docs["writer"]), "title": "Writer"}
    assert body["title"] == "Look up support docs"
    new = uuid.UUID(body["node_id"])
    with session_scope() as s:
        node = s.get(AgentNode, new)
        assert node.kind == "domain_query" and node.team_graph_id == docs["team"]
        assert node.prompt == "What do our support docs say about {idea}?"
        assert node.config == {
            "domain_id": did,
            "title": "Look up support docs",
            "pass_to_spec": True,
            "on_no_answer": "continue",
        }
        # The step takes the Writer's column; the Writer and everything after move right.
        assert node.position == {"x": 260, "y": 0}
        assert s.get(AgentNode, docs["writer"]).position["x"] == 520
        assert s.get(AgentNode, docs["pm"]).position["x"] == 0
        assert s.get(Edge, docs["e"]).target_node_id == new
        nodes, edges = graph_dicts(s, docs["team"])
    pairs = {(e["source_node_id"], e["target_node_id"]) for e in edges}
    assert (str(new), str(docs["writer"])) in pairs
    assert validate_graph(nodes, edges)["runnable"] is True
    # The usage tab lists it.
    steps = c.get(f"/api/domains/{did}/usage").json()["steps"]
    assert [s["node_id"] for s in steps] == [str(new)]


def test_add_step_refuses_a_place_with_no_single_way_out():
    c, owner = _fresh()
    did = _domain(c)
    loop = _loop_team(owner)
    for after in (loop["rev"], loop["gate"]):
        resp = c.post(
            f"/api/domains/{did}/steps",
            json={"team_id": str(loop["team"]), "after_node_id": str(after), "prompt": "q"},
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "Pick where the step goes."


def test_add_step_needs_a_question():
    c, owner = _fresh()
    did = _domain(c)
    docs = _docs_team(owner)
    resp = c.post(
        f"/api/domains/{did}/steps",
        json={"team_id": str(docs["team"]), "after_node_id": str(docs["pm"]), "prompt": "  "},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Write the question to ask."


def test_add_step_to_another_accounts_team_is_404():
    c, _ = _fresh()
    did = _domain(c)
    _, stranger = _fresh()
    docs = _docs_team(stranger)
    resp = c.post(
        f"/api/domains/{did}/steps",
        json={"team_id": str(docs["team"]), "after_node_id": str(docs["pm"]), "prompt": "q"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "library team not found"


def test_add_step_for_another_accounts_domain_is_404():
    """Review (missing cross-account test): the caller's own team, a domain that isn't theirs."""
    c, owner = _fresh()
    docs = _docs_team(owner)
    stranger, _ = _fresh()
    theirs = _domain(stranger, "Secret docs")
    resp = c.post(
        f"/api/domains/{theirs}/steps",
        json={"team_id": str(docs["team"]), "after_node_id": str(docs["pm"]), "prompt": "q"},
    )
    assert (resp.status_code, resp.json()["detail"]) == (404, "domain not found")
    with session_scope() as s:
        nodes, _ = graph_dicts(s, docs["team"])
    assert not any(n["kind"] == "domain_query" for n in nodes)


def test_a_run_whose_step_points_at_another_accounts_domain_is_refused(monkeypatch):
    """Review (missing cross-account test): a Query domain step holding another account's domain id
    (set behind the API's back) is refused at launch with the missing-domain finding — no run, no
    workflow, nothing read from that domain."""
    c, owner = _fresh()
    docs = _docs_team(owner)
    mine = _domain(c)
    step = c.post(
        f"/api/domains/{mine}/steps",
        json={"team_id": str(docs["team"]), "after_node_id": str(docs["pm"]), "prompt": "q"},
    ).json()["node_id"]
    stranger, _ = _fresh()
    theirs = _domain(stranger, "Secret docs")
    with session_scope() as s:
        node = s.get(AgentNode, uuid.UUID(step))
        node.config = {**node.config, "domain_id": theirs}
    started: list = []
    monkeypatch.setattr("tvashtr.routers.DBOS.start_workflow", lambda *a, **k: started.append(a))

    resp = c.post("/api/runs", json={"team_graph_id": str(docs["team"]), "idea": "refunds"})
    assert resp.status_code == 422, resp.text
    errors = resp.json()["detail"]["errors"]
    assert [(e["code"], e["node_id"]) for e in errors] == [("domain_query_no_domain", step)]
    assert started == []
    with session_scope() as s:
        assert s.query(Run).filter(Run.owner_id == owner).count() == 0


def test_step_title_keeps_acronyms():
    assert step_title("Support docs") == "Look up support docs"
    assert step_title("Q3 filings") == "Look up Q3 filings"
    assert step_title("API guide") == "Look up API guide"


# ---- GET/PUT …/agents (DM-96/97) ----


def test_give_and_take_access():
    c, owner = _fresh()
    did = _domain(c)
    vendor = _domain(c, "Vendor contracts", "legal")
    t = _team(owner, "Indicator sprint team")
    pm = _node(t, "completion", "pm", tool_config={"tvashtr": {"domains": [vendor]}})
    eng = _node(t, "agent", "engineer", 260)

    resp = c.put(f"/api/domains/{did}/agents", json={"node_ids": [str(pm), str(eng)]})
    assert resp.status_code == 200, resp.text
    assert [a["node_id"] for a in resp.json()["agents"]] == [str(pm), str(eng)]
    with session_scope() as s:
        assert s.get(AgentNode, pm).tool_config["tvashtr"]["domains"] == [vendor, did]
        assert s.get(AgentNode, eng).tool_config["tvashtr"]["domains"] == [did]

    resp = c.put(f"/api/domains/{did}/agents", json={"node_ids": [str(eng)]})
    assert [a["node_id"] for a in resp.json()["agents"]] == [str(eng)]
    with session_scope() as s:
        assert s.get(AgentNode, pm).tool_config["tvashtr"]["domains"] == [vendor]


def test_taking_access_from_an_all_domains_agent_keeps_the_others():
    c, owner = _fresh()
    did = _domain(c)
    vendor = _domain(c, "Vendor contracts", "legal")
    t = _team(owner, "Support bot")
    rev = _node(t, "agent", "reviewer", tool_config={"tvashtr": {"domains": True}, "x": 1})
    resp = c.put(f"/api/domains/{did}/agents", json={"node_ids": []})
    assert resp.json()["agents"] == []
    with session_scope() as s:
        tool_config = s.get(AgentNode, rev).tool_config
    assert tool_config == {"tvashtr": {"domains": [vendor]}, "x": 1}


def test_giving_access_to_another_accounts_agent_is_404():
    c, _ = _fresh()
    did = _domain(c)
    _, stranger = _fresh()
    theirs = _node(_team(stranger, "Theirs"), "agent", "engineer")
    resp = c.put(f"/api/domains/{did}/agents", json={"node_ids": [str(theirs)]})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Agent not found."


# ---- The run side: per-domain access reaches the Domains MCP ----


def _owned_run(owner: uuid.UUID) -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as s:
        t = TeamGraph(name="r", is_library=False, owner_id=owner)
        s.add(t)
        s.flush()
        s.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=t.id,
                owner_id=owner,
                idea="x",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def test_a_domain_list_sends_the_allowlist_header():
    _, owner = _fresh()
    run_id = _owned_run(owner)
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    out = build_mcp_config({"tvashtr": {"domains": [a, b]}}, run_id)
    headers = out["mcpServers"]["tvashtr-domains"]["headers"]
    assert headers[DOMAINS_HEADER] == f"{a},{b}"
    # The legacy switch still means every domain: no header.
    out = build_mcp_config({"tvashtr": {"domains": True}}, run_id)
    assert DOMAINS_HEADER not in out["mcpServers"]["tvashtr-domains"]["headers"]
    # An emptied list gives no Domains tools at all.
    out = build_mcp_config({"tvashtr": {"domains": []}}, run_id)
    assert "tvashtr-domains" not in out["mcpServers"]


def test_tools_find_the_domain_by_name_within_the_allowlist():
    c, owner = _fresh()
    support = _domain(c)
    vendor = _domain(c, "Vendor contracts", "legal")
    _domain(c, "Research papers", "scientific")
    allowed = {support, vendor}
    assert resolve_domain_ref(owner, "support DOCS", allowed) == support
    assert resolve_domain_ref(owner, vendor.upper(), allowed) == vendor
    assert resolve_domain_ref(owner, "Support docs", None) == support
    with pytest.raises(DomainMcpToolError) as ei:
        resolve_domain_ref(owner, "Research papers", allowed)
    assert ei.value.message == "Domains you can search: Support docs, Vendor contracts."
    # With one domain to search, the name may be left out.
    assert resolve_domain_ref(owner, "", {support}) == support
    with pytest.raises(DomainMcpToolError) as ei:
        resolve_domain_ref(owner, "", set())
    assert ei.value.message == "You can’t search any domains."


def test_allowlist_header_parses_ids():
    a = str(uuid.uuid4())
    assert domain_mcp.allowed_domains(None) is None
    assert domain_mcp.allowed_domains(f" {a.upper()} ,") == {a}


def test_ask_tool_uses_the_resolved_domain():
    c, owner = _fresh()
    support = _domain(c)
    fake = {"answer": "30 days", "citations": [], "latency_ms": 1, "model": "m", "message_id": None}
    with patch("tvashtr.control_plane.domain_mcp.ask_domain", return_value=fake) as ask:
        did = resolve_domain_ref(owner, "Support docs", {support})
        domain_mcp.run_domain_ask_tool(owner, did, "Refunds?")
    assert str(ask.call_args.args[1]) == support


def test_the_tool_list_names_the_domains_the_agent_can_search(monkeypatch):
    """DM-96/106: an agent is told which domains it can search, by name, when it lists its tools
    — so it picks one without a failed call first."""
    import asyncio
    from types import SimpleNamespace

    from starlette.requests import Request

    from tvashtr.auth import SESSION_COOKIE_NAME, make_session_cookie_value

    c, owner = _fresh()
    support = _domain(c)
    _domain(c, "Vendor contracts", "legal")
    cookie = f"{SESSION_COOKIE_NAME}={make_session_cookie_value(str(owner))}"

    def ctx(headers: dict) -> SimpleNamespace:
        raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
        return SimpleNamespace(
            request_context=SimpleNamespace(request=Request({"type": "http", "headers": raw}))
        )

    mcp = domain_mcp.create_domains_fastmcp()
    monkeypatch.setattr(
        mcp, "get_context", lambda: ctx({"cookie": cookie, DOMAINS_HEADER: support})
    )
    tools = asyncio.run(mcp.list_tools())
    assert {t.name for t in tools} == {"domain_ask", "domain_retrieve"}
    assert all(t.description.endswith("\n\nDomains you can search: Support docs.") for t in tools)
    # The legacy switch (no header) searches every domain.
    monkeypatch.setattr(mcp, "get_context", lambda: ctx({"cookie": cookie}))
    tools = asyncio.run(mcp.list_tools())
    assert all(
        t.description.endswith("Domains you can search: Support docs, Vendor contracts.")
        for t in tools
    )
    # No session (a stdio debug run): the plain descriptions.
    monkeypatch.setattr(mcp, "get_context", lambda: ctx({}))
    assert all("Domains you can search" not in t.description for t in asyncio.run(mcp.list_tools()))


def test_a_foreign_domain_in_the_allowlist_header_is_not_usable(monkeypatch):
    """Review (missing cross-account test): another account's domain id in the agent's
    ``X-Tvashtr-Domains`` header is never searched — by id or by name, with either tool."""
    import asyncio
    from types import SimpleNamespace

    from starlette.requests import Request

    from tvashtr.auth import SESSION_COOKIE_NAME, make_session_cookie_value

    c, owner = _fresh()
    _domain(c)
    stranger, _ = _fresh()
    theirs = _domain(stranger, "Secret docs")
    cookie = f"{SESSION_COOKIE_NAME}={make_session_cookie_value(str(owner))}"
    raw = [(b"cookie", cookie.encode()), (DOMAINS_HEADER.lower().encode(), theirs.encode())]
    ctx = SimpleNamespace(
        request_context=SimpleNamespace(request=Request({"type": "http", "headers": raw}))
    )
    mcp = domain_mcp.create_domains_fastmcp()
    monkeypatch.setattr(mcp, "get_context", lambda: ctx)
    used: list = []
    monkeypatch.setattr(domain_mcp, "ask_domain", lambda *a, **k: used.append(a))
    monkeypatch.setattr(domain_mcp, "retrieve_domain", lambda *a, **k: used.append(a))

    for tool, args in (("domain_ask", {"question": "q"}), ("domain_retrieve", {"query": "q"})):
        for ref in ({"domain_id": theirs}, {"domain": "Secret docs"}, {}):
            with pytest.raises(Exception) as ei:
                asyncio.run(mcp.call_tool(tool, {**args, **ref}))
            assert "You can’t search any domains." in str(ei.value)
    assert used == []
    tools = asyncio.run(mcp.list_tools())
    assert all(t.description.endswith("You can’t search any domains.") for t in tools)
