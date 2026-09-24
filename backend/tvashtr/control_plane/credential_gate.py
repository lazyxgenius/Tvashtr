"""M-subs-desktop — the ONE launch credential rule, pure and shared.

The FE Run gate (``frontend/src/lib/engines.ts::missingProvidersForModels``) and the server launch
pre-flight implement the SAME rule and are tested against the SAME cases
(``frontend/src/lib/credentialGate.cases.json``), so the Run button and ``POST /api/runs`` can never
disagree:

* a node's provider is covered by a BYOK key held for it, on any launch;
* on a DESKTOP launch only, it is also covered by a FRESH connected subscription — the mirror says
  connected AND the owner's Desktop runner polled recently — for an engine the Desktop can run
  (``claude``, ``grok``). A Codex subscription cannot run nodes yet, and a hosted launch never
  counts a subscription (the Fly/OpenHands path cannot use one, by design).

Covered-by-subscription nodes are ROUTED to the owner's Desktop even when a key is also held
(prefer-subscription on Desktop). Pure: no DB, no I/O.
"""

from collections.abc import Iterable

from tvashtr.control_plane.credentials import provider_for_model

# Model-slug provider → subscription engine (the same mapping the mirror/preflight copy uses).
MODEL_PROVIDER_TO_SUB: dict[str, str] = {
    "anthropic": "claude",
    "xai": "grok",
    "grok": "grok",
    "openai": "codex",
}

# The subscription engines Tvashtr Desktop's runner can actually execute a node with.
RUNNER_SUBSCRIPTIONS: tuple[str, ...] = ("claude", "grok")


def subscription_for_model(model: str) -> str | None:
    """The subscription engine a model's provider maps to (``None`` when there is none)."""
    return MODEL_PROVIDER_TO_SUB.get(provider_for_model(model))


def _runner_sub(model: str, fresh_subscriptions: set[str], desktop_target: bool) -> str | None:
    if not desktop_target:
        return None
    sub = subscription_for_model(model)
    if sub in RUNNER_SUBSCRIPTIONS and sub in fresh_subscriptions:
        return sub
    return None


def missing_providers_for_launch(
    models: Iterable[str | None],
    *,
    byok: set[str],
    fresh_subscriptions: set[str],
    desktop_target: bool,
) -> list[str]:
    """Sorted distinct providers the launch has NO credential for (empty ⇒ it may launch)."""
    missing: set[str] = set()
    for raw in models:
        model = (raw or "").strip()
        if not model:
            continue
        provider = provider_for_model(model)
        if not provider or provider in byok:
            continue
        if _runner_sub(model, fresh_subscriptions, desktop_target):
            continue
        missing.add(provider)
    return sorted(missing)


def desktop_routed_subscriptions(
    models: Iterable[str | None], *, fresh_subscriptions: set[str], desktop_target: bool
) -> list[str]:
    """Sorted subscription engines whose nodes this launch runs on the owner's Desktop."""
    routed = {
        sub
        for raw in models
        if (raw or "").strip()
        for sub in [_runner_sub((raw or "").strip(), fresh_subscriptions, desktop_target)]
        if sub
    }
    return sorted(routed)
