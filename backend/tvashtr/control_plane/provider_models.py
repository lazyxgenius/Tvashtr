"""M-live D1 — "does this provider still serve that model?", asked safely.

``PROVIDER_CATALOGUE`` hard-codes one ``default_model`` per provider and node models are free text,
so a slug that a vendor retires keeps sailing through validation and dies forty seconds into a run.
NVIDIA proved it: ``meta/llama-3.3-70b-instruct`` went ``410 Gone`` on 2026-08-26, and because
``nvidia_nim`` leads ``_PROVIDER_DEFAULT_ORDER`` that made every freshly created team unrunnable.
This module is the missing question, and :mod:`tvashtr.routers` asks it in the launch pre-flight.

**FAIL OPEN. Always.** Unreachable endpoint, timeout, 401, 429, unparseable body, a provider with
no confirmed adapter — every one of them returns ``None``, and ``None`` never refuses a launch. A
liveness check that blocks runs when the *check* is what broke is strictly worse than the bug it
prevents: it turns a provider blip or an offline laptop into a total outage. The only thing that
may refuse is a parsed list that positively does not contain the id.

**Which providers get an adapter is evidence, not documentation.** Every endpoint below was
confirmed live on 2026-09-06 against the operator's own keys, and each list was cross-checked
against a real completion for the model the catalogue points at:

===========  ==================================================  =========================
provider     endpoint (confirmed HTTP 200)                       list vs. a real call
===========  ==================================================  =========================
nvidia_nim   ``integrate.api.nvidia.com/v1/models``              agrees (the retired slug is
                                                                 absent; the live one present)
openai       ``api.openai.com/v1/models``                        agrees
groq         ``api.groq.com/openai/v1/models``                   agrees (its default is absent
                                                                 AND 404s on a real call)
gemini       ``generativelanguage.googleapis.com/v1beta/models`` agrees (ditto, "no longer
                                                                 available")
openrouter   ``openrouter.ai/api/v1/models``                     agrees
deepseek     ``api.deepseek.com/models``                         **DISAGREES — no adapter**
===========  ==================================================  =========================

DeepSeek is deliberately absent. Its list returns three ids and omits ``deepseek-chat``, which
nevertheless answers a real completion with HTTP 200 — an INCOMPLETE list. Trusting it would refuse
a launch that works, which is the one outcome this module must never produce. It fails open until
a source of truth for that provider is confirmed.

One caveat worth knowing about the adapters that ARE enabled: a list can be complete about
*existence* and still say nothing about *entitlement*. NIM lists 81 models while a given build key
can actually reach about seven; the rest answer ``404 Not found for account``. That asymmetry is
harmless here, because those ids ARE in the list and so are never refused — the error direction
always points at fail-open.

Openhands-free at import, and it never logs or returns key material.
"""

import hashlib
import logging
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# A launch must not pay a cold provider round-trip, and vendor catalogues change on the order of
# weeks — an hour is the same posture the installation-token cache takes.
_TTL_SECONDS = 3600.0
# Short on purpose: a slow provider must never hang the launch endpoint. Two seconds is far longer
# than any of the six confirmed endpoints took to answer, and a miss merely fails open.
_TIMEOUT_SECONDS = 2.5

HttpGet = Callable[[str, Mapping[str, str], float], tuple[int, Any]]


@dataclass(frozen=True)
class _Adapter:
    """How to ask one provider what it serves. ``ids`` pulls the model ids from the parsed body."""

    url: str
    auth_header: str
    auth_format: str
    ids: Callable[[Any], list[str]]


def _openai_shaped(body: Any) -> list[str]:
    """``{"data": [{"id": ...}, ...]}`` — the OpenAI ``/v1/models`` convention."""
    return [str(row["id"]) for row in body["data"] if isinstance(row, dict) and row.get("id")]


def _gemini_shaped(body: Any) -> list[str]:
    """``{"models": [{"name": "models/gemini-2.5-flash"}, ...]}`` — the ``models/`` prefix is
    Google's own namespacing and is not part of the slug Tvashtr stores."""
    out = []
    for row in body["models"]:
        name = str(row.get("name") or "") if isinstance(row, dict) else ""
        if name:
            out.append(name[len("models/") :] if name.startswith("models/") else name)
    return out


