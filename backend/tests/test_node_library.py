"""M-tools C7.C — the reusable account LIBRARY (``control_plane/node_library.py``) + the two
resolvers' library-reference expansion + the ``/api/tool-library`` and ``/api/skill-library``
endpoints.

Mutation-real, offline throughout (no NIM, no network — a library skill's source is inline; the
wire-through-executor test uses a RecordingAdapter over the real ``run_team``).

The C7.C storage model under test:
  * a node REFERENCES a library tool by id at ``tool_config.tvashtr.library`` (a list of ids) and a
    library skill by a ``{"type":"library","id":…}`` element in ``skills`` — NO new node column;
  * the reference is LIVE (content fetched fresh at run time from the owner-scoped library table);
  * ``build_mcp_config`` MERGES referenced servers with inline — INLINE WINS on a name collision;
  * ``_resolve_skills`` expands a library ref one level, then de-dups the final list by name (first
    wins);
  * a missing/deleted/foreign reference is SKIPPED and warned through the existing recorder;
  * a node with NO refs + NULL config is byte-for-byte inert (the C7.0/C7.A/C7.B posture holds).
"""

import ast
import json
import shutil
import uuid
from pathlib import Path

from conftest import auth_user_id, maybe_write_entry_report
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select, update

from tvashtr.control_plane import node_library, team_run
from tvashtr.control_plane.mcp_secrets import set_owner_mcp_secret
from tvashtr.control_plane.node_skills import build_skills
from tvashtr.control_plane.node_tools import build_mcp_config
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import AgentNode, Run, RunWarning, SkillLibraryItem, ToolLibraryItem, User

_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / ".tvashtr_workspaces"


# --------------------------------------------------------------------------------------------- #
# helpers (mirror test_mcp_tools / test_node_skills)
# --------------------------------------------------------------------------------------------- #
def _make_user() -> uuid.UUID:
    uid = uuid.uuid4()
    with session_scope() as session:
        session.add(User(id=uid, email=f"lib-{uid.hex}@tvashtr.local", password_hash="x"))
    return uid


def _make_owned_run(owner_id: uuid.UUID) -> str:
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


def _warnings(run_id: str) -> list[RunWarning]:
    with session_scope() as session:
        return (
            session.execute(select(RunWarning).where(RunWarning.run_id == uuid.UUID(run_id)))
            .scalars()
            .all()
        )


# ============================================================================================= #
# 1. Library store — CRUD (returns content, unlike a secret) + owner-scoping + upsert
# ============================================================================================= #
def test_tool_library_crud_returns_content_and_is_owner_scoped(client):
    owner = _make_user()
    other = _make_user()
    tid = node_library.create_owner_tool(owner, "gh", {"command": "gh-mcp", "args": ["--x"]})
    node_library.create_owner_tool(other, "gh", {"command": "OTHER"})  # a different account's item

    tools = node_library.list_owner_tools(owner)
    assert [t["name"] for t in tools] == ["gh"]  # only the owner's item
    assert tools[0]["server_config"] == {"command": "gh-mcp", "args": ["--x"]}  # content verbatim
    assert tools[0]["id"] == tid
    # resolver-facing fetch is owner-scoped: the other owner cannot resolve this id
    assert node_library.resolve_owner_tool(owner, tid) == (
        "gh",
        {"command": "gh-mcp", "args": ["--x"]},
    )
    assert node_library.resolve_owner_tool(other, tid) is None

    # update by id (owner-scoped) — a foreign owner's update is refused
    assert node_library.update_owner_tool(other, tid, "gh", {"command": "HACK"}) is False
    assert node_library.update_owner_tool(owner, tid, "gh", {"command": "gh2"}) is True
    assert node_library.resolve_owner_tool(owner, tid) == ("gh", {"command": "gh2"})

    # delete is idempotent + owner-scoped
    node_library.delete_owner_tool(other, tid)  # foreign -> no-op
    assert node_library.resolve_owner_tool(owner, tid) is not None
    node_library.delete_owner_tool(owner, tid)
    node_library.delete_owner_tool(owner, tid)  # idempotent
    assert node_library.list_owner_tools(owner) == []


def test_tool_library_create_is_upsert_on_owner_name(client):
    owner = _make_user()
    first = node_library.create_owner_tool(owner, "srv", {"command": "v1"})
    again = node_library.create_owner_tool(owner, "srv", {"command": "v2"})  # same name -> replace
    assert first == again  # same row
    tools = node_library.list_owner_tools(owner)
    assert len(tools) == 1
    assert tools[0]["server_config"] == {"command": "v2"}


