"""Process-level sandbox reuse cache (M-unify U2).

Keeps a live agent SANDBOX — a docker container + its OpenHands ``Conversation`` (docker mode), or a
local ``Conversation`` (local mode) — alive across the repeated goals of the SAME node in the SAME
run (the Engineer/Reviewer across review-loop rounds), so round 2+ skip the container spin-up AND
continue the same conversation (the agent remembers prior rounds).

WHY A PROCESS-LEVEL CACHE (not the DBOS durable model): a live sandbox handle — a running container,
an open WebSocket-backed ``RemoteConversation`` — CANNOT cross a ``@DBOS.step`` boundary; it is not
serializable and would not survive a replay. So the durable model carries only the serializable
``session_key`` (``AgentTask.session_key``); the LIVE handle lives here, keyed by that string,
entirely inside the adapter layer. The Control Plane NEVER touches a handle: it passes the key on
the way in and calls :func:`close_run_sandboxes` (run_id in, nothing out) at run-end.

ENGINE-NEUTRAL: this module never imports ``openhands`` (or ``docker``). It holds each sandbox as an
OPAQUE :class:`CachedSandbox` — it only reads ``.container_id`` and calls the adapter-provided
``.close()``. That is what lets ``engines.base`` + ``control_plane.team_run`` import this module and
still stay ``openhands``-free (the import-boundary invariant).

CRASH-SAFETY: the cache is in-memory. A ``kill -9`` evaporates it → on resume every node is a MISS
and rebuilds FRESH from the durable host workspace (finished rounds replay from the DBOS log; a
reused-then-crashed in-flight round re-runs). The cache is a pure optimization with no correctness
dependency; the boot sweep (unchanged) reaps any orphaned container the crash left behind.

CONCURRENCY: a module-level dict guarded by a lock. Runs are serial (single-operator v1), but the
lock keeps the reaper's read of :func:`live_container_ids` consistent with a concurrent put/close.
"""

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass

logger = logging.getLogger("tvashtr.engines.sandbox_cache")

# session_key format contract (owned HERE so :func:`close_run_sandboxes` can recover a run's
# entries):   session_key == f"{run_id}{_SEP}{node_id}" run_id + node_id are UUID strings (they
# contain no ``::``), so the split is unambiguous.
_SEP = "::"


def session_key_for(run_id: str, node_id: str) -> str:
    """Build the opaque per-node reuse key the Control Plane threads onto ``AgentTask.session_key``.
    Centralized here so :func:`_run_id_of` can recover the run for run-end teardown."""
    return f"{run_id}{_SEP}{node_id}"


def _run_id_of(session_key: str) -> str:
    return session_key.split(_SEP, 1)[0]


@dataclass
class CachedSandbox:
    """One live sandbox the adapter stashed.

    ``handle`` is adapter-private (this module NEVER inspects it — it is the ``Conversation`` +
    workspace the adapter needs to resume). ``close`` is the adapter-provided teardown (docker:
    ``workspace.cleanup`` → ``docker stop``; local: a no-op — the shared workspace dir must survive
    to ship, and the ``Conversation`` is released by eviction/GC). ``container_id`` (docker only;
    ``None`` for local) lets the reaper skip a live warm container. No ``openhands`` types cross
    this boundary.
    """

    handle: object
    close: Callable[[], None]
    container_id: str | None = None


_LOCK = threading.Lock()
_CACHE: dict[str, CachedSandbox] = {}


def get(session_key: str | None) -> CachedSandbox | None:
    """Return the live sandbox for ``session_key``, or ``None`` on a MISS. ``session_key is None``
    (reuse disabled) is ALWAYS a MISS — both the byte-identical no-reuse path AND the guard that
    keeps an un-threaded ``None`` key from ever spuriously colliding into a HIT."""
    if session_key is None:
        return None
    with _LOCK:
        return _CACHE.get(session_key)


def put(session_key: str | None, sandbox: CachedSandbox) -> None:
    """Stash a freshly-built sandbox under ``session_key``. ``None`` ⇒ a no-op (reuse disabled), so
    nothing is EVER cached on the no-reuse path — the teardown then falls to the adapter's own
    per-run ``cleanup`` and behavior is byte-for-byte today's."""
    if session_key is None:
        return
    with _LOCK:
        _CACHE[session_key] = sandbox


def live_container_ids() -> frozenset[str]:
    """The container ids of every currently-cached docker sandbox — the reaper's keep-set, so
    reap-before-start skips warm containers it must NOT kill (the boot sweep passes nothing and
    still reaps everything). Local sandboxes contribute no id."""
    with _LOCK:
        return frozenset(cs.container_id for cs in _CACHE.values() if cs.container_id)


def close_run_sandboxes(run_id: str) -> None:
    """Tear down + evict EVERY cached sandbox for ``run_id`` (run-end teardown; run_id in, nothing
    out — no engine internals leak). Best-effort + idempotent: a failing ``close()`` is logged,
    never raised, so one sandbox's teardown can't strand another or break the workflow's terminal.
    A ``kill -9`` skips this entirely — the in-memory cache's evaporation + the boot sweep are the
    backstops (see the module docstring)."""
    with _LOCK:
        keys = [k for k in _CACHE if _run_id_of(k) == run_id]
        entries = [(k, _CACHE.pop(k)) for k in keys]
    # Close OUTSIDE the lock — ``cleanup()`` shells out to ``docker stop`` (slow); holding the lock
    # would block the reaper / a concurrent put for its duration.
    for key, cs in entries:
        try:
            cs.close()
        except Exception:
            logger.warning("sandbox close failed for %s (evicted anyway)", key, exc_info=True)


def clear() -> None:
    """Drop ALL entries WITHOUT closing them — a test-only seam so a unit test that exercises the
    process-global cache directly can't leak state into the next test. NEVER used in production."""
    with _LOCK:
        _CACHE.clear()
