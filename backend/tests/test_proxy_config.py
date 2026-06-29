"""P1.4a: the LiteLLM-proxy settings + the mode-aware agent-LLM routing.

All pure config — NO openhands import — so it stays in the offline suite and the
import-boundary purity (test_registry) is unaffected. Settings are constructed with
``_env_file=None`` so a real local .env can't perturb the assertions.
"""

import pytest

from tvashtr.config import Settings, agent_llm_routing


def test_proxy_disabled_by_default(monkeypatch):
    # OPT-IN: off unless explicitly enabled, so offline/no-key behavior is unchanged.
    # Clear BOTH proxy env vars: `make test` exports the operator's .env (which may enable the
    # proxy + set a master key for live runs), so this default-assertion must isolate from it.
    monkeypatch.delenv("LITELLM_PROXY_ENABLED", raising=False)
    monkeypatch.delenv("LITELLM_MASTER_KEY", raising=False)
    s = Settings(_env_file=None)
    assert s.litellm_proxy_enabled is False
    assert s.litellm_proxy_port == 4000
    assert s.litellm_proxy_host_local == "127.0.0.1"
    assert s.litellm_proxy_host_docker == "host.docker.internal"
    assert s.litellm_master_key is None


def test_agent_llm_base_url_is_mode_aware():
    s = Settings(_env_file=None)
    # local -> the host loopback (agent runs in-process on the host).
    assert s.agent_llm_base_url("local") == "http://127.0.0.1:4000"
    # docker -> host.docker.internal (the agent-server container is on Docker's default
    # bridge, not the compose network, so it reaches the host-published proxy port here).
    assert s.agent_llm_base_url("docker") == "http://host.docker.internal:4000"


def test_base_url_honors_port_and_host_overrides():
    s = Settings(
        _env_file=None,
        litellm_proxy_port=4100,
        litellm_proxy_host_docker="172.17.0.1",
        litellm_proxy_host_local="0.0.0.0",
    )
    assert s.agent_llm_base_url("docker") == "http://172.17.0.1:4100"
    assert s.agent_llm_base_url("local") == "http://0.0.0.0:4100"


def test_routing_off_uses_the_threaded_owner_key(monkeypatch):
    # Proxy OFF (BYOK direct path, M-accounts Slice B): the bare slug + the per-owner key the
    # executor threaded as api_key_override, and NO base_url. The `litellm_proxy/` transform is NOT
    # applied (mode irrelevant). An .env OPENROUTER_API_KEY is IGNORED — there is no .env fallback.
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-env-should-not-be-used")
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = agent_llm_routing(
        s, "openrouter/openai/gpt-4o-mini", "docker", api_key_override="byok"
    )
    # Milestone B: the BYOK dict now also carries the widened rate-limit retry envelope (8 / 120).
    assert kwargs == {
        "model": "openrouter/openai/gpt-4o-mini",
        "api_key": "byok",
        "num_retries": 8,
        "retry_max_wait": 120,
    }
    assert "base_url" not in kwargs


def test_routing_on_local_targets_the_proxy(monkeypatch):
    # Proxy ON: the `litellm_proxy/` slug transform + master key + the local proxy URL.
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    s = Settings(_env_file=None, litellm_proxy_enabled=True, litellm_master_key="sk-master")
    kwargs = agent_llm_routing(s, "openrouter/meta-llama/llama-3.1-8b-instruct", "local")
    assert kwargs == {
        "model": "litellm_proxy/openrouter/meta-llama/llama-3.1-8b-instruct",
        "api_key": "sk-master",
        "base_url": "http://127.0.0.1:4000",
    }


def test_routing_on_docker_uses_host_docker_internal():
    # The slug transform is identical; only the base_url host differs by mode.
    s = Settings(_env_file=None, litellm_proxy_enabled=True, litellm_master_key="sk-master")
    kwargs = agent_llm_routing(s, "openrouter/x", "docker")
    assert kwargs["model"] == "litellm_proxy/openrouter/x"
    assert kwargs["api_key"] == "sk-master"
    assert kwargs["base_url"] == "http://host.docker.internal:4000"


# --- P1.4b: per-run virtual key threaded via api_key_override ---


def test_routing_on_uses_api_key_override_as_the_agent_key():
    # Proxy ON + a per-run virtual key -> the OVERRIDE is the agent's api_key (not the master
    # key); the master key stays the admin/mint credential. base_url + slug unchanged.
    s = Settings(_env_file=None, litellm_proxy_enabled=True, litellm_master_key="sk-master")
    kwargs = agent_llm_routing(s, "openrouter/x", "docker", api_key_override="sk-run-vkey")
    assert kwargs == {
        "model": "litellm_proxy/openrouter/x",
        "api_key": "sk-run-vkey",
        "base_url": "http://host.docker.internal:4000",
    }


def test_routing_on_without_override_falls_back_to_master_key():
    # No per-run key minted -> the master key authenticates (a proxy-ON run still works).
    s = Settings(_env_file=None, litellm_proxy_enabled=True, litellm_master_key="sk-master")
    kwargs = agent_llm_routing(s, "openrouter/x", "local", api_key_override=None)
    assert kwargs["api_key"] == "sk-master"


