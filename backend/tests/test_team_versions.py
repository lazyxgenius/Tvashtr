"""M5 — team versions (ruling R3; contract ``docs/superpowers/plans/api/versions.md``): a version
is an explicit checkpoint of a library team; changes since the latest one count (positions never),
Save as vN makes one, starting a run saves first so every run has a version, Restore makes a NEW
version equal to an old one (in place: nodes keep their ids), and each agent's instruction history
is the versions in which its instructions changed."""

import uuid

import pytest
from conftest import auth_user_id
from home_fixtures import add_invocation, clone_node, fresh_account, library_team, make_run
from sqlalchemy import select, text

from tvashtr import routers
from tvashtr.control_plane import resume, versions
from tvashtr.control_plane.teams import ENGINEER_PROMPT
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, Run, TeamGraph, TeamVersion


def _graph(c, team: str) -> dict:
    resp = c.get(f"/api/teams/{team}/graph")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _node(c, team: str, role: str) -> dict:
    return next(n for n in _graph(c, team)["nodes"] if n["role_name"] == role)


def _patch(c, team: str, node_id: str, **body) -> None:
    resp = c.patch(f"/api/teams/{team}/nodes/{node_id}", json=body)
    assert resp.status_code == 200, resp.text


def _versions(c, team: str) -> dict:
    resp = c.get(f"/api/teams/{team}/versions")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _save(c, team: str, **body) -> dict:
    resp = c.post(f"/api/teams/{team}/versions", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_migration_0046_adds_team_versions_and_runs_team_version_number(client):
    with session_scope() as session:
        cols = set(
            session.execute(
                text(
                    "select column_name from information_schema.columns "
                    "where table_name = 'team_versions'"
                )
            ).scalars()
        )
        run_col = session.execute(
            text(
                "select is_nullable from information_schema.columns "
                "where table_name = 'runs' and column_name = 'team_version_number'"
            )
        ).scalar_one()
    assert {
        "team_graph_id",
        "number",
        "snapshot",
        "graph",
        "summary",
        "note",
        "author_id",
        "source",
        "restored_from",
        "created_at",
    } <= cols
    assert run_col == "YES"


def test_a_team_gets_v1_its_current_state_the_first_time_anything_asks(client):
    team = library_team(client, name="Indicator sprint team")
    got = _versions(client, team)
    assert got["current"] == 1 and got["changes"] == 0 and got["next"] == 2 and got["total"] == 1
    assert got["versions"][0] | {"created_at": None} == {
        "number": 1,
        "created_at": None,
        "author": "you",
        "summary": "First version",
        "note": None,
        "runs": 0,
        "source": "first",
        "restored_from": None,
        "tests": None,  # M7: no agent of it has been tested on v1
        "check": None,  # M9: no set compare has checked v1
    }
    # Asking again makes no second v1.
    assert _versions(client, team)["total"] == 1
    with session_scope() as session:
        v1 = session.execute(
            select(TeamVersion).where(TeamVersion.team_graph_id == uuid.UUID(team))
        ).scalar_one()
        assert v1.snapshot["tvashtr_team"] == 1 and v1.snapshot["name"] == "Indicator sprint team"


def test_an_imported_team_s_v1_says_so(client):
    content = (
        "tvashtr_team: 1\nname: T\nagents:\n  - id: pm\n    kind: thinker\n    model: m\n"
        "ends:\n  - {id: ship, kind: ship}\nroutes:\n  - {from: pm, to: ship}\n"
    )
    team = client.post("/api/teams/import", json={"content": content}).json()["team_graph_id"]
    assert _versions(client, team)["versions"][0]["summary"] == "Imported from a team file"


def test_edits_count_as_changes_and_save_as_vn_makes_the_next_version(client):
    team = library_team(client)
    _versions(client, team)
    eng = _node(client, team, "engineer")
    _patch(client, team, eng["id"], prompt=(eng["prompt"] or "") + "\nAlways run the linter.")
    _patch(client, team, eng["id"], model="anthropic/claude-sonnet-4")
    got = _versions(client, team)
    assert got["current"] == 1 and got["changes"] == 2 and got["next"] == 2

    saved = _save(client, team)
    assert saved["number"] == 2 and saved["source"] == "save"
    assert saved["summary"] == "Engineer: instructions and model changed"
    assert _versions(client, team)["changes"] == 0

    v2 = client.get(f"/api/teams/{team}/versions/2").json()
    assert v2["current"] is True and v2["compared_with"] == 1
    rows = {r["field"]: r for r in v2["changes"]}
    assert rows["Instructions"]["kind"] == "text" and rows["Instructions"]["agent"] == "Engineer"
    assert rows["Instructions"]["added"] == 1 and rows["Instructions"]["removed"] == 0
    assert {"op": "added", "text": "Always run the linter."} in rows["Instructions"]["lines"]
    assert rows["Model"]["after"] == "anthropic/claude-sonnet-4"
    assert v2["same"] == ["routes", "gates", "budget"]


def test_a_note_is_kept_and_nothing_changed_is_409(client):
    team = library_team(client)
    _versions(client, team)
    resp = client.post(f"/api/teams/{team}/versions", json={})
    assert resp.status_code == 409 and resp.json()["detail"] == "Nothing changed since v1."
    eng = _node(client, team, "engineer")
    _patch(client, team, eng["id"], model="openai/gpt-4.1")
    assert _save(client, team, note="Stricter about the registry")["note"] == (
        "Stricter about the registry"
    )


def test_moving_nodes_never_makes_a_change(client):
    team = library_team(client)
    _versions(client, team)
    eng = _node(client, team, "engineer")
    resp = client.post(
        f"/api/teams/{team}/positions", json={"positions": {eng["id"]: {"x": 999, "y": -40}}}
    )
    assert resp.status_code < 400, resp.text
    assert _versions(client, team)["changes"] == 0
    assert client.post(f"/api/teams/{team}/versions", json={}).status_code == 409


def test_routes_gates_and_agents_added_and_removed_are_changes(client):
    team = library_team(client)
    _versions(client, team)
    graph = _graph(client, team)
    edge = graph["edges"][0]
    assert client.delete(f"/api/teams/{team}/edges/{edge['id']}").status_code < 400
    added = client.post(
        f"/api/teams/{team}/nodes", json={"node_kind": "thinker", "preset": "architect"}
    )
    assert added.status_code < 400, added.text
    saved = _save(client, team)
    v2 = client.get(f"/api/teams/{team}/versions/{saved['number']}").json()
    kinds = {(r["field"], r["kind"]) for r in v2["changes"]}
    assert (None, "added") in kinds and ("Routes", "removed") in kinds
    assert "routes" not in v2["same"]


def test_starting_a_run_saves_the_changes_first_so_every_run_has_a_version(client, monkeypatch):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    team = library_team(client)
    first = client.post("/api/runs", json={"idea": "Add an RSI indicator", "team_graph_id": team})
    assert first.status_code == 200, first.text
    assert first.json()["team_version_number"] == 1 and first.json()["version_saved"] is False

    eng = _node(client, team, "engineer")
    _patch(client, team, eng["id"], model="openai/gpt-4.1")
    second = client.post("/api/runs", json={"idea": "Add a VWAP indicator", "team_graph_id": team})
    body = second.json()
    assert body["team_version_number"] == 2 and body["version_saved"] is True
    got = _versions(client, team)
    assert got["changes"] == 0 and got["versions"][0]["source"] == "run"
    assert got["versions"][0]["runs"] == 1 and got["versions"][1]["runs"] == 1

    run = client.get(f"/api/runs/{body['run_id']}").json()["run"]
    assert run["team_version_number"] == 2
    listed = client.get("/api/runs").json()["runs"]
    assert {r["run_id"]: r["team_version_number"] for r in listed}[body["run_id"]] == 2
    team_runs = client.get(f"/api/teams/{team}/runs").json()["runs"]
    assert [(r["number"], r["team_version_number"]) for r in team_runs] == [(2, 2), (1, 1)]
    detail = client.get(f"/api/teams/{team}/versions/2").json()
    assert [r["idea"] for r in detail["runs"]] == ["Add a VWAP indicator"]
    assert detail["runs"][0]["number"] == 2


def test_an_ephemeral_team_s_run_has_no_version(client, monkeypatch):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    resp = client.post("/api/runs", json={"idea": "x"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["team_version_number"] is None


def test_restore_makes_a_new_version_equal_to_the_old_one_in_place(client):
    team = library_team(client)
    _versions(client, team)
    before = _graph(client, team)
    eng = _node(client, team, "engineer")
    rev = _node(client, team, "reviewer")
    _patch(client, team, eng["id"], prompt="Something else entirely")
    assert client.delete(f"/api/teams/{team}/nodes/{rev['id']}").status_code < 400
    _save(client, team)  # v2: the Engineer rewritten, the Reviewer gone

    plan = client.get(f"/api/teams/{team}/versions/1/restore").json()
    assert plan["number"] == 1 and plan["makes"] == 3 and plan["current"] == 2
    assert plan["draft_saved_as"] is None
    assert {(r["agent"], r["field"]) for r in plan["changes"]} >= {
        ("Engineer", "Instructions"),
        ("Reviewer", None),
    }

    done = client.post(f"/api/teams/{team}/versions/1/restore")
    assert done.status_code == 201, done.text
    assert done.json() == {"number": 3, "restored_from": 1, "draft_saved_as": None}
    after = _graph(client, team)
    # The same nodes, by id (the Reviewer came back as itself), with v1's content.
    assert sorted(n["id"] for n in after["nodes"]) == sorted(n["id"] for n in before["nodes"])
    assert _node(client, team, "engineer")["prompt"] == eng["prompt"]
    with session_scope() as session:
        team_row = session.get(TeamGraph, uuid.UUID(team))
        v1 = versions._version(session, team_row, 1)
        v3 = versions._version(session, team_row, 3)
        assert versions.diff(v1.graph, v3.graph) == []
        assert v3.source == "restore" and v3.summary == "Restored v1"
    got = _versions(client, team)
    assert got["current"] == 3 and got["changes"] == 0 and got["total"] == 3


def test_restore_saves_the_working_copy_s_changes_first(client):
    team = library_team(client)
    _versions(client, team)
    eng = _node(client, team, "engineer")
    _patch(client, team, eng["id"], model="anthropic/claude-sonnet-4")
    _save(client, team)  # v2
    _patch(client, team, eng["id"], model="xai/grok-4.7")  # not saved
    plan = client.get(f"/api/teams/{team}/versions/1/restore").json()
    assert plan["draft_saved_as"] == 3 and plan["makes"] == 4
    done = client.post(f"/api/teams/{team}/versions/1/restore").json()
    assert done == {"number": 4, "restored_from": 1, "draft_saved_as": 3}
    listed = _versions(client, team)["versions"]
    assert [v["number"] for v in listed] == [4, 3, 2, 1]
    assert listed[1]["summary"] == "Engineer: model changed to xai/grok-4.7"


def test_restoring_the_current_version_with_nothing_changed_is_409(client):
    team = library_team(client)
    _versions(client, team)
    assert client.get(f"/api/teams/{team}/versions/1/restore").status_code == 409
    assert client.post(f"/api/teams/{team}/versions/1/restore").status_code == 409
    assert client.get(f"/api/teams/{team}/versions/7").status_code == 404
    assert client.get(f"/api/teams/{team}/versions/x").status_code == 404
    assert client.post(f"/api/teams/{team}/versions/9/restore").status_code == 404


def test_a_run_in_flight_keeps_its_version_after_a_restore(client, monkeypatch):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    team = library_team(client)
    _versions(client, team)  # v1
    eng = _node(client, team, "engineer")
    _patch(client, team, eng["id"], model="openai/gpt-4.1")
    run_id = client.post("/api/runs", json={"idea": "x", "team_graph_id": team}).json()["run_id"]
    client.post(f"/api/teams/{team}/versions/1/restore")
    with session_scope() as session:
        assert session.get(Run, uuid.UUID(run_id)).team_version_number == 2


def test_an_agent_s_instruction_history_is_the_versions_that_changed_it(client):
    team = library_team(client)
    eng = _node(client, team, "engineer")
    base = eng["prompt"]
    _versions(client, team)  # v1: the built-in text
    _patch(client, team, eng["id"], prompt=base + "\nAlways run the linter.")
    _save(client, team)  # v2
    _patch(client, team, eng["id"], model="anthropic/claude-sonnet-4")
    _save(client, team)  # v3: the instructions didn't change
    _patch(client, team, eng["id"], prompt=base + "\nAlways run the type checker.")
    _save(client, team)  # v4

    got = client.get(f"/api/teams/{team}/nodes/{eng['id']}/instruction-history").json()
    assert got["count"] == 3
    v4, v2, v1 = got["entries"]
    assert (v4["number"], v4["current"], v4["first"]) == (4, True, False)
    assert v4["added"] == ["Always run the type checker."]
    assert v4["removed"] == ["Always run the linter."]
    assert (v2["number"], v2["current"], v2["added"]) == (2, False, ["Always run the linter."])
    assert (v1["number"], v1["first"], v1["text"]) == (1, True, base)
    assert v1.get("from_builtin") == ("Engineer" if base == ENGINEER_PROMPT else None)


def test_versions_are_owner_scoped(client):
    team = library_team(client)
    eng = _node(client, team, "engineer")
    _versions(client, team)
    b, _ = fresh_account("ver-b")
    for method, path in (
        ("get", f"/api/teams/{team}/versions"),
        ("post", f"/api/teams/{team}/versions"),
        ("get", f"/api/teams/{team}/versions/1"),
        ("get", f"/api/teams/{team}/versions/1/restore"),
        ("post", f"/api/teams/{team}/versions/1/restore"),
        ("get", f"/api/teams/{team}/nodes/{eng['id']}/instruction-history"),
    ):
        resp = b.post(path, json={}) if method == "post" else b.get(path)
        assert resp.status_code == 404, (path, resp.status_code)
    assert _versions(client, team)["total"] == 1  # nothing made for A by B
    other = library_team(b)
    other_node = _node(b, other, "engineer")
    resp = client.get(f"/api/teams/{team}/nodes/{other_node['id']}/instruction-history")
    assert resp.status_code == 404  # a node of another team, even through your own team


def test_deleting_a_team_deletes_its_versions(client):
    team = library_team(client)
    _versions(client, team)
    assert client.delete(f"/api/teams/{team}").status_code < 400
    with session_scope() as session:
        left = session.execute(
            select(TeamVersion).where(TeamVersion.team_graph_id == uuid.UUID(team))
        ).all()
    assert left == []


def test_resume_keeps_the_old_run_s_version(client):
    """R8: a resumed run runs on the old run's snapshot, so on the old run's version — never a
    new one, even when the team changed since."""
    old = make_run(auth_user_id(), None, status="failed")[0]
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == old)).scalar_one()
        run.team_version_number = 4
        graph = str(run.team_graph_id)
    add_invocation(old, clone_node(graph, "engineer"), "failed")
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == old)).scalar_one()
        inv = session.execute(
            select(AgentInvocation.id).where(AgentInvocation.run_id == old)
        ).scalar_one()
        new = resume.create(session, run, inv, owner_id=run.owner_id, desktop_routed=[])
        assert new.team_version_number == 4
        session.rollback()


