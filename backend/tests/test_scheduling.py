"""Cron ticks run on the app version that enqueued them (the stall sweep's "stuck ENQUEUED" bug).

dbos 2.23's ``DBOS.scheduled`` loop stamps each tick with the LATEST registered application version,
and a process dequeues only its own version. A newer version registered on the same database (on the
dev DB: the offline suite, whose sweep-off workflow set hashes differently) therefore strands every
tick of the running backend ENQUEUED: the stall sweep never ran and a Stalled step was never ended.
"""

import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

import dbos._scheduler_decorator as stock
import pytest
from dbos import DBOS
from dbos._dbos import _get_dbos_instance
from dbos._registrations import get_dbos_func_name

import tvashtr

EVERY_SECOND = "* * * * * *"  # seconds-first, as DBOS parses crons


# Module level, so registered before conftest's session client launches DBOS (as test_budget.py).
@DBOS.workflow()
def _stock_tick_probe(scheduled_time: datetime, actual_time: datetime) -> str:
    return "ran"


@DBOS.workflow()
def _app_tick_probe(scheduled_time: datetime, actual_time: datetime) -> str:
    return "ran"


def _newer_version_is_latest(monkeypatch) -> str:
    """The bug's state — another, newer version is "latest" — without writing a version row."""
    rival = f"newer-{uuid.uuid4().hex}"
    monkeypatch.setattr(
        _get_dbos_instance()._sys_db,
        "get_latest_application_version",
        lambda: {"version_name": rival},
    )
    return rival


def _ticks(func) -> list:
    return DBOS.list_workflows(
        workflow_id_prefix=f"sched-{get_dbos_func_name(func)}-", load_input=False, load_output=False
    )


def _first_tick(loop, func):
    """Run a cron loop on its own thread until it has enqueued a new tick; return its status."""
    prefix = f"sched-{get_dbos_func_name(func)}-"
    before = {t.workflow_id for t in _ticks(func)}  # earlier runs' ticks stay in the database
    stop = threading.Event()
    thread = threading.Thread(target=loop, args=(func, EVERY_SECOND, stop), daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            new = [t for t in _ticks(func) if t.workflow_id not in before]
            if new:
                return new[0]
            time.sleep(0.2)
        pytest.fail(f"the cron loop enqueued no tick of {prefix}* within 15 s")
    finally:
        stop.set()
        thread.join(timeout=5)


def test_dbos_stock_cron_loop_strands_ticks_under_a_newer_version(client, monkeypatch):
    # The bug, at its source (and a tripwire: if an upgrade stops this, scheduling.py can go).
    rival = _newer_version_is_latest(monkeypatch)
    tick = _first_tick(stock.decorator_scheduler_loop, _stock_tick_probe)
    try:
        assert tick.app_version == rival
        time.sleep(3)  # well past the queue's poll: this process never takes another version's row
        assert DBOS.get_workflow_status(tick.workflow_id).status == "ENQUEUED"
    finally:
        for stranded in _ticks(_stock_tick_probe):  # leave none of THIS test's rows stranded
            if stranded.status == "ENQUEUED" and stranded.app_version == rival:
                DBOS.cancel_workflow(stranded.workflow_id)


def test_no_app_cron_registers_through_the_latest_stamping_decorator():
    root = Path(tvashtr.__file__).parent
    users = sorted(p.name for p in root.rglob("*.py") if "DBOS.scheduled(" in p.read_text())
    assert users == []


def test_an_app_cron_tick_runs_here_while_another_version_is_latest(client, monkeypatch):
    from tvashtr.control_plane import scheduling

    rival = _newer_version_is_latest(monkeypatch)
    tick = _first_tick(scheduling._loop, _app_tick_probe)
    assert tick.app_version == DBOS.application_version != rival
    deadline = time.monotonic() + 15  # dequeued and run by THIS process, within a few queue polls
    while DBOS.get_workflow_status(tick.workflow_id).status != "SUCCESS":
        assert time.monotonic() < deadline, "the tick was not run by this process within 15 s"
        time.sleep(0.2)
    assert DBOS.retrieve_workflow(tick.workflow_id).get_result() == "ran"
    # DBOS's own id ("sched-<name>-<UTC ISO time>"), so a tick is enqueued once across machines,
    # pre-fix ones included — and a tick that exists is never enqueued again.
    suffix = tick.workflow_id.removeprefix("sched-_app_tick_probe-")
    at = datetime.fromisoformat(suffix)
    assert at.isoformat() == suffix and suffix.endswith("+00:00")
    enqueued = []
    queue = type(_get_dbos_instance()._registry.get_internal_queue())
    monkeypatch.setattr(queue, "enqueue", lambda self, *a, **k: enqueued.append(a))
    assert scheduling.enqueue_tick(_app_tick_probe, at) == tick.workflow_id
    assert enqueued == []


def test_the_app_cron_loop_stops_and_rejects_a_bad_cron(monkeypatch):
    from tvashtr.control_plane import scheduling

    stop, seen = threading.Event(), []
    monkeypatch.setattr(scheduling, "enqueue_tick", lambda f, at: (seen.append(at), stop.set()))
    scheduling._loop(_app_tick_probe, EVERY_SECOND, stop)
    assert len(seen) == 1
    with pytest.raises(ValueError, match="Invalid crontab"):  # raised before any poller registers
        scheduling.scheduled("not a cron")(_app_tick_probe)
