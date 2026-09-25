"""B-NODES (frontend revamp): executor honesty for the agent panel's settings — ``reads_default``,
the output format checked for every agent kind (the verdict file for verdict-emitting agents), the
Images (``multimodal``) opt-in threaded into the agent's LLM config, and Desktop subscription agents
getting their skills folded into the instruction plus a ``tools`` run warning.

The real ``run_team`` / ``agent_run_step`` run against fake adapters at the ``resolve_adapter`` seam
(no LLM, no container)."""

import json
import uuid
from pathlib import Path

from conftest import auth_user_id, maybe_write_entry_report
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane import team_run
from tvashtr.control_plane.context_compiler import resolve_reads_default
from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult, AgentTask
from tvashtr.gateway import gateway as gw
from tvashtr.models import AgentNode, Run, RunWarning


class _Recorder:
    """Records every task; the entry writes REPORT.md, a verdict-only node writes ``verdict``,
    any other worker writes a file."""

    name = "openhands"

    def __init__(self, verdict: dict | None = None) -> None:
        self.tasks: list[AgentTask] = []
        self.verdict = verdict if verdict is not None else {"verdict": "approved"}

    def run(self, task, on_event=None):
        self.tasks.append(task)
        ws = Path(task.workspace_dir)
        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="r", events=[], files_changed=["REPORT.md"]
            )
        if task.pull_paths == ("REVIEW_VERDICT.json",):
            ws.joinpath("REVIEW_VERDICT.json").write_text(json.dumps(self.verdict))
            return AgentRunResult(
                status="completed", summary="v", events=[], files_changed=["REVIEW_VERDICT.json"]
            )
        ws.joinpath("greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def _set_config(team_graph_id: str, role_name: str, updates: dict) -> None:
    with session_scope() as session:
        node = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                AgentNode.role_name == role_name,
            )
        ).scalar_one()
        node.config = {**(node.config or {}), **updates}


def _seed_run(team_graph_id: str, **extra) -> str:
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
                **extra,
            )
        )
    return run_id


def _warnings(run_id: str, source_kind: str) -> list[RunWarning]:
    with session_scope() as session:
        return list(
            session.execute(
                select(RunWarning).where(
                    RunWarning.run_id == uuid.UUID(run_id), RunWarning.source_kind == source_kind
                )
            )
            .scalars()
            .all()
        )


def _drive(monkeypatch, tmp_path, team_graph_id: str, adapter: _Recorder) -> tuple[str, dict]:
    from dbos import DBOS, SetWorkflowID

    from tvashtr.control_plane.shipping import init_workspace_repo

    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    monkeypatch.delenv("TVASHTR_FORCE_REVISIONS", raising=False)
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: adapter)
    run_id = _seed_run(team_graph_id)
    with SetWorkflowID(run_id):
        result = DBOS.start_workflow(team_run.run_team, "Add a greeting.").get_result()
    return run_id, result


def _engineer_task(adapter: _Recorder) -> AgentTask:
    return next(t for t in adapter.tasks if "REPORT-ONLY NODE" not in t.instruction)


# ---- reads_default ------------------------------------------------------------------------------


def test_resolve_reads_default():
    assert resolve_reads_default(None) is True
    assert resolve_reads_default({}) is True
    assert resolve_reads_default({"reads_default": True}) is True
    assert resolve_reads_default({"reads_default": False}) is False
    assert resolve_reads_default({"reads_default": "no"}) is True  # only a real False turns it off


def test_reads_default_false_skips_the_spec(client, monkeypatch, tmp_path):
    team = build_two_node_team()
    _set_config(team, "engineer", {"reads_default": False})
    adapter = _Recorder()
    run_id, result = _drive(monkeypatch, tmp_path, team, adapter)
    assert result["status"] == "completed", result
    assert "--- PRD ---" not in _engineer_task(adapter).instruction


def test_the_default_reader_still_gets_the_spec(client, monkeypatch, tmp_path):
    adapter = _Recorder()
    _run_id, result = _drive(monkeypatch, tmp_path, build_two_node_team(), adapter)
    assert result["status"] == "completed", result
    assert "--- PRD ---" in _engineer_task(adapter).instruction


# ---- output format for every kind --------------------------------------------------------------


def test_output_schema_is_checked_on_a_worker(client, monkeypatch, tmp_path):
    """An edits-on worker (``agent`` kind) whose output does not match its output format records
    the advisory warning — the check used to run for ``completion`` nodes only. (Its REPORT.md here
    is the shared workspace's prose, which is not JSON.)"""
    team = build_two_node_team()
    _set_config(team, "engineer", {"output_schema": {"type": "object"}})
    run_id, result = _drive(monkeypatch, tmp_path, team, _Recorder())
    assert result["status"] == "completed"  # advisory, never fatal
    hits = _warnings(run_id, "output_schema")
    assert [w.name for w in hits] == ["engineer"]
    assert _warnings(run_id, "output_schema")[0].reason == "output is not valid JSON"


