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
from tvashtr.control_plane import team_file
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
    # The inline server can't come back (its definition never leaves) and a connector comes back
    # read-only (a file never gets to change things in an account); everything else does.
    for data in (first, second):
        engineer = next(a for a in data["agents"] if a["id"] == "engineer")
        engineer["tools"] = [t for t in engineer["tools"] if t != "private-api"]
        engineer["connectors"] = [{"connector": g["connector"]} for g in engineer["connectors"]]
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
    # B holds a key for every model the file names: only the sign-in and the tool are left.
    content = _file(a, team)["content"]
    models = {
        v for agent in yaml.safe_load(content)["agents"] for k, v in agent.items() if "model" in k
    }
    for provider in {m.split("/")[0] for m in models}:
        r = b.post("/api/providers", json={"provider": provider, "api_key": "sk-test-1234"})
        assert r.status_code in (200, 201), r.text
    reply = _import(b, content, name="Imported squad")
    assert not any(f["key"].startswith("model:") for f in reply["fixes"])
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


# ---------------------------------------------------------------------------- the security review


def _check(c, content: str) -> dict:
    return c.post("/api/teams/import-check", json={"content": content}).json()


_MIN = "tvashtr_team: 1\nname: Team\nagents:\n  - id: pm\n    model: openai/gpt-4.1-mini\n"


def test_anchors_and_aliases_are_refused_before_anything_expands(client):
    c, _ = fresh_account("tf-bomb")
    bomb = _MIN + "description_seed: &a0 [lol]\nmore: [*a0, *a0]\n"
    reply = _check(c, bomb)
    assert reply["ok"] is False and reply["error"]["line"] == 6
    assert "anchors and aliases" in reply["error"]["message"]


def test_a_repeated_key_is_refused_with_its_line(client):
    c, _ = fresh_account("tf-dup")
    reply = _check(c, _MIN + "    model: hidden/model\n")
    assert reply["ok"] is False and reply["error"]["line"] == 6
    assert "`model` appears twice" in reply["error"]["message"]


@pytest.mark.parametrize(
    ("tail", "line"),
    [
        ("    kind: [x]\n", 6),
        ("routes:\n  - {from: [pm], to: pm}\n", 7),
        ("1: x\n", 6),
        ("needs: x\n", 6),
        ("    domains: [[x]]\n", 6),
        ("    connectors: [[x]]\n", 6),
        ("budget_usd: true\n", 6),
        ("budget_usd: 1000000000\n", 6),
        ("budget_usd: .inf\n", 6),
        ("layout: {pm: [.nan, 0]}\n", 6),
        ("    description: 2024-01-01\n", 6),
        ("    tools: [[x]]\n", 6),
        ("    skills: [{name: [x]}]\n", 6),
        ("routes:\n  - {from: pm, to: pm, loop_limit: 1000000000}\n", 7),
        ("routes:\n  - {from: pm, to: pm, type: weird}\n", 7),
        ("gates:\n  - {id: g, asks: you, kind: totally-made-up}\n", 7),
        # the independent review: a value YAML can't build, or the wrong type where a set is checked
        ("x: 2026-13-45\n", 1),
        ("x: " + "1" * 5000 + "\n", 1),
        ("x: !!int abc\n", 1),
        ("x: !!float abc\n", 1),
        ("x: !!timestamp abc\n", 1),
        ("x: !!bool abc\n", 1),
        ("    skills: 5\n", 6),
        ("    connectors: true\n", 6),
        ("gates:\n  - {id: g, checks: [a]}\n", 7),
        ("gates:\n  - {id: g, kind: {a: b}}\n", 7),
    ],
)
def test_a_malformed_file_is_a_line_not_a_crash(client, tail, line):
    c, _ = fresh_account("tf-500")
    content = _MIN + tail
    reply = _check(c, content)
    assert reply["ok"] is False and reply["error"]["line"] == line, reply
    resp = c.post("/api/teams/import", json={"content": content})
    assert resp.status_code == 422, resp.text


def test_deep_nesting_is_refused(client):
    c, _ = fresh_account("tf-deep")
    reply = _check(c, _MIN + "    output_format: " + "[" * 3000 + "]" * 3000 + "\n")
    assert reply["ok"] is False


def test_a_file_holds_at_most_200_agents_gates_and_ends(client):
    c, _ = fresh_account("tf-cap")
    agents = "".join(f"  - {{id: a{i}, model: m, kind: thinker}}\n" for i in range(201))
    reply = _check(c, "tvashtr_team: 1\nname: Big\nagents:\n" + agents)
    assert reply["ok"] is False and "at most 200" in reply["error"]["message"]


