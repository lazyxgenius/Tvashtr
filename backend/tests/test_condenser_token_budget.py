"""M-live: the condenser must fold on TOKENS, not only on event count.

M-ctx0 shipped `LLMSummarizingCondenser(llm=…, keep_first=2, max_size=80)` on all three adapters to
stop a long agent transcript from overrunning the model's context window. `max_size` counts EVENTS,
and the SDK gates its token-based path entirely on a separate field:

    if self.max_tokens and agent_llm:        # llm_summarizing_condenser.py:104
        if total_tokens > self.max_tokens:

`max_tokens` defaults to `None` and Tvashtr never set it, so token-based condensation was OFF and
80 events was the only trigger. That cannot protect a brownfield run: reading a handful of large
files off a 264-file monorepo breaches a 131,072-token window long before 80 events accumulate.

Measured on run `ee0e75d1` (M-live D6): the Engineer node died with
`litellm.BadRequestError: Nvidia_nimException -` — an empty body, which direct probing showed is
NIM's context-overflow refusal (`max_tokens must be at least 1, got -2119`, i.e. it derives
`window - prompt_tokens` and goes negative). The PM node, whose transcript is short, passed.

These tests pin the budget on all three adapters by reading the construction site, so the docker and
fly paths — whose condensers serialize into the in-container agent-server — cannot silently drift
back to event-count-only.
"""

import ast
from pathlib import Path

import pytest

from tvashtr.config import get_settings

_ENGINES = Path(__file__).resolve().parents[1] / "tvashtr" / "engines"
_ADAPTERS = (
    "openhands_adapter.py",
    "openhands_docker_adapter.py",
    "openhands_fly_adapter.py",
)


def _condenser_kwargs(filename: str) -> dict[str, ast.expr]:
    """The keywords of the single `LLMSummarizingCondenser(...)` call in `filename`."""
    tree = ast.parse((_ENGINES / filename).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "LLMSummarizingCondenser"
        ):
            return {kw.arg: kw.value for kw in node.keywords if kw.arg}
    raise AssertionError(f"no LLMSummarizingCondenser(...) call found in {filename}")


@pytest.mark.parametrize("filename", _ADAPTERS)
def test_every_adapter_gives_the_condenser_a_token_budget(filename):
    """Without `max_tokens` the SDK's token path is dead code and only 80 events can trigger."""
    kwargs = _condenser_kwargs(filename)
    assert "max_tokens" in kwargs, (
        f"{filename} builds the condenser without max_tokens, so token-based condensation is "
        "disabled and a large-repo run overruns the model's context window"
    )


@pytest.mark.parametrize("filename", _ADAPTERS)
def test_the_budget_comes_from_settings_not_a_literal(filename):
    """One env-tunable number, not three literals that can drift apart."""
    value = _condenser_kwargs(filename)["max_tokens"]
    src = ast.unparse(value)
    assert "agent_condenser_max_tokens" in src, src


@pytest.mark.parametrize("filename", _ADAPTERS)
def test_the_event_trigger_is_kept(filename):
    """The token budget ADDS a trigger; it must not replace the event-count one M-ctx0 tuned."""
    kwargs = _condenser_kwargs(filename)
    assert "max_size" in kwargs
    assert "keep_first" in kwargs


def test_the_default_budget_leaves_headroom_under_a_131k_window():
    """The window this actually has to survive is 131,072 (every reachable NIM model, and the
    retired llama-3.3-70b before them). The budget must sit below it with room for the reply."""
    settings = get_settings()
    budget = settings.agent_condenser_max_tokens
    assert budget > 0
    assert budget + settings.agent_max_output_tokens < 131_072, (
        f"budget {budget} + output {settings.agent_max_output_tokens} leaves no headroom under a "
        "131,072-token window — the condenser would fold only after the provider already refused"
    )
