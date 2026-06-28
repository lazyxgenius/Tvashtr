"""P1.4a: both adapters build the agent LLM correctly per the proxy flag.

LLM/Agent/Conversation (+ the docker container) are mocked — like test_docker_adapter,
no real agent spins; we only inspect the kwargs ``LLM()`` was constructed with. The
adapter's ``get_settings`` is patched to a constructed ``Settings(_env_file=None, …)`` so a
real local .env can't perturb the flag. These import openhands (the adapters do at module
top) — legitimately, like test_docker_adapter — keeping the openhands-free purity file
(test_registry) unaffected.
"""

from unittest.mock import MagicMock, patch

from openhands.sdk.event.conversation_error import ConversationErrorEvent

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


# --- flag OFF: the BYOK direct path — the per-owner key the executor threaded, NOT .env ---


def test_local_off_builds_direct_llm_with_the_threaded_owner_key(tmp_path, monkeypatch):
    # M-accounts Slice B: proxy OFF builds the LLM with the per-owner key the executor threaded
    # (AgentTask.llm_api_key), bare slug + no base_url. An .env OPENROUTER_API_KEY is IGNORED.
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-env-ignored")
    settings = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = _run_local(settings, tmp_path, llm_api_key="byok-key")
    assert kwargs == {
        "model": "openrouter/m",
        "api_key": "byok-key",
        "temperature": 0.0,
        "usage_id": "tvashtr-agent",
    }


