"""The Model Gateway — the single, provider-agnostic metering chokepoint (D9).

This is the ONLY module in the codebase that imports ``litellm``. Everything
else depends on ``complete()`` plus the Tvashtr-owned types, so the gateway can
later be swapped for the LiteLLM proxy without touching callers.

Routing & fallbacks: LiteLLM ships a native ``fallbacks=`` argument, but we use
an explicit ordered try-next loop instead. That choice (a) makes the fallback
path deterministically unit-testable offline by monkeypatching
``litellm.completion`` to raise-then-succeed, and (b) lets the gateway report
exactly which model served the request (``model_used``) — which native
fallbacks obscure.

The gateway does NO database writes: it is a pure (request -> result) function.
Persisting the cost is the caller's job (a DBOS step), which is what keeps
metering idempotent under DBOS's at-least-once step retries.
"""

import time

import litellm

from tvashtr.config import get_settings
from tvashtr.gateway.types import CompletionRequest, CompletionResult, GatewayError

# Keep the gateway quiet and side-effect free: no debug spam, no phone-home.
litellm.suppress_debug_info = True
litellm.telemetry = False


def _ordered_models(request: CompletionRequest) -> list[str]:
    """Requested model first, then configured fallbacks — de-duplicated, in order."""
    ordered: list[str] = []
    for model in [request.model, *get_settings().model_fallbacks]:
        if model and model not in ordered:
            ordered.append(model)
    return ordered


def _provider_of(model: str) -> str:
    """Best-effort provider name for a model slug (e.g. ``openrouter``)."""
    try:
        return litellm.get_llm_provider(model)[1]
    except Exception:
        return model.split("/", 1)[0]


def _cost_of(response: object) -> float:
    """Computed USD cost. ``0.0`` is legitimate (free tiers / unknown pricing)."""
    try:
        return float(litellm.completion_cost(completion_response=response) or 0.0)
    except Exception:
        return 0.0


def complete(request: CompletionRequest) -> CompletionResult:
    """Route a completion to the requested model, failing over through fallbacks.

    Raises ``GatewayError`` only if *every* candidate model fails.
    """
    last_error: Exception | None = None
    # Apply the configured per-call output ceiling when the caller didn't set one
    # (static config, like the fallback list — NOT run state, so the gateway stays
    # a pure request->result function).
    max_tokens = request.max_tokens
    if max_tokens is None:
        max_tokens = get_settings().default_max_tokens_per_call
    for model in _ordered_models(request):
        kwargs: dict = {"model": model, "messages": request.messages}
        if request.temperature is not None:
            kwargs["temperature"] = request.temperature
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        # M-accounts Slice B: pass the per-owner provider key (BYOK) when the caller set one, so the
        # completion path resolves from the run owner's encrypted credential, not ``.env``. ``None``
        # ⇒ litellm's own env lookup (non-run callers only — the executor always sets it on a run).
        if request.api_key is not None:
            kwargs["api_key"] = request.api_key

        started = time.perf_counter()
        try:
            response = litellm.completion(**kwargs)
        except Exception as exc:  # noqa: BLE001 — any provider error means: try the next model
            last_error = exc
            continue
        latency_ms = (time.perf_counter() - started) * 1000.0

        usage = getattr(response, "usage", None)
        prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        total_tokens = int(getattr(usage, "total_tokens", 0) or 0) or (
            prompt_tokens + completion_tokens
        )

        return CompletionResult(
            text=response.choices[0].message.content or "",
            model_requested=request.model,
            model_used=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_usd=_cost_of(response),
            raw_provider=_provider_of(model),
            latency_ms=latency_ms,
        )

    raise GatewayError(
        f"all models failed for request (tried {_ordered_models(request)}): {last_error}"
    ) from last_error
