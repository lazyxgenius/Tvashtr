"""The orphaned agent-workspace reaper (M-wsgc) — disk hygiene for EVERY run.

``make_local_workspace`` creates ``.tvashtr_workspaces/<run_id>`` for every run that reaches an
agent step, and until this module NOTHING ever removed it. That is the registered PROJECTPLAN §15
"agent workspace lifecycle / GC" item, and it is the *broader* sibling of the hosted-clone leak
``clone_reaper`` closed: a clone leaks only on hosted-GitHub runs, but a workspace leaks on
**every** run — greenfield (the throwaway build tree) and brownfield (the ``git worktree`` of the
user's real repo) alike. This module is deliberately the same shape as ``clone_reaper``, and the two
should be read together.

**THE REAP DECISION IS READ FROM THE ``runs`` TABLE** — but on TWO axes, not one, and that second
axis is where this module deliberately DIVERGES from ``clone_reaper``. Read them together, but do
not assume the rule is the same; it is strictly narrower here, on purpose.

A clone is a COPY of something the user already has (their GitHub repo), so reclaiming it can only
ever cost disk. A GREENFIELD workspace was the opposite: ``idempotent_ship`` makes the run's commit
and tag INSIDE that directory's own git repo and there is no remote, so the directory *was* the
run's one and only artifact — and ``run_diff._greenfield_files`` served the run view's "Changes" tab
straight out of it. **Reaping such a workspace would not reclaim disk, it would destroy the
deliverable.** So the rule spared greenfield FOREVER, and the unbounded-growth item stayed half
closed.

PERSIST-THEN-REAP (M-wsgc S1, migration ``0031``) removes the premise rather than the caution.
``ship_step`` now snapshots a greenfield run's whole diff into ``run_artifacts`` while the workspace
still exists, and ``GET /api/runs/{id}/diff`` serves that stored snapshot once the directory is
gone. A greenfield workspace whose artifact is persisted is therefore a redundant COPY of something
durable — exactly the position a brownfield worktree has always been in. "Spared forever" becomes
"spared until its artifact is persisted":

- **SPARE** a workspace whose Run is ``pending`` / ``running`` / ``awaiting_human``, whatever its
  type. ``make_local_workspace`` is ``mkdir(exist_ok=True)`` and ``add_worktree`` short-circuits on
  *``.git`` already present*, so a run whose workspace we deleted would resume onto an EMPTY
  directory — every file the agent had already produced silently gone, and, for a brownfield run,
  its worktree registration dangling. Deleting a live run's workspace does not save disk, it
  destroys a resumable run. Liveness OUTRANKS persistence: a mid-run snapshot says nothing about
  the files the agent is still producing.
- **SPARE** a GREENFIELD workspace (``runs.repo_path IS NULL``) that has **NO** ``run_artifacts``
  row. Its diff is not durable anywhere else yet, so the directory is still the deliverable. This
  is the axis ``clone_reaper`` has no analogue for.
- **REAP** iff the Run row is ABSENT (``delete_library_team_and_runs`` removes run rows and has
  never touched the disk, so a deleted team leaves its whole workspace tree behind), **or** the Run
  is terminal AND either BROWNFIELD/hosted (``repo_path`` non-NULL) or a GREENFIELD run whose
  artifact IS persisted. A brownfield workspace is a ``git worktree`` CHECKOUT of the user's real
  repo; the deliverable is the ``tvashtr/<run_id>`` BRANCH, which lives in that real repo's object
  store and is untouched here. Removing the checkout leaves only a stale admin entry
  (``.git/worktrees/<name>``) that ``git worktree prune`` clears — and which the live brownfield
  scripts already clear themselves with ``git worktree remove --force`` +
  ``shutil.rmtree(..., ignore_errors=True)``.

**THE HARD INVARIANT: a greenfield workspace is NEVER reaped before its diff is durably saved in the
database.** Structural, not careful: reaping requires a row to EXIST, so every way the persist can
fail to happen — a run that never shipped, an empty snapshot, a write that errored — leaves no row
and leaves the directory spared, i.e. exactly the pre-milestone behaviour. Absence is the safe
state, which is also why the residual leak is the harmless direction: a FAILED greenfield run never
ships, so it never persists, so it is kept forever (a registered §15 rider, not a bug to widen the
reap over).

Deliberately an allow-list of things to SPARE rather than a deny-list of things to reap — a status
or a run type added later defaults to "spare it", erring toward keeping a directory instead of
destroying someone's work.

**THE NEVER-TOUCH RULE:** nothing outside :data:`WORKSPACE_ROOT` is reachable from this module. Two
structural fences, not path arithmetic:

1. :func:`_workspace_path` builds a candidate ONLY from a string that parses as a UUID. A
   ``uuid.UUID`` round-trip cannot contain ``/`` or ``..``, so a malformed run id cannot escape the
   root — it returns ``None`` and nothing is deleted.
2. The sweep enumerates with ``os.scandir(WORKSPACE_ROOT)`` and takes only entries that are
   directories with ``follow_symlinks=False``, so a symlink planted under the root is skipped rather
   than followed out of the fence. The sweep also refuses to run at all if the root is itself a
   symlink.

Everything here is **``openhands``-free** (``main.py`` imports it at module scope, and startup must
never pull the agent SDK) and **never raises** (a boot sweep that threw would take down the whole
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
from tvashtr.models import Run, RunArtifact

logger = logging.getLogger("tvashtr.control_plane.workspace_reaper")

# The per-run agent workspace root, resolved EXACTLY as ``openhands_adapter._WORKSPACE_ROOT`` does
# (its ``parents[2]`` and this module's ``parents[2]`` are both ``backend/``). REPLICATED, not
# imported, for the same reason ``run_diff`` replicates it: the canonical definition lives in the
# openhands adapter, and importing from there would drag the agent SDK into app startup, breaking
# the openhands-free-at-import invariant (CLI-RULES §3.1) that ``main.py`` depends on.
#
# Three things pin the replicas together so this can never silently drift into sweeping a root
# nothing writes to (a reaper that reclaims nothing forever passes every behavioural test):
#   * ``test_the_reaper_sweeps_the_root_the_greenfield_diff_reads`` equates this with
#     ``run_diff._WORKSPACE_ROOT`` — the other openhands-free replica;
#   * ``make workspace-gc-check`` seeds its fixtures through the EXECUTOR's own
#     ``make_local_workspace`` and asserts the parent is this root — the live, third replica;
#   * ``workspace_dir_for_run`` below is the single place the per-run path is spelled.
WORKSPACE_ROOT = Path(__file__).resolve().parents[2] / ".tvashtr_workspaces"

# A run in one of these states owns its workspace and MUST be spared. Shared by BOTH reclaim paths
# so they can never disagree about what "live" means.
LIVE_STATUSES = frozenset({"pending", "running", "awaiting_human"})


def workspace_dir_for_run(run_id: str) -> str:
    """The deterministic per-run workspace directory. The one place the path is spelled."""
    return str(WORKSPACE_ROOT / run_id)


def _workspace_path(run_id: str) -> Path | None:
    """FENCE 1 — a candidate path, or ``None`` if ``run_id`` is not UUID-shaped.

    Every real run id is a UUID (``DBOS.workflow_id`` is ``str(Run.id)``). Refusing anything else
    means a caller cannot pass ``../../etc`` and reach outside :data:`WORKSPACE_ROOT`: a string that
    survives ``uuid.UUID()`` cannot contain a path separator."""
    try:
        uuid.UUID(str(run_id))
    except (ValueError, AttributeError, TypeError):
        return None
    return WORKSPACE_ROOT / str(run_id)


def _spared_run_ids(candidate_ids: list[str]) -> set[str]:
    """Which of these run ids must KEEP their workspace, per the database?

    THE ONE RULE, in one place, so the two reclaim paths can never disagree. A run is spared if:

    * it is **LIVE** (a resume needs the directory), whatever its type; **or**
    * it is **GREENFIELD** (``repo_path IS NULL``) **and has NO** ``run_artifacts`` **row** — its
      shipped diff is not yet durable anywhere else, so the directory is still the deliverable.

    The second arm used to read simply "greenfield", i.e. spared forever. ``ship_step`` now
    snapshots a greenfield run's diff into ``run_artifacts`` while the workspace still exists, and
    ``GET /api/runs/{id}/diff`` serves that snapshot once the directory is gone — so a PERSISTED
    greenfield workspace is a redundant copy of something durable, exactly the position a brownfield
    worktree has always been in, and it is finally reclaimable.

    **THE HARD INVARIANT: a greenfield workspace is never reaped before its diff is durably saved.**
    It holds structurally here, not by care: the reap needs a row to EXIST, so every way the persist
    can fail to happen — a run that never shipped, a snapshot that came back empty, a write that
    errored — leaves no row and therefore leaves the workspace spared, which is precisely the
    pre-milestone behaviour. Absence is the safe state.

    Ids that do not parse as UUIDs, and ids with no Run row at all, are simply never in the returned
    set: they cannot match a row, so they read as ABSENT and therefore reapable. That is the correct
    answer for a stray directory named after something that was never a real run.

    NOTE the asymmetry this creates for the two callers, which is deliberate: for the SWEEP, "not
    spared" means reap (an absent row is an orphan). For the RUN-END delete, absence is treated as
    "do not touch" — see :func:`delete_run_workspace`."""
    parsed: dict[uuid.UUID, str] = {}
    for rid in candidate_ids:
        try:
            parsed[uuid.UUID(rid)] = rid
        except (ValueError, AttributeError, TypeError):
            continue
    if not parsed:
        return set()
    ids = list(parsed.keys())
    with session_scope() as session:
        rows = session.execute(
            select(Run.id, Run.status, Run.repo_path).where(Run.id.in_(ids))
        ).all()
        # Which candidates already have a durable diff snapshot. A separate SELECT rather than an
        # outer join so the spare rule above reads as the sentence it is, and so a run type that
        # never persists (brownfield) costs nothing to evaluate.
        persisted = set(
            session.execute(select(RunArtifact.run_id).where(RunArtifact.run_id.in_(ids))).scalars()
        )
    return {
        parsed[row_id]
        for row_id, status, repo_path in rows
        if status in LIVE_STATUSES or (repo_path is None and row_id not in persisted)
    }


def _rmtree(path: Path) -> bool:
    """Delete one workspace directory. Returns whether it is gone. **NEVER RAISES** — a directory we
    cannot remove (permissions, a race with another sweep) is logged and skipped so it can never
    abort the caller."""
    try:
        shutil.rmtree(path)
        return True
    except FileNotFoundError:
        return False  # already gone — a concurrent sweep or a prior run-end delete won the race
    except Exception:  # noqa: BLE001 — one stubborn directory must not abort the caller
        logger.warning("workspace reaper: failed to remove %s", path, exc_info=True)
        return False


def delete_run_workspace(run_id: str) -> bool:
    """RECLAIM PATH 1 — delete THIS run's workspace at run end. Returns whether a directory was
    removed.

    Gated on the same :func:`_spared_run_ids` rule as the sweep. Two independent reasons a run is
    spared, both subtle enough to state plainly:

    * **UN-PERSISTED GREENFIELD** (``repo_path IS NULL`` with no ``run_artifacts`` row) is never
      reclaimed, at any status. That directory holds the run's shipped commit + tag and there is no
      remote — deleting it before the snapshot is durable destroys the artifact the run exists to
      produce, and empties the run view's "Changes" tab for good. Once ``ship_step`` HAS persisted
      the diff, the same directory is reclaimable: the tab is then served from the database.
    * **LIVE** is never reclaimed. ``_run_end_teardown`` rides a ``finally``, and a ``finally`` also
      fires on paths where the run is *not* finished — a step raising mid-walk unwinds through it
      while the row still reads ``running``, and DBOS may then RECOVER that workflow. Because
      ``make_local_workspace`` is ``mkdir(exist_ok=True)`` and ``add_worktree`` short-circuits on
      *``.git`` already present*, a resumed run whose workspace we deleted would not rebuild it; it
      would resume onto an empty directory, having silently lost everything the agent produced.

    A run with no workspace (one that failed before its first agent step) is a clean no-op. So is a
    run whose row has VANISHED: unlike the sweep, absence is treated here as "do not touch" rather
    than "orphan", because at run-end we are holding a specific run's id and a missing row means we
    cannot tell whether that directory was a disposable worktree or somebody's deliverable. A
    genuine orphan is still reclaimed — by the sweep, which reasons over the whole root at once.

    **NEVER RAISES.**"""
    try:
        path = _workspace_path(run_id)
        if path is None:
            logger.warning("workspace reaper: refusing to delete non-UUID run id %r", run_id)
            return False
        if not path.is_dir():
            return False  # never reached an agent step / already reclaimed — the no-op path
        with session_scope() as session:
            exists = session.execute(
                select(Run.id).where(Run.id == uuid.UUID(str(run_id)))
            ).scalar_one_or_none()
        if exists is None:
            return False  # row gone: unknown type ⇒ leave it for the sweep to reason about
        if _spared_run_ids([str(run_id)]):
            return False  # live (a resume needs it) or greenfield (it IS the deliverable)
        removed = _rmtree(path)
        if removed:
            logger.info("workspace reaper: reclaimed workspace for run %s", run_id)
        return removed
    except Exception:  # noqa: BLE001 — run-end teardown must never mask the run's real terminal
        logger.warning("workspace reaper: run-end delete failed run_id=%s", run_id, exc_info=True)
        return False


def sweep_orphaned_workspaces() -> int:
    """RECLAIM PATH 2 — reconcile ``.tvashtr_workspaces/*`` against ``runs`` and delete the orphans.
    Returns how many were reaped.

    This is the backstop for everything the run-end delete cannot cover: a ``kill -9`` mid-run, a
    crash between the agent step and the teardown, a run row deleted out from under its directory by
    a team deletion. The process that knew about the workspace is precisely the thing that died, so
    only a reconcile against the database can find them. It is also the ONLY path that reclaims the
    backlog already on disk when this milestone lands.

    Applies the SAME :func:`_spared_run_ids` rule as the run-end delete — which is exactly why the
    greenfield spare lives in that shared rule and not at the teardown call site. Gating only the
    run-end path would merely DELAY an un-persisted greenfield deliverable's destruction until the
    next boot sweep. It cuts the other way too: because the persist gate lives in the shared rule,
    this sweep is what finally reclaims the greenfield workspaces of runs that shipped and then
    CRASHED before their teardown — the backlog the run-end delete can never reach.

    **NEVER RAISES.** Called from FastAPI startup (before DBOS recovery) and from a scheduled
    workflow; in both places an exception would be far worse than a missed sweep. Missing root,
    database not ready, an unreadable directory — all log and return 0."""
    reaped = 0
    try:
        if WORKSPACE_ROOT.is_symlink() or not WORKSPACE_ROOT.is_dir():
            return 0
        # THE FENCE: only DIRECT, NON-SYMLINK children of the root are ever candidates. Nothing
        # downstream can name a path this scan did not produce.
        with os.scandir(WORKSPACE_ROOT) as entries:
            ours = [e.name for e in entries if e.is_dir(follow_symlinks=False)]
        if not ours:
            return 0
        spared = _spared_run_ids(ours)
        for name in ours:
            if name in spared:
                continue
            if _rmtree(WORKSPACE_ROOT / name):
                reaped += 1
                logger.warning("workspace reaper: reaped orphaned workspace %s", name)
        if reaped:
            logger.warning(
                "workspace reaper: reaped %d orphaned workspace(s) of %d", reaped, len(ours)
            )
    except Exception:  # noqa: BLE001 — a sweep must never take down startup or error a workflow
        logger.warning("workspace reaper: sweep failed; continuing", exc_info=True)
    return reaped


def _periodic_workspace_sweep(scheduled_time: datetime, actual_time: datetime) -> None:
    """The scheduled sweeper's body. DBOS hands every scheduled workflow
    ``(scheduled_time, actual_time)``; neither is used — the sweep's inputs are the disk and the
    database, not the clock."""
    sweep_orphaned_workspaces()


# ---------------------------------------------------------------------------------------------
# REGISTRATION IS GATED ON FLY MODE — and the gate is on the DECORATOR, not just the body.
#
# Identical in kind to ``clone_reaper``'s / ``fly_reaper``'s gate, and load-bearing for the same
# reason: ``DBOS.scheduled`` registers a POLLER at import time, and ``DBOS.launch()`` then starts it
# as a daemon thread — which ``make test`` does, via conftest's session-scoped ``with
# TestClient(app)``. Registering unconditionally would arm a real 10-minute cron inside the offline
# suite: any session that spanned a ``*/10`` boundary would enqueue a genuine workflow row into the
# shared system database, at random depending on wall-clock start time, and a wedged PENDING sweeper
# would then be RECOVERED by the next session's launch — the stale-PENDING wedge that has bitten
# this repo before. Gating only the body would not help: the poller thread and the workflow row
# happen regardless.
#
# Fly mode is the right gate rather than "wherever workspaces exist" because the PERIODIC sweep only
# earns its keep on the long-lived hosted deployment. A docker/local box is not left uncovered: the
# run-end delete and the boot sweep both run in EVERY mode, and a dev box restarts constantly, which
# is exactly when the boot sweep fires.
# ---------------------------------------------------------------------------------------------
if get_settings().agent_sandbox_mode == "fly":
    periodic_workspace_sweep = DBOS.scheduled("*/10 * * * *")(
        DBOS.workflow()(_periodic_workspace_sweep)
    )
