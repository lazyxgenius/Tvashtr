"""Cron registration whose ticks run on the app version that enqueued them.

dbos 2.23's stock cron loop (``_scheduler_decorator.decorator_scheduler_loop``) stamps every tick
with the LATEST registered application version, a process dequeues only rows of its own version
(``_sys_db.start_queued_workflows``), and re-launching an already-registered version never makes it
latest again (``create_application_version`` is insert-or-nothing). So whenever the newest
registered version is not the one running — a rollback, an aborted deploy, or the offline suite
(its sweep-off workflow set hashes differently) registering itself on the dev database — every tick
sits ENQUEUED forever and the stall sweep and the reapers never run.

This is that loop with one change: a tick is stamped with THIS process's version. Ids, cron parsing
and jitter are DBOS's, so a tick is still enqueued once across machines (pre-fix ones included).
No workflow is defined here, so the app version hash is unchanged.

The trade-off: during a deploy that changes the version, a tick enqueued by an outgoing machine in
the second before it stops (before its own queue poll) is never run — stock would have handed it
to the new version. Every sweep repeats within minutes and ignores its scheduled time, so that
costs one tick, not a stuck cron.
"""

import logging
import random
import threading
from collections.abc import Callable
from datetime import UTC, datetime

from dbos import DBOS, SetEnqueueOptions, SetWorkflowID

# ponytail: private dbos internals, pinned by dbos==2.23.0 in pyproject.toml. A rename fails loudly
# at import, and tests/test_scheduling.py's stock-loop test fails once an upgrade stops stamping
# "latest" — then this module can go and the call sites return to the stock decorator.
from dbos._croniter import croniter  # type: ignore[attr-defined]
from dbos._dbos import _get_dbos_instance, _get_or_create_dbos_registry
from dbos._registrations import get_dbos_func_name

logger = logging.getLogger(__name__)


def scheduled(cron: str) -> Callable:
    """Drop-in for the stock decorator: a poller registered at import, started by launch."""

    def decorator(func: Callable) -> Callable:
        try:
            croniter(cron, datetime.now(UTC), second_at_beginning=True)
        except Exception as exc:
            raise ValueError(f'Invalid crontab "{cron}" for {get_dbos_func_name(func)}') from exc
        stop = threading.Event()
        _get_or_create_dbos_registry().register_poller(stop, _loop, func, cron, stop)
        return func

    return decorator


def enqueue_tick(func: Callable, at: datetime) -> str:
    """Enqueue the tick due ``at`` on this process's version, unless some process already did."""
    wf_id = f"sched-{get_dbos_func_name(func)}-{at.isoformat()}"
    dbos = _get_dbos_instance()
    if not dbos._sys_db.get_workflow_status(wf_id):
        with SetWorkflowID(wf_id), SetEnqueueOptions(app_version=DBOS.application_version):
            dbos._registry.get_internal_queue().enqueue(func, at, datetime.now(UTC))
    return wf_id


def _loop(func: Callable, cron: str, stop: threading.Event) -> None:
    name = get_dbos_func_name(func)
    logger.info("cron %s (%s): ticks run on app version %s", name, cron, DBOS.application_version)
    ticks = croniter(cron, datetime.now(UTC), second_at_beginning=True)
    while not stop.is_set():
        at = ticks.get_next(datetime)
        sleep = max(0.0, (at - datetime.now(UTC)).total_seconds())
        # DBOS's jitter (up to 10% of the sleep, at most 10 s) against a thundering herd.
        if stop.wait(sleep + random.uniform(0, min(sleep / 10, 10))):
            return
        try:
            enqueue_tick(func, at)
        except Exception:  # noqa: BLE001 — a failed tick must never end the cron, as in DBOS
            logger.warning("cron tick of %s failed", name, exc_info=True)
