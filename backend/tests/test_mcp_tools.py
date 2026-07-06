"""M-tools C7.A (Tools) — MCP secret brokering, per-server allow-list, skip-and-warn, and the
run-scoped resolution-warning recorder + its /graph wire + the S2 clear path.

Offline throughout (mocked adapter / the in-process client), no NIM, no container. Mirrors the
established harnesses: ``test_tools_skills_scaffold`` (RecordingAdapter over ``run_team``),
``test_resolve_owner_key`` (fresh-owner + encrypted-credential seed), ``test_capability_edit`` (the
node PATCH round-trip).

The three secret guarantees (the C8 credential invariant, pulled forward):
1. the stored ``agent_nodes.tool_config`` row holds only ``${NAME}`` — never the plaintext;
2. the plaintext never appears in the model prompt / ``run_events`` / any Tvashtr-controlled store;
3. the value is encrypted at rest in ``mcp_secrets`` (row != plaintext; decrypt -> plaintext).
"""

import json
import shutil
import uuid
from pathlib import Path

from conftest import auth_user_id, seed_pm_prd
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select, update

from tvashtr.control_plane import team_run
from tvashtr.control_plane.credentials import decrypt_secret
from tvashtr.control_plane.mcp_secrets import (
    delete_owner_mcp_secret,
    list_owner_mcp_secret_names,
    resolve_owner_mcp_secret,
    set_owner_mcp_secret,
)
from tvashtr.control_plane.node_tools import build_mcp_config
from tvashtr.control_plane.resolution_warnings import record_resolution_warning
from tvashtr.control_plane.teams import build_two_node_team, create_team_from_template
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import AgentNode, McpSecret, Run, RunEvent, RunWarning, User

_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / ".tvashtr_workspaces"


# --------------------------------------------------------------------------------------------- #
# helpers (mirror test_resolve_owner_key / test_tools_skills_scaffold)
# --------------------------------------------------------------------------------------------- #
def _make_user() -> uuid.UUID:
    uid = uuid.uuid4()
    with session_scope() as session:
        session.add(User(id=uid, email=f"mcp-{uid.hex}@tvashtr.local", password_hash="x"))
    return uid


def _make_owned_run(owner_id: uuid.UUID) -> str:
    """A minimal owned run (workflow_id == run_id == str(id)) so build_mcp_config can resolve the
    owner and /graph can find + owner-scope it."""
    run_id = str(uuid.uuid4())
    team_graph_id = build_two_node_team()
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=owner_id,
                idea="x",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def _graph_nodes(client, tid: str) -> dict[str, dict]:
    return {n["role_name"]: n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]}


# --------------------------------------------------------------------------------------------- #
# 1. secret storage: encrypted at rest + resolver (guarantee 3)
# --------------------------------------------------------------------------------------------- #
def test_mcp_secret_is_encrypted_at_rest_and_resolves(client):
    owner = _make_user()
    set_owner_mcp_secret(owner, "GITHUB_TOKEN", "ghp_secretvalue_123")

    with session_scope() as session:
        row = session.execute(
            select(McpSecret).where(McpSecret.owner_id == owner, McpSecret.name == "GITHUB_TOKEN")
        ).scalar_one()
        stored = row.secret_encrypted
    # encrypted at rest: ciphertext != plaintext, but decrypts back to it
    assert stored != "ghp_secretvalue_123"
    assert decrypt_secret(stored) == "ghp_secretvalue_123"
    # the resolver returns the plaintext; a missing name returns None (never raises)
    assert resolve_owner_mcp_secret(owner, "GITHUB_TOKEN") == "ghp_secretvalue_123"
    assert resolve_owner_mcp_secret(owner, "ABSENT") is None


def test_secret_crud_lists_names_only_and_deletes(client):
    owner = _make_user()
    set_owner_mcp_secret(owner, "A_TOKEN", "va")
    set_owner_mcp_secret(owner, "B_TOKEN", "vb")
    assert sorted(list_owner_mcp_secret_names(owner)) == ["A_TOKEN", "B_TOKEN"]
    # set again = replace (upsert), still one row per name
    set_owner_mcp_secret(owner, "A_TOKEN", "va2")
    assert resolve_owner_mcp_secret(owner, "A_TOKEN") == "va2"
    assert sorted(list_owner_mcp_secret_names(owner)) == ["A_TOKEN", "B_TOKEN"]
    delete_owner_mcp_secret(owner, "A_TOKEN")
    assert list_owner_mcp_secret_names(owner) == ["B_TOKEN"]


