"""Domains multi-provider embedding catalogue (Approach B, multi-dim)."""

from tvashtr.control_plane.credentials import provider_for_model
from tvashtr.control_plane.domain_embedding import (
    ALLOWED_EMBEDDING_MODELS,
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_EMBEDDING_SLUG,
    EMBEDDING_CATALOGUE,
    EMBEDDING_PRESETS,
    expected_dim,
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


def test_normalize_preserves_openai_openrouter_and_gemini_slugs():
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
    assert (
        normalize_embedding_model("gemini/gemini-embedding-001")
        == "gemini/gemini-embedding-001"
    )


def test_catalogue_covers_presets_provider_and_dim():
    assert DEFAULT_EMBEDDING_SLUG in ALLOWED_EMBEDDING_MODELS
    assert "openrouter/openai/text-embedding-3-small" in ALLOWED_EMBEDDING_MODELS
    assert "gemini/gemini-embedding-001" in ALLOWED_EMBEDDING_MODELS
    assert EMBEDDING_CATALOGUE["gemini/gemini-embedding-001"]["provider"] == "gemini"
    assert EMBEDDING_CATALOGUE["gemini/gemini-embedding-001"]["dim"] == 768
    assert EMBEDDING_CATALOGUE["openai/text-embedding-3-small"]["dim"] == 1536
    assert EMBEDDING_CATALOGUE["openrouter/openai/text-embedding-3-small"]["dim"] == 1536
    for preset in EMBEDDING_PRESETS:
        assert preset["slug"] in ALLOWED_EMBEDDING_MODELS
        assert preset["slug"] in EMBEDDING_CATALOGUE
        entry = EMBEDDING_CATALOGUE[preset["slug"]]
        assert preset["dim"] == entry["dim"]
        assert preset["provider"] == entry["provider"]
        assert preset["provider"] == provider_for_model(preset["slug"])
    slugs = {p["slug"] for p in public_embedding_presets()}
    assert "openrouter/openai/text-embedding-3-small" in slugs
    assert "gemini/gemini-embedding-001" in slugs
    gem = next(p for p in public_embedding_presets() if p["id"] == "gemini-embedding-001")
    assert gem["dim"] == 768
    assert gem["provider"] == "gemini"
    assert not any(p["id"] == "groq-nomic-v1_5" for p in public_embedding_presets())


def test_expected_dim_openai_1536_and_gemini_768():
    assert expected_dim("text-embedding-3-small") == 1536
    assert expected_dim("openai/text-embedding-3-small") == 1536
    assert expected_dim("openrouter/openai/text-embedding-3-small") == 1536
    assert expected_dim("gemini/gemini-embedding-001") == 768


def test_expected_dim_rejects_unknown():
    try:
        expected_dim("ollama/nomic-embed-text")
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "embedding" in str(e).lower() or "allowlist" in str(e).lower()


def test_is_allowed_accepts_catalogue_rejects_unknown():
    assert is_allowed_embedding_model("text-embedding-3-small")
    assert is_allowed_embedding_model("openai/text-embedding-ada-002")
    assert is_allowed_embedding_model("openrouter/openai/text-embedding-3-small")
    assert is_allowed_embedding_model("gemini/gemini-embedding-001")
    # OpenRouter free embeds are not in catalogue — must reject
    assert not is_allowed_embedding_model("openrouter/liquid/lfm-2.5-embedding-350m:free")
    assert not is_allowed_embedding_model("openai/text-embedding-3-large")
    assert not is_allowed_embedding_model("ollama/nomic-embed-text")
    assert not is_allowed_embedding_model("groq/nomic-embed-text-v1_5")


def test_validate_accepts_openrouter_and_gemini_embed_slugs():
    cfg = domains_cp.default_config_for_template("blank")
    cfg["embedding"]["model"] = "openrouter/openai/text-embedding-3-small"
    domains_cp.validate_domain_config(cfg)  # no raise
    cfg["embedding"]["model"] = "gemini/gemini-embedding-001"
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


def test_provider_for_model_openrouter_and_gemini_embed():
    assert (
        provider_for_model("openrouter/openai/text-embedding-3-small") == "openrouter"
    )
    assert provider_for_model("openai/text-embedding-3-small") == "openai"
    assert provider_for_model("gemini/gemini-embedding-001") == "gemini"
