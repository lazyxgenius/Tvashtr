"""Gateway ``embed()`` unit tests — no network (M-memory S1).

The gateway is the only module that imports LiteLLM; these monkeypatch the ``litellm.embedding``
boundary so they run fully offline + deterministically, mirroring ``test_gateway.py`` for
``complete()``. They assert the canned provider response maps to a correct ``EmbeddingResult``
(the 1536-length vector, tokens, computed cost, provider), the BYOK api_key is forwarded only when
set, and a provider failure surfaces as ``GatewayError`` (embeddings have NO fallback — a
dimension-pinned model must never silently fail over).
"""

from types import SimpleNamespace

import pytest

from tvashtr.gateway import EmbeddingRequest, GatewayError, embed
from tvashtr.gateway import gateway as gw


def _canned_embedding(dim: int = 1536, model: str = "openai/text-embedding-3-small"):
    """A stand-in for LiteLLM's EmbeddingResponse (only the bits the gateway reads). ``data`` items
    are dicts with an ``embedding`` key, exactly as litellm returns them."""
    return SimpleNamespace(
        data=[{"embedding": [0.001 * (i % 7) for i in range(dim)], "index": 0}],
        usage=SimpleNamespace(prompt_tokens=5, total_tokens=5),
        model=model,
    )


def test_embed_maps_vectors_usage_cost_and_model(monkeypatch):
    captured = {}

    def fake_embedding(*, model, input, **kwargs):
        captured["model"] = model
        captured["input"] = input
        return _canned_embedding()

    monkeypatch.setattr(gw.litellm, "embedding", fake_embedding)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0000004)

    result = embed(EmbeddingRequest(model="openai/text-embedding-3-small", input=["hello memory"]))

    # Routed exactly the requested model + input batch.
    assert captured["model"] == "openai/text-embedding-3-small"
    assert captured["input"] == ["hello memory"]
    # Mapped fields from the canned response.
    assert len(result.vectors) == 1
    assert len(result.vectors[0]) == 1536  # the PINNED text-embedding-3-small dimension
    assert all(isinstance(x, float) for x in result.vectors[0][:5])
    assert result.model == "openai/text-embedding-3-small"
    assert result.prompt_tokens == 5
    assert result.total_tokens == 5
    assert result.cost_usd == 0.0000004
    assert result.raw_provider == "openai"
    assert result.latency_ms >= 0.0


def test_embed_forwards_byok_api_key_when_set(monkeypatch):
    captured = {}

    def fake_embedding(*, model, input, **kwargs):
        captured["api_key"] = kwargs.get("api_key", "<<absent>>")
        return _canned_embedding()

    monkeypatch.setattr(gw.litellm, "embedding", fake_embedding)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    embed(EmbeddingRequest(model="openai/x", input=["hi"], api_key="owner-key"))
    assert captured["api_key"] == "owner-key"


def test_embed_omits_api_key_when_none(monkeypatch):
    # The manual/non-run path (api_key=None) lets litellm resolve the key its own env way (.env).
    captured = {}

    def fake_embedding(*, model, input, **kwargs):
        captured["has_api_key"] = "api_key" in kwargs
        return _canned_embedding()

    monkeypatch.setattr(gw.litellm, "embedding", fake_embedding)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    embed(EmbeddingRequest(model="openai/x", input=["hi"]))
    assert captured["has_api_key"] is False


def test_embed_raises_gateway_error_on_provider_failure(monkeypatch):
    def boom(*, model, input, **kwargs):
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(gw.litellm, "embedding", boom)
    with pytest.raises(GatewayError):
        embed(EmbeddingRequest(model="openai/x", input=["hi"]))