_ADAPTERS: dict[str, _Adapter] = {
    "nvidia_nim": _Adapter(
        "https://integrate.api.nvidia.com/v1/models", "Authorization", "Bearer {}", _openai_shaped
    ),
    "openai": _Adapter(
        "https://api.openai.com/v1/models", "Authorization", "Bearer {}", _openai_shaped
    ),
    "groq": _Adapter(
        "https://api.groq.com/openai/v1/models", "Authorization", "Bearer {}", _openai_shaped
    ),
    "openrouter": _Adapter(
        "https://openrouter.ai/api/v1/models", "Authorization", "Bearer {}", _openai_shaped
    ),
    "gemini": _Adapter(
        "https://generativelanguage.googleapis.com/v1beta/models",
        "x-goog-api-key",
        "{}",
        _gemini_shaped,
    ),
    # "deepseek" is intentionally ABSENT — see the module docstring. Its list omits models it
    # serves, so a refusal built on it would be a false positive.
}

# provider + key fingerprint -> (models, fetched_at). The fingerprint is there because entitlement
# is per-key, so two owners of the same provider must not inherit each other's answer; only a
# truncated SHA-256 is held, never the key.
_cache: dict[tuple[str, str], tuple[frozenset[str], float]] = {}
_cache_lock = threading.Lock()


def reset_cache() -> None:
    """Drop every cached list. For tests and deliberate refreshes; not called on the run path."""
    with _cache_lock:
        _cache.clear()


def _cache_snapshot() -> dict[tuple[str, str], tuple[frozenset[str], float]]:
    """A copy of the cache, for tests that assert on what is (and is not) retained."""
    with _cache_lock:
        return dict(_cache)


def _fingerprint(api_key: str) -> str:
    """A short, irreversible tag for a key so the cache can be per-key without holding the key."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:16]


def _bare_model_id(model: str) -> str:
    """Strip Tvashtr's leading ``<provider>/`` segment, leaving the provider's own id.

    ``nvidia_nim/openai/gpt-oss-20b`` -> ``openai/gpt-oss-20b``; ``openai/gpt-4o-mini`` ->
    ``gpt-4o-mini``. Only the FIRST segment is ours — the remainder is the vendor's namespace and
    must survive intact, which is why this is not a plain ``rsplit``.
    """
    _, _, rest = model.partition("/")
    return rest.strip()


def _default_http_get(url: str, headers: Mapping[str, str], timeout: float) -> tuple[int, Any]:
    """The real transport, imported lazily so the module stays cheap and easily faked in tests."""
    import httpx

    response = httpx.get(url, headers=dict(headers), timeout=timeout)
    try:
        body = response.json()
    except Exception:  # noqa: BLE001 - a non-JSON body is just a miss; the caller fails open
        body = None
    return response.status_code, body


def servable_models(
    provider: str, api_key: str, *, http_get: HttpGet | None = None
) -> frozenset[str] | None:
    """The ids ``provider`` currently serves for ``api_key``, or ``None`` when we cannot say.

    ``None`` is not an error the caller should surface — it means "no verdict", and every caller
    must treat it as permission to proceed. See the module docstring for why that direction is
    non-negotiable.
    """
    adapter = _ADAPTERS.get(provider)
    if adapter is None or not api_key:
        return None

    cache_key = (provider, _fingerprint(api_key))
    now = time.time()
    with _cache_lock:
        cached = _cache.get(cache_key)
        if cached is not None and now - cached[1] < _TTL_SECONDS:
            return cached[0]

    getter = http_get or _default_http_get
    try:
        status, body = getter(
            adapter.url,
            {
                adapter.auth_header: adapter.auth_format.format(api_key),
                "Accept": "application/json",
            },
            _TIMEOUT_SECONDS,
        )
        if status != 200:
            logger.info(
                "provider %s model list unavailable (HTTP %s) — failing open", provider, status
            )
            return None
        ids = {model_id.strip() for model_id in adapter.ids(body) if model_id.strip()}
    except Exception as exc:  # noqa: BLE001 - ANY failure of the check itself must fail open
        logger.info(
            "provider %s model list unreachable (%s) — failing open", provider, type(exc).__name__
        )
        return None

    if not ids:
        # An empty list is far likelier to be a shape we misread than a provider serving nothing.
        logger.info("provider %s returned no model ids — failing open", provider)
        return None

    served = frozenset(ids)
    # Only successes are cached: a blip must not poison the answer for a whole TTL.
    with _cache_lock:
        _cache[cache_key] = (served, now)
    return served


def is_definitely_unservable(model: str, api_key: str, *, http_get: HttpGet | None = None) -> bool:
    """``True`` only when a parsed provider list positively lacks ``model``. Never guesses.

    This is the predicate the launch pre-flight refuses on, so its ``False`` is load-bearing: an
    unknown answer, an unparseable slug, a provider with no adapter and an unreachable endpoint all
    return ``False`` and let the launch through.
    """
    provider, _, _rest = model.partition("/")
    bare = _bare_model_id(model)
    if not provider or not bare:
        return False
    served = servable_models(provider.strip().lower(), api_key, http_get=http_get)
    if served is None:
        return False
    return bare not in served
