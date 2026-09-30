"""Connectors: per-agent grants (B1.6): ``GET`` and ``PUT /api/connectors/{id}/agents``."""

import uuid

from connector_helpers import add_connection, connection_row, grant
from toolkit_helpers import fresh_account, make_node, make_team, node_row

from tvashtr.db import session_scope
from tvashtr.models import AgentNode, EngineSubscriptionStatus

NOT_FOUND = {"detail": "Connector not found."}


def _teams(owner: uuid.UUID, cid: str, other: str | None = None) -> dict:
    """Two library teams and a run-snapshot clone. In the sprint team the PM has the grant (no
    access named), the Engineer has it with ``write`` and the Reviewer has another connection's."""
    sprint = make_team(owner, "Indicator sprint team")
    docs = make_team(owner, "Docs team")
    clone = make_team(owner, "Run snapshot", library=False)
    return {
        "sprint": sprint,
        "docs": docs,
        # Created right to left, so the order asserted is by canvas position.
        "reviewer": make_node(
            sprint,
            "Reviewer",
            x=520,
            tool_config=grant(other) if other else None,
            edits_allowed=False,
        ),
        "gate": make_node(sprint, "Approve", kind="gate", x=400, tool_config=grant(cid)),
        "engineer": make_node(
            sprint,
            "Engineer",
            x=260,
            tool_config=grant(cid, "write"),
            config={"title": "Eng"},
            edits_allowed=True,
        ),
        "pm": make_node(sprint, "PM", kind="completion", x=0, tool_config=grant(cid)),
        "writer": make_node(docs, "Writer", x=0),
        "clone": make_node(clone, "PM", x=0, tool_config=grant(cid, "write")),
    }


def _put(client, cid, *node_ids):
    return client.put(
        f"/api/connectors/{cid}/agents", json={"node_ids": [str(n) for n in node_ids]}
    )


# ---- GET ----


def test_get_agents_lists_the_library_teams_agents_and_who_has_the_grant():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", access="write")
    n = _teams(owner, cid, add_connection(owner, "linear"))

    resp = c.get(f"/api/connectors/{cid}/agents")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "teams": [
            {
                "team_id": str(n["sprint"]),
                "team_name": "Indicator sprint team",
                "agents": [
                    {
                        "node_id": str(n["pm"]),
                        "role_name": "PM",
                        "title": None,
                        "kind": "completion",
                        "edits_allowed": False,
                        "enabled": True,
                        "access": "read",  # a grant that names no access reads
                        "subscription": None,
                    },
                    {
                        "node_id": str(n["engineer"]),
                        "role_name": "Engineer",
                        "title": "Eng",
                        "kind": "agent",
                        "edits_allowed": True,
                        "enabled": True,
                        "access": "write",
                        "subscription": None,
                    },
                    {
                        "node_id": str(n["reviewer"]),
                        "role_name": "Reviewer",
                        "title": None,
                        "kind": "agent",
                        "edits_allowed": False,
                        "enabled": False,  # it has another connection, not this one
                        "access": None,
                        "subscription": None,
                    },
                ],
            },
            {
                "team_id": str(n["docs"]),
                "team_name": "Docs team",
                "agents": [
                    {
                        "node_id": str(n["writer"]),
                        "role_name": "Writer",
                        "title": None,
                        "kind": "agent",
                        "edits_allowed": True,  # an agent's default
                        "enabled": False,
                        "access": None,
                        "subscription": None,
                    }
                ],
            },
        ]
    }  # no gate, no run snapshot


def test_get_agents_access_is_the_grants_own_even_on_a_read_only_connection():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")  # access read
    _teams(owner, cid)
    agents = c.get(f"/api/connectors/{cid}/agents").json()["teams"][0]["agents"]
    assert [(a["role_name"], a["access"]) for a in agents] == [
        ("PM", "read"),
        ("Engineer", "write"),  # the grant's access; the effective one is in the usage rows
        ("Reviewer", None),
    ]
    used = c.get(f"/api/connectors/{cid}").json()["used_by_agents"]
    assert [(u["role_name"], u["access"]) for u in used] == [("PM", "read"), ("Engineer", "read")]


