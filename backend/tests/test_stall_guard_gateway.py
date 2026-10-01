"""M1 stall guard — the gateway's time limit, retry envelope and one-time backup switch (R1, R2).

Offline: ``litellm.completion`` is monkeypatched. Settings are pinned per test with a stand-in so
the waits and the limit are tiny; ``gw._sleep`` is captured so no test really waits.
"""

import threading
import time
from types import SimpleNamespace

import pytest

from tvashtr.gateway import CompletionRequest, GatewayError, complete
from tvashtr.gateway import gateway as gw


def _canned(content: str, model: str) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
        model=model,
    )


class _RateLimited(Exception):
    status_code = 429


@pytest.fixture
def waits(monkeypatch):
    """Pin the settings the gateway reads and record each backoff instead of sleeping."""
    monkeypatch.setattr(
        gw,
        "get_settings",
        lambda: SimpleNamespace(
            model_fallbacks=[],
            default_max_tokens_per_call=None,
            agent_request_timeout_s=5,
            model_retries=3,
            model_retry_backoff_s=10.0,
        ),
    )
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    recorded: list[float] = []
    monkeypatch.setattr(gw, "_sleep", recorded.append)
    return recorded


def _request(events: list, **kw) -> CompletionRequest:
    return CompletionRequest(
        model="primary/m",
        messages=[{"role": "user", "content": "hi"}],
        on_event=lambda kind, payload: events.append((kind, payload)),
        **kw,
    )


def test_a_hung_call_is_cut_at_the_time_limit(monkeypatch, waits):
    """(a) A provider that accepts the call and never answers is cut at the per-call limit."""
    monkeypatch.setattr(
        gw,
        "get_settings",
        lambda: SimpleNamespace(
            model_fallbacks=[],
            default_max_tokens_per_call=None,
            agent_request_timeout_s=0.2,
            model_retries=0,
            model_retry_backoff_s=0.0,
        ),
    )
    release = threading.Event()
    seen: dict = {}

    def hangs(*, model, messages, **kwargs):
        seen["timeout"] = kwargs.get("timeout")
        release.wait(30)
        return _canned("late", model)

    monkeypatch.setattr(gw.litellm, "completion", hangs)
    started = time.monotonic()
    try:
        with pytest.raises(GatewayError, match="didn't answer within"):
            complete(
                CompletionRequest(model="primary/m", messages=[{"role": "user", "content": "x"}])
            )
    finally:
        release.set()
    assert time.monotonic() - started < 5
    assert seen["timeout"] == 0.2  # the provider call carries the same limit


def test_429_three_times_then_success_retries_without_switching(monkeypatch, waits):
    """(b) 429×3 then success: 3 retry events, backoff 10/20/40 s, the primary serves, no switch."""
    calls: list[str] = []

    def flaky(*, model, messages, **kwargs):
        calls.append(model)
        if len(calls) <= 3:
            raise _RateLimited("429 Too Many Requests")
        return _canned("ok", model)

    monkeypatch.setattr(gw.litellm, "completion", flaky)
    events: list = []
    result = complete(_request(events, fallback_model="backup/m"))

    assert result.model_used == "primary/m"
    assert calls == ["primary/m"] * 4
    assert waits == [10.0, 20.0, 40.0]
    assert [k for k, _ in events] == ["retry", "retry", "retry"]
    assert [(p["attempt"], p["of"], p["wait_s"], p["reason"]) for _, p in events] == [
        (1, 3, 10.0, "busy"),
        (2, 3, 20.0, "busy"),
        (3, 3, 40.0, "busy"),
    ]
    assert all(p["model"] == "primary/m" and p["next_at"] for _, p in events)


