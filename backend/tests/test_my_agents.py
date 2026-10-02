"""M6 — my agents and recent tasks (ruling R4; contract
``docs/superpowers/plans/api/my-agents.md``): save an agent's parts as a saved agent (re-saving the
name makes v2), never a secret; use one on a node at once with Undo (it keeps its id, role, routes
and memory); Detach; update a team that is on an older version; add one to a team; rename and
delete (never changing a team); the composer's recent tasks."""

import uuid

import pytest
from home_fixtures import fresh_account, library_team, make_run
from sqlalchemy import select, text

from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge, NodeMemory, SavedAgent, SavedAgentVersion

_GHP = "ghp_" + "Z" * 36


def _graph(c, team: str) -> dict:
    resp = c.get(f"/api/teams/{team}/graph")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _node(c, team: str, role: str) -> dict:
    return next(n for n in _graph(c, team)["nodes"] if n["role_name"] == role)


def _patch(c, team: str, node_id: str, **body) -> dict:
    resp = c.patch(f"/api/teams/{team}/nodes/{node_id}", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


ALL = ["instructions", "model", "skills_tools", "file_access"]


def _save(c, team: str, node_id: str, name="Strict reviewer", include=ALL, **extra) -> dict:
    resp = c.post(
        "/api/my-agents",
        json={
            "team_id": team,
            "node_id": node_id,
            "name": name,
            "purpose": "Reviews it.",
            "include": include,
            **extra,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _agents(c) -> list:
    resp = c.get("/api/my-agents")
    assert resp.status_code == 200, resp.text
    return resp.json()["agents"]


def _use(c, team: str, node_id: str, agent_id: str, **extra) -> dict:
    resp = c.post(
        f"/api/teams/{team}/nodes/{node_id}/use-agent", json={"agent_id": agent_id, **extra}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_migration_0047_adds_saved_agents_and_their_versions(client):
    client, owner = fresh_account("ma")
    with session_scope() as session:
        tables = set(
            session.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_name in ('saved_agents', 'saved_agent_versions')"
                )
            ).scalars()
        )
    assert tables == {"saved_agents", "saved_agent_versions"}


def test_saving_an_agent_makes_v1_and_the_same_name_makes_v2(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    _patch(client, team, rev["id"], model="openai/gpt-4.1", fallback_model="openai/gpt-4.1-mini")
    first = _save(client, team, rev["id"])
    assert first["created"] is True and first["version"] == 1
    agent = first["agent"]
    assert agent["name"] == "Strict reviewer" and agent["latest"] == 1
    assert agent["built_on"] == "Reviewer" and agent["model"] == "openai/gpt-4.1"
    assert agent["file_access"] == "read-only"
    assert agent["used_in"] == [
        {
            "team_id": team,
            "team_name": "Indicator sprint team",
            "version": 1,
            "node_ids": [rev["id"]],
        }
    ]  # the agent it was saved from is now based on it
    _patch(client, team, rev["id"], prompt="Be stricter.")
    second = _save(client, team, rev["id"], name="  strict REVIEWER ")
    assert second["created"] is False and second["version"] == 2
    assert [v["number"] for v in second["agent"]["versions"]] == [2, 1]
    other = _save(client, team, rev["id"], name="Spec writer")
    assert other["created"] is True and other["version"] == 1
    assert [a["name"] for a in _agents(client)] == ["Spec writer", "Strict reviewer"]


def test_a_saved_agent_never_holds_a_secret(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    eng = _node(client, team, "engineer")
    _patch(
        client,
        team,
        eng["id"],
        prompt=f"Use the token {_GHP} to push.",
        tool_config={
            "mcpServers": {
                "literal": {
                    "url": "https://x.test/mcp",
                    "headers": {"Authorization": "Bearer abc123"},
                },
                "byref": {"url": "https://y.test/mcp", "headers": {"Authorization": "${Y_TOKEN}"}},
            }
        },
        skills=[{"type": "inline", "name": "deploy", "content": f"export TOKEN={_GHP}"}],
    )
    saved = _save(client, team, eng["id"], name="Builder")
    with session_scope() as session:
        version = session.execute(
            select(SavedAgentVersion).where(
                SavedAgentVersion.saved_agent_id == uuid.UUID(saved["agent"]["id"])
            )
        ).scalar_one()
        parts = version.parts
    blob = str(parts)
    assert _GHP not in blob and "abc123" not in blob
    assert "literal" not in parts["tool_config"].get("mcpServers", {})
    assert parts["tool_config"]["mcpServers"]["byref"]["headers"] == {"Authorization": "${Y_TOKEN}"}


def test_memories_are_left_out_unless_asked(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    with session_scope() as session:
        session.add(
            NodeMemory(
                owner_id=owner,
                node_id=uuid.UUID(rev["id"]),
                content="Prefers pytest -q",
                status="active",
            )
        )
    plain = _save(client, team, rev["id"], name="No memories")
    asked = _save(client, team, rev["id"], name="With memories", include=[*ALL, "memories"])
    with session_scope() as session:
        rows = {
            v.saved_agent_id: v.memories
            for v in session.execute(select(SavedAgentVersion)).scalars()
            if str(v.saved_agent_id) in (plain["agent"]["id"], asked["agent"]["id"])
        }
    assert rows[uuid.UUID(plain["agent"]["id"])] is None
    assert [m["content"] for m in rows[uuid.UUID(asked["agent"]["id"])]] == ["Prefers pytest -q"]


def test_using_a_saved_agent_applies_its_parts_at_once_and_keeps_the_node(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    _patch(client, team, rev["id"], prompt="Be strict.", model="openai/gpt-4.1")
    agent = _save(client, team, rev["id"])["agent"]
    other = library_team(client, name="Bugfix squad")
    target = _node(client, other, "reviewer")
    edges_before = {
        (e["source_node_id"], e["target_node_id"]) for e in _graph(client, other)["edges"]
    }
    client.get(f"/api/teams/{other}/versions")  # v1 of the target team
    used = _use(client, other, target["id"], agent["id"])
    assert used["text"] == "Reviewer now uses Strict reviewer v1"
    node = used["node"]
    assert node["id"] == target["id"] and node["role_name"] == target["role_name"]
    assert node["position"] == target["position"]
    assert node["prompt"] == "Be strict." and node["model"] == "openai/gpt-4.1"
    assert node["config"]["based_on"] == {
        "id": agent["id"],
        "name": "Strict reviewer",
        "version": 1,
    }
    assert {(e["source_node_id"], e["target_node_id"]) for e in _graph(client, other)["edges"]} == (
        edges_before
    )
    assert used["before"]["prompt"] == target["prompt"]
    # It's a change of the team (its instructions and model), not of based_on itself.
    assert client.get(f"/api/teams/{other}/versions").json()["changes"] == 2
    saved = client.post(f"/api/teams/{other}/versions", json={}).json()
    assert saved["summary"] == "Reviewer: instructions and model changed"


def test_undo_puts_the_node_back(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    _patch(client, team, rev["id"], prompt="Be strict.")
    agent = _save(client, team, rev["id"])["agent"]
    other = library_team(client, name="Bugfix squad")
    target = _node(client, other, "reviewer")
    used = _use(client, other, target["id"], agent["id"])
    resp = client.post(
        f"/api/teams/{other}/nodes/{target['id']}/undo-agent", json={"before": used["before"]}
    )
    assert resp.status_code == 200, resp.text
    back = _node(client, other, "reviewer")
    assert back["prompt"] == target["prompt"] and back["model"] == target["model"]
    assert "based_on" not in (back["config"] or {})


def test_detach_keeps_the_parts_and_is_not_a_change(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    _patch(client, team, rev["id"], prompt="Be strict.")
    agent = _save(client, team, rev["id"])["agent"]
    other = library_team(client, name="Bugfix squad")
    target = _node(client, other, "reviewer")
    _use(client, other, target["id"], agent["id"])
    client.post(f"/api/teams/{other}/versions", json={})  # saved with based_on
    resp = client.post(f"/api/teams/{other}/nodes/{target['id']}/detach-agent")
    assert resp.status_code == 200, resp.text
    node = _node(client, other, "reviewer")
    assert node["prompt"] == "Be strict." and "based_on" not in (node["config"] or {})
    assert client.get(f"/api/teams/{other}/versions").json()["changes"] == 0


def test_a_team_on_an_older_version_is_behind_and_update_brings_it_up(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    _patch(client, team, rev["id"], prompt="Version one.")
    agent = _save(client, team, rev["id"])["agent"]
    other = library_team(client, name="Bugfix squad")
    target = _node(client, other, "reviewer")
    _use(client, other, target["id"], agent["id"])
    _patch(client, team, rev["id"], prompt="Version two.")
    _save(client, team, rev["id"])  # v2, from the first team's reviewer
    listed = next(a for a in _agents(client) if a["id"] == agent["id"])
    assert listed["latest"] == 2
    assert listed["behind"] == [{"team_id": other, "team_name": "Bugfix squad", "version": 1}]
    resp = client.post(f"/api/my-agents/{agent['id']}/update-team", json={"team_id": other})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["text"] == "Bugfix squad now uses Strict reviewer v2"
    assert [u["node_id"] for u in body["updated"]] == [target["id"]]
    assert _node(client, other, "reviewer")["prompt"] == "Version two."
    assert next(a for a in _agents(client) if a["id"] == agent["id"])["behind"] == []


def test_use_in_a_team_adds_a_new_agent(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    agent = _save(client, team, rev["id"])["agent"]
    other = library_team(client, name="Docs team", template="two_node")
    before = {n["id"] for n in _graph(client, other)["nodes"]}
    resp = client.post(f"/api/my-agents/{agent['id']}/use-in-team", json={"team_id": other})
    assert resp.status_code == 201, resp.text
    new_id = resp.json()["node_id"]
    assert new_id not in before
    node = next(n for n in _graph(client, other)["nodes"] if n["id"] == new_id)
    assert node["config"]["based_on"]["id"] == agent["id"] and node["kind"] == rev["kind"]
    assert not [
        e
        for e in _graph(client, other)["edges"]
        if new_id in (e["source_node_id"], e["target_node_id"])
    ]


def test_the_entry_agent_stays_read_only(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    eng = _node(client, team, "engineer")  # can edit files
    agent = _save(client, team, eng["id"], name="Builder")["agent"]
    pm = _node(client, team, "pm")  # the entry: read-only by rule
    used = _use(client, team, pm["id"], agent["id"])
    assert used["node"]["edits_allowed"] is False


def test_a_gate_cannot_use_a_saved_agent(client):
    client, owner = fresh_account("ma")
    team = library_team(client, template="plan_review")
    rev = (
        _node(client, team, "reviewer")
        if any(n["role_name"] == "reviewer" for n in _graph(client, team)["nodes"])
        else _node(client, team, "pm")
    )
    agent = _save(client, team, rev["id"])["agent"]
    gate = next(n for n in _graph(client, team)["nodes"] if n["kind"] == "gate")
    resp = client.post(
        f"/api/teams/{team}/nodes/{gate['id']}/use-agent", json={"agent_id": agent["id"]}
    )
    assert resp.status_code == 409


def test_rename_delete_and_a_taken_name(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    agent = _save(client, team, rev["id"])["agent"]
    _save(client, team, rev["id"], name="Spec writer")
    taken = client.patch(f"/api/my-agents/{agent['id']}", json={"name": "spec writer"})
    assert taken.status_code == 409
    assert taken.json()["detail"] == "You already have an agent called spec writer."
    renamed = client.patch(
        f"/api/my-agents/{agent['id']}", json={"name": "Careful reviewer", "purpose": "Careful."}
    )
    assert renamed.status_code == 200 and renamed.json()["name"] == "Careful reviewer"
    node_before = _node(client, team, "reviewer")
    assert client.delete(f"/api/my-agents/{agent['id']}").status_code == 204
    assert _node(client, team, "reviewer") == node_before  # deleting never changes a team
    with session_scope() as session:
        assert session.get(SavedAgent, uuid.UUID(agent["id"])) is None


def test_saving_needs_a_name_and_something_included(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    for body in ({"name": "  ", "include": ALL}, {"name": "X", "include": []}):
        resp = client.post(
            "/api/my-agents", json={"team_id": team, "node_id": rev["id"], "purpose": "", **body}
        )
        assert resp.status_code == 422, (body, resp.text)


def test_my_agents_are_owner_scoped(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    agent = _save(client, team, rev["id"])["agent"]
    b, _ = fresh_account("agents-b")
    b_team = library_team(b, name="B team")
    b_rev = _node(b, b_team, "reviewer")
    for method, path, body in (
        ("patch", f"/api/my-agents/{agent['id']}", {"name": "x"}),
        ("delete", f"/api/my-agents/{agent['id']}", None),
        ("post", f"/api/my-agents/{agent['id']}/update-team", {"team_id": b_team}),
        ("post", f"/api/my-agents/{agent['id']}/use-in-team", {"team_id": b_team}),
        ("post", f"/api/teams/{b_team}/nodes/{b_rev['id']}/use-agent", {"agent_id": agent["id"]}),
        (
            "post",
            "/api/my-agents",
            {"team_id": team, "node_id": rev["id"], "name": "x", "purpose": "", "include": ALL},
        ),
        ("post", f"/api/teams/{team}/nodes/{rev['id']}/use-agent", {"agent_id": agent["id"]}),
        ("post", f"/api/teams/{team}/nodes/{rev['id']}/undo-agent", {"before": {}}),
        ("post", f"/api/teams/{team}/nodes/{rev['id']}/detach-agent", None),
    ):
        resp = getattr(b, method)(path, **({"json": body} if body is not None else {}))
        assert resp.status_code == 404, (method, path, resp.status_code, resp.text)
    assert b.get("/api/my-agents").json()["agents"] == []
    assert _agents(client)[0]["id"] == agent["id"]  # untouched


def test_recent_tasks_are_one_per_task_newest_first_and_only_yours(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    make_run(owner, team, idea="Add an RSI indicator", status="completed")
    make_run(owner, team, idea="add an  RSI indicator ", status="failed")  # same task, newer
    make_run(owner, team, idea="Add a MACD indicator", status="running")
    make_run(owner, None, idea="Add a ghost", status="completed")  # no library team
    b, b_owner = fresh_account("tasks-b")
    make_run(b_owner, library_team(b), idea="Add their task", status="completed")
    got = client.get("/api/recent-tasks", params={"q": "add a"}).json()["tasks"]
    tasks = [t["task"] for t in got]
    assert "Add their task" not in tasks and "Add a ghost" not in tasks
    assert tasks[:2] == ["Add a MACD indicator", "add an  RSI indicator "]
    assert got[1]["status"] == "failed" and got[1]["team"]["id"] == team
    assert got[0]["number"] is not None
    assert client.get("/api/recent-tasks", params={"q": "100%_"}).json()["tasks"] == []
    assert client.get("/api/recent-tasks", params={"limit": 0}).status_code == 422


def test_a_saved_agent_s_based_on_is_not_a_team_change():
    from tvashtr.control_plane import versions

    before = {"id": "n", "kind": "agent", "role_name": "reviewer", "config": {}}
    after = {**before, "config": {"based_on": {"id": "a", "name": "X", "version": 1}}}
    assert versions._node_rows(before, after) == []


@pytest.mark.parametrize("missing", ["agent_id"])
def test_use_agent_needs_an_agent(client, missing):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    resp = client.post(f"/api/teams/{team}/nodes/{rev['id']}/use-agent", json={})
    assert resp.status_code == 422


def test_edges_are_never_touched_by_a_use(client):
    client, owner = fresh_account("ma")
    team = library_team(client)
    rev = _node(client, team, "reviewer")
    agent = _save(client, team, rev["id"])["agent"]
    with session_scope() as session:
        n_edges = len(session.execute(select(Edge)).scalars().all())
    _use(client, team, _node(client, team, "engineer")["id"], agent["id"])
    with session_scope() as session:
        assert len(session.execute(select(Edge)).scalars().all()) == n_edges
        assert session.get(AgentNode, uuid.UUID(rev["id"])) is not None