@pytest.mark.parametrize(
    ("rows", "want"),
    [
        (
            [
                {
                    "agent": "Engineer",
                    "field": "Backup model",
                    "kind": "value",
                    "before": None,
                    "after": "openai/gpt-4.1-mini",
                }
            ],
            "Engineer: added a backup model",
        ),
        (
            [{"agent": "Spec approval", "field": None, "kind": "added", "gate": True}],
            "Added the Spec approval gate",
        ),
        (
            [{"agent": "Engineer", "field": "Model", "kind": "value", "before": "a", "after": "b"}],
            "Engineer: model changed to b",
        ),
        (
            [
                {
                    "agent": None,
                    "field": "Budget",
                    "kind": "value",
                    "before": "$5.00",
                    "after": "$8.00",
                }
            ],
            "Budget changed to $8.00",
        ),
        (
            [
                {"agent": "Reviewer", "field": "Instructions", "kind": "text"},
                {
                    "agent": "Engineer",
                    "field": "Model",
                    "kind": "value",
                    "before": "a",
                    "after": "b",
                },
            ],
            "Reviewer: instructions changed and 1 more change",
        ),
    ],
)
def test_summaries_are_plain_words(rows, want):
    assert versions.summary(rows) == want


def test_no_node_column_is_left_out_of_a_version():
    """A new AgentNode column must be captured (and restored) or knowingly left out."""
    # cloned_from_node_id: a run snapshot's link to its library node, not content.
    left_out = {"team_graph_id", "created_at", "cloned_from_node_id"}
    captured = {
        "id",
        "role_name",
        "kind",
        "prompt",
        "model",
        "engine",
        "position",
        "config",
        "tool_config",
        "skills",
        "edits_allowed",
    }
    assert {c.name for c in AgentNode.__table__.columns} == captured | left_out


