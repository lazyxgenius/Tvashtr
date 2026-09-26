"""Revamp (Engines + the agent panel's model picker): the provider catalogue's display metadata,
the ``anthropic``/``xai`` entries, the provider directory, and the new ``/api/config`` fields.

The catalogue grew two providers that are OFFERED but never stamped: these tests pin both halves —
the picker sees them, and no default/fallback walk ever returns them.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from tvashtr.config import get_settings
from tvashtr.control_plane.credential_gate import MODEL_PROVIDER_TO_SUB, RUNNER_SUBSCRIPTIONS
from tvashtr.control_plane.credentials import provider_for_model
from tvashtr.control_plane.domain_embedding import EMBEDDING_CATALOGUE, public_embedding_presets
from tvashtr.control_plane.provider_directory import public_provider_directory
from tvashtr.control_plane.teams import (
    _PROVIDER_DEFAULT_ORDER,
    CAPABILITIES,
    PROVIDER_CATALOGUE,
    account_default_model,
    account_fallback_model,
    catalogue_presets,
    public_provider_catalogue,
)
from tvashtr.main import app

# ------------------------------------------------------------------------- the catalogue ----


def test_catalogue_offers_anthropic_and_xai_with_the_designs_models():
    anthropic = PROVIDER_CATALOGUE["anthropic"]
    xai = PROVIDER_CATALOGUE["xai"]
    for capability in CAPABILITIES:
        assert catalogue_presets("anthropic", capability) == [
            "anthropic/claude-sonnet-5",
            "anthropic/claude-sonnet-4",
        ]
        assert catalogue_presets("xai", capability) == ["xai/grok-4.7"]
    assert anthropic["label"] == "Anthropic" and xai["label"] == "xAI"
    assert xai["model_labels"]["xai/grok-4.7"] == "Grok 4.7"
    assert anthropic["subscription"] == "claude" and xai["subscription"] == "grok"
    # Neither was probed on the BYOK path — the picker must be able to say so.
    assert anthropic["byok_probed"] is False and xai["byok_probed"] is False


@pytest.mark.parametrize("provider", sorted(PROVIDER_CATALOGUE))
def test_every_entry_labels_every_slug_it_declares(provider):
    entry = PROVIDER_CATALOGUE[provider]
    assert isinstance(entry["label"], str) and entry["label"].strip()
    declared = {
        m
        for capability in CAPABILITIES
        for m in [entry[f"{capability}_default"], *entry[f"{capability}_presets"]]
        if m is not None
    }
    assert declared <= set(entry["model_labels"]), declared - set(entry["model_labels"])
    for slug, label in entry["model_labels"].items():
        assert provider_for_model(slug) == provider
        assert label.strip()
    assert isinstance(entry["byok_probed"], bool)


@pytest.mark.parametrize("provider", sorted(PROVIDER_CATALOGUE))
def test_subscription_flag_agrees_with_the_launch_gate(provider):
    """The picker's "subscription · this computer" group and the launch gate must agree on which
    providers a plan covers: the gate's mapping, restricted to engines the Desktop can run."""
    mapped = MODEL_PROVIDER_TO_SUB.get(provider)
    expected = mapped if mapped in RUNNER_SUBSCRIPTIONS else None
    assert PROVIDER_CATALOGUE[provider]["subscription"] == expected


def test_byok_probed_matches_the_catalogue_evidence():
    probed = {p for p, e in PROVIDER_CATALOGUE.items() if e["byok_probed"]}
    assert probed == {"nvidia_nim", "openai", "gemini", "groq", "deepseek"}


# ------------------------------------------- adding entries changes no default selection ----


def test_offered_only_providers_are_never_an_account_default():
    """``anthropic``/``xai`` are outside ``_PROVIDER_DEFAULT_ORDER``: holding only their keys stamps
    nothing (the caller keeps its legacy default), exactly as before they were catalogued."""
    assert "anthropic" not in _PROVIDER_DEFAULT_ORDER and "xai" not in _PROVIDER_DEFAULT_ORDER
    for capability in CAPABILITIES:
        assert account_default_model({"anthropic", "xai"}, capability) is None
        assert account_fallback_model({"anthropic", "xai"}, capability) is None


@pytest.mark.parametrize("extra", [{"anthropic"}, {"xai"}, {"anthropic", "xai"}])
def test_holding_an_offered_only_key_changes_no_default_or_fallback(extra):
    for capability in CAPABILITIES:
        for held in ({"nvidia_nim"}, {"openai", "groq"}, set(_PROVIDER_DEFAULT_ORDER)):
            assert account_default_model(held | extra, capability) == account_default_model(
                held, capability
            )
            assert account_fallback_model(held | extra, capability) == account_fallback_model(
                held, capability
            )


