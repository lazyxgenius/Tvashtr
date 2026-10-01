"""M1 stall guard, ruling R2 on the WORKER path: when the agent's own retry envelope is used up on a
busy provider (429 / rate limit / timeout / overloaded), or on a hard failure, the step switches
ONCE to its backup model — the node's ``config["fallback_model"]``, else the account's backup for
the node's capability — only when the owner holds a key for it and it differs from the primary.
The switch is a ``backup_model`` run event and a ``fallback_model`` RunWarning.

Adapter tests drive the REAL except blocks with the SDK mocked (``test_proxy_adapter_wiring``'s
harness); executor tests drive the REAL ``run_team`` with a fake adapter at ``resolve_adapter``.
"""

from unittest.mock import patch

import pytest
from openhands.sdk.event.conversation_error import ConversationErrorEvent
from test_proxy_adapter_wiring import (
    _GENERIC_REMOTE_EXC,
    _budget_error_event,
    _FakeProxyRateLimitError,
    _run_docker_result,
    _run_local_result,
)

from tvashtr.config import Settings
from tvashtr.engines import openhands_adapter as local_mod
from tvashtr.engines.base import AgentRunResult

# ---- the contract: an additive, default-False field ----------------------------------------------


def test_retries_exhausted_is_an_additive_default_false_field():
    result = AgentRunResult(status="completed", summary="s", events=[], files_changed=[])
    assert result.retries_exhausted is False
    assert result.provider_failure is False


# ---- the adapters classify a busy provider whose retries ran out ---------------------------------


def _local(tmp_path, monkeypatch, exc):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    settings = Settings(_env_file=None, litellm_proxy_enabled=False)
    return _run_local_result(settings, tmp_path, run_side_effect=exc)


@pytest.mark.parametrize(
    "exc",
    [
        RuntimeError("litellm.RateLimitError: OpenAIException - 429 Too Many Requests"),
        RuntimeError("litellm.APITimeoutError: APITimeoutError - Request timed out."),
        RuntimeError("litellm.InternalServerError: Overloaded"),
        type("RateLimitError", (Exception,), {})(""),
        type("Timeout", (Exception,), {})(""),
    ],
)
def test_local_adapter_flags_a_busy_provider_as_retries_exhausted(tmp_path, monkeypatch, exc):
    result = _local(tmp_path, monkeypatch, exc)
    assert (result.status, result.retries_exhausted, result.provider_failure) == (
        "failed",
        True,
        False,
    )


def test_local_adapter_budget_cutoff_is_never_retries_exhausted(tmp_path, monkeypatch):
    result = _local(tmp_path, monkeypatch, _FakeProxyRateLimitError())
    assert (result.status, result.retries_exhausted, result.provider_failure) == (
        "over_budget",
        False,
        False,
    )


def test_local_adapter_hard_failure_is_provider_failure_only(tmp_path, monkeypatch):
    exc = RuntimeError(
        "litellm.AuthenticationError: OpenrouterException - No auth credentials found"
    )
    result = _local(tmp_path, monkeypatch, exc)
    assert (result.retries_exhausted, result.provider_failure) == (False, True)


def test_local_adapter_generic_failure_sets_neither(tmp_path, monkeypatch):
    result = _local(tmp_path, monkeypatch, RuntimeError("boom"))
    assert (result.retries_exhausted, result.provider_failure) == (False, False)


def _rate_limit_event() -> ConversationErrorEvent:
    return ConversationErrorEvent.model_construct(
        code="LLMRateLimitError",
        detail="litellm.RateLimitError: OpenrouterException - 429 Too Many Requests",
    )


def test_docker_flags_retries_exhausted_from_the_error_event(tmp_path):
    """Remote mode: the raised exception is the SDK's generic wrap; the 429 is only in the event."""
    result = _run_docker_result(
        tmp_path, feed_events=[_rate_limit_event()], raise_exc=_GENERIC_REMOTE_EXC
    )
    assert (result.status, result.retries_exhausted, result.provider_failure) == (
        "failed",
        True,
        False,
    )


def test_docker_generic_failure_is_not_retries_exhausted(tmp_path):
    result = _run_docker_result(tmp_path, feed_events=[], raise_exc=_GENERIC_REMOTE_EXC)
    assert result.retries_exhausted is False


def test_docker_budget_event_is_never_retries_exhausted(tmp_path):
    result = _run_docker_result(
        tmp_path, feed_events=[_budget_error_event()], raise_exc=_GENERIC_REMOTE_EXC
    )
    assert (result.status, result.retries_exhausted) == ("over_budget", False)


def _run_fly_result(tmp_path, *, feed_events, raise_exc):
    """Drive the REAL fly adapter's except block: the conversation feeds ``feed_events`` through
    its callbacks, then raises ``raise_exc`` (``test_fly_adapter``'s fakes, no socket)."""
    from test_fly_adapter import _Ctx, _fake_conversation, _task

    from tvashtr.engines import openhands_fly_adapter as fly_mod
    from tvashtr.engines import sandbox_cache

    def _make_conversation(*args, callbacks=None, **kwargs):
        convo = _fake_conversation()

        def _run():
            for ev in feed_events:
                for cb in callbacks or []:
                    cb(ev)
            raise raise_exc

        convo.run.side_effect = _run
        return convo

    fly_mod._RUNS.clear()
    sandbox_cache.clear()
    try:
        with _Ctx(), patch.object(fly_mod, "Conversation", side_effect=_make_conversation):
            return fly_mod.OpenHandsFlyAdapter().run(_task(tmp_path, "node-a"))
    finally:
        fly_mod._RUNS.clear()
        sandbox_cache.clear()


def test_fly_flags_retries_exhausted_from_the_error_event(tmp_path):
    result = _run_fly_result(
        tmp_path, feed_events=[_rate_limit_event()], raise_exc=_GENERIC_REMOTE_EXC
    )
    budget = _run_fly_result(
        tmp_path, feed_events=[_budget_error_event()], raise_exc=_GENERIC_REMOTE_EXC
    )
    assert (result.status, result.retries_exhausted, result.provider_failure) == (
        "failed",
        True,
        False,
    )
    assert (budget.status, budget.retries_exhausted) == ("over_budget", False)


def test_is_transient_error_excludes_the_budget_cutoff():
    assert local_mod._is_transient_error(RuntimeError("429 Too Many Requests")) is True
    assert local_mod._is_transient_error(_FakeProxyRateLimitError()) is False
    assert local_mod._is_transient_error(RuntimeError("boom")) is False
