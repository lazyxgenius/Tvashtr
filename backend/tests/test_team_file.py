"""M4 — the team file (``tvashtr_team: 1``): export → import → export round-trips (bar the ids and
the name), a secret-bearing tool config never leaks a value, the import check's cases, the errors
naming their line, and owner scope."""

import json
import uuid

import pytest
import yaml
from home_fixtures import fresh_account
from sqlalchemy import select, update

from tvashtr.config import get_settings
from tvashtr.control_plane.mcp_secrets import set_owner_mcp_secret
from tvashtr.control_plane.node_library import create_owner_skill, create_owner_tool
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, ConnectorConnection, Run, TeamGraph

TEMPLATES = ["blank", "two_node", "review_loop", "plan_review", "full_squad", "spec_only"]


def _team(c, template="review_loop", name="Indicator sprint team") -> str:
    resp = c.post("/api/teams", json={"template": template, "name": name})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["team_graph_id"]


def _file(c, team_id: str, fmt="yaml") -> dict:
    resp = c.get(f"/api/teams/{team_id}/file", params={"format": fmt})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _import(c, content: str, name: str | None = None) -> dict:
    body = {"content": content} if name is None else {"content": content, "name": name}
    resp = c.post("/api/teams/import", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _bar_name(content: str) -> dict:
    data = yaml.safe_load(content)
    data.pop("name")
    return data


@pytest.mark.parametrize("template", TEMPLATES)
def test_export_import_export_round_trips_every_template(template):
    c, _ = fresh_account("tf-rt")
    team = _team(c, template)
    first = _file(c, team)
    assert first["filename"] == "indicator-sprint-team.yaml"
    assert yaml.safe_load(first["content"])["tvashtr_team"] == 1
    imported = _import(c, first["content"])
    assert imported["name"] == "Indicator sprint team (copy)"
    second = _file(c, imported["team_graph_id"])
    assert _bar_name(second["content"]) == _bar_name(first["content"])
    # JSON says the same.
    as_json = json.loads(_file(c, team, "json")["content"])
    assert as_json == yaml.safe_load(first["content"])


def _node(team_id: str, role: str) -> AgentNode:
    with session_scope() as session:
        node = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(team_id), AgentNode.role_name == role
            )
        ).scalar_one()
        session.expunge(node)
        return node


def _rich_team(c, owner) -> tuple[str, list[str]]:
    """A team using a Toolkit tool (with a ${SECRET}), a Toolkit skill, an inline server with
    literal secret values, an inline skill, a connector, a backup model, a budget and a repo."""
    team = _team(c)
    secret_values = [
        "sk-live-INLINE-HEADER-0001",
        "inline-env-secret-0002",
        "querytoken0003",
        "ghp_LibraryTokenValue0004",
    ]
    set_owner_mcp_secret(owner, "GITHUB_TOKEN", secret_values[3])
    tool = create_owner_tool(
        owner,
        "chart-render",
        {
            "url": "https://charts.example.com/mcp",
            "headers": {"Authorization": "Bearer ${GITHUB_TOKEN}"},
        },
    )
    skill = create_owner_skill(
        owner, "pytest", {"type": "inline", "name": "pytest", "content": "run pytest"}
    )
    with session_scope() as session:
        conn = ConnectorConnection(
            owner_id=owner,
            connector_key="notion",
            name="Notion",
            slug="notion",
            url="https://mcp.notion.com/mcp",
            auth_kind="oauth",
            status="connected",
            secret_encrypted="encrypted-sign-in",
        )
        session.add(conn)
        session.flush()
        conn_id = conn.id
        eng = _node(team, "engineer")
        session.execute(
            update(AgentNode)
            .where(AgentNode.id == eng.id)
            .values(
                tool_config={
                    "mcpServers": {
                        "private-api": {
                            "url": f"https://api.example.com/mcp?token={secret_values[2]}",
                            "headers": {"Authorization": f"Bearer {secret_values[0]}"},
                            "env": {"API_KEY": secret_values[1], "OTHER": "${OTHER_SECRET}"},
                            "args": ["--key", secret_values[1]],
                        }
                    },
                    "tvashtr": {
                        "library": [str(tool)],
                        "connectors": [{"id": str(conn_id), "access": "write"}],
                    },
                },
                skills=[
                    {"type": "library", "id": str(skill), "mode": "always"},
                    {"type": "inline", "name": "house-style", "content": "Use the house style."},
                ],
                config={**(eng.config or {}), "fallback_model": "openai/gpt-4.1-mini"},
            )
        )
        session.execute(
            update(TeamGraph)
            .where(TeamGraph.id == uuid.UUID(team))
            .values(budget_usd=5, repo="lazyxgenius/trade_mcp")
        )
    return team, secret_values


