"""Domains embedding model catalogue — multi-dim allowlist + normalize.

Approach B (multi-provider LiteLLM/BYOK). ``domain_chunks.embedding`` is an
unbound pgvector ``vector`` column; each catalogue slug declares its native
``dim``. Keys resolve via ``provider_for_model`` + Engines BYOK
(``resolve_owner_api_key``). Never pad or truncate returned vectors — ingest
fail-closes when ``len(vec) != expected_dim(model)``.

OpenRouter free catalogue embeds (384/768/1024) are excluded unless explicitly
listed. Gemini ``gemini-embedding-001`` (768 via ``output_dimensionality``) is the
non-1536 preset. Groq hosted nomic embed is unavailable (docs/API list none; removed).
"""

from __future__ import annotations

from typing import TypedDict

# Stored / template default (bare) — normalize prefixes openai/ for LiteLLM.
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_SLUG = "openai/text-embedding-3-small"

# slug → {provider, dim}. Single source of truth for allowlist + expected dims.
EMBEDDING_CATALOGUE: dict[str, dict[str, object]] = {
    "openai/text-embedding-3-small": {"provider": "openai", "dim": 1536},
    "openai/text-embedding-ada-002": {"provider": "openai", "dim": 1536},
    # OpenRouter BYOK path to the same 1536 OpenAI model (Engines key: openrouter).
    "openrouter/openai/text-embedding-3-small": {"provider": "openrouter", "dim": 1536},
    "openrouter/openai/text-embedding-ada-002": {"provider": "openrouter", "dim": 1536},
    # Gemini AI Studio gemini-embedding-001 — Matryoshka; we pin 768 via LiteLLM
    # ``dimensions`` → Google ``outputDimensionality`` (Engines key: gemini).
    # Docs: https://ai.google.dev/gemini-api/docs/embeddings (text-embedding-004 shut down).
    "gemini/gemini-embedding-001": {"provider": "gemini", "dim": 768},
}

ALLOWED_EMBEDDING_MODELS: frozenset[str] = frozenset(EMBEDDING_CATALOGUE)


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
    {
        "id": "gemini-embedding-001",
        "label": "Gemini gemini-embedding-001 (768)",
        "slug": "gemini/gemini-embedding-001",
        "provider": "gemini",
        "dim": 768,
        "notes": (
            "Google AI Studio embed with output_dimensionality=768. Add a gemini "
            "Engines key. text-embedding-004 is shut down. Switching to/from a "
            "1536 model clears ready embeddings and forces re-ingest."
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
    """True if ``model`` normalizes to a catalogue slug."""
    return normalize_embedding_model(model) in ALLOWED_EMBEDDING_MODELS


def expected_dim(model: str) -> int:
    """Native embedding dimension for a catalogue slug. Raises if not allowlisted."""
    slug = normalize_embedding_model(model)
    entry = EMBEDDING_CATALOGUE.get(slug)
    if entry is None:
        raise ValueError(
            f"embedding model {slug!r} is not allowlisted; cannot resolve expected dim"
        )
    return int(entry["dim"])  # type: ignore[arg-type]


def public_embedding_presets() -> list[dict]:
    """JSON-safe preset list for FE / docs (no secrets)."""
    return [dict(p) for p in EMBEDDING_PRESETS]
