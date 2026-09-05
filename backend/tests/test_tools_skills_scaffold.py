"""M-tools C7.0 — the per-node tools + skills SCAFFOLD, proven inert end-to-end + wired.

Three proofs, matching the milestone's contract:

1. **Inertness** — with a node's ``tool_config`` / ``skills`` unset (NULL everywhere today), BOTH
   adapters construct the OpenHands ``Agent`` with ``mcp_config={}`` (⇒ NO MCP tools) and
   ``agent_context=None`` (NOT an empty ``AgentContext``, which would inject a datetime into the
   system message and change the prompt). And the two seam helpers are pure stubs. This is the
   byte-for-byte-unchanged guarantee at the adapter boundary.
2. **The wire reaches the AgentTask** — a worker node whose ``tool_config`` is a real MCP object,
   driven through the REAL ``run_team`` worker path, hands the adapter an ``AgentTask`` with that
   EXACT ``mcp_config``; and node's ``skills`` flow to ``build_skills``. (Offline: the adapter is
   a capturing fake — no LLM, no container.)
3. **Persistence round-trip** — a node PATCHed with a ``tool_config`` + ``skills`` reads back equal
   over the graph GET, survives an unrelated ``{prompt, model}`` save (additive), and rides the
   clone-on-launch snapshot onto the cloned node.

Offline throughout (mocked adapters / the in-process client), no NIM. Mirrors the established
harnesses in ``test_condenser_wiring`` (Agent-kwargs capture) + ``test_context_budget_executor``
(RecordingAdapter over ``run_team``) + ``test_capability_edit`` (the node PATCH round-trip).
"""

import shutil
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from conftest import auth_user_id, maybe_write_entry_report
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select, update

from tvashtr.control_plane import team_run
from tvashtr.control_plane.node_skills import build_skills, inject_skills_into_prompt
from tvashtr.control_plane.node_tools import build_mcp_config
from tvashtr.control_plane.teams import (
    build_two_node_team,
    clone_team_graph,
    create_team_from_template,
)
from tvashtr.db import session_scope
from tvashtr.engines import openhands_adapter as local_mod
from tvashtr.engines import openhands_docker_adapter as docker_mod
from tvashtr.engines.base import AgentRunResult, AgentTask
from tvashtr.models import AgentNode, Run

_MODEL = "nvidia_nim/meta/llama-3.3-70b-instruct"
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / ".tvashtr_workspaces"

# A realistic inline MCP config + skills array (the shapes C7.A / C7.B will populate for real).
_SAMPLE_TOOLS = {"mcpServers": {"fetch": {"command": "uvx", "args": ["mcp-server-fetch"]}}}
_SAMPLE_SKILLS = [{"name": "AGENTS.md", "content": "Reply concisely."}]


# =============================================================================================
# 1. INERTNESS — the adapter boundary is byte-for-byte unchanged with no tools/skills
# =============================================================================================


def _local_agent_kwargs(tmp_path, **task_kwargs) -> dict:
    """Run the LOCAL adapter with Agent + Conversation mocked; return the kwargs it passed to
    ``Agent(...)`` (the same capture technique as test_condenser_wiring)."""
    with (
        patch.object(local_mod, "Agent") as Agent,
        patch.object(local_mod, "Conversation"),
    ):
        task = AgentTask(
            instruction="x",
            workspace_dir=str(tmp_path),
            model=_MODEL,
            llm_api_key="byok-key",
            **task_kwargs,
        )
        local_mod.OpenHandsAdapter().run(task)
    assert Agent.call_count == 1, "the adapter must construct exactly one worker Agent"
    return Agent.call_args.kwargs


def _docker_agent_kwargs(tmp_path, **task_kwargs) -> dict:
    """Same Agent-kwargs capture for the DOCKER adapter (container + reap + Conversation mocked)."""
    ws = MagicMock()
    ws.working_dir = "/workspace"
    ws.execute_command.return_value = MagicMock(stdout="", exit_code=0)
    with (
        patch.object(docker_mod, "reap_agent_containers"),
        # M-unify U2: the adapter no longer uses ``with`` — DockerWorkspace(...) IS the workspace.
        patch.object(docker_mod, "DockerWorkspace", return_value=ws),
        patch.object(docker_mod, "Conversation"),
        patch.object(docker_mod, "Agent") as Agent,
    ):
        task = AgentTask(
            instruction="x",
            workspace_dir=str(tmp_path),
            model=_MODEL,
            llm_api_key="byok-key",
            **task_kwargs,
        )
        docker_mod.OpenHandsDockerAdapter().run(task)
    assert Agent.call_count == 1, "the adapter must construct exactly one worker Agent"
    return Agent.call_args.kwargs