def test_public_catalogue_serves_the_display_metadata():
    served = {e["provider"]: e for e in public_provider_catalogue()}
    assert set(served) == set(PROVIDER_CATALOGUE)
    for provider, entry in served.items():
        source = PROVIDER_CATALOGUE[provider]
        assert entry["label"] == source["label"]
        assert entry["model_labels"] == source["model_labels"]
        assert entry["subscription"] == source["subscription"]
        assert entry["byok_probed"] == source["byok_probed"]


# ------------------------------------------------------------------------- the directory ----


def test_directory_covers_every_catalogue_and_embedding_provider():
    listed = [e["provider"] for e in public_provider_directory()]
    assert len(listed) == len(set(listed)), "a provider is listed twice"
    embedding_providers = {str(e["provider"]) for e in EMBEDDING_CATALOGUE.values()}
    assert set(PROVIDER_CATALOGUE) <= set(listed)
    assert embedding_providers <= set(listed)
    assert "huggingface" in listed


def test_directory_order_and_design_copy():
    entries = public_provider_directory()
    by = {e["provider"]: e for e in entries}
    assert [e["provider"] for e in entries][:2] == ["anthropic", "xai"]
    assert by["anthropic"]["label"] == "Claude models"
    assert by["anthropic"]["monogram"] == "A"
    assert by["anthropic"]["example_model"] == "anthropic/claude-sonnet-5"
    assert by["anthropic"]["subscription"] == "claude"
    assert by["xai"]["monogram"] == "X" and by["xai"]["subscription"] == "grok"
    assert by["groq"]["monogram"] == "Q" and by["openrouter"]["monogram"] == "R"
    assert by["openrouter"]["label"] == "many models through one key"
    assert by["gemini"]["label"] == "Gemini models and Domains embeddings"
    hf = by["huggingface"]
    assert hf["embeddings"] is True and hf["subscription"] is None
    assert hf["example_model"] == "huggingface/BAAI/bge-small-en-v1.5"
    assert hf["hint"] == (
        "Used by Domains ingest for BGE-small embeddings. A free token from huggingface.co works."
    )
    assert hf["name"] == "Hugging Face"


def test_directory_entries_are_consistent_with_the_catalogues():
    embedding_providers = {str(e["provider"]) for e in EMBEDDING_CATALOGUE.values()}
    for e in public_provider_directory():
        assert set(e) == {
            "provider",
            "monogram",
            "name",
            "label",
            "example_model",
            "subscription",
            "embeddings",
            "hint",
        }
        assert len(e["monogram"]) == 1
        source = PROVIDER_CATALOGUE.get(e["provider"])
        embedding_slug = next(
            (slug for slug, m in EMBEDDING_CATALOGUE.items() if m["provider"] == e["provider"]),
            None,
        )
        declared = (
            (source or {}).get("thinker_default")
            or (source or {}).get("worker_default")
            or embedding_slug
        )
        # The example is DERIVED, exactly: a provider that declares a model quotes one of its own;
        # one that declares none quotes nothing rather than an undeclared slug. The only such
        # provider today is nvidia_nim — kept in the directory (a held key still has its row) but
        # serving no seat since 2026-09-26 (worker: minimax-m3 retired; thinker: gpt-oss-20b
        # hangs) — and the Add-key hint then reads "Covers models that start with nvidia_nim/.".
        assert e["example_model"] == declared, e["provider"]
        if declared is not None:
            assert provider_for_model(e["example_model"]) == e["provider"]
        assert e["embeddings"] is (e["provider"] in embedding_providers)
        if source is not None:
            assert e["name"] == source["label"]
            assert e["subscription"] == source["subscription"]
            assert e["hint"] is None  # model providers use the generic "Covers models …" hint
    no_example = {d["provider"] for d in public_provider_directory() if not d["example_model"]}
    assert no_example == {"nvidia_nim"}


# ------------------------------------------------------------------------ /api/config ----


def test_config_serves_directory_presets_and_default_budget(monkeypatch):
    monkeypatch.setattr(get_settings(), "default_run_budget_usd", Decimal("7.50"))
    body = TestClient(app).get("/api/config").json()
    assert body["provider_directory"] == public_provider_directory()
    assert body["embedding_presets"] == public_embedding_presets()
    assert body["default_run_budget_usd"] == 7.5
    catalogue = {e["provider"]: e for e in body["provider_catalogue"]}
    assert {"anthropic", "xai"} <= set(catalogue)
    assert catalogue["xai"]["model_labels"] == {"xai/grok-4.7": "Grok 4.7"}
    assert catalogue["openai"]["subscription"] is None


def test_config_serves_a_null_budget_when_uncapped(monkeypatch):
    monkeypatch.setattr(get_settings(), "default_run_budget_usd", None)
    body = TestClient(app).get("/api/config").json()
    assert body["default_run_budget_usd"] is None