def test_a_secret_bearing_tool_config_never_exports_a_value(client):
    c, owner = fresh_account("tf-secret")
    team, values = _rich_team(c, owner)
    for fmt in ("yaml", "json"):
        reply = _file(c, team, fmt)
        for value in values + ["encrypted-sign-in"]:
            assert value not in reply["content"], (fmt, value)
        data = yaml.safe_load(reply["content"])
        assert data["needs"] == {
            "connectors": ["github", "notion"],
            "secrets": ["GITHUB_TOKEN", "OTHER_SECRET"],
        }
        engineer = next(a for a in data["agents"] if a["id"] == "engineer")
        assert engineer["tools"] == ["chart-render", "private-api"]
        assert engineer["skills"] == [
            {"name": "pytest", "mode": "always"},
            {"name": "house-style", "inline": "Use the house style."},
        ]
        assert engineer["connectors"] == [{"connector": "notion", "access": "write"}]
        assert engineer["backup_model"] == "openai/gpt-4.1-mini"
        assert (data["budget_usd"], data["repo"]) == (5.0, "lazyxgenius/trade_mcp")


def test_a_rich_team_round_trips_in_its_own_account(client):
    c, owner = fresh_account("tf-rich")
    team, _values = _rich_team(c, owner)
    first = _bar_name(_file(c, team)["content"])
    imported = _import(c, _file(c, team)["content"])
    second = _bar_name(_file(c, imported["team_graph_id"])["content"])
    # The inline server can't come back (its definition never leaves); everything else does.
    for data in (first, second):
        engineer = next(a for a in data["agents"] if a["id"] == "engineer")
        engineer["tools"] = [t for t in engineer["tools"] if t != "private-api"]
        data["needs"]["secrets"] = [s for s in data["needs"]["secrets"] if s != "OTHER_SECRET"]
    assert second == first
    # And the existing team is untouched.
    assert _file(c, team)["content"].count("private-api") >= 1