def test_output_schema_miss_when_there_is_no_report(client, monkeypatch, tmp_path):
    """No REPORT.md at all is itself a miss (the old completion-only check skipped it silently)."""
    from tvashtr.control_plane.team_run import _output_schema_violation

    assert (
        _output_schema_violation(None, {"type": "object"}) is None
    )  # the pure helper is unchanged
    team = build_two_node_team()
    _set_config(team, "engineer", {"output_schema": {"type": "object"}})
    adapter = _Recorder()
    real_run = adapter.run

    def run_and_drop_report(task, on_event=None):
        result = real_run(task, on_event)
        if "REPORT-ONLY NODE" not in task.instruction:
            Path(task.workspace_dir).joinpath("REPORT.md").unlink(missing_ok=True)
        return result

    adapter.run = run_and_drop_report
    run_id, result = _drive(monkeypatch, tmp_path, team, adapter)
    assert result["status"] == "completed"
    assert [(w.name, w.reason) for w in _warnings(run_id, "output_schema")] == [
        ("engineer", "no REPORT.md to check against the output format")
    ]


def test_output_schema_checks_the_verdict_of_an_emitting_agent(client, monkeypatch, tmp_path):
    team = build_review_loop_team()
    schema = {"type": "object", "required": ["verdict", "reasons"]}
    _set_config(team, "reviewer", {"output_schema": schema})
    run_id, result = _drive(monkeypatch, tmp_path, team, _Recorder({"verdict": "approved"}))
    assert result["status"] == "completed", result
    hits = _warnings(run_id, "output_schema")
    assert len(hits) == 1 and hits[0].name == "reviewer"
    assert "reasons" in hits[0].reason


def test_a_matching_verdict_records_nothing(client, monkeypatch, tmp_path):
    team = build_review_loop_team()
    schema = {"type": "object", "required": ["verdict", "reasons"]}
    _set_config(team, "reviewer", {"output_schema": schema})
    verdict = {"verdict": "approved", "reasons": "Tests pass."}
    run_id, result = _drive(monkeypatch, tmp_path, team, _Recorder(verdict))
    assert result["status"] == "completed", result
    assert _warnings(run_id, "output_schema") == []


# ---- agent_run_step: multimodal + the Desktop fold ----------------------------------------------


def _step(run_id: str, model: str, tmp_path, monkeypatch, **kwargs):
    adapter = _Recorder()
    engines: list[str] = []

    def fake_resolve(name):
        engines.append(name)
        return adapter

    monkeypatch.setattr(team_run, "resolve_adapter", fake_resolve)
    monkeypatch.setattr(get_settings(), "litellm_proxy_enabled", False)
    monkeypatch.delenv("TVASHTR_FORCE_REVISIONS", raising=False)
    ws = tmp_path / "ws"
    ws.mkdir(exist_ok=True)
    out = team_run.agent_run_step(
        run_id, "do the thing", model, 1, "idea", "spec", str(ws), None, None, False, 100_000, 7,
        node_id="node-xyz", **kwargs,
    )  # fmt: skip
    return out, engines, adapter.tasks[0]


def test_multimodal_reaches_the_task_when_the_model_takes_images(client, tmp_path, monkeypatch):
    monkeypatch.setattr(gw.litellm, "supports_vision", lambda model: True)
    run_id = _seed_run(build_two_node_team())
    out, _engines, task = _step(
        run_id, "openai/gpt-4o-mini", tmp_path, monkeypatch, multimodal=True
    )
    assert out["status"] == "completed"
    assert task.multimodal is True
    assert _warnings(run_id, "multimodal") == []


def test_the_authored_images_setting_reaches_the_run(client, monkeypatch, tmp_path):
    """The workflow body threads ``config["multimodal"]`` into the step for that node only."""
    monkeypatch.setattr(gw.litellm, "supports_vision", lambda model: True)
    team = build_two_node_team()
    _set_config(team, "engineer", {"multimodal": True})
    adapter = _Recorder()
    _run_id, result = _drive(monkeypatch, tmp_path, team, adapter)
    assert result["status"] == "completed", result
    assert _engineer_task(adapter).multimodal is True
    assert all(not t.multimodal for t in adapter.tasks if t is not _engineer_task(adapter))


def test_multimodal_on_a_text_only_model_warns(client, tmp_path, monkeypatch):
    monkeypatch.setattr(gw.litellm, "supports_vision", lambda model: False)
    run_id = _seed_run(build_two_node_team())
    _out, _engines, task = _step(
        run_id, "openai/gpt-4o-mini", tmp_path, monkeypatch, multimodal=True
    )
    assert task.multimodal is False
    hits = _warnings(run_id, "multimodal")
    assert len(hits) == 1 and "does not accept image input" in hits[0].reason


