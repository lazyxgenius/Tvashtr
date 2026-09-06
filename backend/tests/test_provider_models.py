"""M-live D1: the provider model-list resolver, and above all that it FAILS OPEN.

The whole point of this module is to catch a model its provider has retired *before* a run starts.
The danger is the mirror image: a liveness check that refuses launches when the CHECK is what broke
is strictly worse than the bug it prevents — it converts a provider blip, a proxy, or an offline
laptop into "you cannot run anything". Every path that is not a confident, parsed "this provider
does not serve that id" must therefore return ``None``, and ``None`` must never refuse.

Nothing here touches the network: the adapters are driven through an injected HTTP getter.
"""

import pytest

from tvashtr.control_plane import provider_models as pm

_NIM_BODY = {"data": [{"id": "openai/gpt-oss-20b"}, {"id": "meta/llama-3.2-11b-vision-instruct"}]}


@pytest.fixture(autouse=True)
def _clean_cache():
    pm.reset_cache()
    yield
    pm.reset_cache()


def _getter(body, status=200):
    def _get(url, headers, timeout):  # noqa: ARG001 - signature mirrors the real client
        return status, body

    return _get


# --------------------------------------------------------------------------------------
# FAIL OPEN — the single most important property. Each of these is a way the CHECK breaks.
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("label", "getter"),
    [
        ("connection refused", lambda *_a, **_k: (_ for _ in ()).throw(OSError("refused"))),
        ("read timeout", lambda *_a, **_k: (_ for _ in ()).throw(TimeoutError("slow"))),
        ("HTTP 500", _getter({"error": "boom"}, status=500)),
        ("HTTP 401 bad key", _getter({"error": "unauthorized"}, status=401)),
        ("HTTP 429 throttled", _getter({"error": "slow down"}, status=429)),
        ("body is not JSON-shaped", _getter("<html>gateway timeout</html>")),
        ("body has no model array", _getter({"unexpected": "shape"})),
        ("entries carry no id", _getter({"data": [{"name": "no-id-field"}, {}]})),
        ("empty list", _getter({"data": []})),
    ],
)
def test_a_broken_check_returns_none_and_never_refuses(label, getter):
    """Unreachable, refused, throttled, unparseable or empty ⇒ ``None`` — never a refusal."""
    assert pm.servable_models("nvidia_nim", "k", http_get=getter) is None, label
    # …and the D2-facing predicate must agree: no verdict means no refusal.
    assert (
        pm.is_definitely_unservable("nvidia_nim/meta/llama-3.3-70b-instruct", "k", http_get=getter)
        is False
    ), label


def test_a_provider_with_no_adapter_fails_open():
    """An uncatalogued provider has no endpoint we have confirmed — it must not be guessed at."""
    assert pm.servable_models("acme", "k") is None
    assert pm.is_definitely_unservable("acme/some-model", "k") is False


def test_deepseek_fails_open_because_its_list_is_incomplete():
    """Probed live 2026-09-06: ``deepseek-chat`` is ABSENT from deepseek's ``/models`` yet serves
    HTTP 200. Its list therefore cannot support a refusal, so the adapter is deliberately absent."""
    assert pm.servable_models("deepseek", "k") is None
    assert pm.is_definitely_unservable("deepseek/deepseek-chat", "k") is False


# --------------------------------------------------------------------------------------
# The positive path — a confident verdict, in both directions.
# --------------------------------------------------------------------------------------
def test_a_served_model_is_not_unservable():
    served = pm.servable_models("nvidia_nim", "k", http_get=_getter(_NIM_BODY))
    assert served == frozenset({"openai/gpt-oss-20b", "meta/llama-3.2-11b-vision-instruct"})
    assert (
        pm.is_definitely_unservable(
            "nvidia_nim/openai/gpt-oss-20b", "k", http_get=_getter(_NIM_BODY)
        )
        is False
    )


def test_a_retired_model_is_definitely_unservable():
    """The M-live case: NVIDIA dropped ``meta/llama-3.3-70b-instruct`` from the list entirely."""
    assert (
        pm.is_definitely_unservable(
            "nvidia_nim/meta/llama-3.3-70b-instruct", "k", http_get=_getter(_NIM_BODY)
        )
        is True
    )


def test_the_provider_prefix_is_stripped_before_matching():
    """Tvashtr slugs are ``<provider>/<the provider's own id>``; only the first segment is ours."""
    assert pm._bare_model_id("nvidia_nim/openai/gpt-oss-20b") == "openai/gpt-oss-20b"
    assert pm._bare_model_id("openai/gpt-4o-mini") == "gpt-4o-mini"
    assert pm._bare_model_id("openrouter/openai/gpt-4o-mini") == "openai/gpt-4o-mini"


def test_gemini_ids_lose_their_models_prefix():
    """Gemini answers ``models/gemini-2.5-flash``; the slug says ``gemini/gemini-2.5-flash``."""
    body = {"models": [{"name": "models/gemini-2.5-flash"}]}
    assert pm.servable_models("gemini", "k", http_get=_getter(body)) == frozenset(
        {"gemini-2.5-flash"}
    )
    live = pm.is_definitely_unservable("gemini/gemini-2.5-flash", "k", http_get=_getter(body))
    dead = pm.is_definitely_unservable("gemini/gemini-2.0-flash", "k", http_get=_getter(body))
    assert live is False
    assert dead is True


def test_a_model_with_no_provider_segment_fails_open():
    """A bare ``gpt-4o-mini`` has no provider we can ask; never refuse on a slug we cannot parse."""
    assert pm.is_definitely_unservable("gpt-4o-mini", "k") is False


# --------------------------------------------------------------------------------------
# Cache behaviour.
# --------------------------------------------------------------------------------------
def test_the_list_is_fetched_once_per_provider_within_the_ttl():
    calls = []

    def counting(url, headers, timeout):  # noqa: ARG001
        calls.append(url)
        return 200, _NIM_BODY

    for _ in range(4):
        pm.servable_models("nvidia_nim", "k", http_get=counting)
    assert len(calls) == 1, "a launch must not pay a cold provider round-trip every time"


def test_two_different_keys_do_not_share_a_cached_answer():
    """Entitlement is per-key (NIM lists 81 models but a given key reaches ~7), so a second key
    must get its own lookup rather than inheriting the first key's answer."""
    calls = []

    def counting(url, headers, timeout):  # noqa: ARG001
        calls.append(headers.get("Authorization"))
        return 200, _NIM_BODY

    pm.servable_models("nvidia_nim", "key-one", http_get=counting)
    pm.servable_models("nvidia_nim", "key-two", http_get=counting)
    assert len(calls) == 2


def test_a_failed_lookup_is_not_cached_as_a_permanent_none():
    """A blip must not poison the cache for an hour — the next launch retries."""
    calls = []

    def flaky(url, headers, timeout):  # noqa: ARG001
        calls.append(url)
        if len(calls) == 1:
            raise OSError("transient")
        return 200, _NIM_BODY

    assert pm.servable_models("nvidia_nim", "k", http_get=flaky) is None
    assert pm.servable_models("nvidia_nim", "k", http_get=flaky) is not None
    assert len(calls) == 2


def test_the_cache_key_never_contains_the_api_key():
    """The key is a secret: it may be fingerprinted, never stored."""
    pm.servable_models("nvidia_nim", "super-secret-key", http_get=_getter(_NIM_BODY))
    assert "super-secret-key" not in repr(pm._cache_snapshot())