def test_429_four_times_switches_once_to_the_backup(monkeypatch, waits):
    """(c) 429×4: the tries are used up, the backup serves, one backup_model event."""
    calls: list[str] = []

    def busy_primary(*, model, messages, **kwargs):
        calls.append(model)
        if model == "primary/m":
            raise _RateLimited("429 Too Many Requests")
        return _canned("from backup", model)

    monkeypatch.setattr(gw.litellm, "completion", busy_primary)
    events: list = []
    result = complete(_request(events, fallback_model="backup/m"))

    assert result.model_used == "backup/m"
    assert calls == ["primary/m"] * 4 + ["backup/m"]
    assert [k for k, _ in events] == ["retry", "retry", "retry", "backup_model"]
    assert events[-1][1] == {"from_model": "primary/m", "to_model": "backup/m", "reason": "busy"}


def test_the_backup_is_not_retried_and_its_failure_raises(monkeypatch, waits):
    def always_busy(*, model, messages, **kwargs):
        raise _RateLimited("429 Too Many Requests")

    monkeypatch.setattr(gw.litellm, "completion", always_busy)
    events: list = []
    with pytest.raises(GatewayError):
        complete(_request(events, fallback_model="backup/m"))
    assert [k for k, _ in events].count("backup_model") == 1
    assert [k for k, _ in events].count("retry") == 3


def test_a_timeout_is_retried_like_a_429(monkeypatch, waits):
    class Timeout(Exception):
        pass

    calls: list[str] = []

    def slow_once(*, model, messages, **kwargs):
        calls.append(model)
        if len(calls) == 1:
            raise Timeout("Request timed out")
        return _canned("ok", model)

    monkeypatch.setattr(gw.litellm, "completion", slow_once)
    events: list = []
    assert complete(_request(events)).model_used == "primary/m"
    assert events[0][0] == "retry" and events[0][1]["reason"] == "timeout"


def test_a_server_error_is_retried(monkeypatch, waits):
    class Unavailable(Exception):
        status_code = 503

    calls: list[str] = []

    def down_once(*, model, messages, **kwargs):
        calls.append(model)
        if len(calls) == 1:
            raise Unavailable("Service Unavailable")
        return _canned("ok", model)

    monkeypatch.setattr(gw.litellm, "completion", down_once)
    events: list = []
    complete(_request(events))
    assert len(calls) == 2 and events[0][1]["reason"] == "unavailable"


def test_a_hard_failure_switches_at_once_without_retrying(monkeypatch, waits):
    calls: list[str] = []

    def bad_key(*, model, messages, **kwargs):
        calls.append(model)
        if model == "primary/m":
            raise RuntimeError("invalid api key for the primary provider")
        return _canned("ok", model)

    monkeypatch.setattr(gw.litellm, "completion", bad_key)
    events: list = []
    result = complete(_request(events, fallback_model="backup/m"))
    assert result.model_used == "backup/m"
    assert calls == ["primary/m", "backup/m"]
    assert waits == []
    assert events == [
        ("backup_model", {"from_model": "primary/m", "to_model": "backup/m", "reason": "error"})
    ]


def test_no_hook_means_no_events_and_the_same_result(monkeypatch, waits):
    """A caller that passes no ``on_event`` (every pre-M1 caller) gets the same result, silently."""
    n = {"calls": 0}

    def flaky(*, model, messages, **kwargs):
        n["calls"] += 1
        if n["calls"] == 1:
            raise _RateLimited("429")
        return _canned("ok", model)

    monkeypatch.setattr(gw.litellm, "completion", flaky)
    result = complete(
        CompletionRequest(model="primary/m", messages=[{"role": "user", "content": "x"}])
    )
    assert result.text == "ok" and n["calls"] == 2


def test_a_failing_event_hook_never_breaks_the_call(monkeypatch, waits):
    def flaky_once(*, model, messages, **kwargs):
        if not getattr(flaky_once, "done", False):
            flaky_once.done = True
            raise _RateLimited("429")
        return _canned("ok", model)

    def broken_hook(kind, payload):
        raise RuntimeError("database down")

    monkeypatch.setattr(gw.litellm, "completion", flaky_once)
    result = complete(
        CompletionRequest(
            model="primary/m", messages=[{"role": "user", "content": "x"}], on_event=broken_hook
        )
    )
    assert result.text == "ok"