def test_multimodal_off_leaves_the_task_unchanged(client, tmp_path, monkeypatch):
    run_id = _seed_run(build_two_node_team())
    _out, _engines, task = _step(run_id, "openai/gpt-4o-mini", tmp_path, monkeypatch)
    assert task.multimodal is False
    assert _warnings(run_id, "multimodal") == []


_SKILL = {
    "type": "inline",
    "name": "house-style",
    "content": "HOUSE STYLE: tabs.",
    "mode": "always",
}
_TOOLS = {"mcpServers": {"fetch": {"command": "uvx", "args": ["mcp-server-fetch"]}}}


def test_desktop_agent_gets_skills_in_its_instruction_and_a_tools_warning(
    client, tmp_path, monkeypatch
):
    run_id = _seed_run(build_two_node_team(), desktop_target=True, desktop_subscriptions=["claude"])
    out, engines, task = _step(
        run_id,
        "anthropic/claude-sonnet-5",
        tmp_path,
        monkeypatch,
        skills=[_SKILL],
        tool_config=_TOOLS,
        multimodal=True,
    )
    assert engines == ["desktop-runner"]
    assert task.instruction.startswith("HOUSE STYLE: tabs.")
    assert "do the thing" in task.instruction
    assert task.skills == [] and task.mcp_config == {}
    tools = _warnings(run_id, "tools")
    assert [(w.name, w.reason) for w in tools] == [
        (
            "fetch",
            "tools aren't used by Desktop subscription agents yet — this agent ran without them",
        )
    ]
    assert task.multimodal is False and len(_warnings(run_id, "multimodal")) == 1


def test_hosted_agent_keeps_skills_as_context(client, tmp_path, monkeypatch):
    run_id = _seed_run(build_two_node_team())
    _out, _engines, task = _step(
        run_id, "openai/gpt-4o-mini", tmp_path, monkeypatch, skills=[_SKILL], tool_config=_TOOLS
    )
    assert not task.instruction.startswith("HOUSE STYLE")
    assert [s.name for s in task.skills] == ["house-style"]
    assert _warnings(run_id, "tools") == []


# ---- the adapters build the LLM with vision on when the task opts in ----------------------------


def test_the_local_and_docker_adapters_turn_vision_on_for_a_multimodal_task(tmp_path):
    from unittest.mock import patch

    from test_proxy_adapter_wiring import _fake_conversation

    from tvashtr.config import Settings
    from tvashtr.engines import openhands_adapter as local_mod
    from tvashtr.engines import openhands_docker_adapter as docker_mod

    settings = Settings(_env_file=None, litellm_proxy_enabled=False)

    def local_kwargs(multimodal: bool) -> dict:
        with (
            patch.object(local_mod, "get_settings", return_value=settings),
            patch.object(local_mod, "LLM") as LLM,
            patch.object(local_mod, "Agent"),
            patch.object(local_mod, "LLMSummarizingCondenser"),
            patch.object(local_mod, "Tool"),
            patch.object(local_mod, "TerminalTool"),
            patch.object(local_mod, "FileEditorTool"),
            patch.object(local_mod, "Conversation", return_value=_fake_conversation()),
        ):
            local_mod.OpenHandsAdapter().run(
                AgentTask(
                    instruction="x",
                    workspace_dir=str(tmp_path),
                    model="openai/gpt-4o-mini",
                    llm_api_key="k",
                    multimodal=multimodal,
                )
            )
        return LLM.call_args.kwargs

    def docker_kwargs(multimodal: bool) -> dict:
        with (
            patch.object(docker_mod, "get_settings", return_value=settings),
            patch.object(docker_mod, "reap_agent_containers"),
            patch.object(docker_mod, "DockerWorkspace", side_effect=RuntimeError("stop")),
            patch.object(docker_mod, "LLM") as LLM,
            patch.object(docker_mod, "Agent"),
            patch.object(docker_mod, "LLMSummarizingCondenser"),
            patch.object(docker_mod, "Tool"),
            patch.object(docker_mod, "TerminalTool"),
            patch.object(docker_mod, "FileEditorTool"),
        ):
            docker_mod.OpenHandsDockerAdapter().run(
                AgentTask(
                    instruction="x",
                    workspace_dir=str(tmp_path),
                    model="openai/gpt-4o-mini",
                    llm_api_key="k",
                    multimodal=multimodal,
                )
            )
        return LLM.call_args.kwargs

    for build in (local_kwargs, docker_kwargs):
        assert build(True)["disable_vision"] is False
        assert "disable_vision" not in build(False)  # unset ⇒ the LLM is built exactly as before