def test_skill_library_crud_returns_source_and_is_owner_scoped(client):
    owner = _make_user()
    src = {"type": "inline", "name": "house", "content": "STYLE", "mode": "always"}
    sid = node_library.create_owner_skill(owner, "house-style", src)
    skills = node_library.list_owner_skills(owner)
    assert [s["name"] for s in skills] == ["house-style"]
    assert skills[0]["source"] == src  # the source object returned verbatim
    assert node_library.resolve_owner_skill_source(owner, sid) == src
    assert node_library.resolve_owner_skill_source(_make_user(), sid) is None  # owner-scoped


def test_resolve_absent_or_garbage_id_returns_none(client):
    owner = _make_user()
    assert node_library.resolve_owner_tool(owner, str(uuid.uuid4())) is None  # absent
    assert node_library.resolve_owner_tool(owner, "not-a-uuid") is None  # unparseable
    assert node_library.resolve_owner_skill_source(owner, "garbage") is None


# ============================================================================================= #
# 2. Library endpoints — content-returning CRUD, owner-scoped, validated
# ============================================================================================= #
def test_tool_library_endpoints_roundtrip_and_owner_scope(client):
    # create
    resp = client.post(
        "/api/tool-library", json={"name": "fetch", "server_config": {"command": "uvx", "args": []}}
    )
    assert resp.status_code == 200, resp.text
    item_id = resp.json()["id"]
    # list returns the content
    listed = client.get("/api/tool-library").json()["tools"]
    assert any(
        t["id"] == item_id and t["server_config"] == {"command": "uvx", "args": []} for t in listed
    )
    # update
    resp = client.patch(
        f"/api/tool-library/{item_id}",
        json={"name": "fetch", "server_config": {"command": "uvx", "args": ["mcp-server-fetch"]}},
    )
    assert resp.status_code == 200, resp.text
    got = next(t for t in client.get("/api/tool-library").json()["tools"] if t["id"] == item_id)
    assert got["server_config"] == {"command": "uvx", "args": ["mcp-server-fetch"]}
    # another owner's item is 404 on PATCH + invisible in list
    foreign = node_library.create_owner_tool(_make_user(), "foreign", {"command": "x"})
    assert (
        client.patch(
            f"/api/tool-library/{foreign}",
            json={"name": "foreign", "server_config": {"command": "y"}},
        ).status_code
        == 404
    )
    assert all(t["id"] != str(foreign) for t in client.get("/api/tool-library").json()["tools"])
    # delete (revamp: 200 {removed_from_agents}, still idempotent)
    resp = client.delete(f"/api/tool-library/{item_id}")
    assert resp.status_code == 200 and resp.json() == {"removed_from_agents": 0}
    assert client.delete(f"/api/tool-library/{item_id}").status_code == 200


