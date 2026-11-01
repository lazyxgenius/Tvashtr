"""Google Cloud 1: ``vertex_ai/<id>`` slugs reach Gemini on Vertex AI with a Google Cloud API key.

LiteLLM's own ``vertex_ai/`` route only logs in with a service account, so a ``vertex_ai/`` slug must
never reach it. The one translation (``tvashtr.google_cloud``) turns the slug into LiteLLM's
``gemini/`` route plus an ``api_base`` on the Vertex address; these tests pin it at the gateway, at
``agent_llm_routing`` and at the SDK ``LLM`` every adapter builds. No network.
"""

import ast
import inspect
from pathlib import Path
from types import SimpleNamespace

import pytest
from litellm import ModelResponse
from openhands.sdk.llm import LLM, Message, TextContent

import tvashtr
import tvashtr.gateway.gateway as gw
from tvashtr import google_cloud
from tvashtr.config import Settings, agent_llm_routing
from tvashtr.gateway.types import CompletionRequest, GatewayError

BASE = "https://aiplatform.googleapis.com/v1/publishers/google"
KEY = "test-google-cloud-key"
SLUG = "vertex_ai/gemini-3-flash-preview"


def _settings(**over) -> Settings:
    return Settings(_env_file=None, **over)


def _fake_response() -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
    )


def _capture_completion(monkeypatch) -> list[dict]:
    seen: list[dict] = []

    def fake(**kwargs):
        seen.append(kwargs)
        return _fake_response()

    monkeypatch.setattr(gw.litellm, "completion", fake)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    return seen


# ---- the pure translation ----


def test_translation_returns_the_three_settings():
    assert google_cloud.call_settings(SLUG, KEY) == {
        "model": "gemini/gemini-3-flash-preview",
        "api_base": BASE,
        "api_key": KEY,
    }


@pytest.mark.parametrize(
    "slug",
    ["gemini/gemini-2.5-flash", "openai/gpt-4.1-mini", "gemini-2.5-flash", "vertex_ai_beta/x", ""],
)
def test_every_other_slug_is_untouched(slug):
    assert google_cloud.call_settings(slug, KEY) is None


@pytest.mark.parametrize("slug", ["vertex_ai/", "vertex_ai/   "])
def test_an_empty_model_id_is_refused(slug):
    with pytest.raises(ValueError, match="model id"):
        google_cloud.call_settings(slug, KEY)


@pytest.mark.parametrize("key", [None, ""])
def test_a_missing_key_is_refused_not_left_to_litellms_env_lookup(key):
    # LiteLLM's gemini route would read GEMINI_API_KEY: an AI Studio key must never go to Vertex.
    with pytest.raises(ValueError, match="Google Cloud API key"):
        google_cloud.call_settings(SLUG, key)


def test_the_module_imports_neither_litellm_nor_openhands_nor_tvashtr():
    tree = ast.parse(Path(inspect.getfile(google_cloud)).read_text())
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            roots.add((node.module or "").split(".")[0])
    assert not roots & {"litellm", "openhands", "tvashtr"}


# ---- the gateway ----


def test_complete_sends_the_translated_kwargs_and_reports_the_tvashtr_slug(monkeypatch):
    seen = _capture_completion(monkeypatch)
    result = gw.complete(
        CompletionRequest(
            model=SLUG,
            messages=[{"role": "user", "content": "hi"}],
            temperature=0.1,
            max_tokens=64,
            api_key=KEY,
        )
    )
    assert len(seen) == 1
    sent = {k: v for k, v in seen[0].items() if k != "timeout"}
    assert sent == {
        "model": "gemini/gemini-3-flash-preview",
        "api_base": BASE,
        "api_key": KEY,
        "messages": [{"role": "user", "content": "hi"}],
        "temperature": 0.1,
        "max_tokens": 64,
    }
    assert result.model_used == SLUG
    assert result.model_requested == SLUG
    assert result.raw_provider == "vertex_ai"