# --------------------------------------------------------------------------------------------- #
# 2. build_mcp_config: substitution (guarantee 1 — input row unmutated)
# --------------------------------------------------------------------------------------------- #
def test_build_mcp_config_substitutes_secret_into_env_and_headers(client):
    owner = _make_user()
    set_owner_mcp_secret(owner, "GH_TOKEN", "ghp_live_999")
    run_id = _make_owned_run(owner)
    tool_config = {
        "mcpServers": {
            "gh": {
                "command": "gh-mcp",
                "env": {"GH_TOKEN": "${GH_TOKEN}"},
                "headers": {"Authorization": "Bearer ${GH_TOKEN}"},
            }
        }
    }
    out = build_mcp_config(tool_config, run_id)
    server = out["mcpServers"]["gh"]
    assert server["env"]["GH_TOKEN"] == "ghp_live_999"  # exact-value ref substituted
    assert server["headers"]["Authorization"] == "Bearer ghp_live_999"  # embedded ref substituted
    # guarantee 1: build_mcp_config never mutates its input (the row stays ${...})
    assert tool_config["mcpServers"]["gh"]["env"]["GH_TOKEN"] == "${GH_TOKEN}"
    assert tool_config["mcpServers"]["gh"]["headers"]["Authorization"] == "Bearer ${GH_TOKEN}"


def test_build_mcp_config_none_is_inert_and_writes_no_warning(client):
    """The inertness backstop: a NULL tool_config returns {} and records nothing."""
    owner = _make_user()
    run_id = _make_owned_run(owner)
    assert build_mcp_config(None, run_id) == {}
    assert build_mcp_config({}, run_id) == {}
    with session_scope() as session:
        warns = (
            session.execute(select(RunWarning).where(RunWarning.run_id == uuid.UUID(run_id)))
            .scalars()
            .all()
        )
    assert warns == []


# --------------------------------------------------------------------------------------------- #
# 3. per-server allow-list (C7.A-2)
# --------------------------------------------------------------------------------------------- #
def test_allowlist_disabled_server_dropped_and_tvashtr_block_stripped(client):
    owner = _make_user()
    run_id = _make_owned_run(owner)
    tool_config = {
        "mcpServers": {"a": {"command": "a"}, "b": {"command": "b"}},
        "tvashtr": {"servers": {"b": {"enabled": False}}},
    }
    out = build_mcp_config(tool_config, run_id)
    assert set(out["mcpServers"]) == {"a"}  # b disabled -> dropped
    assert "tvashtr" not in out  # the Tvashtr-only metadata block is stripped from the return


def test_pasted_config_without_tvashtr_block_keeps_all_servers(client):
    owner = _make_user()
    run_id = _make_owned_run(owner)
    tool_config = {"mcpServers": {"a": {"command": "a"}, "b": {"command": "b"}}}
    out = build_mcp_config(tool_config, run_id)
    assert set(out["mcpServers"]) == {"a", "b"}  # a pasted config = all-on


# --------------------------------------------------------------------------------------------- #
# 4. skip-and-warn + the /graph resolution_warnings wire
# --------------------------------------------------------------------------------------------- #
def test_missing_secret_skips_server_records_warning_and_shows_on_graph(client):
    owner = auth_user_id()  # owned by the authenticated client so /graph is visible
    run_id = _make_owned_run(owner)
    tool_config = {
        "mcpServers": {
            "needs": {"command": "x", "env": {"TOK": "${MISSING_TOKEN}"}},
            "plain": {"command": "y"},
        }
    }
    out = build_mcp_config(tool_config, run_id)
    assert "needs" not in out["mcpServers"]  # unresolvable -> dropped
    assert "plain" in out["mcpServers"]  # no refs -> kept, run continues

    with session_scope() as session:
        warns = (
            session.execute(select(RunWarning).where(RunWarning.run_id == uuid.UUID(run_id)))
            .scalars()
            .all()
        )
    assert len(warns) == 1
    assert warns[0].source_kind == "tool"
    assert warns[0].name == "needs"
    assert "MISSING_TOKEN" in warns[0].reason

    graph = client.get(f"/api/runs/{run_id}/graph").json()
    assert graph["resolution_warnings"] == [
        {"source_kind": "tool", "name": "needs", "reason": warns[0].reason}
    ]


def test_recorder_writes_once_and_dedupes(client):
    owner = _make_user()
    run_id = _make_owned_run(owner)
    record_resolution_warning(run_id, "tool", "srv", "missing secret X")
    record_resolution_warning(run_id, "tool", "srv", "missing secret X")  # identical -> deduped
    record_resolution_warning(run_id, "skill", "srv", "missing secret X")  # different kind -> new
    with session_scope() as session:
        rows = (
            session.execute(select(RunWarning).where(RunWarning.run_id == uuid.UUID(run_id)))
            .scalars()
            .all()
        )
    assert len(rows) == 2


def test_graph_resolution_warnings_empty_ordered_and_owner_scoped(client):
    owner = auth_user_id()
    run_id = _make_owned_run(owner)
    # empty when none
    assert client.get(f"/api/runs/{run_id}/graph").json()["resolution_warnings"] == []
    # ordered by created_at ASC
    record_resolution_warning(run_id, "tool", "first", "r1")
    record_resolution_warning(run_id, "skill", "second", "r2")
    graph = client.get(f"/api/runs/{run_id}/graph").json()
    assert [w["name"] for w in graph["resolution_warnings"]] == ["first", "second"]

    # owner-scoped: another owner's run + warning is NOT visible to this client (404)
    other = _make_user()
    other_run = _make_owned_run(other)
    record_resolution_warning(other_run, "tool", "hidden", "r3")
    assert client.get(f"/api/runs/{other_run}/graph").status_code == 404


