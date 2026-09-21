"""Domains multi-provider embedding catalogue (Approach B, dim 1536)."""

from tvashtr.control_plane.credentials import provider_for_model
from tvashtr.control_plane.domain_embedding import (
    ALLOWED_EMBEDDING_MODELS,
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_EMBEDDING_SLUG,
    EMBEDDING_PRESETS,
    is_allowed_embedding_model,
    normalize_embedding_model,
    public_embedding_presets,
)
from tvashtr.control_plane import domains as domains_cp


def test_normalize_default_and_bare_openai():
    assert normalize_embedding_model("") == DEFAULT_EMBEDDING_SLUG
    assert normalize_embedding_model(None) == DEFAULT_EMBEDDING_SLUG  # type: ignore[arg-type]
    assert normalize_embedding_model("  ") == DEFAULT_EMBEDDING_SLUG
    assert (
        normalize_embedding_model(DEFAULT_EMBEDDING_MODEL) == DEFAULT_EMBEDDING_SLUG
    )
    assert (
        normalize_embedding_model("text-embedding-3-small")
        == "openai/text-embedding-3-small"
    )


def test_normalize_preserves_openai_and_openrouter_slugs():
    assert (
        normalize_embedding_model("openai/text-embedding-3-small")
        == "openai/text-embedding-3-small"
    )
    assert (
        normalize_embedding_model("openrouter/openai/text-embedding-3-small")
        == "openrouter/openai/text-embedding-3-small"
    )
    assert (
        normalize_embedding_model("openai/text-embedding-ada-002")
        == "openai/text-embedding-ada-002"
    )


def test_allowlist_covers_presets_and_dims():
    assert DEFAULT_EMBEDDING_SLUG in ALLOWED_EMBEDDING_MODELS
    assert "openrouter/openai/text-embedding-3-small" in ALLOWED_EMBEDDING_MODELS
    for preset in EMBEDDING_PRESETS:
        assert preset["dim"] == 1536
        assert preset["slug"] in ALLOWED_EMBEDDING_MODELS
        assert preset["provider"] == provider_for_model(preset["slug"])
    slugs = {p["slug"] for p in public_embedding_presets()}
    assert "openrouter/openai/text-embedding-3-small" in slugs


def test_is_allowed_accepts_bare_default_rejects_non_1536():
    assert is_allowed_embedding_model("text-embedding-3-small")
    assert is_allowed_embedding_model("openai/text-embedding-ada-002")
    assert is_allowed_embedding_model("openrouter/openai/text-embedding-3-small")
    # OpenRouter free embeds are not 1536 — must reject
    assert not is_allowed_embedding_model("openrouter/liquid/lfm-2.5-embedding-350m:free")
    assert not is_allowed_embedding_model("openai/text-embedding-3-large")
    assert not is_allowed_embedding_model("ollama/nomic-embed-text")


def test_validate_accepts_openrouter_embed_slug():
    cfg = domains_cp.default_config_for_template("blank")
    cfg["embedding"]["model"] = "openrouter/openai/text-embedding-3-small"
    domains_cp.validate_domain_config(cfg)  # no raise


def test_validate_accepts_bare_default():
    cfg = domains_cp.default_config_for_template("blank")
    assert cfg["embedding"]["model"] == "text-embedding-3-small"
    domains_cp.validate_domain_config(cfg)


def test_validate_rejects_unknown_embedding_model():
    cfg = domains_cp.default_config_for_template("blank")
    cfg["embedding"]["model"] = "openrouter/thenlper/gte-base"
    try:
        domains_cp.validate_domain_config(cfg)
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "embedding.model" in str(e) or "allowlisted" in str(e).lower()


def test_validate_rejects_embedding_unknown_keys():
    cfg = domains_cp.default_config_for_template("blank")
    cfg["embedding"]["api_base"] = "https://example.invalid"
    try:
        domains_cp.validate_domain_config(cfg)
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "unknown" in str(e).lower()


def test_provider_for_model_openrouter_embed():
    assert (
        provider_for_model("openrouter/openai/text-embedding-3-small") == "openrouter"
    )
    assert provider_for_model("openai/text-embedding-3-small") == "openai"
