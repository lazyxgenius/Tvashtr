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

import json
import logging
import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

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


def run_id_from_session_key(session_key: str | None) -> str | None:
    """Public, None-safe recovery of the run_id from a U2 ``session_key`` — the live-container
    registry stores it (informational: WHICH run owns a registered container). ``None`` in ⇒
    ``None`` out (the no-reuse path threads no key), so the registry entry's ``run_id`` is simply
    unset there; correctness rides on ``pid`` alone."""
    if not session_key:
        return None
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
        # De-register the torn-down container from the live-container registry (M-reaper): the
        # boot sweep must no longer spare it. Best-effort, after the close attempt — a failed
        # close still ends the run, and a lingering entry's now-dying pid would let the next boot
        # reap it anyway; dropping it here keeps the file tight. (The no-reuse path — which caches
        # nothing — de-registers in the adapter's own ``finally``.)
        if cs.container_id:
            deregister_live_container(cs.container_id)


def clear() -> None:
    """Drop ALL entries WITHOUT closing them — a test-only seam so a unit test that exercises the
    process-global cache directly can't leak state into the next test. NEVER used in production."""
    with _LOCK:
        _CACHE.clear()


# --- M-reaper: the host-side LIVE-container registry (per-run boot-sweep spare) -----------------
#
# WHY A FILE (the in-memory ``_CACHE`` above is NOT enough): the boot sweep runs in a DIFFERENT
# process from the live run whose container it must spare (e.g. ``make test`` builds its session
# TestClient — which runs the FastAPI lifespan sweep — while a real run executes in another
# process). An in-memory cache is invisible across that boundary; a small on-disk registry is not.
# So a docker run REGISTERS its container here (``register_live_container`` at container start,
# ``deregister_live_container`` at teardown) with the OWNING process's ``pid``, and the boot sweep
# reads :func:`spared_container_ids` and passes it as ``reap_agent_containers(keep_ids=...)``.
#
# THE SPARE RULE (preserves the P1.3a crash backstop EXACTLY): a container is spared iff it has a
# registry entry AND that entry's owning ``pid`` is still alive. No entry, or a DEAD pid (the owner
# crashed / exited), ⇒ NOT spared ⇒ reaped — a genuine orphan, exactly what the sweep must clear.
#
# ROBUSTNESS: every op is best-effort. A missing / unreadable / corrupt file is treated as EMPTY
# (warn, never raise) so a bad file can never block app boot nor crash a run. The registry sits
# beside the agent workspaces (both gitignored). Writes are atomic (temp + ``os.replace``) so a
# concurrent reader (the sweep) never sees a torn file; the module ``_LOCK`` serializes in-process
# access. Cross-process is last-writer-wins — correct for the serial single-operator v1. The
# registration TOCTOU window is just the ``DockerWorkspace`` ctor's own span (the adapter registers
# the instant the container exists, before the Conversation handshake); a concurrent boot sweep
# landing inside that span WOULD reap the container (the run then fails — no self-heal), but
# serial single-operator runs make that coincidence vanishingly unlikely. ``register`` also drops
# dead-pid entries, so the file stays bounded across crashes.
#
# ``pid`` reuse (the OS recycling a dead owner's pid onto an unrelated live process) could spare an
# already-orphaned container until that process dies — for THAT orphan strictly worse than the
# pre-fix reap-everything, but bounded (ephemeral ports ⇒ no wedged port) and backstopped by the
# next run's reap-before-start (image-scoped). A start-time-qualified liveness check (using stored
# ``started_at``) is the named follow-on that closes it.

_REGISTRY_PATH = (
    Path(__file__).resolve().parents[2] / ".tvashtr_workspaces" / "live_containers.json"
)


