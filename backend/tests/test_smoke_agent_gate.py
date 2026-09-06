"""M-live: ``make agent-smoke`` must gate on the key the CHOSEN agent model actually needs.

The pre-image asked one hardcoded question — ``if not os.environ.get("OPENROUTER_API_KEY")`` —
and then skipped with exit 0. M-accounts Slice B removed provider keys from ``.env`` entirely
(they live encrypted in ``provider_credentials``) and the operator's ``.env`` no longer carries an
OpenRouter key at all, so the one permanent harness CLI-RULES §4.6 names as the pre-flight for any
live agent run ("Test with ``make agent-smoke`` before any live agent run") had become a silent
no-op: it reported success while proving nothing. A skip that cannot be distinguished from a pass
is worse than a failure, which is why this is fixed at the root rather than worked around.

``scripts/smoke_agent.py`` is a CLI script, not a package module, so it is loaded BY FILE PATH from
here — the established pattern (``test_model_bench.py``, and the §15 item Tvashtr-68 resolved by
moving such a test into ``backend/tests/`` so ``make test`` actually runs it).
"""

import importlib.util
from pathlib import Path

import pytest

_SMOKE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "smoke_agent.py"


def _load():
    spec = importlib.util.spec_from_file_location("smoke_agent_under_test", _SMOKE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    ("model", "environ", "expected"),
    [
        # The M-live case: a NIM agent model + the NIM key present, NO OpenRouter key anywhere.
        ("nvidia_nim/mistralai/mistral-nemotron", {"NVIDIA_BUILD_API_KEY": "nv-key"}, "nv-key"),
        # The documented alternate env name for the same provider.
        ("nvidia_nim/meta/llama-3.3-70b-instruct", {"NVIDIA_NIM_API_KEY": "nv-alt"}, "nv-alt"),
        # Every other catalogued provider resolves through its own name, not OpenRouter's.
        ("deepseek/deepseek-chat", {"DEEPSEEK_API_KEY": "ds-key"}, "ds-key"),
        ("gemini/gemini-2.0-flash", {"GEMINI_API_KEY": "gm-key"}, "gm-key"),
        ("groq/llama-3.3-70b-versatile", {"GROQ_CLOUD_API_KEY": "gq-key"}, "gq-key"),
        ("openai/gpt-4o-mini", {"OPENAI_API_KEY": "oa-key"}, "oa-key"),
        ("openrouter/openai/gpt-4o-mini", {"OPENROUTER_API_KEY": "or-key"}, "or-key"),
    ],
)
def test_the_gate_resolves_the_key_the_chosen_model_needs(model, environ, expected):
    """A NIM agent model is gated by the NIM key — never by an unrelated provider's."""
    assert _load().resolve_agent_key(model, environ) == expected


def test_an_unrelated_providers_key_does_not_unlock_a_nim_run():
    """The converse of the bug: holding ONLY an OpenRouter key must NOT let a NIM model through.

    The pre-image would have run the agent here and failed deep inside OpenHands with an auth
    error, because ``agent_llm_routing``'s proxy-OFF path refuses a ``None`` api_key outright.
    """
    assert (
        _load().resolve_agent_key(
            "nvidia_nim/mistralai/mistral-nemotron", {"OPENROUTER_API_KEY": "or-key"}
        )
        is None
    )


def test_an_empty_or_whitespace_value_counts_as_absent():
    """A blank ``FOO=`` line in ``.env`` is not a credential — it must still skip, not half-run."""
    module = _load()
    assert module.resolve_agent_key("deepseek/deepseek-chat", {"DEEPSEEK_API_KEY": ""}) is None
    assert module.resolve_agent_key("deepseek/deepseek-chat", {"DEEPSEEK_API_KEY": "   "}) is None


def test_an_uncatalogued_provider_skips_rather_than_guessing():
    """No silent fallback to somebody else's key for a provider we have no env mapping for."""
    assert _load().resolve_agent_key("acme/whatever", {"OPENROUTER_API_KEY": "or-key"}) is None