def test_the_check_says_what_another_account_must_fix(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    a, owner_a = fresh_account("tf-a")
    team, _ = _rich_team(a, owner_a)
    content = _file(a, team)["content"]
    content = content.replace("tvashtr_team: 1\n", "tvashtr_team: 1\ncolour: teal\n")
    b, _owner_b = fresh_account("tf-b")
    reply = b.post(
        "/api/teams/import-check",
        json={"content": content, "filename": "indicator-sprint-team.yaml"},
    ).json()
    assert reply["ok"] is True and reply["error"] is None
    assert reply["name"] == "Indicator sprint team (copy)"
    keys = {r["key"]: r for r in reply["checks"]}
    assert keys["shape"]["title"].startswith("3 agents, 2 gates and ")
    assert keys["connector:github"]["title"] == "GitHub isn’t signed in here"
    assert keys["connector:notion"]["title"] == "Notion isn’t signed in here"
    assert keys["tool:chart-render"]["title"] == "The tool chart-render isn’t in your Toolkit"
    assert keys["tool:chart-render"]["code"] == ["chart-render"]
    assert keys["skill:pytest"]["tone"] == "warn"
    assert keys["secrets"]["title"] == "No secrets inside the file"
    assert "GITHUB_TOKEN" in keys["secrets"]["detail"]
    assert keys["secret:GITHUB_TOKEN"]["fix"] is True
    assert keys["unknown"]["detail"] == "colour" and keys["unknown"]["fix"] is False
    # B's account has no provider keys: every model needs one.
    assert any(k.startswith("model:") for k in keys)
    assert reply["fixes"] == sum(1 for r in reply["checks"] if r["fix"])
    # Nothing changed: B has no new team.
    assert all("copy" not in t["name"] for t in b.get("/api/teams").json()["teams"])


def test_import_creates_a_new_team_with_its_fixes(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    a, owner_a = fresh_account("tf-imp-a")
    team, _ = _rich_team(a, owner_a)
    b, owner_b = fresh_account("tf-imp-b")
    reply = _import(b, _file(a, team)["content"], name="Imported squad")
    assert reply["name"] == "Imported squad"
    fixes = {f["key"]: f for f in reply["fixes"]}
    assert fixes["connector:github"]["text"] == "Sign in to GitHub"
    assert fixes["connector:github"]["action"] == "sign_in"
    assert fixes["tool:chart-render"]["text"] == "Add chart-render or remove it"
    assert fixes["tool:chart-render"]["action"] == "open_toolkit"
    engineer = _node(reply["team_graph_id"], "engineer")
    assert str(engineer.id) in fixes["tool:chart-render"]["node_ids"]
    assert reply["note"] == (
        "You can run the team now. It can’t open a pull request until GitHub is signed in."
    )
    with session_scope() as session:
        new = session.get(TeamGraph, uuid.UUID(reply["team_graph_id"]))
        assert new.owner_id == owner_b and new.is_library and new.repo == "lazyxgenius/trade_mcp"
    # A's team is A's, untouched; nothing of A's sign-ins reached B.
    assert engineer.tool_config is None or "connectors" not in (engineer.tool_config or {}).get(
        "tvashtr", {}
    )


@pytest.mark.parametrize(
    ("content", "line", "message"),
    [
        ("name: x\nagents: [\n", 3, "this isn’t valid YAML or JSON"),
        ("name: Team\nagents: []\n", 1, "this isn’t a Tvashtr team file"),
        ("tvashtr_team: 2\nname: Team\n", 1, "this file is format 2"),
        ("tvashtr_team: 1\nname: Team\nagents: nope\n", 3, "`agents` should be a list of agents."),
        (
            "tvashtr_team: 1\nname: Team\nagents:\n  - id: pm\n    model: openai/gpt-4.1-mini\n"
            "routes:\n  - {from: pm, to: ghost}\n",
            7,
            "the route’s `to` names `ghost`",
        ),
        (
            "tvashtr_team: 1\nname: Team\nagents:\n  - id: pm\n    model: m\n"
            "  - id: pm\n    model: m\n",
            6,
            "the id `pm` is used twice",
        ),
        ('{"tvashtr_team": 1, "name": "", "agents": []}', 1, "`name` should be the team’s name."),
    ],
)
def test_a_file_that_cant_be_imported_names_its_line(client, content, line, message):
    c, _ = fresh_account("tf-err")
    reply = c.post("/api/teams/import-check", json={"content": content}).json()
    assert reply["ok"] is False and reply["error"]["line"] == line, reply
    assert message in reply["error"]["message"]
    resp = c.post("/api/teams/import", json={"content": content})
    assert resp.status_code == 422 and resp.json()["detail"]["error"]["line"] == line


def test_another_account_cannot_read_a_team_file(client):
    a, _ = fresh_account("tf-scope-a")
    b, _ = fresh_account("tf-scope-b")
    team = _team(a)
    assert b.get(f"/api/teams/{team}/file").status_code == 404
    assert a.get(f"/api/teams/{team}/file").status_code == 200


def test_the_export_falls_back_to_the_last_runs_budget_and_repo(client):
    c, owner = fresh_account("tf-last")
    team = _team(c)
    with session_scope() as session:
        rid = uuid.uuid4()
        graph = session.execute(
            select(TeamGraph.id).where(TeamGraph.id == uuid.UUID(team))
        ).scalar_one()
        session.add(
            Run(
                id=rid,
                team_graph_id=graph,
                owner_id=owner,
                idea="x",
                workflow_id=str(rid),
                status="completed",
                library_team_id=graph,
                budget_cap_usd=3,
                github_repo="lazyxgenius/trade_mcp",
                repo_path="/srv/private/clone",
            )
        )
    data = yaml.safe_load(_file(c, team)["content"])
    assert (data["budget_usd"], data["repo"]) == (3.0, "lazyxgenius/trade_mcp")
    assert "/srv/private" not in _file(c, team)["content"]


def test_migration_0045_adds_two_nullable_team_columns(client):
    from sqlalchemy import text

    with session_scope() as session:
        rows = session.execute(
            text(
                "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                "WHERE table_name = 'team_graphs' AND column_name IN ('budget_usd', 'repo')"
            )
        ).all()
    assert {r[0]: (r[1], r[2]) for r in rows} == {
        "budget_usd": ("numeric", "YES"),
        "repo": ("text", "YES"),
    }
