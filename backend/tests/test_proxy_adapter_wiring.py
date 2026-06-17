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


def _run_local(settings, tmp_path, llm_api_key=None):
    """Drive the LOCAL adapter to the LLM construction with everything mocked; return the
    kwargs LLM() was called with. ``llm_api_key`` (P1.4b) rides into the task."""
    with (
        patch.object(local_mod, "get_settings", return_value=settings),
        patch.object(local_mod, "LLM") as LLM,
        patch.object(local_mod, "Agent"),
        patch.object(local_mod, "Tool"),
        patch.object(local_mod, "TerminalTool"),
        patch.object(local_mod, "FileEditorTool"),
        patch.object(local_mod, "Conversation", return_value=_fake_conversation()),
    ):
        task = AgentTask(
            instruction="x",
            workspace_dir=str(tmp_path),
            model="openrouter/m",
            llm_api_key=llm_api_key,
        )
        local_mod.OpenHandsAdapter().run(task)
    return LLM.call_args.kwargs


def _run_docker(settings, tmp_path, llm_api_key=None):
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
        task = AgentTask(
            instruction="x",
            workspace_dir=str(tmp_path),
            model="openrouter/m",
            llm_api_key=llm_api_key,
        )
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


# --- P1.4b: thread the per-run key + classify the proxy's budget cutoff ---


def test_adapters_thread_the_per_run_key_as_the_agent_api_key(tmp_path, monkeypatch):
    # When the proxy is ON and the task carries a per-run virtual key, BOTH adapters use that
    # key as the agent's api_key (not the master key) so the proxy enforces the run's budget.
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    settings = Settings(_env_file=None, litellm_proxy_enabled=True, litellm_master_key="sk-master")
    for runner in (_run_local, _run_docker):
        kwargs = runner(settings, tmp_path, llm_api_key="sk-run-vkey")
        assert kwargs["api_key"] == "sk-run-vkey"
        assert kwargs["model"] == "litellm_proxy/openrouter/m"


class _FakeProxyRateLimitError(Exception):
    """Stand-in for what the agent's client raises on the proxy budget cutoff — CAPTURED LIVE:
    the client wraps the proxy's 429 as litellm.RateLimitError, message-identical to this."""

    def __init__(self):
        super().__init__(
            "litellm.RateLimitError: RateLimitError: Litellm_proxyException - "
            "Budget has been exceeded! Current cost: 3.15e-06, Max budget: 1e-09"
        )


def test_is_budget_error_true_on_the_captured_signature():
    assert local_mod._is_budget_error(_FakeProxyRateLimitError()) is True


def test_is_budget_error_true_on_message_variants():
    for msg in (
        "ExceededBudget: Key over 30m budget. Spend=$0.10, Limit=$0.05",
        "Litellm_proxyException - type: budget_exceeded",
        "User=u1 over budget. Spend=1.0, Budget=0.5",
    ):
        assert local_mod._is_budget_error(Exception(msg)) is True


def test_is_budget_error_true_on_raw_server_type_name():
    # Belt-and-suspenders: the server-side type, should a client ever surface it directly.
    class BudgetExceededError(Exception):
        pass

    assert local_mod._is_budget_error(BudgetExceededError("anything")) is True


def test_is_budget_error_false_on_generic_and_real_ratelimit():
    # A real failure / network error / genuine rate-limit must NEVER be misclassified.
    assert local_mod._is_budget_error(RuntimeError("boom")) is False
    assert local_mod._is_budget_error(ConnectionError("connection refused")) is False
    assert (
        local_mod._is_budget_error(Exception("RateLimitError: rate limit exceeded, retry")) is False
    )


def _run_local_result(settings, tmp_path, *, run_side_effect):
    """Drive the LOCAL adapter to completion with conversation.run() raising; return the
    AgentRunResult (to assert the classified status)."""
    convo = _fake_conversation()
    convo.run.side_effect = run_side_effect
    with (
        patch.object(local_mod, "get_settings", return_value=settings),
        patch.object(local_mod, "LLM"),
        patch.object(local_mod, "Agent"),
        patch.object(local_mod, "Tool"),
        patch.object(local_mod, "TerminalTool"),
        patch.object(local_mod, "FileEditorTool"),
        patch.object(local_mod, "Conversation", return_value=convo),
    ):
        task = AgentTask(instruction="x", workspace_dir=str(tmp_path), model="openrouter/m")
        return local_mod.OpenHandsAdapter().run(task)


def test_adapter_classifies_budget_cutoff_as_over_budget(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    settings = Settings(_env_file=None, litellm_proxy_enabled=False)
    result = _run_local_result(settings, tmp_path, run_side_effect=_FakeProxyRateLimitError())
    assert result.status == "over_budget"


def test_adapter_classifies_generic_error_as_failed(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    settings = Settings(_env_file=None, litellm_proxy_enabled=False)
    result = _run_local_result(settings, tmp_path, run_side_effect=RuntimeError("boom"))
    assert result.status == "failed"