# --------------------------------------------------------------------------------------------- #
# 5. the whole secret journey through run_team: resolved into the sandbox, never leaked (g.2)
# --------------------------------------------------------------------------------------------- #
class _CapturingAdapter:
    name = "openhands"

    def __init__(self, captured: dict) -> None:
        self._captured = captured

    def run(self, task, on_event=None):
        self._captured["mcp_config"] = task.mcp_config
        self._captured["instruction"] = task.instruction
        (Path(task.workspace_dir) / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def test_resolved_secret_reaches_sandbox_but_never_prompt_row_or_events(client, monkeypatch):
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    owner = auth_user_id()
    set_owner_mcp_secret(owner, "GH_TOKEN", "ghp_TOPSECRET_zzz")

    team_graph_id = build_two_node_team()
    tool_config = {"mcpServers": {"gh": {"command": "x", "env": {"GH_TOKEN": "${GH_TOKEN}"}}}}
    with session_scope() as session:
        session.execute(
            update(AgentNode)
            .where(AgentNode.team_graph_id == uuid.UUID(team_graph_id), AgentNode.kind == "agent")
            .values(tool_config=tool_config)
        )

    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=owner,
                idea="Add a greeting.",
                workflow_id=run_id,
                status="running",
            )
        )

    monkeypatch.setattr(team_run, "pm_step", lambda r, i, m, p, mt, inv=None: seed_pm_prd(r, i))
    captured: dict = {}
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _CapturingAdapter(captured))

    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(team_run.run_team, "Add a greeting.")
        result = handle.get_result()
        assert result["status"] == "completed"

        # the resolved plaintext DID reach the sandbox mcp_config (the intended posture)...
        assert captured["mcp_config"]["mcpServers"]["gh"]["env"]["GH_TOKEN"] == "ghp_TOPSECRET_zzz"
        # ...but NEVER the model prompt/instruction
        assert "ghp_TOPSECRET_zzz" not in captured["instruction"]
        # ...NEVER the stored node row (it still holds only the ${NAME} reference)
        with session_scope() as session:
            node = session.execute(
                select(AgentNode).where(
                    AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                    AgentNode.kind == "agent",
                )
            ).scalar_one()
            assert node.tool_config["mcpServers"]["gh"]["env"]["GH_TOKEN"] == "${GH_TOKEN}"
        # ...NEVER run_events
        with session_scope() as session:
            events = (
                session.execute(select(RunEvent).where(RunEvent.run_id == run_id)).scalars().all()
            )
        assert "ghp_TOPSECRET_zzz" not in json.dumps([e.payload for e in events])
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


# --------------------------------------------------------------------------------------------- #
# 6. the S2 clear path — for BOTH tool_config AND skills
# --------------------------------------------------------------------------------------------- #
def test_patch_clears_both_fields_with_explicit_null(client):
    tid = create_team_from_template("plan_review", "Clear", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]
    # set both
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={
            "prompt": eng["prompt"],
            "model": eng["model"],
            "tool_config": {"mcpServers": {}},
            "skills": [{"name": "a", "content": "b"}],
        },
    )
    assert resp.status_code == 200, resp.text
    got = _graph_nodes(client, tid)["engineer"]
    assert got["tool_config"] == {"mcpServers": {}}
    assert got["skills"] == [{"name": "a", "content": "b"}]

    # explicit null clears BOTH to NULL
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={"prompt": eng["prompt"], "model": eng["model"], "tool_config": None, "skills": None},
    )
    assert resp.status_code == 200, resp.text
    got = _graph_nodes(client, tid)["engineer"]
    assert got["tool_config"] is None
    assert got["skills"] is None


def test_patch_omitting_both_fields_leaves_them_unchanged(client):
    """S2's other direction: a field ABSENT from the body (not in model_fields_set) is untouched."""
    tid = create_team_from_template("plan_review", "Absent", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]
    client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={
            "prompt": eng["prompt"],
            "model": eng["model"],
            "tool_config": {"mcpServers": {"keep": {"command": "k"}}},
            "skills": [{"name": "s", "content": "c"}],
        },
    )
    new_prompt = f"edited {uuid.uuid4().hex}"
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={"prompt": new_prompt, "model": eng["model"]},
    )
    assert resp.status_code == 200, resp.text
    got = _graph_nodes(client, tid)["engineer"]
    assert got["prompt"] == new_prompt  # the sent field changed
    assert got["tool_config"] == {"mcpServers": {"keep": {"command": "k"}}}  # omitted -> unchanged
    assert got["skills"] == [{"name": "s", "content": "c"}]
