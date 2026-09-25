"""B-TOOLKIT — ``GET /api/toolkit/summary`` and ``GET /api/agents`` (who uses a tool or skill)."""

import uuid

from toolkit_helpers import fresh_account, make_node, make_team

from tvashtr.control_plane import node_library
from tvashtr.control_plane.mcp_secrets import set_owner_mcp_secret
from tvashtr.db import session_scope
from tvashtr.models import NodeMemory

# ---------------------------------------------------------------- GET /api/toolkit/summary


def test_summary_is_all_zero_for_a_fresh_account():
    c, _ = fresh_account()
    resp = c.get("/api/toolkit/summary")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "tools": 0,
        "tools_needing_attention": 0,
        "skills": 0,
        "memory": {"inbox": 0, "active": 0, "archive": 0},
        "secrets_missing": 0,
    }


def test_summary_counts_tools_attention_skills_memory_and_missing_secrets():
    c, owner = fresh_account()
    other_c, other = fresh_account()
    set_owner_mcp_secret(owner, "GITHUB_TOKEN", "v")
    node_library.create_owner_tool(owner, "fetch", {"command": "uvx", "args": ["mcp-server-fetch"]})
    node_library.create_owner_tool(
        owner,
        "github",
        {"url": "https://api.githubcopilot.com/mcp/", "headers": {"A": "Bearer ${GITHUB_TOKEN}"}},
    )
    node_library.create_owner_tool(
        owner, "linear", {"url": "https://mcp.linear.app", "headers": {"A": "${LINEAR_TOKEN}"}}
    )
    node_library.create_owner_tool(
        owner, "jira", {"command": "npx", "env": {"T": "${LINEAR_TOKEN}", "U": "${JIRA_USER}"}}
    )
    node_library.create_owner_tool(owner, "broken", {"args": ["x"]})  # no command or URL
    node_library.create_owner_skill(owner, "house-style", {"type": "inline", "name": "h"})
    # another account's items never count
    node_library.create_owner_tool(other, "x", {"command": "x", "env": {"T": "${NOPE}"}})
    with session_scope() as session:
        for status in (
            "pending_review",
            "pending_review",
            "active",
            "active",
            "active",
            "superseded",
            "rejected",
        ):
            session.add(NodeMemory(owner_id=owner, content=f"m {status}", status=status))
        session.add(NodeMemory(owner_id=other, content="other", status="pending_review"))

    body = c.get("/api/toolkit/summary").json()
    assert body == {
        "tools": 5,
        "tools_needing_attention": 3,  # linear, jira (missing secrets) + broken (no command/URL)
        "skills": 1,
        "memory": {"inbox": 2, "active": 3, "archive": 2},
        "secrets_missing": 2,  # LINEAR_TOKEN, JIRA_USER (distinct names)
    }
    assert other_c.get("/api/toolkit/summary").json()["tools"] == 1


# ---------------------------------------------------------------- GET /api/agents


def _two_teams(owner: uuid.UUID, tool_id: uuid.UUID, tool_name: str) -> dict:
    """Indicator sprint team (PM, Engineer, Reviewer + a gate) and Docs team (Writer), plus a
    run-snapshot clone that references the tool (must never count)."""
    t1 = make_team(owner, "Indicator sprint team")
    t2 = make_team(owner, "Docs team")
    lib = {"tvashtr": {"library": [str(tool_id)]}}
    ids = {
        # created out of canvas order: the listing sorts by position.x
        "reviewer": make_node(t1, "Reviewer", kind="completion", x=300, tool_config=lib),
        "pm": make_node(
            t1,
            "Product manager",
            kind="completion",
            x=0,
            config={"title": "Planner"},
            edits_allowed=False,
        ),
        "engineer": make_node(
            t1,
            "Engineer",
            x=150,
            tool_config={
                "tvashtr": {
                    "library": [str(tool_id)],
                    "servers": {tool_name: {"enabled": False}},
                }
            },
        ),
        "writer": make_node(
            t2,
            "Writer",
            tool_config={
                "mcpServers": {tool_name: {"command": "inline"}},
                "tvashtr": {"library": [str(tool_id)]},
            },
        ),
    }
    make_node(t1, "Approve", kind="gate", x=400)
    clone = make_team(None, "clone", library=False)
    make_node(clone, "Reviewer", tool_config=lib)
    return {"t1": t1, "t2": t2, **ids}