def test_routing_off_without_override_raises(monkeypatch):
    # Proxy OFF + NO per-owner key threaded: refuse rather than fall back to .env (a keyless run
    # must not leak the operator's key/spend). The pre-flight makes this unreachable on a real run.
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-env-should-not-be-used")
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    with pytest.raises(ValueError, match="per-owner api_key"):
        agent_llm_routing(s, "openrouter/x", "docker", api_key_override=None)


# --- M-accounts Slice B: proxy-OFF is the BYOK direct path (the .env per-provider lookup is gone) -


def test_routing_off_uses_override_for_any_provider_slug(monkeypatch):
    # The provider slug no longer selects an .env var (the pre-Slice-B per-provider lookup is GONE):
    # proxy OFF returns the threaded per-owner key verbatim for ANY slug. The owner's stored
    # provider_credentials are what differ per provider now, resolved upstream by the executor.
    monkeypatch.setenv("GEMINI_API_KEY", "AQ.env-ignored")
    monkeypatch.setenv("NVIDIA_BUILD_API_KEY", "nvapi-env-ignored")
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    for slug in ("gemini/gemini-2.0-flash", "nvidia_nim/meta/llama-3.3-70b-instruct", "groq/x"):
        kwargs = agent_llm_routing(s, slug, "local", api_key_override="owner-key")
        # Milestone B: + the widened retry envelope (8 / 120) on the BYOK path, for ANY slug.
        assert kwargs == {
            "model": slug,
            "api_key": "owner-key",
            "num_retries": 8,
            "retry_max_wait": 120,
        }
        assert "base_url" not in kwargs


def test_routing_on_gemini_ignores_provider_key_and_uses_proxy(monkeypatch):
    # Proxy ON wins over provider resolution: even a gemini/ slug routes through the proxy
    # (litellm_proxy/ transform + the proxy creds), so the direct per-provider key is NOT used.
    monkeypatch.setenv("GEMINI_API_KEY", "AQ.gemini-test")
    s = Settings(_env_file=None, litellm_proxy_enabled=True, litellm_master_key="sk-master")
    kwargs = agent_llm_routing(s, "gemini/gemini-2.0-flash", "local")
    assert kwargs["model"] == "litellm_proxy/gemini/gemini-2.0-flash"
    assert kwargs["api_key"] == "sk-master"
    assert kwargs["base_url"] == "http://127.0.0.1:4000"


def test_litellm_master_key_from_env(monkeypatch):
    monkeypatch.setenv("LITELLM_MASTER_KEY", "sk-from-env")
    s = Settings(_env_file=None)
    assert s.litellm_master_key == "sk-from-env"


def test_litellm_proxy_enabled_from_env(monkeypatch):
    monkeypatch.setenv("LITELLM_PROXY_ENABLED", "1")
    s = Settings(_env_file=None)
    assert s.litellm_proxy_enabled is True


# --- Milestone B: the BYOK agent-loop rate-limit retry envelope (proxy-OFF path ONLY) ---


def test_byok_branch_carries_the_retry_envelope_both_modes(monkeypatch):
    # The BYOK (proxy-OFF) branch carries the widened rate-limit retry envelope so a throttled
    # low-tier key rides out a busy window instead of crashing the loop. Resolved defaults: 8 / 120.
    # Clear the env dials (`make test` exports the operator's .env) to isolate the defaults.
    monkeypatch.delenv("TVASHTR_AGENT_NUM_RETRIES", raising=False)
    monkeypatch.delenv("TVASHTR_AGENT_RETRY_MAX_WAIT", raising=False)
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    for mode in ("local", "docker"):
        kwargs = agent_llm_routing(s, "nvidia_nim/x", mode, api_key_override="byok")
        # the EXACT new BYOK shape (local AND docker): bare slug + threaded key + the widened
        # envelope (8 / 120), no base_url — the authoritative dict-shape guard for the path.
        assert kwargs == {
            "model": "nvidia_nim/x",
            "api_key": "byok",
            "num_retries": 8,
            "retry_max_wait": 120,
        }


def test_proxy_on_branch_omits_the_retry_envelope():
    # The proxy-ON path deliberately OMITS the envelope: its only 429 is the budget cutoff, and
    # lengthening that retry would worsen the registered proxy budget-latency deferral.
    s = Settings(_env_file=None, litellm_proxy_enabled=True, litellm_master_key="sk-master")
    kwargs = agent_llm_routing(s, "openrouter/x", "docker", api_key_override="sk-run-vkey")
    assert "num_retries" not in kwargs
    assert "retry_max_wait" not in kwargs
    # the proxy shape is byte-unchanged (the budget-latency guard).
    assert kwargs == {
        "model": "litellm_proxy/openrouter/x",
        "api_key": "sk-run-vkey",
        "base_url": "http://host.docker.internal:4000",
    }


def test_env_overrides_retune_the_retry_envelope(monkeypatch):
    # The envelope is env-dialable (re-tune with no code change): a fresh Settings() reads the env
    # vars and the routing dict reflects the OVERRIDDEN numbers. monkeypatch resets the env after.
    monkeypatch.setenv("TVASHTR_AGENT_NUM_RETRIES", "3")
    monkeypatch.setenv("TVASHTR_AGENT_RETRY_MAX_WAIT", "45")
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = agent_llm_routing(s, "nvidia_nim/x", "local", api_key_override="byok")
    assert kwargs["num_retries"] == 3
    assert kwargs["retry_max_wait"] == 45
