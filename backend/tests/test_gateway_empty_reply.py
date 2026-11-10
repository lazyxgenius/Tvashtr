"""M2 Part A — a reply with no answer in it (``choices == []`` or ``choices[0].message is None``) is a
provider error: the primary is retried, then the backup is tried, and with nothing left the caller
gets a ``GatewayError`` saying the model returned no answer — never a bare ``IndexError``.

A reply that HAS a choice whose text is empty still returns normally with ``text=""``.
Offline: ``litellm.completion`` is monkeypatched; waits are recorded, never slept."""

from types import SimpleNamespace

import pytest

from tvashtr.gateway import CompletionRequest, GatewayError, complete
from tvashtr.gateway import gateway as gw

_USAGE = SimpleNamespace(prompt_tokens=3, completion_tokens=0, total_tokens=3)


def _no_choices(model: str) -> SimpleNamespace:
    return SimpleNamespace(choices=[], usage=_USAGE, model=model)


def _no_message(model: str) -> SimpleNamespace:
    return SimpleNamespace(choices=[SimpleNamespace(message=None)], usage=_USAGE, model=model)


def _answer(content, model: str) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=_USAGE,
        model=model,
    )


@pytest.fixture
def waits(monkeypatch):
    monkeypatch.setattr(
        gw,
        "get_settings",
        lambda: SimpleNamespace(
            model_fallbacks=[],
            default_max_tokens_per_call=None,
            agent_request_timeout_s=5,
            model_retries=2,
            model_retry_backoff_s=1.0,
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


@pytest.mark.parametrize("empty", [_no_choices, _no_message])
def test_an_empty_reply_is_retried_then_a_gateway_error(monkeypatch, waits, empty):
    calls: list[str] = []

    def replies(*, model, **kwargs):
        calls.append(model)
        return empty(model)

    monkeypatch.setattr(gw.litellm, "completion", replies)
    events: list = []
    with pytest.raises(GatewayError) as caught:
        complete(_request(events))
    assert "the model returned no answer" in str(caught.value)
    assert calls == ["primary/m"] * 3  # the first try + its 2 retries
    retries = [p for k, p in events if k == "retry"]
    assert [p["reason"] for p in retries] == ["no_answer", "no_answer"]
    assert waits == [1.0, 2.0]


@pytest.mark.parametrize("empty", [_no_choices, _no_message])
def test_an_empty_reply_switches_to_the_backup_model(monkeypatch, waits, empty):
    calls: list[str] = []

    def replies(*, model, **kwargs):
        calls.append(model)
        return empty(model) if model == "primary/m" else _answer("Motor", model)

    monkeypatch.setattr(gw.litellm, "completion", replies)
    events: list = []
    result = complete(_request(events, fallback_model="backup/m", api_key="k"))
    assert result.text == "Motor"
    assert result.model_used == "backup/m"
    assert calls == ["primary/m"] * 3 + ["backup/m"]
    backups = [p for k, p in events if k == "backup_model"]
    assert backups == [{"from_model": "primary/m", "to_model": "backup/m", "reason": "busy"}]


@pytest.mark.parametrize("content", ["", None])
def test_a_choice_with_empty_text_still_returns_normally(monkeypatch, waits, content):
    calls: list[str] = []

    def replies(*, model, **kwargs):
        calls.append(model)
        return _answer(content, model)

    monkeypatch.setattr(gw.litellm, "completion", replies)
    events: list = []
    result = complete(_request(events))
    assert result.text == ""
    assert calls == ["primary/m"]
    assert events == []