# ------------------------------------------------------------------- the backend review


def test_a_run_s_version_is_what_it_runs_even_when_an_edit_lands_during_the_launch(
    client, monkeypatch
):
    """The run is recorded on the version of the snapshot it RUNS: an edit that commits after
    the clone (while the pre-flight is out) stays a change since that version."""
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    team = library_team(client)
    _versions(client, team)
    eng = _node(client, team, "engineer")
    real = routers._launch_preflight

    def preflight(*a, **k):
        with session_scope() as session:
            session.get(AgentNode, uuid.UUID(eng["id"])).prompt = "Edited during the launch"
        return real(*a, **k)

    monkeypatch.setattr(routers, "_launch_preflight", preflight)
    body = client.post("/api/runs", json={"idea": "x", "team_graph_id": team}).json()
    assert body["team_version_number"] == 1 and body["version_saved"] is False
    with session_scope() as session:
        run = session.get(Run, uuid.UUID(body["run_id"]))
        cloned = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == run.team_graph_id, AgentNode.role_name == "engineer"
            )
        ).scalar_one()
        assert cloned.prompt == eng["prompt"]
    assert _versions(client, team)["changes"] == 1  # the late edit is still a change since v1


def test_a_run_whose_snapshot_differs_from_the_latest_version_saves_that_snapshot(
    client, monkeypatch
):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    team = library_team(client)
    _versions(client, team)
    eng = _node(client, team, "engineer")
    _patch(client, team, eng["id"], prompt="Before the launch")
    real = routers._launch_preflight

    def preflight(*a, **k):
        with session_scope() as session:
            session.get(AgentNode, uuid.UUID(eng["id"])).prompt = "After the clone"
        return real(*a, **k)

    monkeypatch.setattr(routers, "_launch_preflight", preflight)
    body = client.post("/api/runs", json={"idea": "x", "team_graph_id": team}).json()
    assert body["team_version_number"] == 2 and body["version_saved"] is True
    with session_scope() as session:
        team_row = session.get(TeamGraph, uuid.UUID(team))
        v2 = versions._version(session, team_row, 2)
        prompt = next(n for n in v2.graph["nodes"] if n["id"] == eng["id"])["prompt"]
    assert prompt == "Before the launch"  # what the run runs, not the late edit
    assert _versions(client, team)["changes"] == 1