def test_get_agents_marks_agents_on_a_connected_desktop_plan():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")
    team = make_team(owner, "Team")
    models = {"Claude": "anthropic/claude-sonnet-5", "Grok": "xai/grok-4.7", "Open": "openrouter/x"}
    for x, (role, model) in enumerate(models.items()):
        nid = make_node(team, role, x=x)
        with session_scope() as s:
            s.get(AgentNode, nid).model = model

    def subscriptions() -> list:
        agents = c.get(f"/api/connectors/{cid}/agents").json()["teams"][0]["agents"]
        return [(a["role_name"], a["subscription"]) for a in agents]

    assert subscriptions() == [("Claude", None), ("Grok", None), ("Open", None)]
    with session_scope() as s:
        s.add(EngineSubscriptionStatus(owner_id=owner, provider="grok", connected=True))
        s.add(EngineSubscriptionStatus(owner_id=owner, provider="claude", connected=False))
    # Only a plan that is connected: connectors don't reach those agents yet.
    assert subscriptions() == [("Claude", None), ("Grok", "grok"), ("Open", None)]


def test_get_agents_with_no_teams_and_for_a_pending_connection():
    c, owner = fresh_account()
    pending = add_connection(owner, "supabase", status="pending")
    assert c.get(f"/api/connectors/{pending}/agents").json() == {"teams": []}


# ---- PUT ----


def test_put_agents_is_the_full_set_new_ones_read_kept_ones_keep_their_access():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", access="write")
    other = add_connection(owner, "linear")
    n = _teams(owner, cid, other)

    resp = _put(c, cid, n["engineer"], n["reviewer"], n["writer"])  # the PM is not listed
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["agent_count"], body["team_count"]) == (3, 2)
    assert [
        (u["node_id"], u["role_name"], u["team_name"], u["access"]) for u in body["agents"]
    ] == [
        (str(n["engineer"]), "Engineer", "Indicator sprint team", "write"),  # kept its write
        (str(n["reviewer"]), "Reviewer", "Indicator sprint team", "read"),  # new: read
        (str(n["writer"]), "Writer", "Docs team", "read"),
    ]
    assert set(body["agents"][0]) == {
        "node_id",
        "role_name",
        "title",
        "team_id",
        "team_name",
        "access",
    }

    assert node_row(n["pm"]).tool_config is None  # lost it, and nothing else was there
    assert node_row(n["engineer"]).tool_config == grant(cid, "write")  # untouched
    # The Reviewer keeps its other connection and gains this one.
    assert node_row(n["reviewer"]).tool_config == {
        "tvashtr": {"connectors": [{"id": other}, {"id": cid, "access": "read"}]}
    }
    assert node_row(n["writer"]).tool_config == {
        "tvashtr": {"connectors": [{"id": cid, "access": "read"}]}
    }
    # A gate can't use a connector and a run snapshot is run history: neither is rewritten.
    assert node_row(n["gate"]).tool_config == grant(cid)
    assert node_row(n["clone"]).tool_config == grant(cid, "write")

    # The counts everywhere else follow.
    assert c.get(f"/api/connectors/{cid}").json()["used_by"] == {"agent_count": 3, "team_count": 2}
    enabled = [
        a["role_name"]
        for t in c.get(f"/api/connectors/{cid}/agents").json()["teams"]
        for a in t["agents"]
        if a["enabled"]
    ]
    assert enabled == ["Engineer", "Reviewer", "Writer"]

    # The empty set takes it from everyone, and leaves other grants and tools alone.
    assert _put(c, cid).json() == {"agents": [], "agent_count": 0, "team_count": 0}
    assert node_row(n["engineer"]).tool_config is None
    assert node_row(n["reviewer"]).tool_config == grant(other)
    assert node_row(n["writer"]).tool_config is None


