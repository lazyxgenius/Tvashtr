"""Milestone B — the BYOK rate-limit retry envelope lands on a real ``LLM``.

The routing-DICT assertions live in ``test_proxy_config.py`` (kept openhands-free — the routing
function is deliberately unit-testable without an agent). THIS file holds the one end-to-end wiring
test that constructs a real OpenHands ``LLM`` from the routing kwargs, proving the dict keys are
real, correctly-spelled ``LLM`` fields (not a vacuous smoke assert). It imports openhands at module
top — legitimately, like ``test_proxy_adapter_wiring`` — so the openhands-free purity file
(``test_registry``, which scrubs ``openhands.*`` from ``sys.modules`` before each check) is
unaffected.
"""

import pytest
from openhands.sdk import LLM

from tvashtr.config import Settings, agent_llm_routing


def test_byok_retry_envelope_lands_on_a_constructed_llm(monkeypatch):
    # End-to-end: splat the BYOK routing dict into a REAL LLM exactly as both adapters do
    # (``LLM(**agent_llm_routing(...), temperature=0.0, usage_id=...)``) and confirm the widened
    # envelope (8 retries / a 120s cap) materializes as the very fields the SDK backs off on —
    # so a mis-spelled key (e.g. ``max_retries``) would be silently dropped and fail here.
    monkeypatch.delenv("TVASHTR_AGENT_NUM_RETRIES", raising=False)
    monkeypatch.delenv("TVASHTR_AGENT_RETRY_MAX_WAIT", raising=False)
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    routing = agent_llm_routing(
        s, "openrouter/openai/gpt-4o-mini", "docker", api_key_override="sk-test"
    )
    llm = LLM(**routing, temperature=0.0, usage_id="t")
    assert llm.num_retries == 8
    assert llm.retry_max_wait == 120


# ---- Tvashtr-79 item 7: what the envelope OWNS must never trigger a model failover ---------------
#
# The envelope above (8 retries / 120s cap) rides out 429s and transient timeouts INSIDE the agent
# loop. Item 7 adds a mid-run failover to the node's ``fallback_model`` for HARD provider failures —
# so the classifier's exclusion of everything this envelope already owns is the crux of the slice:
# swapping models on a 429 would burn the fallback's quota on a wall the primary was about to clear.


@pytest.mark.parametrize(
    "text",
    [
        # litellm 1.89.0 surface shapes for the cases the envelope retries.
        "litellm.RateLimitError: RateLimitError: OpenrouterException - Rate limit exceeded",
        "litellm.RateLimitError: OpenAIException - 429 Too Many Requests",
        "Error code: 429 - {'error': {'message': 'rate_limit_exceeded'}}",
        "litellm.APITimeoutError: APITimeoutError - Request timed out.",
        "litellm.Timeout: Connection timed out after 600.0 seconds",
        "litellm.InternalServerError: Overloaded",
        # The P1.4b proxy budget cutoff arrives wrapped as a RateLimitError and owns its OWN
        # terminal status (``over_budget``) — it must never be re-read as a provider failure.
        "litellm.RateLimitError: Litellm_proxyException - Budget has been exceeded! "
        "Current cost: 3.15e-06, Max budget: 1e-09",
    ],
)
def test_transient_failures_are_not_provider_failures(text):
    """THE CRUX EXCLUSION: a 429 / rate-limit / timeout / overload stays a plain ``failed`` and is
    NEVER failed over. RED before item 7 (the classifier did not exist)."""
    from tvashtr.engines.openhands_adapter import _is_provider_error, _text_has_provider_signature

    assert _text_has_provider_signature(text) is False, text
    assert _is_provider_error(RuntimeError(text)) is False, text


def test_a_rate_limit_exception_type_is_not_a_provider_failure():
    """The TYPE surface excludes too — a litellm ``RateLimitError`` whose message says nothing is
    still the envelope's business, not the fallback's."""
    from tvashtr.engines.openhands_adapter import _is_provider_error

    rate_limited = type("RateLimitError", (Exception,), {})
    assert _is_provider_error(rate_limited("")) is False


def test_a_rate_limit_nested_under_a_provider_word_is_still_excluded():
    """Precedence: the transient check WINS. A retryable 429 whose text also happens to carry a
    provider word must not be promoted to a hard failure."""
    from tvashtr.engines.openhands_adapter import _text_has_provider_signature

    assert (
        _text_has_provider_signature(
            "litellm.RateLimitError: AuthenticationError-shaped text but 429 rate limit"
        )
        is False
    )