def _tool_node(client, team: str, tool_id: uuid.UUID, switch: str) -> str:
    eng = _node(client, team, "engineer")
    with session_scope() as session:
        session.get(AgentNode, uuid.UUID(eng["id"])).tool_config = {
            "tvashtr": {"library": [str(tool_id)], "servers": {switch: {"enabled": False}}}
        }
    return eng["id"]


def test_a_toolkit_rename_is_not_a_change_and_restore_keeps_the_tool_switched_off(client):
    from tvashtr.control_plane import tool_usage
    from tvashtr.control_plane.node_library import create_owner_tool, update_owner_tool

    owner = auth_user_id()
    tid = create_owner_tool(owner, f"search-{uuid.uuid4().hex[:6]}", {"url": "https://s.test/mcp"})
    team = library_team(client)
    with session_scope() as session:
        from tvashtr.models import ToolLibraryItem

        name = session.get(ToolLibraryItem, tid).name
    node_id = _tool_node(client, team, tid, name)
    _versions(client, team)  # v1: the tool referenced, switched off
    renamed = f"websearch-{uuid.uuid4().hex[:6]}"
    assert update_owner_tool(owner, tid, renamed, {"url": "https://s.test/mcp"})
    assert _versions(client, team)["changes"] == 0  # a Toolkit rename isn't a team change
    eng = _node(client, team, "engineer")
    _patch(client, team, eng["id"], model="openai/gpt-4.1")
    _save(client, team)  # v2
    assert client.post(f"/api/teams/{team}/versions/1/restore").status_code == 201
    with session_scope() as session:
        cfg = session.get(AgentNode, uuid.UUID(node_id)).tool_config
    assert tool_usage.tool_effective(cfg, tid, renamed) is False  # still switched off
    assert tool_usage.tool_switched_off(cfg, renamed)


