"""P1.4a: both adapters build the agent LLM correctly per the proxy flag.

LLM/Agent/Conversation (+ the docker container) are mocked — like test_docker_adapter,
no real agent spins; we only inspect the kwargs ``LLM()`` was constructed with. The
adapter's ``get_settings`` is patched to a constructed ``Settings(_env_file=None, …)`` so a
real local .env can't perturb the flag. These import openhands (the adapters do at module
top) — legitimately, like test_docker_adapter — keeping the openhands-free purity file
(test_registry) unaffected.
"""

from unittest.mock import MagicMock, patch

from tvashtr.config import Settings
from tvashtr.engines import openhands_adapter as local_mod
from tvashtr.engines import openhands_docker_adapter as docker_mod
from tvashtr.engines.base import AgentTask


def _fake_conversation():
    """A Conversation stand-in whose post-run usage read returns zeros (so the local
    adapter's run() completes without a real agent)."""
    convo = MagicMock()
    metrics = MagicMock(accumulated_cost=0.0)
    metrics.accumulated_token_usage = MagicMock(prompt_tokens=0, completion_tokens=0)
    convo.conversation_stats.get_combined_metrics.return_value = metrics
    return convo


def _run_local(settings, tmp_path):
    """Drive the LOCAL adapter to the LLM construction with everything mocked; return the
    kwargs LLM() was called with."""
    with (
        patch.object(local_mod, "get_settings", return_value=settings),
        patch.object(local_mod, "LLM") as LLM,
        patch.object(local_mod, "Agent"),
        patch.object(local_mod, "Tool"),
        patch.object(local_mod, "TerminalTool"),
        patch.object(local_mod, "FileEditorTool"),
        patch.object(local_mod, "Conversation", return_value=_fake_conversation()),
    ):
        task = AgentTask(instruction="x", workspace_dir=str(tmp_path), model="openrouter/m")
        local_mod.OpenHandsAdapter().run(task)
    return LLM.call_args.kwargs


def _run_docker(settings, tmp_path):
    """Drive the DOCKER adapter just past the LLM construction (DockerWorkspace raises
    immediately after, so no container is needed); return the LLM() kwargs."""
    with (
        patch.object(docker_mod, "get_settings", return_value=settings),
        patch.object(docker_mod, "reap_agent_containers"),
        patch.object(docker_mod, "DockerWorkspace", side_effect=RuntimeError("stop-after-llm")),
        patch.object(docker_mod, "LLM") as LLM,
        patch.object(docker_mod, "Agent"),
        patch.object(docker_mod, "Tool"),
        patch.object(docker_mod, "TerminalTool"),
        patch.object(docker_mod, "FileEditorTool"),
    ):
        task = AgentTask(instruction="x", workspace_dir=str(tmp_path), model="openrouter/m")
        docker_mod.OpenHandsDockerAdapter().run(task)
    return LLM.call_args.kwargs


# --- flag OFF: the EXACT prior direct construction (the brief's core assertion) ---


def test_local_off_builds_exact_direct_llm(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    settings = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = _run_local(settings, tmp_path)
    # Byte-for-byte the prior call: bare slug + OPENROUTER_API_KEY, no base_url.
    assert kwargs == {
        "model": "openrouter/m",
        "api_key": "sk-or-test",
        "temperature": 0.0,
        "usage_id": "tvashtr-agent",
    }


def test_docker_off_builds_exact_direct_llm(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    settings = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = _run_docker(settings, tmp_path)
    assert kwargs == {
        "model": "openrouter/m",
        "api_key": "sk-or-test",
        "temperature": 0.0,
        "usage_id": "tvashtr-agent",
    }


# --- flag ON: routed through the proxy, each adapter pinning its OWN mode's host ---


def test_local_on_routes_through_proxy_at_loopback(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    settings = Settings(_env_file=None, litellm_proxy_enabled=True, litellm_master_key="sk-master")
    kwargs = _run_local(settings, tmp_path)
    assert kwargs == {
        "model": "litellm_proxy/openrouter/m",
        "api_key": "sk-master",
        "base_url": "http://127.0.0.1:4000",
        "temperature": 0.0,
        "usage_id": "tvashtr-agent",
    }


def test_docker_on_routes_through_proxy_at_host_docker_internal(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    settings = Settings(_env_file=None, litellm_proxy_enabled=True, litellm_master_key="sk-master")
    kwargs = _run_docker(settings, tmp_path)
    # The docker adapter hardcodes its own "docker" mode -> host.docker.internal, NOT the
    # global setting — the wiring that makes the containerized agent reach the host proxy.
    assert kwargs == {
        "model": "litellm_proxy/openrouter/m",
        "api_key": "sk-master",
        "base_url": "http://host.docker.internal:4000",
        "temperature": 0.0,
        "usage_id": "tvashtr-agent",
    }