def test_a_gemini_slug_gets_the_same_kwargs_as_before(monkeypatch):
    seen = _capture_completion(monkeypatch)
    result = gw.complete(
        CompletionRequest(
            model="gemini/gemini-2.5-flash",
            messages=[{"role": "user", "content": "hi"}],
            temperature=0.1,
            max_tokens=64,
            api_key=KEY,
        )
    )
    sent = {k: v for k, v in seen[0].items() if k != "timeout"}
    assert sent == {
        "model": "gemini/gemini-2.5-flash",
        "api_key": KEY,
        "messages": [{"role": "user", "content": "hi"}],
        "temperature": 0.1,
        "max_tokens": 64,
    }
    assert result.model_used == "gemini/gemini-2.5-flash"


def test_a_vertex_slug_with_no_key_fails_as_a_gateway_error_and_never_calls_litellm(monkeypatch):
    seen = _capture_completion(monkeypatch)
    monkeypatch.setattr(gw, "get_settings", lambda: _settings(model_fallbacks=[]))
    with pytest.raises(GatewayError, match="Google Cloud API key"):
        gw.complete(CompletionRequest(model=SLUG, messages=[], api_key=None))
    assert seen == []


def test_a_per_node_backup_on_vertex_is_translated_with_its_own_key(monkeypatch):
    seen: list[dict] = []

    def fake(**kwargs):
        seen.append(kwargs)
        if kwargs["model"].startswith("openai/"):
            raise RuntimeError("dead key")
        return _fake_response()

    monkeypatch.setattr(gw.litellm, "completion", fake)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    monkeypatch.setattr(gw, "get_settings", lambda: _settings(model_fallbacks=[]))
    result = gw.complete(
        CompletionRequest(
            model="openai/gpt-4.1-mini",
            messages=[],
            api_key="owner-openai-key",
            fallback_model=SLUG,
            fallback_api_key=KEY,
        )
    )
    assert seen[0]["model"] == "openai/gpt-4.1-mini"
    assert "api_base" not in seen[0]
    assert seen[1]["model"] == "gemini/gemini-3-flash-preview"
    assert seen[1]["api_base"] == BASE
    assert seen[1]["api_key"] == KEY
    assert result.model_used == SLUG


# ---- the agent routing ----


@pytest.mark.parametrize("mode", ["local", "docker", "fly"])
def test_routing_proxy_off_points_at_the_vertex_base_with_the_envelope(mode):
    settings = _settings(litellm_proxy_enabled=False)
    routing = agent_llm_routing(settings, SLUG, mode, api_key_override=KEY)
    assert routing == {
        "model": "gemini/gemini-3-flash-preview",
        "api_key": KEY,
        "base_url": BASE,
        "num_retries": settings.agent_num_retries,
        "retry_max_wait": settings.agent_retry_max_wait_s,
        "timeout": settings.agent_request_timeout_s,
    }


def test_routing_keeps_the_hosts_own_retry_envelope():
    routing = agent_llm_routing(_settings(), SLUG, "local", api_key_override=KEY, num_retries=3)
    assert routing["num_retries"] == 3


def test_routing_proxy_on_is_unchanged():
    settings = _settings(litellm_proxy_enabled=True)
    assert agent_llm_routing(settings, SLUG, "local", api_key_override="vkey") == {
        "model": f"litellm_proxy/{SLUG}",
        "api_key": "vkey",
        "base_url": settings.agent_llm_base_url("local"),
    }


def test_routing_for_a_gemini_slug_is_unchanged():
    settings = _settings(litellm_proxy_enabled=False)
    assert agent_llm_routing(
        settings, "gemini/gemini-2.5-flash", "local", api_key_override=KEY
    ) == {
        "model": "gemini/gemini-2.5-flash",
        "api_key": KEY,
        "num_retries": settings.agent_num_retries,
        "retry_max_wait": settings.agent_retry_max_wait_s,
        "timeout": settings.agent_request_timeout_s,
    }


