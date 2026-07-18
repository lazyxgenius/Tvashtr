"""The orphaned-``tv-run-*`` Fly app reaper (M-h2b Piece 2) — cost hygiene for hosted runs.

M-h2a guaranteed only that a run does not leak its OWN sandbox: teardown sits in a ``finally`` plus
the run-end ``close_run_sandboxes`` hook. Neither survives the process dying. A backend that is
``kill -9``'d mid-run, or a cancel that skipped teardown, leaves a ``tv-run-<run_id>`` app alive on
Fly — and a Fly app bills until something deletes it. Nothing in-process can fix that, because the
process that knew about it is precisely the thing that died.

**LIVENESS IS READ FROM THE ``runs`` TABLE, NOT FROM A HOST REGISTRY.** This is the one real design
decision here and it is forced by the substrate: the docker reaper can consult a host-side pid
registry because a container and its owner share a host, but Fly apps are cross-process AND
cross-host durable. The only thing that knows whether a run is still alive is the database. So the
sweep reconciles Fly's real app list against ``runs``:

- **KEEP** a ``tv-run-<id>`` app whose Run is ``pending`` / ``running`` / ``awaiting_human``.
  ``awaiting_human`` is the load-bearing one: that is a run legitimately parked (and SUSPENDED) at
  an
  approval gate, possibly overnight. Reaping it would destroy exactly the durability M-h2b exists to
  provide — the reaper and the suspend feature would silently cancel each other out.
- **REAP** iff the Run is terminal (``completed``/``failed``/``rejected``/``cancelled``/
  ``over_budget``) or the Run row is ABSENT (a deleted run, or an app that never had one).

**NO GRACE WINDOW IS NEEDED**, which is worth stating because "reaper deletes a machine that was
still booting" is the obvious way to get this wrong. The ordering rules it out: a Run row is created
BEFORE its workflow starts, and the app is created INSIDE the workflow. So there is no instant at
which a live app lacks a protecting non-terminal Run row.

**THE NEVER-TOUCH RULE:** any app whose name does not start with ``tv-run-`` is invisible to this
module. The org holds unrelated apps — ``cryptoground-data`` is the operator's — and deleting one
would be an unrecoverable, unbilled-for disaster. The prefix filter is asserted by name in the unit
tests and re-asserted against the real org in ``make fly-reaper-check``.

Everything here is **``openhands``-free** (``main.py`` imports it at module scope, and startup must
never pull the agent SDK) and **never raises** (a boot sweep that throws would take down the whole
backend over a cost optimization).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from dbos import DBOS
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.engines.fly_machines import FlyApiError, FlyMachines
from tvashtr.models import Run

logger = logging.getLogger("tvashtr.control_plane.fly_reaper")

APP_PREFIX = "tv-run-"

# A run in one of these states owns its sandbox and MUST be spared. Everything else — and every
# absent row — is an orphan. Deliberately an allow-list of LIVE states rather than a deny-list of
# terminal ones: a new status added later defaults to "spare it", which errs toward paying for a
# machine instead of destroying a live run's workspace.
LIVE_STATUSES = frozenset({"pending", "running", "awaiting_human"})


def _run_id_from_app(app_name: str) -> str:
    """``tv-run-<id>`` -> ``<id>``. Assumes the prefix has already been checked."""
    return app_name[len(APP_PREFIX) :]


def _live_run_ids(candidate_ids: list[str]) -> set[str]:
    """Which of these run ids are still alive, per the database?

    Ids that do not parse as UUIDs are simply never in the returned set — they cannot match a Run
    row, so they read as ABSENT and therefore reapable. That is the correct answer for a stray app
    named after something that was never a real run."""
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


def sweep_orphaned_fly_apps() -> int:
    """Reconcile Fly's ``tv-run-*`` apps against ``runs`` and delete the orphans. Returns how many
    were reaped.

    **NEVER RAISES.** Called from FastAPI startup (before DBOS recovery) and from a scheduled
    workflow; in both places an exception would be far worse than a missed sweep. Fly API down, no
    token, database not ready yet — all log and return 0. Each app is also deleted inside its own
    try/except so one stubborn app cannot abort the rest of the sweep."""
    settings = get_settings()
    if settings.agent_sandbox_mode != "fly":
        return 0
    if not settings.fly_api_token:
        logger.info("fly reaper: no API token configured; skipping sweep")
        return 0

    fly = None
    reaped = 0
    try:
        fly = FlyMachines(
            token=settings.fly_api_token,
            org=settings.fly_org,
            region=settings.fly_region,
            image=settings.fly_agent_image,
        )
        # THE FENCE: everything downstream sees only our own apps. Nothing else in this function
        # can reach an app that failed this filter.
        ours = [name for name in fly.list_apps() if name.startswith(APP_PREFIX)]
        if not ours:
            return 0
        live = _live_run_ids([_run_id_from_app(n) for n in ours])
        for app_name in ours:
            if _run_id_from_app(app_name) in live:
                continue
            try:
                fly.delete_app(app_name)
                reaped += 1
                logger.warning("fly reaper: reaped orphaned app %s", app_name)
            except FlyApiError:
                logger.warning("fly reaper: failed to reap %s", app_name, exc_info=True)
        if reaped:
            logger.warning("fly reaper: reaped %d orphaned app(s) of %d", reaped, len(ours))
    except Exception:  # noqa: BLE001 — a sweep must never take down startup or error a workflow
        logger.warning("fly reaper: sweep failed; continuing", exc_info=True)
    finally:
        if fly is not None:
            try:
                fly.close()
            except Exception:  # noqa: BLE001
                pass
    return reaped


def _periodic_fly_sweep(scheduled_time: datetime, actual_time: datetime) -> None:
    """The scheduled sweeper's body. DBOS hands every scheduled workflow
    ``(scheduled_time, actual_time)``; neither is used — the sweep's inputs are Fly and the
    database, not the clock."""
    sweep_orphaned_fly_apps()


# ---------------------------------------------------------------------------------------------
# REGISTRATION IS GATED ON FLY MODE — and the gate is on the DECORATOR, not just the body.
#
# This is not belt-and-braces, it is load-bearing. ``DBOS.scheduled`` registers a POLLER at import
# time; ``DBOS.launch()`` then starts it as a daemon thread — and ``make test`` launches DBOS, via
# conftest's session-scoped ``with TestClient(app)``. Registering unconditionally would therefore
# arm a real 10-minute cron inside the offline suite: every time a test session happened to span a
# ``*/10`` boundary it would enqueue a genuine workflow row into the shared system database, at
# random depending on wall-clock start time. A wedged PENDING sweeper would then be RECOVERED by the
# next session's launch — precisely the stale-PENDING wedge that has bitten this repo before.
# Gating only the body would not help: the poller thread and the workflow row happen regardless.
#
# In docker/local mode this module therefore registers NOTHING and costs nothing but its import.
# ---------------------------------------------------------------------------------------------
if get_settings().agent_sandbox_mode == "fly":
    periodic_fly_sweep = DBOS.scheduled("*/10 * * * *")(DBOS.workflow()(_periodic_fly_sweep))
