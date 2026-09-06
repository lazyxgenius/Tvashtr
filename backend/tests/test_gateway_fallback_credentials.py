"""M-proof F2 — a fallback candidate is never tried with another provider's credential.

``complete()`` built its candidate list as ``[(model, request.api_key) for model in ...]``, so
every STATIC ``settings.model_fallbacks`` entry inherited the PRIMARY provider's key. Under BYOK
(M-accounts Slice B: the executor always sets ``api_key``) a NIM-primary node whose provider fails
hard therefore sends the NVIDIA key to OpenRouter, collects a 401, and that 401 REPLACES the real
error the operator needs to see. The registered §15 wording: "gateway.py static fallbacks still
reuse the primary's api_key ... structurally broken for cross-provider failover in BYOK mode".

The invariant these tests pin:

    A model candidate is NEVER tried with a credential belonging to a different provider. A
    candidate for which no owner credential can be resolved is SKIPPED, and the original primary
    error propagates unchanged.

Note what is NOT broken, and is pinned here so a future "fix" cannot quietly regress it: when
``api_key is None`` (the non-owner-scoped / self-hosted caller) litellm resolves EACH candidate's
own provider key from the environment, so that path already honours the invariant and must stay
byte-identical. And a static candidate on the SAME provider as the primary is legitimately covered
by the key in hand, so it is still tried.

Offline: the litellm boundary is monkeypatched, exactly like ``test_gateway.py``.
"""

from types import SimpleNamespace

import pytest

from tvashtr.gateway import CompletionRequest, GatewayError, complete
from tvashtr.gateway import gateway as gw

# The SHIPPED default (backend/tvashtr/config.py) — an OpenRouter -> OpenRouter -> OpenAI chain.
# Deliberately the real value: the defect is only interesting against what production actually runs.
_SHIPPED_FALLBACKS = ["openrouter/google/gemini-flash-1.5", "gpt-4o-mini"]
_NIM = "nvidia_nim/meta/llama-3.3-70b-instruct"
_NIM_KEY = "nvapi-PRIMARY-KEY-SENTINEL"
_HARD_FAILURE = "nvidia_nim provider is unreachable (connection refused)"
_MSGS = [{"role": "user", "content": "hi"}]


def _canned(content: str, model: str) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=3, completion_tokens=4, total_tokens=7),
        model=model,
    )


@pytest.fixture
def calls(monkeypatch):
    """Record every ``(model, api_key)`` handed to litellm; the primary always fails HARD."""
    seen: list[tuple[str, str | None]] = []

    def fake_completion(**kwargs):
        seen.append((kwargs["model"], kwargs.get("api_key")))
        if kwargs["model"] == _NIM:
            # A HARD failure: no status_code, no "429"/"rate limit" text, so `_is_rate_limit` is
            # False and the failover path (not the retry envelope) is what runs.
            raise RuntimeError(_HARD_FAILURE)
        return _canned("served", kwargs["model"])

    monkeypatch.setattr(gw.litellm, "completion", fake_completion)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    monkeypatch.setattr(
        gw,
        "get_settings",
        lambda: SimpleNamespace(
            model_fallbacks=list(_SHIPPED_FALLBACKS), default_max_tokens_per_call=None
        ),
    )
    return seen


def test_owner_scoped_static_fallback_is_never_tried_with_the_primarys_key(calls):
    """The defect, stated as behaviour: a BYOK NIM primary must not leak its key to OpenRouter."""
    with pytest.raises(GatewayError):
        complete(
            CompletionRequest(
                model=_NIM,
                messages=_MSGS,
                api_key=_NIM_KEY,
            )
        )

    # Assert on the CREDENTIAL each call carried, not merely on the call count: a test that only
    # counted calls would pass for the wrong reason the moment the list length changed.
    leaked = [(m, k) for m, k in calls if k == _NIM_KEY and not m.startswith("nvidia_nim/")]
    assert leaked == [], (
        f"the primary's NVIDIA key was handed to a foreign provider: {leaked} "
        f"(full call log: {calls})"
    )
    assert calls == [(_NIM, _NIM_KEY)], f"only the primary should have been attempted: {calls}"


def test_the_primarys_own_error_propagates_when_static_fallbacks_are_skipped(calls):
    """Skipping an uncredentialed candidate must surface the REAL failure, not a masking 401."""
    with pytest.raises(GatewayError) as excinfo:
        complete(
            CompletionRequest(
                model=_NIM,
                messages=_MSGS,
                api_key=_NIM_KEY,
            )
        )
    assert _HARD_FAILURE in str(excinfo.value), (
        "the operator must see the primary provider's own error, not one produced by a fallback "
        f"that was tried with the wrong credential: {excinfo.value}"
    )


def test_a_same_provider_static_fallback_still_runs_on_the_shared_key(calls, monkeypatch):
    """The key in hand genuinely IS that candidate's credential, so the fallback still applies."""
    monkeypatch.setattr(
        gw,
        "get_settings",
        lambda: SimpleNamespace(
            model_fallbacks=["nvidia_nim/meta/llama-3.1-8b-instruct"],
            default_max_tokens_per_call=None,
        ),
    )
    result = complete(CompletionRequest(model=_NIM, messages=_MSGS, api_key=_NIM_KEY))
    assert result.model_used == "nvidia_nim/meta/llama-3.1-8b-instruct"
    assert calls == [
        (_NIM, _NIM_KEY),
        ("nvidia_nim/meta/llama-3.1-8b-instruct", _NIM_KEY),
    ], f"a same-provider fallback must still be tried on the shared key: {calls}"


def test_non_owner_scoped_request_still_walks_every_static_fallback(calls):
    """``api_key is None`` ⇒ litellm resolves each provider's OWN env key from the environment,
    so this path already honours the invariant. It must stay byte-identical."""
    request = CompletionRequest(model=_NIM, messages=_MSGS)
    result = complete(request)
    assert result.model_used == "openrouter/google/gemini-flash-1.5"
    assert calls == [
        (_NIM, None),
        ("openrouter/google/gemini-flash-1.5", None),
    ], f"the self-hosted caller's fallback walk must not change: {calls}"


def test_authored_per_node_fallback_still_splices_with_its_own_key(calls):
    """The per-node path (``team_run._resolve_model_and_key``) is already correct — keep it so."""
    result = complete(
        CompletionRequest(
            model=_NIM,
            messages=_MSGS,
            api_key=_NIM_KEY,
            fallback_model="openai/gpt-4o-mini",
            fallback_api_key="sk-OPENAI-OWNER-KEY",
        )
    )
    assert result.model_used == "openai/gpt-4o-mini"
    assert calls == [
        (_NIM, _NIM_KEY),
        ("openai/gpt-4o-mini", "sk-OPENAI-OWNER-KEY"),
    ], f"the authored per-node fallback must carry ITS OWN owner key: {calls}"
