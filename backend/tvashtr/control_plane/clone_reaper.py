"""The orphaned hosted-GitHub clone reaper (M-clonegc) — disk hygiene for hosted runs.

``clone_github_repo_step`` clones a hosted-GitHub run's repo into ``.tvashtr_clones/<run_id>`` and
sets it as the run's ``repo_path``. Until this module, NOTHING ever removed it: every hosted run
leaked a full working copy of the user's repo onto the backend's disk, forever. This is the M-h2b
Fly reaper's problem one substrate down — Fly leaked *money*, a clone leaks *disk* — so this is
deliberately the same shape, and the two modules should be read together.

**LIVENESS IS READ FROM THE ``runs`` TABLE**, exactly as in ``fly_reaper``. On disk we could in
principle ask the filesystem, but the filesystem cannot tell us whether anyone is still coming back
for a directory. Only the database knows:

- **KEEP** a clone whose Run is ``pending`` / ``running`` / ``awaiting_human``. This is the
  load-bearing case and it is the reason the run-end delete is status-gated too, not unconditional:
  ``clone_github_repo_step`` is idempotent by way of *``repo_path`` is already set ⇒ return*, so a
  run whose ``repo_path`` points at a directory we deleted would resume onto NOTHING. Deleting a
  live run's clone does not save disk, it destroys a resumable run.
- **REAP** iff the Run is terminal (``completed``/``failed``/``rejected``/``cancelled``/
  ``over_budget``) or the Run row is ABSENT (a deleted run, or a directory that never had one).

Deliberately an allow-list of LIVE states rather than a deny-list of terminal ones — a status added
later defaults to "spare it", erring toward keeping a directory instead of destroying a live run's
workspace.

**THE NEVER-TOUCH RULE:** nothing outside ``CLONE_ROOT`` is reachable from this module. Two
structural fences, not path arithmetic:

1. ``_clone_path`` builds a candidate ONLY from a string that parses as a UUID. A ``uuid.UUID``
   round-trip cannot contain ``/`` or ``..``, so a malformed run id cannot escape the root — it
   returns ``None`` and nothing is deleted.
2. The sweep enumerates with ``os.scandir(CLONE_ROOT)`` and takes only entries that are directories
   with ``follow_symlinks=False``, so a symlink planted under the root is skipped rather than
   followed out of the fence. The sweep also refuses to run at all if ``CLONE_ROOT`` is itself a
   symlink.

Everything here is **``openhands``-free** (``main.py`` imports it at module scope, and startup must
never pull the agent SDK) and **never raises** (a boot sweep that throws would take down the whole
backend over disk hygiene, and the run-end delete rides a ``finally`` where an exception would mask
the run's real terminal).
"""

from __future__ import annotations

import logging
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from dbos import DBOS
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.models import Run

logger = logging.getLogger("tvashtr.control_plane.clone_reaper")

# M-h1b — a hosted-GitHub clone lands in a deterministic per-run dir (so a resume is idempotent),
# under the same gitignored convention as the workspace root. It becomes the run's ``repo_path``.
# Defined HERE, not in ``team_run``, so this module owns the directory's whole lifecycle and
# ``team_run`` can import it without an import cycle (``team_run`` -> ``clone_reaper``, one way).
CLONE_ROOT = Path(__file__).resolve().parents[2] / ".tvashtr_clones"

# A run in one of these states owns its clone and MUST be spared. Everything else — and every
# absent row — is an orphan. Shared by BOTH reclaim paths so they can never disagree about what
# "live" means.
LIVE_STATUSES = frozenset({"pending", "running", "awaiting_human"})


def clone_dir_for_run(run_id: str) -> str:
    """The deterministic per-run clone directory. The one place the path is spelled."""
    return str(CLONE_ROOT / run_id)


def _clone_path(run_id: str) -> Path | None:
    """FENCE 1 — a candidate path, or ``None`` if ``run_id`` is not UUID-shaped.

    Every real run id is a UUID (``DBOS.workflow_id`` is ``str(Run.id)``). Refusing anything else
    means a caller cannot pass ``../../etc`` and reach outside ``CLONE_ROOT``: a string that
    survives ``uuid.UUID()`` cannot contain a path separator."""
    try:
        uuid.UUID(str(run_id))
    except (ValueError, AttributeError, TypeError):
        return None
    return CLONE_ROOT / str(run_id)


def _live_run_ids(candidate_ids: list[str]) -> set[str]:
    """Which of these run ids are still alive, per the database?

    Ids that do not parse as UUIDs are simply never in the returned set — they cannot match a Run
    row, so they read as ABSENT and therefore reapable. That is the correct answer for a stray
    directory named after something that was never a real run."""
    parsed: dict[uuid.UUID, str] = {}
    for rid in candidate_ids:
        try:
            parsed[uuid.UUID(rid)] = rid
        except (ValueError, AttributeError, TypeError):
            continue
    if not parsed:
        return set()
    with session_scope() as session:
        rows = session.execute(
            select(Run.id, Run.status).where(Run.id.in_(list(parsed.keys())))
        ).all()
    return {parsed[row_id] for row_id, status in rows if status in LIVE_STATUSES}


