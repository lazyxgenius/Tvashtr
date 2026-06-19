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
ours). Consequence: reaping is all-or-nothing across runs — fine while runs are
serial; per-run isolation is a named upgrade if concurrency ever lands.
"""

import logging
import os
import subprocess

from tvashtr.config import get_settings

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


def reap_agent_containers(image: str | None = None) -> list[str]:
    """Force-remove every agent-server container from ``image``. Idempotent (a
    no-op when none exist; ``docker rm -f`` is safe to repeat) and **exception-safe**
    — it never raises on a missing / slow / wedged docker (both the listing *and*
    the per-container ``rm`` loop are guarded), so the adapter can call it before
    starting a container without risking a crash. Returns the ids actually removed.
    """
    image = image or agent_server_image()
    reaped: list[str] = []
    try:
        for cid in list_agent_containers(image):
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
    """Boot-time sweep (DQ2): remove **all** agent-server containers before DBOS
    recovers any PENDING run. For the single-operator v1 any such container at boot
    is an orphan from a crashed run — clearing it frees the host port and lets a
    resumed ``engineer_run_step`` start a fresh container. No-op (warn only) if
    docker is unavailable, so a local-mode / docker-less host still boots cleanly.
    """
    try:
        reaped = reap_agent_containers()
        logger.info("agent-server boot sweep complete (reaped=%d)", len(reaped))
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