def test_every_exported_string_is_masked_and_a_repo_skill_url_is_canonical(client):
    c, _ = fresh_account("tf-mask")
    team = _team(c)
    ghp = "ghp_" + "A" * 36
    akia = "AKIA" + "ABCDEFGHIJKLMNOP"
    stripe = "sk_" + "live_" + "51HfAbCdEfGhIjKlMnOp"
    with session_scope() as session:
        eng = _node(team, "engineer")
        gate = (
            session.execute(
                select(AgentNode).where(
                    AgentNode.team_graph_id == uuid.UUID(team), AgentNode.kind == "gate"
                )
            )
            .scalars()
            .first()
        )
        session.execute(
            update(AgentNode)
            .where(AgentNode.id == eng.id)
            .values(
                config={
                    **(eng.config or {}),
                    "description": f"uses {ghp}",
                    "output_schema": {"k": stripe},
                },
                skills=[
                    {
                        "type": "repo",
                        "url": f"https://bot:pa/ss{ghp}@github.com/o/r?access_token={ghp}",
                        "ref": "main",
                    },
                    {"type": "repo", "url": "file:///srv/secret/repo"},
                    {"type": "inline", "name": f"skill {ghp}", "content": "x", "triggers": [ghp]},
                ],
                tool_config={"mcpServers": ["not-a-dict"], "tvashtr": {"servers": ["x"]}},
            )
        )
        session.execute(
            update(AgentNode)
            .where(AgentNode.id == gate.id)
            .values(config={**(gate.config or {}), "title": f"check {akia}"})
        )
    for fmt in ("yaml", "json"):
        content = _file(c, team, fmt)["content"]
        for value in (ghp, akia, stripe, "pa/ss", "access_token", "file:///srv"):
            assert value not in content, (fmt, value)
    engineer = next(
        a for a in yaml.safe_load(_file(c, team)["content"])["agents"] if a["id"] == "engineer"
    )
    assert {"repo": "https://github.com/o/r", "ref": "main"} in engineer["skills"]


def test_a_name_with_line_breaks_cannot_inject_keys_into_the_export(client):
    c, _ = fresh_account("tf-inject")
    content = (
        'tvashtr_team: 1\nname: "Nice team\\nrepo: attacker/evil\\nbudget_usd: 9 #"\n'
        "agents:\n  - id: pm\n    model: m\n"
    )
    imported = _import(c, content)
    data = yaml.safe_load(_file(c, imported["team_graph_id"])["content"])
    assert "repo" not in data and "budget_usd" not in data
    assert "\n" not in data["name"]


def test_the_entry_agent_imports_read_only(client):
    c, _ = fresh_account("tf-root")
    content = (
        "tvashtr_team: 1\nname: T\nagents:\n  - id: pm\n    based_on: built-in/product-manager\n"
        "    model: m\n    file_access: can-edit\n  - id: w\n    kind: worker\n"
        "    based_on: custom/worker\n    model: m\nroutes:\n  - {from: pm, to: w}\n"
    )
    imported = _import(c, content)
    pm = _node(imported["team_graph_id"], "pm")
    worker = _node(imported["team_graph_id"], "worker")
    assert pm.edits_allowed is False and worker.edits_allowed is True


def test_the_check_names_what_the_import_will_use_and_connectors_come_in_read_only(client):
    a, owner_a = fresh_account("tf-bind-a")
    team, _ = _rich_team(a, owner_a)
    content = _file(a, team)["content"]
    b, owner_b = fresh_account("tf-bind-b")
    with session_scope() as session:
        session.add(
            ConnectorConnection(
                owner_id=owner_b,
                connector_key="notion",
                name="Notion",
                slug="notion",
                url="https://mcp.notion.com/mcp",
                auth_kind="oauth",
                status="connected",
            )
        )
    create_owner_tool(owner_b, "chart-render", {"url": "https://b.example.com/mcp"})
    keys = {r["key"]: r for r in _check(b, content)["checks"]}
    assert keys["uses:connector:notion"]["title"] == "The Engineer will use your Notion"
    assert "Read-only" in keys["uses:connector:notion"]["detail"]
    assert (
        keys["uses:tool:chart-render"]["title"]
        == "The Engineer will use your Toolkit tool chart-render"
    )
    imported = _import(b, content)
    engineer = _node(imported["team_graph_id"], "engineer")
    grants = engineer.tool_config["tvashtr"]["connectors"]
    assert grants and all("access" not in g for g in grants)