@pytest.mark.parametrize("adapter", ["local", "docker"])
def test_no_tools_no_skills_agent_is_inert(adapter, tmp_path):
    """A task with ``mcp_config=None, skills=None`` (the AgentTask defaults) ⇒ the Agent gets an
    EMPTY mcp_config (no MCP tools) and ``agent_context=None``. This is the whole inertness claim:
    with both columns NULL the Agent is byte-identical to before the milestone."""
    kwargs = _local_agent_kwargs(tmp_path) if adapter == "local" else _docker_agent_kwargs(tmp_path)
    # No tools -> empty mcp_config -> the SDK creates NO MCP tools.
    assert kwargs["mcp_config"] == {}
    # No skills -> agent_context=None (NOT AgentContext(skills=[]), which injects a datetime).
    assert kwargs["agent_context"] is None


@pytest.mark.parametrize("adapter", ["local", "docker"])
def test_empty_skills_and_empty_config_still_inert(adapter, tmp_path):
    """The EXACT values the executor's worker path produces on the inert path — ``mcp_config={}``
    (from ``build_mcp_config(None)``) and ``skills=[]`` (from ``build_skills(None)``) — still map to
    an empty mcp_config and ``agent_context=None``. This pins the critical ``[] -> None`` mapping:
    an empty skills list must NOT become an empty ``AgentContext``."""
    kwargs = (
        _local_agent_kwargs(tmp_path, mcp_config={}, skills=[])
        if adapter == "local"
        else _docker_agent_kwargs(tmp_path, mcp_config={}, skills=[])
    )
    assert kwargs["mcp_config"] == {}
    assert kwargs["agent_context"] is None


def test_seam_helpers_are_inert_stubs():
    """The two follow-on seams are pure stubs today: no tools -> ``{}``, no skills -> ``[]``, no
    skill injection -> the prompt unchanged."""
    assert build_mcp_config(None, "r") == {}
    assert build_skills(None, "/w", "r") == []
    assert inject_skills_into_prompt(None, "hi", "r") == "hi"


def test_build_mcp_config_passthrough_is_a_defensive_copy():
    """The tools stub passes a real config through unchanged — but as a COPY, so a caller can never
    mutate the stored node config through the returned dict."""
    out = build_mcp_config(_SAMPLE_TOOLS, "r")
    assert out == _SAMPLE_TOOLS
    assert out is not _SAMPLE_TOOLS


# =============================================================================================
# 2. THE WIRE — a worker node's tool_config/skills reach the AgentTask handed to the adapter
# =============================================================================================


class _CapturingAdapter:
    """A greenfield fake adapter: captures the AgentTask's tools/skills, writes a deliverable so
    ``ship_step`` has something to commit, and reports success — no LLM, no container."""

    name = "openhands"

    def __init__(self, captured: dict) -> None:
        self._captured = captured

    def run(self, task, on_event=None):
        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        self._captured["mcp_config"] = task.mcp_config
        self._captured["skills"] = task.skills
        (Path(task.workspace_dir) / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def _set_agent_node_tools_skills(team_graph_id: str, tool_config, skills) -> None:
    """Set ``tool_config`` + ``skills`` on the team's worker (``kind="agent"``) node."""
    with session_scope() as session:
        session.execute(
            update(AgentNode)
            .where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                AgentNode.kind == "agent",
            )
            .values(tool_config=tool_config, skills=skills)
        )


