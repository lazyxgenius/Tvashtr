"""The stall ceiling (M1 stall guard, ruling R1): a step Stalled for ``stall_fail_after_s`` (20
minutes) is ended as Failed, ``failure_code="stalled"``.

Marking the run failed is not enough on its own: the hung step is still blocking inside the walk,
and the walk would carry on when it returns. So the sweep also cancels the run's DBOS workflow (the
walk stops at its next step) and closes the run's cached sandboxes (a remote conversation then
raises out of ``run()``). The run's status leaves the in-flight set, which frees its concurrency
slot; the run-end teardown in ``run_team``'s ``finally`` reaps its workspace as for any cancelled
walk.

A running command is never swept (R1: it is bounded by its tool's own timeout). The run update is
guarded on ``status == "running"``, so a run that finished meanwhile is left as it is. Registered as
a DBOS scheduled workflow when ``stall_sweep_enabled`` (off in the offline suite, which calls
:func:`sweep_stalled_steps` directly).
"""

import logging
import uuid
from datetime import UTC, datetime

from dbos import DBOS
from sqlalchemy import select, update

from tvashtr.config import get_settings
from tvashtr.control_plane import live_state, run_failure
from tvashtr.db import session_scope
from tvashtr.engines import sandbox_cache
from tvashtr.metering import running_cost
from tvashtr.models import AgentInvocation, AgentNode, Run

logger = logging.getLogger(__name__)


def _cancel_workflow(run_id: str) -> None:
    DBOS.cancel_workflow(run_id)


def _close_sandboxes(run_id: str) -> None:
    sandbox_cache.close_run_sandboxes(run_id)


def stalled_message(label: str, after_s: float) -> str:
    minutes = max(1, round(after_s / 60))
    return f"The {label} stopped responding: no update for {minutes} minute" + (
        "s" if minutes != 1 else ""
    )


def _end(run_id: str, inv_id: int, node: AgentNode, silent_s: float, ceiling: float) -> bool:
    message = stalled_message(
        run_failure.node_label(node.role_name, node.kind, node.config), ceiling
    )
    total = running_cost(run_id)
    with session_scope() as session:
        ended = session.execute(
            update(Run)
            .where(Run.id == uuid.UUID(run_id), Run.status == "running")
            .values(
                status="failed",
                cost_total_usd=total,
                failure_code=run_failure.STALLED,
                failure_message=message,
                failed_node_id=node.id,
            )
        ).rowcount
        if not ended:
            return False
        session.execute(
            update(AgentInvocation)
            .where(AgentInvocation.id == inv_id, AgentInvocation.status == "running")
            .values(
                status="failed",
                outcome="stalled",
                outcome_detail=message,
                ended_at=datetime.now(UTC),
            )
        )
    live_state.record_host_event(
        run_id, inv_id, "stalled", {"after_s": int(silent_s), "message": message}
    )
    for release in (_cancel_workflow, _close_sandboxes):
        try:
            release(run_id)
        except Exception:  # noqa: BLE001 — the run is already failed; never strand the sweep
            logger.warning("stall sweep: %s failed for run %s", release.__name__, run_id)
    return True


def sweep_stalled_steps(now: datetime | None = None) -> list[str]:
    """End every step that has had no update for the ceiling; return the run ids it ended."""
    now = now or datetime.now(UTC)
    ceiling = get_settings().stall_fail_after_s
    with session_scope() as session:
        rows = session.execute(
            select(AgentInvocation, AgentNode)
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .join(Run, Run.workflow_id == AgentInvocation.run_id)
            .where(
                Run.status == "running",
                AgentInvocation.status == "running",
                AgentNode.kind.in_(live_state.STEP_KINDS),
            )
        ).all()
        live = live_state.invocation_live(session, [inv for inv, _ in rows], now=now)
        due = [
            (inv.run_id, inv.id, node, live_state.stalled_for(live[inv.id], now))
            for inv, node in rows
            if live_state.stalled_for(live[inv.id], now) >= ceiling
        ]
        for _, _, node, _ in due:
            session.expunge(node)
    ended: list[str] = []
    for run_id, inv_id, node, silent in due:
        if run_id not in ended and _end(run_id, inv_id, node, silent, ceiling):
            ended.append(run_id)
    if ended:
        logger.warning("stall sweep: ended %d stalled run(s): %s", len(ended), ended)
    return ended


def _periodic_stall_sweep(scheduled_time: datetime, actual_time: datetime) -> None:
    try:
        sweep_stalled_steps()
    except Exception:  # noqa: BLE001 — a failing sweep must never crash the scheduler
        logger.warning("stall sweep failed", exc_info=True)


# Registered at import (before ``DBOS.launch()``) only when enabled: the offline suite launches DBOS
# through the app and turns it off, so no real cron runs during ``make test``.
if get_settings().stall_sweep_enabled:
    periodic_stall_sweep = DBOS.scheduled(get_settings().stall_sweep_cron)(
        DBOS.workflow()(_periodic_stall_sweep)
    )