def _rmtree(path: Path) -> bool:
    """Delete one clone directory. Returns whether it is gone. **NEVER RAISES** — a directory we
    cannot remove (permissions, a race with another sweep) is logged and skipped so it can never
    abort the caller."""
    try:
        shutil.rmtree(path)
        return True
    except FileNotFoundError:
        return False  # already gone — a concurrent sweep or a prior run-end delete won the race
    except Exception:  # noqa: BLE001 — one stubborn directory must not abort the caller
        logger.warning("clone reaper: failed to remove %s", path, exc_info=True)
        return False


def delete_run_clone(run_id: str) -> bool:
    """RECLAIM PATH 1 — delete THIS run's clone at run end. Returns whether a directory was removed.

    Status-gated on the same :data:`LIVE_STATUSES` allow-list as the sweep, which is the subtle part
    and worth stating plainly: ``_run_end_teardown`` rides a ``finally``, and a ``finally`` also
    fires on paths where the run is *not* finished — a step raising mid-walk unwinds through it
    while the row still reads ``running``, and DBOS may then RECOVER that workflow. Because
    ``clone_github_repo_step`` short-circuits on *``repo_path`` already set*, a resumed run whose
    clone we deleted would never re-clone; it would resume onto a missing directory. So a live run's
    clone is spared here for exactly the reason the sweep spares it.

    A run with no clone (self-hosted brownfield, greenfield, or a hosted run that failed before the
    clone step) is a clean no-op — nothing on those paths changes.

    **NEVER RAISES.**"""
    try:
        path = _clone_path(run_id)
        if path is None:
            logger.warning("clone reaper: refusing to delete non-UUID run id %r", run_id)
            return False
        if not path.is_dir():
            return False  # greenfield / self-hosted / already reclaimed — the no-op path
        if _live_run_ids([str(run_id)]):
            return False  # still live: a resume needs this directory
        removed = _rmtree(path)
        if removed:
            logger.info("clone reaper: reclaimed clone for run %s", run_id)
        return removed
    except Exception:  # noqa: BLE001 — run-end teardown must never mask the run's real terminal
        logger.warning("clone reaper: run-end delete failed run_id=%s", run_id, exc_info=True)
        return False


def sweep_orphaned_clones() -> int:
    """RECLAIM PATH 2 — reconcile ``.tvashtr_clones/*`` against ``runs`` and delete the orphans.
    Returns how many were reaped.

    This is the backstop for everything the run-end delete cannot cover: a ``kill -9`` mid-run, a
    crash between the clone and the teardown, a run row deleted out from under its directory. The
    process that knew about the clone is precisely the thing that died, so only a reconcile against
    the database can find them.

    **NEVER RAISES.** Called from FastAPI startup (before DBOS recovery) and from a scheduled
    workflow; in both places an exception would be far worse than a missed sweep. Missing root,
    database not ready, an unreadable directory — all log and return 0."""
    reaped = 0
    try:
        if CLONE_ROOT.is_symlink() or not CLONE_ROOT.is_dir():
            return 0
        # THE FENCE: only DIRECT, NON-SYMLINK children of the root are ever candidates. Nothing
        # downstream can name a path this scan did not produce.
        with os.scandir(CLONE_ROOT) as entries:
            ours = [e.name for e in entries if e.is_dir(follow_symlinks=False)]
        if not ours:
            return 0
        live = _live_run_ids(ours)
        for name in ours:
            if name in live:
                continue
            if _rmtree(CLONE_ROOT / name):
                reaped += 1
                logger.warning("clone reaper: reaped orphaned clone %s", name)
        if reaped:
            logger.warning("clone reaper: reaped %d orphaned clone(s) of %d", reaped, len(ours))
    except Exception:  # noqa: BLE001 — a sweep must never take down startup or error a workflow
        logger.warning("clone reaper: sweep failed; continuing", exc_info=True)
    return reaped


def _periodic_clone_sweep(scheduled_time: datetime, actual_time: datetime) -> None:
    """The scheduled sweeper's body. DBOS hands every scheduled workflow
    ``(scheduled_time, actual_time)``; neither is used — the sweep's inputs are the disk and the
    database, not the clock."""
    sweep_orphaned_clones()


# ---------------------------------------------------------------------------------------------
# REGISTRATION IS GATED ON FLY MODE — and the gate is on the DECORATOR, not just the body.
#
# Identical in kind to ``fly_reaper``'s gate, and load-bearing for the same reason:
# ``DBOS.scheduled`` registers a POLLER at import time, and ``DBOS.launch()`` then starts it as a
# daemon thread — which ``make test`` does, via conftest's session-scoped ``with TestClient(app)``.
# Registering unconditionally would arm a real 10-minute cron inside the offline suite: any session
# that spanned a ``*/10`` boundary would enqueue a genuine workflow row into the shared system
# database, at random depending on wall-clock start time, and a wedged PENDING sweeper would then
# be RECOVERED by the
# next session's launch — the stale-PENDING wedge that has bitten this repo before. Gating only the
# body would not help: the poller thread and the workflow row happen regardless.
#
# Fly mode is the right gate rather than "wherever clones exist" because the PERIODIC sweep only
# earns its keep on the long-lived hosted deployment. A docker/local box is not left uncovered: the
# run-end delete and the boot sweep both run in EVERY mode, and a dev box restarts constantly, which
# is exactly when the boot sweep fires.
# ---------------------------------------------------------------------------------------------
if get_settings().agent_sandbox_mode == "fly":
    periodic_clone_sweep = DBOS.scheduled("*/10 * * * *")(DBOS.workflow()(_periodic_clone_sweep))
