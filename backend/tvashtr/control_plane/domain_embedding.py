"""Domains embedding model catalogue — 1536-dim allowlist + normalize.

Approach B (multi-provider LiteLLM/BYOK). pgvector column is fixed at 1536; only
models verified to emit 1536 dims are allowed. Keys resolve via
``provider_for_model`` + Engines BYOK (``resolve_owner_api_key``).

There is no zero-key free remote 1536 path on OpenRouter — free catalogue embeds
are 384/768/1024. The cheap path without an OpenAI Engines key is
``openrouter/openai/text-embedding-3-small`` (OpenRouter BYOK; still OpenAI
upstream weights, billed on OpenRouter credits).
"""

from __future__ import annotations

from typing import TypedDict

# Stored / template default (bare) — normalize prefixes openai/ for LiteLLM.
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_SLUG = "openai/text-embedding-3-small"

# Verified native 1536 LiteLLM slugs only.
ALLOWED_EMBEDDING_MODELS: frozenset[str] = frozenset(
    {
        "openai/text-embedding-3-small",
        "openai/text-embedding-ada-002",
        # OpenRouter BYOK path to the same 1536 OpenAI model (Engines key: openrouter).
        "openrouter/openai/text-embedding-3-small",
        "openrouter/openai/text-embedding-ada-002",
    }
)


class EmbeddingPreset(TypedDict):
    id: str
    label: str
    slug: str
    provider: str
    dim: int
    notes: str


EMBEDDING_PRESETS: tuple[EmbeddingPreset, ...] = (
    {
        "id": "openai-3-small",
        "label": "OpenAI text-embedding-3-small (default)",
        "slug": "openai/text-embedding-3-small",
        "provider": "openai",
        "dim": 1536,
        "notes": "Requires Engines key for provider openai.",
    },
    {
        "id": "openai-ada-002",
        "label": "OpenAI text-embedding-ada-002",
        "slug": "openai/text-embedding-ada-002",
        "provider": "openai",
        "dim": 1536,
        "notes": "Legacy 1536; requires Engines key for provider openai.",
    },
    {
        "id": "openrouter-3-small",
        "label": "OpenRouter → text-embedding-3-small",
        "slug": "openrouter/openai/text-embedding-3-small",
        "provider": "openrouter",
        "dim": 1536,
        "notes": (
            "Cheapest 1536 path without an OpenAI Engines key. Add an OpenRouter "
            "key under Engines. Still OpenAI upstream via OpenRouter billing — "
            "not covered by SuperGrok/subscription."
        ),
    },
)


def normalize_embedding_model(model: str) -> str:
    """Return a LiteLLM slug. Bare names get ``openai/`` for back-compat."""
    m = (model or "").strip() or DEFAULT_EMBEDDING_MODEL
    if "/" not in m:
        return f"openai/{m}"
    return m


def is_allowed_embedding_model(model: str) -> bool:
    """True if ``model`` normalizes to a catalogue 1536-safe slug."""
    return normalize_embedding_model(model) in ALLOWED_EMBEDDING_MODELS


def public_embedding_presets() -> list[dict]:
    """JSON-safe preset list for FE / docs (no secrets)."""
    return [dict(p) for p in EMBEDDING_PRESETS]
