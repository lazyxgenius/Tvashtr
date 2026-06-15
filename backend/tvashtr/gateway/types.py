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
    ``provider/model`` pass-through string (no enum)."""

    model: str
    messages: list[dict[str, str]]
    temperature: float | None = None
    max_tokens: int | None = None


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