def _pid_alive(pid: object) -> bool:
    """True iff ``pid`` names a live process. ``os.kill(pid, 0)`` sends no signal — it only probes:
    ``ProcessLookupError`` ⇒ dead; ``PermissionError`` ⇒ ALIVE (exists, just not ours to signal);
    a non-int / non-positive / out-of-range pid ⇒ dead (never probe pid 0 = the process group)."""
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except (OSError, OverflowError):
        # OSError => dead (ProcessLookupError handled above). OverflowError => an out-of-range
        # int pid from a corrupt/hand-edited registry (os.kill's pid_t is int32) — treat as dead;
        # never let it escape and collapse the WHOLE spare set (that would reap a co-resident LIVE
        # container). Keeps the "tolerant of a corrupt file" contract.
        return False
    return True


def _read_registry() -> list[dict]:
    """Load the registry entries, tolerantly. Missing ⇒ ``[]``. Corrupt / unreadable / not-a-list
    ⇒ ``[]`` + a warning (NEVER raise — a bad file must not block boot or crash a run). Filters to
    dict entries that carry a ``container_id``."""
    try:
        with open(_REGISTRY_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return []
    except (OSError, ValueError):
        logger.warning(
            "live-container registry %s unreadable/corrupt; treating as empty",
            _REGISTRY_PATH,
            exc_info=True,
        )
        return []
    if not isinstance(data, list):
        logger.warning("registry %s is not a JSON list; treating as empty", _REGISTRY_PATH)
        return []
    return [e for e in data if isinstance(e, dict) and e.get("container_id")]


def _write_registry(entries: list[dict]) -> None:
    """Atomically write ``entries`` (temp file + ``os.replace``) so a concurrent reader never sees a
    torn file. Creates the workspaces dir if absent. Caller holds ``_LOCK`` + wraps exceptions."""
    _REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _REGISTRY_PATH.with_name(f"{_REGISTRY_PATH.name}.{os.getpid()}.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(entries, fh)
    os.replace(tmp, _REGISTRY_PATH)


def register_live_container(
    container_id: str, *, run_id: str | None = None, pid: int | None = None
) -> None:
    """Record ``container_id`` as owned by a LIVE process so the boot sweep spares it. ``pid``
    defaults to this process (``os.getpid()``). Idempotent per container_id (a re-register replaces
    the prior entry) and self-GC'ing (drops any dead-pid entries as it writes, bounding the file
    across crashes). Best-effort: a write failure is logged, never raised — a registry hiccup must
    not crash the run that is starting the container."""
    if not container_id:
        return
    pid = os.getpid() if pid is None else pid
    try:
        with _LOCK:
            entries = [
                e
                for e in _read_registry()
                if e.get("container_id") != container_id and _pid_alive(e.get("pid"))
            ]
            entries.append(
                {
                    "container_id": container_id,
                    "pid": pid,
                    "run_id": run_id,
                    "started_at": time.time(),
                }
            )
            _write_registry(entries)
    except Exception:
        logger.warning(
            "failed to register live container %s (continuing)", container_id, exc_info=True
        )


def deregister_live_container(container_id: str) -> None:
    """Drop ``container_id``'s entry at teardown so the boot sweep no longer spares it. Best-effort:
    a failure is logged, never raised (a dropped-close leaves a dying-pid entry the next sweep reaps
    anyway). A no-op when the id is absent."""
    if not container_id:
        return
    try:
        with _LOCK:
            entries = _read_registry()
            kept = [e for e in entries if e.get("container_id") != container_id]
            if len(kept) != len(entries):
                _write_registry(kept)
    except Exception:
        logger.warning(
            "failed to deregister live container %s (continuing)", container_id, exc_info=True
        )


def spared_container_ids() -> frozenset[str]:
    """The container ids the boot sweep must SPARE: every registered container whose owning pid is
    still alive. The sweep passes this as ``reap_agent_containers(keep_ids=...)``. Dead-pid and
    unregistered containers are absent ⇒ reaped (the P1.3a orphan backstop, intact). Tolerant: any
    read error ⇒ spare nothing (warn) — a bad registry degrades to today's reap-everything, never
    to a boot failure."""
    try:
        with _LOCK:
            entries = _read_registry()
        return frozenset(
            e["container_id"] for e in entries if e.get("container_id") and _pid_alive(e.get("pid"))
        )
    except Exception:
        logger.warning("failed to read live-container registry; sparing nothing", exc_info=True)
        return frozenset()
