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
from tvashtr.gateway.types import (
    CompletionRequest,
    CompletionResult,
    EmbeddingRequest,
    EmbeddingResult,
    GatewayError,
)

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


def _is_rate_limit(exc: Exception) -> bool:
    """True when a provider error is a RATE LIMIT (429) rather than a HARD failure.

    The per-node fallback (``config["fallback_model"]``) must NEVER burn on a 429: a rate limit is
    transient and is already owned by the Milestone-B retry envelope (``agent_num_retries`` /
    ``retry_max_wait``, see :func:`tvashtr.config.agent_llm_routing`). Swapping models on one would
    silently downgrade a run that only needed to wait. A HARD failure — bad/absent credentials, an
    unreachable provider, an unknown model — is what the swap is for.

    Classified structurally first (litellm surfaces ``status_code`` on its provider errors), with
    a conservative text check as the fallback for wrapped/opaque errors.
    """
    if getattr(exc, "status_code", None) == 429:
        return True
    text = str(exc).lower()
    return "429" in text or "rate limit" in text or "ratelimit" in text


def multimodal_supported(model: str) -> bool:
    """Best-effort: can ``model`` actually accept non-text (image) input?

    The per-node ``config["multimodal"]`` opt-in is BOUNDED BY THE MODEL — a text-only slug simply
    cannot use it. This probe lets a caller SURFACE that mismatch (an advisory warning) instead of
    the flag silently doing nothing. Never raises: an unknown/unmapped slug answers ``False`` rather
    than crashing a run.
    """
    try:
        return bool(litellm.supports_vision(model))
    except Exception:  # noqa: BLE001 — an unknown slug must never crash a run
        return False


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
    # Each candidate is ``(model, api_key)``: the per-node fallback may be a DIFFERENT provider than
    # the primary, so it carries the key the executor resolved for ITS provider. The list is built
    # from the unchanged ``_ordered_models`` (requested + the static config fallbacks) and is
    # MUTATED below — the per-node fallback is spliced in directly after the primary, but ONLY when
    # the primary fails HARD. A request with no ``fallback_model`` never splices, so its order and
    # semantics are byte-identical to before this feature.
    candidates: list[tuple[str, str | None]] = [
        (model, request.api_key) for model in _ordered_models(request)
    ]
    index = 0
    while index < len(candidates):
        model, api_key = candidates[index]
        kwargs: dict = {"model": model, "messages": request.messages}
        if request.temperature is not None:
            kwargs["temperature"] = request.temperature
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        # M-accounts Slice B: pass the per-owner provider key (BYOK) when the caller set one, so the
        # completion path resolves from the run owner's encrypted credential, not ``.env``. ``None``
        # ⇒ litellm's own env lookup (non-run callers only — the executor always sets it on a run).
        if api_key is not None:
            kwargs["api_key"] = api_key

        started = time.perf_counter()
        try:
            response = litellm.completion(**kwargs)
        except Exception as exc:  # noqa: BLE001 — any provider error means: try the next model
            last_error = exc
            # The per-node failover: swap ONCE, only off the PRIMARY (``index == 0``), only on a
            # HARD failure (never a 429 — see :func:`_is_rate_limit`), and only if the fallback slug
            # isn't already queued. Tried BEFORE the static ``model_fallbacks`` because an AUTHORED
            # per-node choice is more specific than a deployment-wide default.
            fallback = request.fallback_model
            if (
                index == 0
                and fallback
                and fallback not in [m for m, _ in candidates]
                and not _is_rate_limit(exc)
            ):
                fallback_key = (
                    request.fallback_api_key
                    if request.fallback_api_key is not None
                    else request.api_key
                )
                candidates.insert(1, (fallback, fallback_key))
            index += 1
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
        f"all models failed for request (tried {[m for m, _ in candidates]}): {last_error}"
    ) from last_error


def embed(request: EmbeddingRequest) -> EmbeddingResult:
    """Embed a batch of texts through the requested model (M-memory S1).

    Mirrors :func:`complete` — a pure ``request -> result`` call with NO database writes (persisting
    the cost is the caller's job, which keeps metering idempotent). ``api_key`` is
    forwarded to litellm only when set (the per-owner BYOK path); ``None`` lets litellm resolve the
    key its own env way (the manual/non-run path — reads ``OPENAI_API_KEY`` from ``.env``).

    Unlike ``complete`` there is NO fallback list: an embedding model is a deliberate,
    dimension-pinned choice (the ``vector(1536)`` column matches ``text-embedding-3-small``), so a
    silent fail-over to a different-dimension model would corrupt the store. Any provider failure
    raises ``GatewayError``.
    """
    kwargs: dict = {"model": request.model, "input": request.input}
    if request.api_key is not None:
        kwargs["api_key"] = request.api_key

    started = time.perf_counter()
    try:
        response = litellm.embedding(**kwargs)
    except Exception as exc:  # noqa: BLE001 — surface any provider error as a GatewayError
        raise GatewayError(f"embedding failed for model {request.model!r}: {exc}") from exc
    latency_ms = (time.perf_counter() - started) * 1000.0

    vectors: list[list[float]] = []
    for item in getattr(response, "data", None) or []:
        raw = item["embedding"] if isinstance(item, dict) else getattr(item, "embedding", [])
        vectors.append([float(x) for x in raw])

    usage = getattr(response, "usage", None)
    prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    total_tokens = int(getattr(usage, "total_tokens", 0) or 0) or prompt_tokens

    return EmbeddingResult(
        vectors=vectors,
        model=request.model,
        prompt_tokens=prompt_tokens,
        total_tokens=total_tokens,
        cost_usd=_cost_of(response),
        raw_provider=_provider_of(request.model),
        latency_ms=latency_ms,
    )