def test_tool_library_rejects_empty_name_and_non_object_config(client):
    assert (
        client.post(
            "/api/tool-library", json={"name": "  ", "server_config": {"command": "x"}}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/tool-library", json={"name": "ok", "server_config": {}}).status_code
        == 422
    )


def test_skill_library_endpoints_roundtrip_and_reject_library_typed_source(client):
    resp = client.post(
        "/api/skill-library",
        json={"name": "sty", "source": {"type": "inline", "name": "sty", "content": "B"}},
    )
    assert resp.status_code == 200, resp.text
    sid = resp.json()["id"]
    listed = client.get("/api/skill-library").json()["skills"]
    assert any(s["id"] == sid and s["source"]["content"] == "B" for s in listed)
    # a library-typed source is rejected (no nesting)
    assert (
        client.post(
            "/api/skill-library",
            json={"name": "nest", "source": {"type": "library", "id": str(uuid.uuid4())}},
        ).status_code
        == 422
    )
    # an unknown-typed source is rejected too
    assert (
        client.post(
            "/api/skill-library", json={"name": "x", "source": {"type": "bogus"}}
        ).status_code
        == 422
    )
    assert client.delete(f"/api/skill-library/{sid}").status_code == 204


# ============================================================================================= #
# 3. Tools resolver — library expansion + precedence (inline wins) + allow-list + secret + strip
# ============================================================================================= #
def test_library_tool_is_merged_into_mcp_config(client):
    owner = _make_user()
    tid = node_library.create_owner_tool(owner, "libsrv", {"command": "LIB_CMD"})
    run_id = _make_owned_run(owner)
    out = build_mcp_config({"tvashtr": {"library": [str(tid)]}}, run_id)
    assert out["mcpServers"]["libsrv"] == {"command": "LIB_CMD"}  # referenced server merged in
    assert "tvashtr" not in out  # the tvashtr block (incl. library) is stripped


def test_inline_server_overrides_library_server_of_same_name(client):
    owner = _make_user()
    tid = node_library.create_owner_tool(owner, "gh", {"command": "LIBRARY_CMD"})
    run_id = _make_owned_run(owner)
    tool_config = {
        "mcpServers": {"gh": {"command": "INLINE_CMD"}},
        "tvashtr": {"library": [str(tid)]},
    }
    out = build_mcp_config(tool_config, run_id)
    assert out["mcpServers"]["gh"] == {"command": "INLINE_CMD"}  # INLINE wins on the name collision


def test_allowlist_disables_a_referenced_library_server(client):
    owner = _make_user()
    tid = node_library.create_owner_tool(owner, "libsrv", {"command": "LIB_CMD"})
    run_id = _make_owned_run(owner)
    tool_config = {"tvashtr": {"library": [str(tid)], "servers": {"libsrv": {"enabled": False}}}}
    out = build_mcp_config(tool_config, run_id)
    assert "libsrv" not in out["mcpServers"]  # enabled:false drops the referenced server


def test_secret_ref_inside_a_library_server_resolves_from_mcp_secrets(client):
    owner = _make_user()
    set_owner_mcp_secret(owner, "LIB_TOK", "sekret_val")
    tid = node_library.create_owner_tool(
        owner, "libsrv", {"command": "x", "env": {"T": "${LIB_TOK}"}}
    )
    run_id = _make_owned_run(owner)
    out = build_mcp_config({"tvashtr": {"library": [str(tid)]}}, run_id)
    assert out["mcpServers"]["libsrv"]["env"]["T"] == "sekret_val"


def test_missing_library_tool_ref_is_skipped_and_warns_on_graph(client):
    owner = auth_user_id()  # owned by the authenticated client so /graph is visible
    run_id = _make_owned_run(owner)
    ghost = str(uuid.uuid4())
    out = build_mcp_config({"tvashtr": {"library": [ghost]}}, run_id)
    assert out["mcpServers"] == {}  # the dangling ref contributes no server
    warns = _warnings(run_id)
    assert len(warns) == 1
    assert warns[0].source_kind == "tool"
    assert warns[0].name == f"library:{ghost}"
    assert "not found" in warns[0].reason
    graph = client.get(f"/api/runs/{run_id}/graph").json()
    assert graph["resolution_warnings"] == [
        {"source_kind": "tool", "name": f"library:{ghost}", "reason": warns[0].reason}
    ]


# ============================================================================================= #
# 4. Skills resolver — library expansion + de-dup (first-in-list wins) + missing-ref skip+warn
# ============================================================================================= #
def test_library_skill_source_is_expanded(client):
    owner = _make_user()
    sid = node_library.create_owner_skill(
        owner,
        "house-style",
        {"type": "inline", "name": "LIBNAME", "content": "LIB_BODY", "mode": "always"},
    )
    run_id = _make_owned_run(owner)
    out = build_skills([{"type": "library", "id": str(sid)}], "/w", run_id)
    assert len(out) == 1
    assert out[0].name == "LIBNAME"
    assert out[0].content == "LIB_BODY"


def test_skills_dedup_by_name_first_in_list_wins(client):
    owner = _make_user()
    run_id = _make_owned_run(owner)
    # two inline sources resolving to the SAME name; the FIRST (higher in the list) survives
    out = build_skills(
        [
            {"type": "inline", "name": "DUP", "content": "FIRST", "mode": "always"},
            {"type": "inline", "name": "DUP", "content": "SECOND", "mode": "always"},
        ],
        "/w",
        run_id,
    )
    assert len(out) == 1
    assert out[0].content == "FIRST"  # first-in-list wins


def test_inline_overrides_library_skill_of_same_name(client):
    owner = _make_user()
    sid = node_library.create_owner_skill(
        owner, "dup", {"type": "inline", "name": "DUP", "content": "LIBRARY_BODY", "mode": "always"}
    )
    run_id = _make_owned_run(owner)
    # inline listed FIRST, then the library ref (same resolved name) -> inline wins (first-in-list)
    out = build_skills(
        [
            {"type": "inline", "name": "DUP", "content": "INLINE_BODY", "mode": "always"},
            {"type": "library", "id": str(sid)},
        ],
        "/w",
        run_id,
    )
    assert len(out) == 1
    assert out[0].content == "INLINE_BODY"


def test_missing_library_skill_ref_is_skipped_and_warns(client):
    owner = _make_user()
    run_id = _make_owned_run(owner)
    ghost = str(uuid.uuid4())
    out = build_skills([{"type": "library", "id": ghost}], "/w", run_id)
    assert out == []  # dangling ref contributes nothing, run continues
    warns = _warnings(run_id)
    assert len(warns) == 1
    assert warns[0].source_kind == "skill"
    assert warns[0].name == f"library:{ghost}"
    assert "not found" in warns[0].reason


# ============================================================================================= #
# 5. Wire-through-the-real-executor — a library-referenced server reaches task.mcp_config VERBATIM
# ============================================================================================= #
class _CapturingAdapter:
    name = "openhands"

    def __init__(self, captured: dict) -> None:
        self._captured = captured

    def run(self, task, on_event=None):
        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        self._captured["mcp_config"] = task.mcp_config
        (Path(task.workspace_dir) / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def test_library_tool_reference_reaches_the_sandbox_through_run_team(client, monkeypatch):
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    owner = auth_user_id()
    tid = node_library.create_owner_tool(
        owner, "libfetch", {"command": "lib-cmd", "args": ["--go"]}
    )

    team_graph_id = build_two_node_team()
    # the worker node REFERENCES the library tool (no inline mcpServers) — the LIVE reference
    with session_scope() as session:
        session.execute(
            update(AgentNode)
            .where(AgentNode.team_graph_id == uuid.UUID(team_graph_id), AgentNode.kind == "agent")
            .values(tool_config={"tvashtr": {"library": [str(tid)]}})
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

    captured: dict = {}
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _CapturingAdapter(captured))

    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(team_run.run_team, "Add a greeting.")
        result = handle.get_result()
        assert result["status"] == "completed"
        # the LIVE library reference expanded into the sandbox mcp_config VERBATIM (through the real
        # executor — no signature widening, team_run untouched)
        assert captured["mcp_config"]["mcpServers"]["libfetch"] == {
            "command": "lib-cmd",
            "args": ["--go"],
        }
        # the stored node row still holds ONLY the reference (no snapshot copied onto the node)
        with session_scope() as session:
            node = session.execute(
                select(AgentNode).where(
                    AgentNode.team_graph_id == uuid.UUID(team_graph_id), AgentNode.kind == "agent"
                )
            ).scalar_one()
            assert node.tool_config == {"tvashtr": {"library": [str(tid)]}}
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


# ============================================================================================= #
# 6. Inertness backstop — a node with NO refs + NULL config is byte-for-byte unchanged
# ============================================================================================= #
def test_no_library_refs_is_byte_for_byte_inert(client):
    owner = _make_user()
    run_id = _make_owned_run(owner)
    # NULL/empty -> {} / [] (unchanged from pre-C7.C)
    assert build_mcp_config(None, run_id) == {}
    assert build_mcp_config({}, run_id) == {}
    assert build_skills(None, "/w", run_id) == []
    # a plain inline config with no library key resolves exactly as before
    assert build_mcp_config({"mcpServers": {"a": {"command": "a"}}}, run_id) == {
        "mcpServers": {"a": {"command": "a"}}
    }
    # an EMPTY library list contributes nothing and writes no warning
    assert build_mcp_config({"tvashtr": {"library": []}}, run_id) == {"mcpServers": {}}
    assert _warnings(run_id) == []


# ============================================================================================= #
# 7. INVARIANT — node_library has NO module-level openhands import
# ============================================================================================= #
def test_node_library_has_no_module_level_openhands_import():
    src = Path(node_library.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                assert not alias.name.startswith("openhands")
        elif isinstance(node, ast.ImportFrom):
            assert not (node.module or "").startswith("openhands")


# a reference to the ORM types keeps the import used (and documents the tables under test)
_ = (SkillLibraryItem, ToolLibraryItem, json)