def test_a_query_domain_with_a_domain_you_have_is_not_a_fix(client):
    c, owner = fresh_account("tf-dom")
    from tvashtr.models import Domain

    with session_scope() as session:
        session.add(Domain(owner_id=owner, name="docs", template="blank", config={}))
    content = (
        "tvashtr_team: 1\nname: T\nagents:\n  - id: pm\n    kind: thinker\n    model: m\n"
        "  - id: ask\n    kind: query-domain\n    based_on: custom/domain_query\n    domain: docs\n"
        "ends:\n  - {id: ship, kind: ship}\n"
        "routes:\n  - {from: pm, to: ask}\n  - {from: ask, to: ship}\n"
    )
    keys = {r["key"] for r in _check(c, content)["checks"]}
    assert "graph" not in keys and "domain:docs" not in keys


def test_a_graph_that_cant_run_is_fixed_on_its_canvas_and_the_note_says_so(client):
    c, _ = fresh_account("tf-graph")
    content = (
        "tvashtr_team: 1\nname: T\nagents:\n  - id: pm\n    based_on: built-in/product-manager\n"
        "    model: m\n  - id: engineer\n    based_on: built-in/engineer\n    model: m\n"
        "gates:\n  - {id: spec-approval, after: pm, asks: you, kind: prd_approval}\n"
        "ends:\n  - {id: ship, kind: ship}\n"
        "routes:\n  - {from: pm, to: spec-approval}\n"
        "  - {from: spec-approval, to: engineer, when: approved}\n"
        "  - {from: engineer, to: ship}\n"
    )
    imported = _import(c, content)
    graph = [f for f in imported["fixes"] if f["key"] == "graph"]
    assert graph and graph[0]["action"] == "open_team"
    assert not imported["note"].startswith("You can run the team now")
    assert "can’t run" in imported["note"]


def test_a_model_without_a_key_means_the_team_cant_run_yet(client):
    c, _ = fresh_account("tf-nokey")
    content = (
        "tvashtr_team: 1\nname: T\nagents:\n  - id: pm\n    kind: thinker\n"
        "    model: anthropic/claude-sonnet-4\nends:\n  - {id: ship, kind: ship}\n"
        "routes:\n  - {from: pm, to: ship}\n"
    )
    imported = _import(c, content)
    assert [f["action"] for f in imported["fixes"]] == ["open_engines"]
    assert imported["note"] == (
        "The team can’t run until each model has a key here, or you pick another model."
    )


# ---------------------------------------------------------------------- the independent review


def test_a_custom_connector_is_exported_by_its_host_never_its_path(client):
    """A custom server's address can carry its sign-in in the path (Zapier's /s/<secret>/mcp): the
    file names the host only, and an importer with one connection on that host uses it."""
    secret = "Zk9QbW1zZWNyZXRwYXRodG9rZW4"
    a, owner_a = fresh_account("tf-cust-a")
    team = _team(a)
    with session_scope() as session:
        conn = ConnectorConnection(
            owner_id=owner_a,
            connector_key=f"custom:mcp.zapier.com/api/mcp/s/{secret}/mcp",
            name="mcp.zapier.com",
            slug="zapier",
            url=f"https://mcp.zapier.com/api/mcp/s/{secret}/mcp",
            auth_kind="oauth",
            status="connected",
        )
        session.add(conn)
        session.flush()
        eng = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(team), AgentNode.role_name == "engineer"
            )
        ).scalar_one()
        eng.tool_config = {"tvashtr": {"connectors": [{"id": str(conn.id)}]}}
    content = _file(a, team)["content"]
    assert secret not in content and "/api/mcp" not in content
    data = yaml.safe_load(content)
    assert data["needs"]["connectors"] == ["custom:mcp.zapier.com"]
    b, owner_b = fresh_account("tf-cust-b")
    with session_scope() as session:
        mine = ConnectorConnection(
            owner_id=owner_b,
            connector_key="custom:mcp.zapier.com/api/mcp/s/other-secret/mcp",
            name="mcp.zapier.com",
            slug="zapier",
            url="https://mcp.zapier.com/api/mcp/s/other-secret/mcp",
            auth_kind="oauth",
            status="connected",
        )
        session.add(mine)
        session.flush()
        mine_id = str(mine.id)
    keys = {r["key"] for r in _check(b, content)["checks"]}
    assert "connector:custom:mcp.zapier.com" not in keys
    imported = _import(b, content)
    engineer = _node(imported["team_graph_id"], "engineer")
    assert engineer.tool_config["tvashtr"]["connectors"] == [{"id": mine_id}]