def test_agents_lists_library_agents_grouped_by_team_with_tool_state():
    c, owner = fresh_account()
    tid = node_library.create_owner_tool(owner, "linear", {"url": "https://mcp.linear.app"})
    ids = _two_teams(owner, tid, "linear")

    resp = c.get(f"/api/agents?tool_id={tid}")
    assert resp.status_code == 200, resp.text
    teams = resp.json()["teams"]
    assert [t["team_name"] for t in teams] == ["Indicator sprint team", "Docs team"]
    assert teams[0]["team_id"] == str(ids["t1"])
    first = teams[0]["agents"]
    assert [a["role_name"] for a in first] == ["Product manager", "Engineer", "Reviewer"]
    by_role = {a["role_name"]: a for a in first + teams[1]["agents"]}
    assert by_role["Product manager"] == {
        "node_id": str(ids["pm"]),
        "role_name": "Product manager",
        "title": "Planner",
        "kind": "completion",
        "edits_allowed": False,
        "enabled": False,
        "overridden": False,
    }
    assert by_role["Reviewer"]["enabled"] is True
    assert by_role["Engineer"]["enabled"] is False  # referenced but switched off
    assert by_role["Writer"]["enabled"] is False  # an inline server of the same name wins
    assert by_role["Writer"]["overridden"] is True


def test_agents_without_a_filter_lists_every_agent_disabled():
    c, owner = fresh_account()
    tid = node_library.create_owner_tool(owner, "linear", {"url": "https://mcp.linear.app"})
    _two_teams(owner, tid, "linear")
    teams = c.get("/api/agents").json()["teams"]
    agents = [a for t in teams for a in t["agents"]]
    assert len(agents) == 4
    assert all(a["enabled"] is False and a["overridden"] is False for a in agents)


def test_agents_skill_state_includes_the_per_agent_mode_override():
    c, owner = fresh_account()
    sid = node_library.create_owner_skill(
        owner,
        "house-style",
        {"type": "inline", "name": "house-style", "content": "x", "mode": "always"},
    )
    team = make_team(owner, "T")
    make_node(
        team,
        "Reviewer",
        x=0,
        skills=[{"type": "library", "id": str(sid), "mode": "trigger", "triggers": ["auth"]}],
    )
    make_node(team, "Engineer", x=10, skills=[{"type": "library", "id": str(sid)}])
    make_node(
        team,
        "Writer",
        x=20,
        skills=[{"type": "inline", "name": "house-style", "content": "mine", "mode": "always"}],
    )
    agents = c.get(f"/api/agents?skill_id={sid}").json()["teams"][0]["agents"]
    by_role = {a["role_name"]: a for a in agents}
    assert by_role["Reviewer"]["enabled"] is True
    assert by_role["Reviewer"]["mode"] == "trigger"
    assert by_role["Reviewer"]["triggers"] == ["auth"]
    assert by_role["Engineer"]["enabled"] is True and by_role["Engineer"]["mode"] is None
    assert by_role["Writer"]["enabled"] is False
    assert by_role["Writer"]["overridden"] is True  # an inline skill of the same name wins


def test_agents_is_owner_scoped_and_validates_the_query():
    c, owner = fresh_account()
    other_c, other = fresh_account()
    foreign_tool = node_library.create_owner_tool(other, "x", {"command": "x"})
    foreign_skill = node_library.create_owner_skill(other, "y", {"type": "inline"})
    make_node(make_team(other, "Theirs"), "Engineer")
    assert c.get("/api/agents").json() == {"teams": []}  # another account's teams are invisible
    for query in (f"tool_id={foreign_tool}", f"skill_id={foreign_skill}", "tool_id=not-a-uuid"):
        assert c.get(f"/api/agents?{query}").status_code == 404, query
    mine = node_library.create_owner_tool(owner, "x", {"command": "x"})
    resp = c.get(f"/api/agents?tool_id={mine}&skill_id={foreign_skill}")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Pass tool_id or skill_id, not both."
    assert len(other_c.get("/api/agents").json()["teams"]) == 1


def test_toolkit_routes_require_a_session(unauth_client):
    assert unauth_client.get("/api/toolkit/summary").status_code == 401
    assert unauth_client.get("/api/agents").status_code == 401