def test_docker_off_builds_direct_llm_with_the_threaded_owner_key(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-env-ignored")
    settings = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = _run_docker(settings, tmp_path, llm_api_key="byok-key")
    assert kwargs == {
        "model": "openrouter/m",
        "api_key": "byok-key",
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
        # proxy-OFF ⇒ the executor always threads a per-owner key (M-accounts Slice B).
        task = AgentTask(
            instruction="x",
            workspace_dir=str(tmp_path),
            model="openrouter/m",
            llm_api_key="byok-key",
        )
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


# --- P1.4b FIX: docker-mode classification via the ConversationErrorEvent ---
# In docker mode the SDK genericizes the raised exception to "Remote conversation ended with
# error"; the proxy budget message reaches the host only in a ConversationErrorEvent.detail.


def test_text_has_budget_signature_matches_event_detail():
    # The docker ConversationErrorEvent detail (code: detail) carries the budget message.
    detail = (
        "LLMRateLimitError: litellm.RateLimitError: Litellm_proxyException - "
        "Budget has been exceeded! Current cost: 0.00133455, Max budget: 0.001"
    )
    assert local_mod._text_has_budget_signature(detail) is True


def test_text_has_budget_signature_false_on_generic():
    assert (
        local_mod._text_has_budget_signature(
            "Conversation run failed for id=x: Remote conversation ended with error"
        )
        is False
    )
    assert local_mod._text_has_budget_signature("") is False


def test_is_budget_error_finds_signature_in_cause_chain():
    # Top-level message is generic; the budget signal is on __cause__ (belt-and-suspenders).
    inner = Exception("Litellm_proxyException - Budget has been exceeded! ...")
    outer = RuntimeError("Conversation run failed: Remote conversation ended with error")
    outer.__cause__ = inner
    assert local_mod._is_budget_error(outer) is True


def test_is_budget_error_false_when_chain_has_no_budget():
    inner = ConnectionError("connection refused")
    outer = RuntimeError("Remote conversation ended with error")
    outer.__cause__ = inner
    assert local_mod._is_budget_error(outer) is False


def _budget_error_event() -> ConversationErrorEvent:
    # Real ConversationErrorEvent via model_construct (bypasses base-Event validation); it only
    # needs to be an instance with .code/.detail for the isinstance check + the capture.
    return ConversationErrorEvent.model_construct(
        code="LLMRateLimitError",
        detail=(
            "litellm.RateLimitError: Litellm_proxyException - "
            "Budget has been exceeded! Current cost: 0.00133455, Max budget: 0.001"
        ),
    )


_GENERIC_REMOTE_EXC = RuntimeError(
    "Conversation run failed for id=x: Remote conversation ended with error"
)


def _run_docker_result(tmp_path, *, feed_events, raise_exc):
    """Drive OpenHandsDockerAdapter.run() with DockerWorkspace + Conversation mocked: run()
    feeds the given events through the captured callback (exactly as the WS would) THEN raises
    ``raise_exc``. Returns the AgentRunResult so the classified status can be asserted."""
    settings = Settings(_env_file=None, litellm_proxy_enabled=False)

    def _make_conversation(*args, callbacks=None, **kwargs):
        convo = MagicMock()
        metrics = MagicMock(accumulated_cost=0.0)
        metrics.accumulated_token_usage = MagicMock(prompt_tokens=0, completion_tokens=0)
        convo.conversation_stats.get_combined_metrics.return_value = metrics

        def _run():
            for ev in feed_events:
                for cb in callbacks or []:
                    cb(ev)
            raise raise_exc

        convo.run.side_effect = _run
        convo.send_message.return_value = None
        return convo

    # A context-manager mock that does NOT suppress the raised exception (__exit__ -> False),
    # so the adapter's except block runs (where classification happens).
    workspace_cm = MagicMock()
    workspace_cm.__enter__.return_value = workspace_cm
    workspace_cm.__exit__.return_value = False

    with (
        patch.object(docker_mod, "get_settings", return_value=settings),
        patch.object(docker_mod, "reap_agent_containers"),
        patch.object(docker_mod, "DockerWorkspace", return_value=workspace_cm),
        patch.object(docker_mod, "LLM"),
        patch.object(docker_mod, "Agent"),
        patch.object(docker_mod, "Tool"),
        patch.object(docker_mod, "TerminalTool"),
        patch.object(docker_mod, "FileEditorTool"),
        patch.object(docker_mod, "Conversation", side_effect=_make_conversation),
    ):
        # proxy-OFF ⇒ the executor always threads a per-owner key (M-accounts Slice B).
        task = AgentTask(
            instruction="x",
            workspace_dir=str(tmp_path),
            model="openrouter/m",
            llm_api_key="byok-key",
        )
        return docker_mod.OpenHandsDockerAdapter().run(task)


def test_docker_classifies_budget_cutoff_via_error_event(tmp_path):
    # THE regression guard: a ConversationErrorEvent carries the budget message, but the raised
    # exception is GENERIC (the SDK stripped it) -> still over_budget via the event detail.
    result = _run_docker_result(
        tmp_path, feed_events=[_budget_error_event()], raise_exc=_GENERIC_REMOTE_EXC
    )
    assert result.status == "over_budget"


def test_docker_generic_error_without_budget_event_is_failed(tmp_path):
    # Negative: the same generic raise but NO budget signal anywhere -> failed (not misclassified).
    result = _run_docker_result(tmp_path, feed_events=[], raise_exc=_GENERIC_REMOTE_EXC)
    assert result.status == "failed"


# --- Slice 4 (Item A): the LOCAL adapter's workspace-read-only mirror of the docker scoped pull ---


def test_local_adapter_emitting_node_is_workspace_read_only(tmp_path, monkeypatch):
    """An outcome-emitting (reviewer) node running the REAL local adapter is workspace-READ-ONLY:
    even when the agent CLOBBERS the deliverable (drops ``subtract``) and drops a stray file while
    "reviewing", the adapter restores the worktree so ONLY ``REVIEW_VERDICT.json`` persists — the
    in-process mirror of the docker scoped pull. ``pull_paths=None`` (a worker) leaves it untouched.
    """
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    deliverable = tmp_path / "calculator.py"
    original = "def add(a, b):\n    return a + b\n\n\ndef subtract(a, b):\n    return a - b\n"
    deliverable.write_text(original, encoding="utf-8")

    convo = _fake_conversation()

    def _agent_edits(*a, **k):
        # The reviewer touches the deliverable (drops subtract), drops a stray, writes its verdict.
        deliverable.write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
        (tmp_path / "scratch.tmp").write_text("junk", encoding="utf-8")
        (tmp_path / "REVIEW_VERDICT.json").write_text(
            '{"verdict": "approved", "reasons": "ok"}', encoding="utf-8"
        )

    convo.run.side_effect = _agent_edits

    with (
        patch.object(
            local_mod,
            "get_settings",
            return_value=Settings(_env_file=None, litellm_proxy_enabled=False),
        ),
        patch.object(local_mod, "LLM"),
        patch.object(local_mod, "Agent"),
        patch.object(local_mod, "Tool"),
        patch.object(local_mod, "TerminalTool"),
        patch.object(local_mod, "FileEditorTool"),
        patch.object(local_mod, "Conversation", return_value=convo),
    ):
        task = AgentTask(
            instruction="review it",
            workspace_dir=str(tmp_path),
            model="openrouter/m",
            llm_api_key="byok-key",
            pull_paths=("REVIEW_VERDICT.json",),
        )
        result = local_mod.OpenHandsAdapter().run(task)

    # The deliverable is restored (clobber undone), the stray is gone, only the sidecar persists.
    assert deliverable.read_text() == original
    assert "def subtract" in deliverable.read_text()
    assert not (tmp_path / "scratch.tmp").exists()
    assert (tmp_path / "REVIEW_VERDICT.json").exists()
    # Only the verdict sidecar is reported as changed (the engine-neutral files_changed).
    assert result.files_changed == ["REVIEW_VERDICT.json"]


def test_local_adapter_worker_none_pull_paths_keeps_edits(tmp_path, monkeypatch):
    """The default (pull_paths=None — a worker) does NO restore: the agent's edits persist in place,
    byte-for-byte the prior behavior. Guards the common worker path against the mirror."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    convo = _fake_conversation()

    def _agent_edits(*a, **k):
        (tmp_path / "greeting.txt").write_text("hello", encoding="utf-8")

    convo.run.side_effect = _agent_edits

    with (
        patch.object(
            local_mod,
            "get_settings",
            return_value=Settings(_env_file=None, litellm_proxy_enabled=False),
        ),
        patch.object(local_mod, "LLM"),
        patch.object(local_mod, "Agent"),
        patch.object(local_mod, "Tool"),
        patch.object(local_mod, "TerminalTool"),
        patch.object(local_mod, "FileEditorTool"),
        patch.object(local_mod, "Conversation", return_value=convo),
    ):
        task = AgentTask(
            instruction="build",
            workspace_dir=str(tmp_path),
            model="openrouter/m",
            llm_api_key="byok-key",
        )
        result = local_mod.OpenHandsAdapter().run(task)

    assert (tmp_path / "greeting.txt").read_text() == "hello"  # the worker's edit survives
    assert result.files_changed == ["greeting.txt"]
