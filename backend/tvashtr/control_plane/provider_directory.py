"""Engines — the provider directory the Add-key picker lists (served on ``GET /api/config``).

The model catalogue (``teams.PROVIDER_CATALOGUE``) answers "which models can a node run?". The
directory answers a different question: "which API keys can an account usefully add?" — so it also
lists providers that serve no node model at all, like ``huggingface`` (Domains embeddings only).

Every entry: ``provider`` (the canonical slug a key is saved under), ``monogram`` (the letter tile;
not always the first letter), ``name`` (the vendor's display name), ``label`` (the picker's
description line), ``example_model`` (the slug the "Covers models that start with …" hint quotes),
``subscription`` (the Desktop plan that also covers it, or ``None``), ``embeddings`` (a Domains
embedding model uses it) and ``hint`` (a provider-specific hint that REPLACES the generic "Covers
models …" one, else ``None``).

Derived, not re-declared: names, example models and subscriptions come from the model catalogue, and
the embeddings flag from ``domain_embedding.EMBEDDING_CATALOGUE``, so a provider added to either
appears here automatically (pinned by a test). Static; no DB, no network, no key material.
"""

from tvashtr.control_plane.domain_embedding import EMBEDDING_CATALOGUE
from tvashtr.control_plane.teams import PROVIDER_CATALOGUE

# The picker's order (the FE lists providers the user's teams use first, then this order): the two
# subscription-backed vendors, the probed catalogue providers, the embeddings-only provider, then
# the two gateways the design lists last.
_DIRECTORY_ORDER: tuple[str, ...] = (
    "anthropic",
    "xai",
    "openai",
    "gemini",
    "groq",
    "deepseek",
    "huggingface",
    "nvidia_nim",
    "openrouter",
)

# Per-provider display copy. ``label`` strings are the design's (Engines analysis ENG-63); deepseek
# and nvidia_nim are not described in the design and use the same "<what> models" pattern.
_DISPLAY: dict[str, dict] = {
    "anthropic": {"monogram": "A", "label": "Claude models"},
    "xai": {"monogram": "X", "label": "Grok models"},
    "openai": {"monogram": "O", "label": "GPT models"},
    "gemini": {"monogram": "G", "label": "Gemini models and Domains embeddings"},
    "groq": {"monogram": "Q", "label": "Fast open models"},
    "deepseek": {"monogram": "D", "label": "DeepSeek models"},
    "huggingface": {
        "monogram": "H",
        "name": "Hugging Face",
        "label": "Domains BGE-small embeddings (free token)",
        "hint": (
            "Used by Domains ingest for BGE-small embeddings. "
            "A free token from huggingface.co works."
        ),
    },
    "nvidia_nim": {"monogram": "N", "label": "Open models on NVIDIA NIM"},
    "openrouter": {"monogram": "R", "label": "many models through one key"},
}


def _embedding_providers() -> dict[str, str]:
    """``provider -> first embedding slug`` for every provider a Domains embedding model uses."""
    out: dict[str, str] = {}
    for slug, entry in EMBEDDING_CATALOGUE.items():
        out.setdefault(str(entry["provider"]), slug)
    return out


def _ordered_providers() -> list[str]:
    """The directory order, then any catalogue or embedding provider it does not name yet (so a
    provider added to either catalogue is never silently missing from the picker)."""
    seen = list(_DIRECTORY_ORDER)
    for provider in [*PROVIDER_CATALOGUE, *_embedding_providers()]:
        if provider not in seen:
            seen.append(provider)
    return seen


def public_provider_directory() -> list[dict]:
    """The directory as a JSON-safe list, in picker order. Public — slugs and copy only."""
    embedding = _embedding_providers()
    out: list[dict] = []
    for provider in _ordered_providers():
        catalogue = PROVIDER_CATALOGUE.get(provider) or {}
        display = _DISPLAY.get(provider) or {}
        example = (
            catalogue.get("thinker_default")
            or catalogue.get("worker_default")
            or embedding.get(provider)
        )
        out.append(
            {
                "provider": provider,
                "monogram": display.get("monogram") or provider[:1].upper(),
                "name": catalogue.get("label") or display.get("name") or provider,
                "label": display.get("label") or f"{provider} models",
                "example_model": example,
                "subscription": catalogue.get("subscription"),
                "embeddings": provider in embedding,
                "hint": display.get("hint"),
            }
        )
    return out
