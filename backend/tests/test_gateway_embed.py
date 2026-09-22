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


def test_embed_gemini_passes_dimensions_and_l2_normalizes(monkeypatch):
    """Gemini AI Studio ``gemini-embedding-001`` needs ``dimensions`` + L2 for truncated dims.

    Docs: https://ai.google.dev/gemini-api/docs/embeddings — recommend 768/1536/3072;
    ``gemini-embedding-001`` requires manual L2 normalize when dim != 3072.
    """
    captured = {}

    def fake_embedding(*, model, input, **kwargs):
        captured["model"] = model
        captured["input"] = input
        captured["dimensions"] = kwargs.get("dimensions")
        captured["api_key"] = kwargs.get("api_key", "<<absent>>")
        # Unnormalized 768 vector (magnitude != 1)
        return _canned_embedding(dim=768, model=model)

    monkeypatch.setattr(gw.litellm, "embedding", fake_embedding)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)

    result = embed(
        EmbeddingRequest(
            model="gemini/gemini-embedding-001",
            input=["domain chunk"],
            api_key="owner-gemini-key",
        )
    )

    assert captured["model"] == "gemini/gemini-embedding-001"
    assert captured["dimensions"] == 768
    assert captured["api_key"] == "owner-gemini-key"
    assert captured["input"] == ["domain chunk"]
    assert result.model == "gemini/gemini-embedding-001"
    assert result.raw_provider == "gemini"
    assert len(result.vectors[0]) == 768
    # L2-normalized: unit length
    mag = sum(x * x for x in result.vectors[0]) ** 0.5
    assert abs(mag - 1.0) < 1e-6


def test_embed_openai_does_not_force_dimensions(monkeypatch):
    captured = {}

    def fake_embedding(*, model, input, **kwargs):
        captured["dimensions"] = kwargs.get("dimensions", "<<absent>>")
        return _canned_embedding()

    monkeypatch.setattr(gw.litellm, "embedding", fake_embedding)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    embed(EmbeddingRequest(model="openai/text-embedding-3-small", input=["hi"]))
    assert captured["dimensions"] == "<<absent>>"



def test_embed_hf_rate_limit_maps_to_clear_message(monkeypatch):
    """HF free Inference 429 → actionable GatewayError (not opaque litellm wrap)."""

    class RateLimited(Exception):
        status_code = 429

    def boom(*, model, input, **kwargs):
        raise RateLimited("Rate limit exceeded: 429")

    monkeypatch.setattr(gw.litellm, "embedding", boom)
    with pytest.raises(GatewayError) as ei:
        embed(
            EmbeddingRequest(
                model="huggingface/BAAI/bge-small-en-v1.5",
                input=["hi"],
                api_key="hf_test",
            )
        )
    msg = str(ei.value)
    assert "Hugging Face free tier rate limit" in msg
    assert "wait or upgrade HF plan" in msg
    assert "Gemini" in msg or "OpenRouter" in msg


def test_embed_non_hf_rate_limit_keeps_generic_gateway_error(monkeypatch):
    """OpenAI/Gemini 429s stay on the generic embedding-failed path (no HF copy)."""

    class RateLimited(Exception):
        status_code = 429

    def boom(*, model, input, **kwargs):
        raise RateLimited("Rate limit exceeded: 429")

    monkeypatch.setattr(gw.litellm, "embedding", boom)
    with pytest.raises(GatewayError) as ei:
        embed(EmbeddingRequest(model="openai/text-embedding-3-small", input=["hi"]))
    assert "embedding failed" in str(ei.value).lower()
    assert "Hugging Face free tier" not in str(ei.value)


def test_embed_hf_forwards_api_key_feature_extraction_no_dimensions(monkeypatch):
    captured = {}

    def fake_embedding(*, model, input, **kwargs):
        captured["model"] = model
        captured["api_key"] = kwargs.get("api_key", "<<absent>>")
        captured["dimensions"] = kwargs.get("dimensions", "<<absent>>")
        captured["input_type"] = kwargs.get("input_type", "<<absent>>")
        return _canned_embedding(dim=384, model=model)

    monkeypatch.setattr(gw.litellm, "embedding", fake_embedding)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    result = embed(
        EmbeddingRequest(
            model="huggingface/BAAI/bge-small-en-v1.5",
            input=["chunk"],
            api_key="hf_owner",
        )
    )
    assert captured["model"] == "huggingface/BAAI/bge-small-en-v1.5"
    assert captured["api_key"] == "hf_owner"
    assert captured["dimensions"] == "<<absent>>"
    assert captured["input_type"] == "feature-extraction"
    assert len(result.vectors[0]) == 384


def test_embed_openai_does_not_force_input_type(monkeypatch):
    captured = {}

    def fake_embedding(*, model, input, **kwargs):
        captured["input_type"] = kwargs.get("input_type", "<<absent>>")
        return _canned_embedding()

    monkeypatch.setattr(gw.litellm, "embedding", fake_embedding)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    embed(EmbeddingRequest(model="openai/text-embedding-3-small", input=["hi"]))
    assert captured["input_type"] == "<<absent>>"


def test_embed_hf_unsupported_model_maps_to_clear_message(monkeypatch):
    """HF router 400 'Model not supported by provider hf-inference' → actionable copy."""

    class Unsupported(Exception):
        status_code = 400

    def boom(*, model, input, **kwargs):
        raise Unsupported("Model not supported by provider hf-inference")

    monkeypatch.setattr(gw.litellm, "embedding", boom)
    with pytest.raises(GatewayError) as ei:
        embed(
            EmbeddingRequest(
                model="huggingface/BAAI/bge-small-en-v1.5",
                input=["hi"],
                api_key="hf_test",
            )
        )
    msg = str(ei.value)
    assert "does not support this embedding model" in msg
    assert "BGE-small" in msg or "Gemini" in msg or "OpenRouter" in msg
