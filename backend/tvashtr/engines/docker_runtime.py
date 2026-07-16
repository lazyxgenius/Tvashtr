"""Orphan-reaping for the OpenHands agent-server Docker containers (P1.3a, DQ2).

A crashed run (``kill -9``) kills the Python client, not the container, so the
``DockerWorkspace.__exit__`` teardown is skipped and the agent-server container is
**orphaned** — still running, still holding its host port. This module force-removes
such orphans via the ``docker`` **CLI** (``subprocess``), mirroring
``control_plane/shipping.py``'s subprocess-to-``git`` pattern.

Boundary discipline: this module is **control-plane-clean** — it imports only the
stdlib (``subprocess``) + ``tvashtr.config`` and **never** imports ``openhands.*``,
so it is safe to call from app startup (the boot sweep) without breaking the
``openhands``-free-startup invariant. (Note: ``openhands-workspace`` pulls in the
``docker`` *Python* lib transitively, but we deliberately do **not** use it here —
the CLI keeps this module dependency-light and matches the brief.)

**Targeting = by image (``ancestor=``), not per-run.** The installed
``DockerWorkspace`` (1.28.1) names its container ``agent-server-<random-uuid>`` and
exposes no custom-name / label hook, so a deterministic per-run identifier is not
available. Per the brief (DQ2) we fall back to reaping by the agent-server image,
which is safe for the single-operator v1 (the only containers from that image are
ours). Consequence: the CLI SELECTS by image (every container of that image, across
runs), but the boot sweep is no longer all-or-nothing — it spares any container a
LIVE run registered (per-run isolation landed in ``de2f515``; see
``sweep_orphaned_agent_containers`` + the host-global ``sandbox_cache`` registry).
"""

import logging
import os
import subprocess

from tvashtr.config import get_settings
from tvashtr.engines import sandbox_cache

logger = logging.getLogger("tvashtr.engines.docker_runtime")

# Bound every docker CLI call so a wedged daemon can't hang a run or app startup.
_DOCKER_TIMEOUT_S = 30


def _docker(*args: str) -> subprocess.CompletedProcess:
    """Run a ``docker`` CLI command, capturing output. Never raises on a non-zero
    exit (callers inspect ``returncode``); the caller handles a missing daemon."""
    return subprocess.run(
        ["docker", *args],
        check=False,
        capture_output=True,
        text=True,
        timeout=_DOCKER_TIMEOUT_S,
    )


def agent_server_image() -> str:
    """The configured agent-server image reaping targets (``ancestor=`` filter)."""
    return get_settings().agent_server_image


def list_agent_containers(image: str | None = None) -> list[str]:
    """Return the ids of all containers (running or stopped) descended from the
    agent-server ``image``. Returns ``[]`` (and warns) if docker is unavailable."""
    image = image or agent_server_image()
    proc = _docker("ps", "-aq", "--filter", f"ancestor={image}")
    if proc.returncode != 0:
        logger.warning("docker ps failed (daemon unavailable?): %s", proc.stderr.strip())
        return []
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def reap_agent_containers(
    image: str | None = None, keep_ids: frozenset[str] = frozenset()
) -> list[str]:
    """Force-remove every agent-server container from ``image``. Idempotent (a
    no-op when none exist; ``docker rm -f`` is safe to repeat) and **exception-safe**
    — it never raises on a missing / slow / wedged docker (both the listing *and*
    the per-container ``rm`` loop are guarded), so the adapter can call it before
    starting a container without risking a crash. Returns the ids actually removed.

    ``keep_ids`` is a set of container ids to SPARE. Two callers pass two different spare-sets:
    reap-before-start (M-unify U2) passes the process-level warm sandboxes
    (``sandbox_cache.live_container_ids()``) so a HIT's warm container is never killed between
    rounds; the boot sweep passes ``sandbox_cache.spared_container_ids()`` (the host-global
    registry's LIVE-pid-owned set, M-reaper) so it spares any container a live run owns and reaps
    only genuine orphans — the crash backstop, intact. Ids are normalized to their 12-char short
    form before comparison because ``docker ps -aq`` yields short ids while the cache holds the
    full 64-char id.
    """
    image = image or agent_server_image()
    keep_short = {k[:12] for k in keep_ids}
    reaped: list[str] = []
    try:
        for cid in list_agent_containers(image):
            if cid[:12] in keep_short:
                continue  # spared: this id is in keep_ids (both callers pass a real spare-set now)
            rm = _docker("rm", "-f", cid)
            if rm.returncode == 0:
                reaped.append(cid)
            else:
                logger.warning("docker rm -f %s failed: %s", cid, rm.stderr.strip())
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        logger.warning("docker unavailable; reap aborted (reaped %d so far): %s", len(reaped), exc)
        return reaped
    if reaped:
        logger.warning(
            "reaped %d orphaned agent-server container(s) (image=%s): %s",
            len(reaped),
            image,
            reaped,
        )
    return reaped


