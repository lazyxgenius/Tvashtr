"""M-subs-desktop — ``agent_run_step`` hands a desktop-routed node to the ``desktop-runner`` engine.

On a desktop-targeted run whose launch routed ``claude`` to the owner's Desktop, an
``anthropic/…`` node runs through the desktop runner WITHOUT resolving any API key (the owner holds
none); every other node — and every node of a hosted run — keeps its current engine path.
"""

import uuid

from conftest import auth_user_id

from tvashtr.config import get_settings
from tvashtr.control_plane import team_run
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import Run


class _Recorder:
    name = "recorder"

    def __init__(self):
        self.tasks = []

    def run(self, task, on_event=None):
        self.tasks.append(task)
        return AgentRunResult(status="completed", summary="ok", events=[], files_changed=[])


def _run(desktop_target: bool, subs: list[str] | None) -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=auth_user_id(),
                idea="route test",
                workflow_id=run_id,
                status="running",
                desktop_target=desktop_target,
                desktop_subscriptions=subs,
            )
        )
    return run_id


def _call(run_id: str, model: str, tmp_path, monkeypatch):
    rec = _Recorder()
    engines: list[str] = []

    def fake_resolve(name):
        engines.append(name)
        return rec

    monkeypatch.setattr(team_run, "resolve_adapter", fake_resolve)
    monkeypatch.setattr(get_settings(), "litellm_proxy_enabled", False)
    ws = tmp_path / "ws"
    ws.mkdir(exist_ok=True)
    out = team_run.agent_run_step(
        run_id,
        "do the thing",
        model,
        1,
        "idea",
        "spec",
        str(ws),
        None,
        None,
        False,
        100_000,
        31337,
        node_id="node-xyz",
    )
    return out, engines, rec


def test_desktop_routed_anthropic_node_uses_the_desktop_runner_without_a_key(
    client, tmp_path, monkeypatch
):
    run_id = _run(True, ["claude"])
    out, engines, rec = _call(run_id, "anthropic/claude-sonnet-5", tmp_path, monkeypatch)
    assert out["status"] == "completed"
    assert engines == ["desktop-runner"]
    task = rec.tasks[0]
    assert task.llm_api_key is None, "no API key is resolved or passed for a subscription node"
    assert task.desktop is not None
    assert (task.desktop.run_id, task.desktop.node_id, task.desktop.iteration) == (
        run_id,
        "node-xyz",
        1,
    )
    assert task.desktop.invocation_id == 31337
    assert task.desktop.provider == "claude"
    assert task.desktop.owner_id == str(auth_user_id())


def test_a_node_whose_provider_was_not_routed_keeps_its_engine(client, tmp_path, monkeypatch):
    run_id = _run(True, ["claude"])
    out, engines, rec = _call(run_id, "openrouter/openai/gpt-4o-mini", tmp_path, monkeypatch)
    assert engines == [team_run._engine_for_sandbox_mode(get_settings().agent_sandbox_mode)]
    assert rec.tasks[0].desktop is None
    assert rec.tasks[0].llm_api_key  # the conftest owner's dummy BYOK key


def test_hosted_runs_never_route_to_a_desktop(client, tmp_path, monkeypatch):
    run_id = _run(False, None)
    out, engines, rec = _call(run_id, "openrouter/openai/gpt-4o-mini", tmp_path, monkeypatch)
    assert "desktop-runner" not in engines
    assert rec.tasks[0].desktop is None
