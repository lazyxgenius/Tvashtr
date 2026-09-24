"""M-subs-desktop — the ONE launch credential rule (server side of the shared contract).

The cases live in ``frontend/src/lib/credentialGate.cases.json`` and are ALSO asserted by the FE
Run gate's vitest suite, so the Run button and the server preflight can never disagree.
"""

import json
from pathlib import Path

import pytest

from tvashtr.control_plane.credential_gate import (
    RUNNER_SUBSCRIPTIONS,
    desktop_routed_subscriptions,
    missing_providers_for_launch,
    subscription_for_model,
)

_CASES = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "lib"
        / "credentialGate.cases.json"
    ).read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_shared_credential_rule(case):
    assert (
        missing_providers_for_launch(
            case["models"],
            byok=set(case["byok"]),
            fresh_subscriptions=set(case["fresh"]),
            desktop_target=case["target"] == "local",
        )
        == case["missing"]
    )


def test_runner_subscriptions_are_claude_and_grok_only():
    assert RUNNER_SUBSCRIPTIONS == ("claude", "grok")
    assert subscription_for_model("anthropic/claude-sonnet-5") == "claude"
    assert subscription_for_model("xai/grok-4.7") == "grok"
    assert subscription_for_model("grok/grok-4.7") == "grok"
    assert subscription_for_model("openai/gpt-4.1") == "codex"
    assert subscription_for_model("deepseek/deepseek-chat") is None


def test_desktop_routing_prefers_the_subscription_even_when_a_key_is_held():
    models = ["anthropic/claude-sonnet-5", "xai/grok-4.7", "deepseek/deepseek-chat"]
    assert desktop_routed_subscriptions(
        models, fresh_subscriptions={"claude", "grok"}, desktop_target=True
    ) == [
        "claude",
        "grok",
    ]
    # Hosted: nothing ever routes to a Desktop.
    assert (
        desktop_routed_subscriptions(models, fresh_subscriptions={"claude"}, desktop_target=False)
        == []
    )
    # A stale subscription routes nothing (the node keeps its BYOK path if a key exists).
    assert (
        desktop_routed_subscriptions(models, fresh_subscriptions=set(), desktop_target=True) == []
    )
    # Codex never routes (no runner yet).
    assert (
        desktop_routed_subscriptions(
            ["openai/gpt-4.1"], fresh_subscriptions={"codex"}, desktop_target=True
        )
        == []
    )