def sweep_orphaned_agent_containers() -> None:
    """Boot-time sweep (DQ2, M-reaper): remove orphaned agent-server containers before DBOS recovers
    any PENDING run — clearing a crashed run's container frees its host port so a resumed
    ``engineer_run_step`` starts fresh.

    **Per-run spare (M-reaper):** the sweep runs on EVERY boot in the default ``docker`` mode —
    including the FastAPI lifespan that ``make test`` triggers (``with TestClient(app)``). It must
    therefore NOT destroy a container owned by a LIVE run in another process. So it consults the
    host-side live-container registry and spares (``keep_ids``) every container whose owning pid is
    still alive; a container with NO entry or a DEAD-pid entry is a genuine orphan and is reaped —
    the P1.3a crash backstop, unchanged. Reading the registry is best-effort (a bad file spares
    nothing → reap-everything, today's behavior); the whole sweep is exception-guarded so it can
    never block app startup. No-op (warn only) if docker is unavailable.
    """
    try:
        keep_ids = sandbox_cache.spared_container_ids()
        reaped = reap_agent_containers(keep_ids=keep_ids)
        logger.info(
            "agent-server boot sweep complete (spared=%d live-owned, reaped=%d)",
            len(keep_ids),
            len(reaped),
        )
    except Exception:  # never let the sweep block app startup
        logger.warning("agent-server boot sweep failed; continuing", exc_info=True)


# --- P1.5c: docker-mode loop seeding (the host-side enumeration for the push) ------------

# Mirrors the docker adapter's ``_SERVER_SCAFFOLDING_DIRS`` (kept as a small local copy
# to avoid a circular import — the adapter imports THIS module, not vice-versa). Defensive:
# the pull already keeps these top-level server stores off the host, so in practice the host
# never contains them; excluding them on the push too preserves exact pull/push symmetry.
_PUSH_SCAFFOLDING_DIRS = frozenset({"bash_events", "conversations"})


def enumerate_push_files(host_dir: str) -> list[str]:
    """Relative paths of the host workspace's non-hidden DELIVERABLE files — what the
    docker adapter seeds into a fresh iteration container (P1.5c). The host-side
    (``os.walk``) mirror of the pull's container-side ``find . -type f -not -path
    '*/.*'``: skip any path with a hidden segment (``.git`` / dotfiles, at any depth)
    AND any file under a TOP-LEVEL server-scaffolding dir (matches the pull's top-level
    exclusion). Sorted + deterministic. ``openhands``-free, so it is unit-tested here."""
    root = host_dir.rstrip("/")
    rels: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        # At the workspace root only, drop the server-scaffolding top-level dirs
        # (mirrors the pull's top-level-only exclusion).
        if dirpath == root:
            dirnames[:] = [d for d in dirnames if d not in _PUSH_SCAFFOLDING_DIRS]
        # Everywhere, drop hidden dirs so os.walk never descends into them (the '*/.*' rule).
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if name.startswith("."):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), root)
            rels.append(rel)
    return sorted(rels)


def enumerate_push_files_git(host_dir: str) -> list[str]:
    """BROWNFIELD seed enumeration (M-brownfield Slice 1): the relative paths the docker adapter
    seeds into a fresh iteration container for a real-repo worktree. Unlike the greenfield
    :func:`enumerate_push_files` (non-hidden deliverable files only), this is **git-aware** —
    ``git -C host_dir ls-files -c -o --exclude-standard``: the repo's TRACKED files (``-c``,
    including tracked dotfiles like ``.github/`` / ``.eslintrc`` a real repo needs) PLUS the agent's
    UNTRACKED-not-ignored files (``-o --exclude-standard``, honoring the repo's own ``.gitignore``),
    and never ``.git`` itself. So a real repo's config reaches the container while ignored junk does
    not. ``-z`` (NUL-delimited) is robust to paths with spaces/newlines (no octal-quoting).
    ``openhands``-free (subprocess only), so it is unit-tested here against a temp repo.

    The greenfield :func:`enumerate_push_files` is left UNTOUCHED — this is a separate, additive
    enumeration the adapter selects on ``task.workspace_mode``."""
    root = host_dir.rstrip("/")
    proc = subprocess.run(
        ["git", "-C", root, "ls-files", "-c", "-o", "--exclude-standard", "-z"],
        check=True,
        capture_output=True,
        text=True,
        timeout=_DOCKER_TIMEOUT_S,
    )
    rels = [r for r in proc.stdout.split("\0") if r]
    # ``-c -o`` lists a tracked file once + an untracked file once (disjoint), but dedup + sort for
    # a deterministic, collision-free push order.
    return sorted(set(rels))
