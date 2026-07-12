"""Tvashtr-owned value objects for the model-gateway boundary.

These deliberately leak no LiteLLM types: the rest of the app depends only on
these dataclasses plus ``gateway.complete()``. That is what lets the gateway be
swapped (or fronted by the LiteLLM proxy) later without touching callers. Cost
is captured as raw token counts *and* a computed USD figure — the counts stay
meaningful even when a free-tier call legitimately costs ``0.0``.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class CompletionRequest:
    """A provider-agnostic completion request. ``model`` is a free-form
    ``provider/model`` pass-through string (no enum).

    ``api_key`` (M-accounts Slice B) is the per-owner provider key the run executor resolved from
    the owner's encrypted ``provider_credentials`` and threads in, so the completion (gateway) path
    is BYOK + ``.env``-free exactly like the agent path. ``None`` (the default) ⇒ the gateway lets
    litellm resolve the key the legacy way (its provider env lookup) — used only by non-run callers
    (e.g. the ``generate_doc`` spike); on the run path the executor ALWAYS sets it."""

    model: str
    messages: list[dict[str, str]]
    temperature: float | None = None
    max_tokens: int | None = None
    api_key: str | None = None


@dataclass(frozen=True)
class CompletionResult:
    """The gateway's own result object — never a raw LiteLLM response.

    ``model_requested`` vs ``model_used`` differ whenever a fallback served the
    request, so the distinction is preserved here (and persisted by metering).
    """

    text: str
    model_requested: str
    model_used: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    raw_provider: str
    latency_ms: float


@dataclass(frozen=True)
class EmbeddingRequest:
    """A provider-agnostic embedding request (M-memory S1). ``model`` is the same free-form
    ``provider/model`` pass-through string as :class:`CompletionRequest` (e.g.
    ``openai/text-embedding-3-small``); ``input`` is a batch of texts to embed.

    ``api_key`` mirrors :class:`CompletionRequest`: a set key is the per-owner BYOK key (the
    run-scoped distillation path threads it in a later slice); ``None`` (the default) ⇒ litellm
    resolves the key its own env way — the non-run/manual path (the S1 CRUD embed reads
    ``OPENAI_API_KEY`` from ``.env``, exactly like the ``generate_doc`` spike)."""

    model: str
    input: list[str]
    api_key: str | None = None


@dataclass(frozen=True)
class EmbeddingResult:
    """The gateway's own embedding result — never a raw LiteLLM response. ``vectors`` holds one
    embedding per input text, order-aligned with ``EmbeddingRequest.input``. Cost is captured as raw
    token counts AND a computed USD figure (``0.0`` is legitimate — unknown pricing), the same
    discipline as :class:`CompletionResult`. There is no ``model_requested``/``model_used`` split:
    an embedding model is a deliberate, dimension-pinned choice, so the gateway never fails it over
    to a different model (see ``gateway.embed``)."""

    vectors: list[list[float]]
    model: str
    prompt_tokens: int
    total_tokens: int
    cost_usd: float
    raw_provider: str
    latency_ms: float


class GatewayError(RuntimeError):
    """Raised when every model in the ordered list (requested + fallbacks) fails."""