def test_put_agents_keeps_the_rest_of_the_tool_config():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")
    team = make_team(owner, "Team")
    config = {
        "mcpServers": {"fetch": {"command": "uvx"}},
        "tvashtr": {"library": ["11111111-1111-1111-1111-111111111111"], "domains": ["d1"]},
    }
    node = make_node(team, "PM", tool_config=config)
    _put(c, cid, node)
    assert node_row(node).tool_config == {
        "mcpServers": {"fetch": {"command": "uvx"}},
        "tvashtr": {
            "library": ["11111111-1111-1111-1111-111111111111"],
            "domains": ["d1"],
            "connectors": [{"id": cid, "access": "read"}],
        },
    }
    _put(c, cid, node)  # listed again: nothing changes
    assert len(node_row(node).tool_config["tvashtr"]["connectors"]) == 1
    _put(c, cid)
    assert node_row(node).tool_config == config


def test_put_agents_the_effective_access_is_read_on_a_read_only_connection():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")  # access read
    n = _teams(owner, cid)
    body = _put(c, cid, n["engineer"]).json()
    assert [(u["role_name"], u["access"]) for u in body["agents"]] == [("Engineer", "read")]
    assert node_row(n["engineer"]).tool_config == grant(cid, "write")  # the grant itself is kept


def test_put_agents_a_foreign_or_unknown_agent_is_404_and_nothing_is_written():
    c, owner = fresh_account()
    _, other = fresh_account()
    cid = add_connection(owner, "supabase")
    n = _teams(owner, cid)
    theirs = make_node(make_team(other, "Theirs"), "PM")
    before = {key: node_row(n[key]).tool_config for key in ("pm", "engineer", "reviewer", "writer")}

    for bad in (theirs, n["gate"], n["clone"], uuid.uuid4(), "not-a-uuid"):
        resp = _put(c, cid, n["writer"], bad)  # a good id next to it is not written either
        assert (resp.status_code, resp.json()) == (404, {"detail": "Agent not found."})
    assert {key: node_row(n[key]).tool_config for key in before} == before
    assert node_row(theirs).tool_config is None


def test_agents_routes_are_404_for_another_accounts_connection(unauth_client):
    c, owner = fresh_account()
    other_c, other = fresh_account()
    cid = add_connection(owner, "supabase")
    n = _teams(owner, cid)
    mine = make_node(make_team(other, "Mine"), "PM")  # the other account's own agent
    before = node_row(n["pm"]).tool_config

    for missing in (cid, uuid.uuid4(), "not-a-uuid"):
        resp = other_c.get(f"/api/connectors/{missing}/agents")
        assert (resp.status_code, resp.json()) == (404, NOT_FOUND)
        resp = _put(other_c, missing, mine)
        assert (resp.status_code, resp.json()) == (404, NOT_FOUND)
    assert node_row(mine).tool_config is None and node_row(n["pm"]).tool_config == before
    assert connection_row(cid) is not None

    assert unauth_client.get(f"/api/connectors/{cid}/agents").status_code == 401
    assert (
        unauth_client.put(f"/api/connectors/{cid}/agents", json={"node_ids": []}).status_code == 401
    )


def test_put_agents_on_a_pending_connection_is_not_connected():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", status="pending")
    node = make_node(make_team(owner, "Team"), "PM")
    resp = _put(c, cid, node)
    assert resp.status_code == 409, resp.text
    assert resp.json() == {
        "detail": {"code": "not_connected", "message": "Finish connecting Supabase first."}
    }
    assert node_row(node).tool_config is None

    # A connection that needs a sign-in can still be given and taken away.
    expired = add_connection(owner, "notion", status="needs_signin")
    assert _put(c, expired, node).json()["agent_count"] == 1


def test_put_agents_needs_a_list_of_ids():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")
    assert c.put(f"/api/connectors/{cid}/agents", json={}).status_code == 422
    assert c.put(f"/api/connectors/{cid}/agents", json={"node_ids": "x"}).status_code == 422