def test_worker_tool_config_and_skills_flow_to_the_agenttask(client, monkeypatch):
    """A worker node carrying a real ``tool_config`` + ``skills``, driven through the REAL
    ``run_team`` worker path, hands the adapter an ``AgentTask`` whose ``mcp_config`` is EXACTLY the
    node's tool_config (``build_mcp_config`` pass-through), and its ``skills`` flow to
    ``build_skills`` (whose stub return, ``[]``, lands on the task). Mutation guard: dropping the
    ``mcp_config=`` / ``skills=`` kwargs on AgentTask in ``agent_run_step`` makes this go RED."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    team_graph_id = build_two_node_team()
    _set_agent_node_tools_skills(team_graph_id, _SAMPLE_TOOLS, _SAMPLE_SKILLS)

    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="Add a greeting.",
                workflow_id=run_id,
                status="running",
            )
        )

    # Fake PM (no LLM) + a capturing fake adapter (no container).
    captured: dict = {}
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _CapturingAdapter(captured))

    # Spy build_skills so we can prove the node's skills reached it (its stub still returns []).
    skills_calls: list = []
    real_build_skills = team_run.build_skills

    def _spy_build_skills(skills, workspace_dir, run_id_arg):
        skills_calls.append((skills, workspace_dir, run_id_arg))
        return real_build_skills(skills, workspace_dir, run_id_arg)

    monkeypatch.setattr(team_run, "build_skills", _spy_build_skills)

    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(team_run.run_team, "Add a greeting.")
        result = handle.get_result()
        assert result["status"] == "completed"

        # The node's tool_config reached the AgentTask VERBATIM (build_mcp_config pass-through).
        assert captured["mcp_config"] == _SAMPLE_TOOLS
        # build_skills received the node's skills (its stub return [] then lands on the task).
        assert skills_calls, "build_skills was never called on the worker path"
        # M-unify U1: the entry (edits-off PM) now runs the agent path too and calls build_skills
        # (with its own None skills) BEFORE the worker — so filter for the worker's call, not [0].
        assert _SAMPLE_SKILLS in [c[0] for c in skills_calls]
        assert captured["skills"] == []
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


# =============================================================================================
# 3. PERSISTENCE — PATCH -> GET round-trip, additive save, and the clone snapshot
# =============================================================================================


def _graph_nodes(client, tid: str) -> dict[str, dict]:
    return {n["role_name"]: n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]}


def test_fresh_node_graph_get_has_null_tools_and_skills(client):
    """Inertness at the GET boundary: a freshly-templated team's nodes expose ``tool_config`` and
    ``skills`` keys, both NULL — EXCEPT that M-thrift now stamps the vendored ``caveman`` skill on
    every WORKER node, so a worker's ``skills`` carries exactly that one source and nothing else.
    ``tool_config`` stays NULL everywhere; every non-worker node stays NULL on both."""
    tid = create_team_from_template("plan_review", "Fresh nulls", auth_user_id())
    for node in client.get(f"/api/teams/{tid}/graph").json()["nodes"]:
        assert node["tool_config"] is None
        if node["kind"] == "agent":
            assert [s["name"] for s in node["skills"]] == ["caveman"]
        else:
            assert node["skills"] is None


def test_patch_get_round_trip_and_clone_carries_tools_and_skills(client):
    """PATCH a worker node with a tool_config + skills, read it back over the GET (deep-equal),
    then clone the team (the launch snapshot) and assert the cloned node carries both."""
    tid = create_team_from_template("plan_review", "Round trip", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={
            "prompt": eng["prompt"],
            "model": eng["model"],
            "tool_config": _SAMPLE_TOOLS,
            "skills": _SAMPLE_SKILLS,
        },
    )
    assert resp.status_code == 200, resp.text
    # The PATCH response echoes them...
    assert resp.json()["tool_config"] == _SAMPLE_TOOLS
    assert resp.json()["skills"] == _SAMPLE_SKILLS
    # ...and a fresh GET reads them back equal (genuine persistence).
    got = _graph_nodes(client, tid)["engineer"]
    assert got["tool_config"] == _SAMPLE_TOOLS
    assert got["skills"] == _SAMPLE_SKILLS

    # Clone-on-launch snapshot carries them onto the cloned node.
    clone_id = clone_team_graph(tid)
    with session_scope() as session:
        clone_nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(clone_id)))
            .scalars()
            .all()
        )
    eng_clone = next(n for n in clone_nodes if n.role_name == "engineer")
    assert eng_clone.tool_config == _SAMPLE_TOOLS
    assert eng_clone.skills == _SAMPLE_SKILLS


def test_patch_omitting_tools_and_skills_leaves_them_unchanged(client):
    """Additive semantics: once set, a plain ``{prompt, model}`` save (omitting tool_config/skills)
    leaves the stored values untouched — the same is-not-None guard ``capability`` uses."""
    tid = create_team_from_template("plan_review", "Additive", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]
    client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={
            "prompt": eng["prompt"],
            "model": eng["model"],
            "tool_config": _SAMPLE_TOOLS,
            "skills": _SAMPLE_SKILLS,
        },
    )

    new_prompt = f"edited {uuid.uuid4().hex}"
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={"prompt": new_prompt, "model": eng["model"]},
    )
    assert resp.status_code == 200, resp.text

    got = _graph_nodes(client, tid)["engineer"]
    assert got["prompt"] == new_prompt  # the omitted-nothing fields DID change
    assert got["tool_config"] == _SAMPLE_TOOLS  # the omitted tool_config/skills did NOT
    assert got["skills"] == _SAMPLE_SKILLS
