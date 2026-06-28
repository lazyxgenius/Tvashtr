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


class GatewayError(RuntimeError):
    """Raised when every model in the ordered list (requested + fallbacks) fails."""
