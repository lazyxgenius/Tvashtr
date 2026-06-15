"""Gateway unit tests — no network.

The gateway is the *only* module that imports LiteLLM. These tests monkeypatch
the LiteLLM boundary (``litellm.completion`` / ``litellm.completion_cost``) so
they run fully offline and deterministically:

* the mapping test asserts a canned provider response is turned into a correct
  ``CompletionResult`` (tokens, computed cost, model_used);
* the fallback test asserts that when the first model raises, the gateway
  transparently tries the next model and the result reflects the one that
  actually served the request.
"""

from types import SimpleNamespace

from tvashtr.gateway import CompletionRequest, complete
from tvashtr.gateway import gateway as gw


def _canned_response(content: str, model: str) -> SimpleNamespace:
    """A stand-in for LiteLLM's ModelResponse (only the bits the gateway reads)."""
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=11, completion_tokens=7, total_tokens=18),
        model=model,
    )


def test_complete_maps_usage_cost_and_model(monkeypatch):
    captured = {}

    def fake_completion(*, model, messages, **kwargs):
        captured["model"] = model
        captured["messages"] = messages
        return _canned_response("a tiny PRD", model)

    monkeypatch.setattr(gw.litellm, "completion", fake_completion)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.000123)

    request = CompletionRequest(
        model="openrouter/meta-llama/llama-3.1-8b-instruct",
        messages=[{"role": "user", "content": "Write a mini-PRD for: notes app"}],
        temperature=0.2,
        max_tokens=64,
    )
    result = complete(request)

    # The gateway routed exactly the requested model.
    assert captured["model"] == "openrouter/meta-llama/llama-3.1-8b-instruct"
    # Mapped fields from the canned response.
    assert result.text == "a tiny PRD"
    assert result.model_requested == "openrouter/meta-llama/llama-3.1-8b-instruct"
    assert result.model_used == "openrouter/meta-llama/llama-3.1-8b-instruct"
    assert result.prompt_tokens == 11
    assert result.completion_tokens == 7
    assert result.total_tokens == 18
    assert result.cost_usd == 0.000123
    assert result.raw_provider == "openrouter"
    assert result.latency_ms >= 0.0


def test_complete_falls_back_to_next_model_on_failure(monkeypatch):
    calls: list[str] = []

    def fake_completion(*, model, messages, **kwargs):
        calls.append(model)
        if model == "primary/down":
            raise RuntimeError("primary is unavailable")
        return _canned_response("served by the fallback", model)

    monkeypatch.setattr(gw.litellm, "completion", fake_completion)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    # Deterministic fallback list, independent of real config.
    monkeypatch.setattr(gw, "get_settings", lambda: SimpleNamespace(model_fallbacks=["second/up"]))

    request = CompletionRequest(
        model="primary/down",
        messages=[{"role": "user", "content": "hi"}],
    )
    result = complete(request)

    # Tried primary first, then the fallback.
    assert calls == ["primary/down", "second/up"]
    # Result reflects the model that actually served the request.
    assert result.text == "served by the fallback"
    assert result.model_requested == "primary/down"
    assert result.model_used == "second/up"
