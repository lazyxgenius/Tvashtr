"""Milestone B — the BYOK rate-limit retry envelope lands on a real ``LLM``.

The routing-DICT assertions live in ``test_proxy_config.py`` (kept openhands-free — the routing
function is deliberately unit-testable without an agent). THIS file holds the one end-to-end wiring
test that constructs a real OpenHands ``LLM`` from the routing kwargs, proving the dict keys are
real, correctly-spelled ``LLM`` fields (not a vacuous smoke assert). It imports openhands at module
top — legitimately, like ``test_proxy_adapter_wiring`` — so the openhands-free purity file
(``test_registry``, which scrubs ``openhands.*`` from ``sys.modules`` before each check) is
unaffected.
"""

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
