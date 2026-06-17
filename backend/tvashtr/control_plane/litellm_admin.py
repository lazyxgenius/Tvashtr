"""Proxy-admin client — mint / delete LiteLLM **virtual keys** (P1.4b).

This is the thin host→proxy admin seam that gives the 4a proxy *teeth*: a per-run
virtual key carries a ``max_budget`` so the proxy errors **mid-call** when the agent's
spend crosses it (the hard cutoff P1.2's between-steps gate can't do). The mint/delete
*steps* live in ``team_run`` (durable, idempotent via DBOS step-output replay); this
module is only the HTTP call.

Boundary (sacred — mirrors how ``gateway.py`` is the sole ``litellm``-library importer):
this module imports **stdlib HTTP only** (``urllib``) + ``tvashtr.config`` — **never**
``litellm`` the library, **never** ``openhands``. (``httpx`` is a dev-only dep, so it is
not used in product code.) That keeps ``import tvashtr.main`` and the import-boundary test
green.

These are **admin** calls: they authenticate with the proxy **master key** and go from the
host process to the proxy at ``127.0.0.1`` (NOT mode-aware — the host always reaches the
proxy at loopback; only the *agent's* use of the minted key is mode-aware, wired in 4a).
Endpoints verified live against the pinned proxy image (litellm 1.89.0):
  - ``POST /key/generate``  body ``{"max_budget": <float|omitted>, "duration": "30m"}``,
    ``Authorization: Bearer <master_key>`` → 200, response carries ``"key"`` (the usable value).
  - ``POST /key/delete``    body ``{"keys": ["<key>"]}`` → 200 ``{"deleted_keys": [...]}``;
    an absent key → 404 (so delete swallows errors — best-effort, never raises).
"""

import json
import logging
import urllib.request

from tvashtr.config import get_settings

logger = logging.getLogger("tvashtr.control_plane.litellm_admin")

_TIMEOUT_SECONDS = 15.0


def _admin_post(path: str, body: dict, master_key: str) -> dict:
    """POST ``body`` to the proxy admin ``path`` with master-key bearer auth; return the
    decoded JSON. The host reaches the proxy at loopback (``agent_llm_base_url("local")``)."""
    settings = get_settings()
    url = f"{settings.agent_llm_base_url('local')}{path}"
    request = urllib.request.Request(  # noqa: S310 (local proxy, fixed scheme)
        url,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {master_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as resp:
        return json.loads(resp.read().decode() or "{}")


def mint_virtual_key(*, max_budget: float | None, duration: str) -> dict:
    """Mint a per-run virtual key on the proxy and return its create response (carries
    ``"key"`` — the value the agent presents as its api_key).

    ``max_budget=None`` ⇒ the field is omitted ⇒ an **uncapped** key (used when the run has
    no cap, or a human already approved a P1.2 breach). ``duration`` is the key TTL (e.g.
    ``"30m"``) — the crash-robust floor that self-cleans orphaned keys.

    Raises if the master key is unset: a proxy-ON run with no master key is already broken
    (the agent would 401), so fail loudly rather than mint nothing and run unbudgeted.
    """
    master_key = get_settings().litellm_master_key
    if not master_key:
        raise RuntimeError(
            "LITELLM_MASTER_KEY is not set — cannot mint a per-run proxy virtual key. "
            "A proxy-enabled run requires the master key (it authenticates the mint and is "
            "the agent's fallback credential)."
        )
    body: dict = {"duration": duration}
    if max_budget is not None:
        body["max_budget"] = max_budget
    return _admin_post("/key/generate", body, master_key)


def delete_virtual_key(key: str) -> None:
    """Best-effort delete of a per-run virtual key (immediate credential invalidation).

    Never raises: the key's TTL backstops a skipped/failed delete, so this adds no
    correctness dependency (deleting an already-expired/absent key 404s — swallowed). A
    missing master key or empty key is a clean no-op.
    """
    master_key = get_settings().litellm_master_key
    if not master_key or not key:
        return
    try:
        _admin_post("/key/delete", {"keys": [key]}, master_key)
    except Exception:
        # TRULY best-effort — must NEVER fail the run on teardown (the docstring's contract).
        # Swallow everything: a 404 on an already-gone key (HTTPError ⊂ URLError), the proxy
        # being unreachable (URLError/OSError), a malformed response (http.client.HTTPException,
        # which is NOT an OSError so a narrow tuple would let it escape), a decode error, etc.
        # The key's TTL guarantees cleanup regardless, so a swallowed delete loses nothing.
        logger.warning(
            "delete_virtual_key best-effort delete failed (TTL backstops)", exc_info=True
        )