def test_restore_drops_what_no_longer_exists_and_never_widens_a_grant(client):
    from tvashtr.models import ConnectorConnection

    owner = auth_user_id()
    team = library_team(client)
    gone = uuid.uuid4()
    with session_scope() as session:
        conn = ConnectorConnection(
            owner_id=owner,
            connector_key="notion",
            name="Notion",
            slug=f"notion-{uuid.uuid4().hex[:6]}",
            url="https://mcp.notion.com/mcp",
            auth_kind="oauth",
            status="connected",
            access="write",
        )
        session.add(conn)
        session.flush()
        conn_id = conn.id
    eng = _node(client, team, "engineer")
    with session_scope() as session:
        node = session.get(AgentNode, uuid.UUID(eng["id"]))
        node.tool_config = {
            "tvashtr": {
                "library": [str(gone)],
                "connectors": [{"id": str(conn_id), "access": "write"}, {"id": str(gone)}],
            }
        }
        node.skills = [{"type": "library", "id": str(gone)}]
    _versions(client, team)  # v1 holds the refs
    _patch(client, team, eng["id"], model="openai/gpt-4.1")
    _save(client, team)  # v2
    with session_scope() as session:
        session.get(ConnectorConnection, conn_id).access = "read"  # narrowed since
    assert client.post(f"/api/teams/{team}/versions/1/restore").status_code == 201
    with session_scope() as session:
        node = session.get(AgentNode, uuid.UUID(eng["id"]))
        meta = (node.tool_config or {}).get("tvashtr", {})
        assert str(gone) not in meta.get("library", [])
        assert meta.get("connectors") == [{"id": str(conn_id)}]
        assert not node.skills