# ---- never untranslated ----


def _raise_on_vertex(**kwargs):
    assert not str(kwargs["model"]).startswith("vertex_ai/"), "untranslated vertex_ai slug"
    return kwargs


def _agent_llm(mode: str, usage_id: str = "tvashtr-agent") -> LLM:
    settings = _settings(litellm_proxy_enabled=False)
    return LLM(
        **agent_llm_routing(settings, SLUG, mode, api_key_override=KEY),
        temperature=0.0,
        usage_id=usage_id,
        max_output_tokens=settings.agent_max_output_tokens,
    )


def _sdk_call(llm: LLM, monkeypatch) -> dict:
    """One real ``LLM.completion`` with litellm's call replaced: what the SDK would send it."""
    import openhands.sdk.llm.llm as sdk_llm

    seen: list[dict] = []

    def fake(**kwargs):
        seen.append(_raise_on_vertex(**kwargs))
        return ModelResponse(
            choices=[{"message": {"role": "assistant", "content": "ok"}}],
            usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        )

    monkeypatch.setattr(sdk_llm, "litellm_completion", fake)
    llm.completion(messages=[Message(role="user", content=[TextContent(text="hi")])])
    assert len(seen) == 1
    return seen[0]


def test_guard_the_gateway_never_sends_a_vertex_slug(monkeypatch):
    def fake(**kwargs):
        _raise_on_vertex(**kwargs)
        return _fake_response()

    monkeypatch.setattr(gw.litellm, "completion", fake)
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    gw.complete(CompletionRequest(model=SLUG, messages=[], api_key=KEY))


@pytest.mark.parametrize("mode", ["local", "docker", "fly"])
def test_guard_the_agent_llm_sends_the_translated_call(mode, monkeypatch):
    sent = _sdk_call(_agent_llm(mode), monkeypatch)
    assert sent["model"] == "gemini/gemini-3-flash-preview"
    assert sent["api_base"] == BASE


def test_guard_the_condenser_llm_inherits_the_translation(monkeypatch):
    llm = _agent_llm("local")
    condenser = llm.model_copy(update={"usage_id": "tvashtr-condenser"})
    condenser.reset_metrics()
    assert condenser.telemetry is not None  # recreated lazily, as the agent loop's first use does
    sent = _sdk_call(condenser, monkeypatch)
    assert sent["model"] == "gemini/gemini-3-flash-preview"
    assert sent["api_base"] == BASE


@pytest.mark.parametrize("mode", ["docker", "fly"])
def test_the_base_url_survives_serialization_into_the_agent_server(mode, monkeypatch):
    # docker and fly send the LLM to the in-sandbox agent-server as JSON; the server rebuilds it.
    payload = _agent_llm(mode).model_dump_json(context={"expose_secrets": True})
    rebuilt = LLM.model_validate_json(payload)
    assert rebuilt.model == "gemini/gemini-3-flash-preview"
    assert rebuilt.base_url == BASE
    assert _sdk_call(rebuilt, monkeypatch)["api_base"] == BASE


def test_every_adapter_builds_its_llm_from_agent_llm_routing():
    # The tests above hold for an adapter only if its LLM comes from that one function.
    engines = Path(inspect.getfile(tvashtr)).parent / "engines"
    for name, mode in [
        ("openhands_adapter.py", "local"),
        ("openhands_docker_adapter.py", "docker"),
        ("openhands_fly_adapter.py", "fly"),
    ]:
        calls = [
            node
            for node in ast.walk(ast.parse((engines / name).read_text()))
            if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "LLM"
        ]
        assert calls, name
        for call in calls:
            routed = [
                kw.value
                for kw in call.keywords
                if kw.arg is None
                and isinstance(kw.value, ast.Call)
                and getattr(kw.value.func, "id", "") == "agent_llm_routing"
            ]
            assert routed, f"{name}: LLM(...) not built from agent_llm_routing"
            assert routed[0].args[2].value == mode, name