@pytest.mark.parametrize(
    "text",
    ["line one\u2028line two", "line one\u2029two", "a\x85b", "\n  code\nmore", "x\n\n  y\n"],
)
def test_text_a_literal_block_cant_hold_comes_back_exactly(text):
    data = {
        "tvashtr_team": 1,
        "name": "T",
        "agents": [{"id": "pm", "model": "m", "kind": "thinker", "instructions": text}],
    }
    back, _ = team_file.parse(team_file.to_yaml(data))
    assert back["agents"][0]["instructions"] == text


@pytest.mark.parametrize("agent_id", ["yes", "no", "on", "off", "null", "true", "123", "1"])
def test_a_layout_key_yaml_would_read_as_another_type_stays_the_id(agent_id):
    data = {
        "tvashtr_team": 1,
        "name": "T",
        "agents": [{"id": agent_id, "model": "m", "kind": "thinker"}],
        "layout": {agent_id: [0, 0]},
    }
    back, unknown = team_file.parse(team_file.to_yaml(data))
    assert back["layout"] == {agent_id: [0, 0]} and unknown == []


def test_json_with_tabs_and_exponents_reads_as_json():
    data = {
        "tvashtr_team": 1,
        "name": "T",
        "budget_usd": 1e1,
        "agents": [{"id": "pm", "model": "m", "kind": "thinker"}],
    }
    back, _ = team_file.parse(json.dumps(data, indent="\t").replace("10.0", "1e1"))
    assert back["budget_usd"] == 10.0 and back["agents"][0]["id"] == "pm"
    with pytest.raises(team_file.FileError) as err:
        team_file.parse('{\n\t"tvashtr_team": 1,\n\t"name": "T",\n\t"name": "U"\n}')
    assert "`name` appears twice" in err.value.message


def test_a_fix_lands_on_the_agent_that_needs_it_not_every_agent_with_its_name(client):
    c, _ = fresh_account("tf-twins")
    content = (
        "tvashtr_team: 1\nname: T\nagents:\n"
        "  - {id: engineer, name: Engineer, kind: thinker, model: m}\n"
        "  - {id: engineer-2, name: Engineer, kind: thinker, model: m2, tools: [chart-render]}\n"
        "ends:\n  - {id: ship, kind: ship}\n"
        "routes:\n  - {from: engineer, to: engineer-2}\n  - {from: engineer-2, to: ship}\n"
    )
    imported = _import(c, content)
    fix = next(f for f in imported["fixes"] if f["key"] == "tool:chart-render")
    assert len(fix["node_ids"]) == 1
    with session_scope() as session:
        node = session.get(AgentNode, uuid.UUID(fix["node_ids"][0]))
        assert node.model == "m2"


def test_a_model_your_desktop_plan_covers_is_set_up_here(client, monkeypatch):
    c, owner = fresh_account("tf-plan")
    from tvashtr.control_plane import teams

    monkeypatch.setattr(
        teams,
        "_readiness_inputs",
        lambda session, owner_id: {"held": set(), "connected": {"claude"}, "fresh": {"claude"}},
    )
    content = (
        "tvashtr_team: 1\nname: T\nagents:\n  - id: pm\n    kind: thinker\n"
        "    model: anthropic/claude-sonnet-4\nends:\n  - {id: ship, kind: ship}\n"
        "routes:\n  - {from: pm, to: ship}\n"
    )
    keys = {r["key"] for r in _check(c, content)["checks"]}
    assert "models" in keys and "model:anthropic/claude-sonnet-4" not in keys


def test_a_sign_in_fix_names_its_connector_as_the_catalog_does(client):
    c, _ = fresh_account("tf-label")
    content = (
        "tvashtr_team: 1\nname: T\nagents:\n  - id: pm\n    kind: thinker\n    model: m\n"
        "    connectors: [{connector: hubspot}]\nends:\n  - {id: ship, kind: ship}\n"
        "routes:\n  - {from: pm, to: ship}\n"
    )
    fix = next(f for f in _import(c, content)["fixes"] if f["key"] == "connector:hubspot")
    assert fix["text"] == "Sign in to HubSpot" and fix["label"] == "HubSpot"
    assert all("label" in f for f in _import(c, content)["fixes"])