def test_settings_that_mean_the_same_are_not_changes(client):
    team = library_team(client)
    _versions(client, team)
    eng = _node(client, team, "engineer")
    _patch(client, team, eng["id"], memory_remember_enabled=True)
    _patch(client, team, eng["id"], memory_remember_enabled=False)
    assert _versions(client, team)["changes"] == 0


def test_one_kind_flip_is_not_three_changes(client):
    team = library_team(client)
    _versions(client, team)
    rev = _node(client, team, "reviewer")
    _patch(client, team, rev["id"], capability="thinker")
    saved = _save(client, team)
    fields = [r["field"] for r in client.get(f"/api/teams/{team}/versions/2").json()["changes"]]
    assert "Settings" not in fields and fields.count("Type") == 1, (fields, saved)


def test_a_name_summary_uses_the_names_people_see(client):
    team = library_team(client)
    eng = _node(client, team, "engineer")
    _patch(client, team, eng["id"], title="Builder")
    _versions(client, team)  # v1: "Builder"
    with session_scope() as session:
        node = session.get(AgentNode, uuid.UUID(eng["id"]))
        node.config = {k: v for k, v in (node.config or {}).items() if k != "title"}
    assert _save(client, team)["summary"] == "Renamed Builder to Engineer"


def test_a_change_to_a_gate_is_never_called_the_same(client):
    team = library_team(client, template="plan_review")
    _versions(client, team)
    gate = next(n for n in _graph(client, team)["nodes"] if n["kind"] == "gate")
    _patch(client, team, gate["id"], title="Sign-off")
    _save(client, team)
    assert "gates" not in client.get(f"/api/teams/{team}/versions/2").json()["same"]


@pytest.mark.parametrize("number", ["2147483648", "999999999999999999999", "9223372036854775808"])
def test_a_version_number_beyond_any_version_is_404(client, number):
    team = library_team(client)
    _versions(client, team)
    assert client.get(f"/api/teams/{team}/versions/{number}").status_code == 404
    assert client.get(f"/api/teams/{team}/versions/{number}/restore").status_code == 404
    assert client.post(f"/api/teams/{team}/versions/{number}/restore").status_code == 404


def test_a_note_with_a_nul_is_kept_without_it(client):
    team = library_team(client)
    _versions(client, team)
    eng = _node(client, team, "engineer")
    _patch(client, team, eng["id"], model="openai/gpt-4.1")
    assert _save(client, team, note="a\u0000b")["note"] == "ab"
