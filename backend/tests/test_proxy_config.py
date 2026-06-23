"""P1.4a: the LiteLLM-proxy settings + the mode-aware agent-LLM routing.

All pure config — NO openhands import — so it stays in the offline suite and the
import-boundary purity (test_registry) is unaffected. Settings are constructed with
``_env_file=None`` so a real local .env can't perturb the assertions.
"""

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


def test_routing_off_is_the_exact_direct_path(monkeypatch):
    # Proxy OFF: the bare slug + OPENROUTER_API_KEY and NO base_url — byte-for-byte the
    # prior construction. The `litellm_proxy/` transform is NOT applied (mode irrelevant).
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = agent_llm_routing(s, "openrouter/openai/gpt-4o-mini", "docker")
    assert kwargs == {"model": "openrouter/openai/gpt-4o-mini", "api_key": "sk-or-test"}
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


def test_routing_off_ignores_api_key_override(monkeypatch):
    # Proxy OFF: byte-for-byte the direct path regardless of any override passed.
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = agent_llm_routing(s, "openrouter/x", "docker", api_key_override="sk-run-vkey")
    assert kwargs == {"model": "openrouter/x", "api_key": "sk-or-test"}
    assert "base_url" not in kwargs


# --- Step 0 (P1.5c): provider-agnostic direct-path api_key (D9) ---


def test_routing_off_gemini_uses_gemini_key(monkeypatch):
    # Proxy OFF + a ``gemini/`` slug -> the api_key comes from GEMINI_API_KEY (Google AI
    # Studio), not OPENROUTER_API_KEY. The slug passes through untransformed and there is no
    # base_url (litellm's gemini/ provider auths via ?key=).
    monkeypatch.setenv("GEMINI_API_KEY", "AQ.gemini-test")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = agent_llm_routing(s, "gemini/gemini-2.0-flash", "docker")
    assert kwargs == {"model": "gemini/gemini-2.0-flash", "api_key": "AQ.gemini-test"}
    assert "base_url" not in kwargs


def test_routing_off_non_gemini_still_uses_openrouter_key(monkeypatch):
    # The fallback is unchanged: any non-gemini slug keeps resolving OPENROUTER_API_KEY even
    # when a GEMINI_API_KEY is present — the existing OpenRouter path is byte-for-byte intact.
    monkeypatch.setenv("GEMINI_API_KEY", "AQ.gemini-test")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = agent_llm_routing(s, "openrouter/openai/gpt-4o-mini", "local")
    assert kwargs == {"model": "openrouter/openai/gpt-4o-mini", "api_key": "sk-or-test"}


def test_routing_on_gemini_ignores_provider_key_and_uses_proxy(monkeypatch):
    # Proxy ON wins over provider resolution: even a gemini/ slug routes through the proxy
    # (litellm_proxy/ transform + the proxy creds), so the direct per-provider key is NOT used.
    monkeypatch.setenv("GEMINI_API_KEY", "AQ.gemini-test")
    s = Settings(_env_file=None, litellm_proxy_enabled=True, litellm_master_key="sk-master")
    kwargs = agent_llm_routing(s, "gemini/gemini-2.0-flash", "local")
    assert kwargs["model"] == "litellm_proxy/gemini/gemini-2.0-flash"
    assert kwargs["api_key"] == "sk-master"
    assert kwargs["base_url"] == "http://127.0.0.1:4000"


def test_routing_off_groq_uses_groq_cloud_key(monkeypatch):
    # Proxy OFF + a ``groq/`` slug -> the api_key comes from GROQ_CLOUD_API_KEY (this repo's
    # .env name), not OPENROUTER_API_KEY. Slug passes through untransformed; no base_url.
    monkeypatch.setenv("GROQ_CLOUD_API_KEY", "gsk_test")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    s = Settings(_env_file=None, litellm_proxy_enabled=False)
    kwargs = agent_llm_routing(s, "groq/llama-3.3-70b-versatile", "docker")
    assert kwargs == {"model": "groq/llama-3.3-70b-versatile", "api_key": "gsk_test"}
    assert "base_url" not in kwargs


def test_direct_agent_api_key_is_a_pure_function_of_the_slug(monkeypatch):
    # The resolver is a pure slug->key function (no settings needed), so both adapters share it.
    from tvashtr.config import _direct_agent_api_key

    monkeypatch.setenv("GEMINI_API_KEY", "AQ.g")
    monkeypatch.setenv("GROQ_CLOUD_API_KEY", "gsk_g")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or")
    assert _direct_agent_api_key("gemini/gemini-2.0-flash") == "AQ.g"
    assert _direct_agent_api_key("gemini/anything") == "AQ.g"
    assert _direct_agent_api_key("groq/llama-3.3-70b-versatile") == "gsk_g"
    assert _direct_agent_api_key("openrouter/x") == "sk-or"
    assert _direct_agent_api_key("gpt-4o-mini") == "sk-or"
    # GROQ_API_KEY is the standard-name fallback when GROQ_CLOUD_API_KEY is absent.
    monkeypatch.delenv("GROQ_CLOUD_API_KEY", raising=False)
    monkeypatch.setenv("GROQ_API_KEY", "gsk_std")
    assert _direct_agent_api_key("groq/x") == "gsk_std"


def test_litellm_master_key_from_env(monkeypatch):
    monkeypatch.setenv("LITELLM_MASTER_KEY", "sk-from-env")
    s = Settings(_env_file=None)
    assert s.litellm_master_key == "sk-from-env"


def test_litellm_proxy_enabled_from_env(monkeypatch):
    monkeypatch.setenv("LITELLM_PROXY_ENABLED", "1")
    s = Settings(_env_file=None)
    assert s.litellm_proxy_enabled is True
