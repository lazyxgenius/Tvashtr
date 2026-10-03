"""The stall ceiling (M1 stall guard, ruling R1): a step Stalled for ``stall_fail_after_s`` (20
minutes) is ended as Failed, ``failure_code="stalled"``.

Marking the run failed is not enough on its own: the hung step is still blocking inside the walk,
and the walk would carry on when it returns. So the sweep also cancels the run's DBOS workflow (the
walk stops at its next step) and closes the run's cached sandboxes (a remote conversation then
raises out of ``run()``). The run's status leaves the in-flight set, which frees its concurrency
slot; the run-end teardown in ``run_team``'s ``finally`` reaps its workspace as for any cancelled
walk.

M11 (ruling R13): an agent with a failure path is the exception. Its step is ended (closed failed,
``stalled``) and its sandbox released, so the step returns failed and the walk takes the path; the
run is not failed and its workflow not cancelled. Such an agent also ends at its own time limit
(``config.time_limit_s``, else this ceiling) however busy it is (``timed_out``).

A running command is never swept (R1: it is bounded by its tool's own timeout). The run update is
guarded on ``status == "running"``, so a run that finished meanwhile is left as it is. Registered as
a DBOS scheduled workflow when ``stall_sweep_enabled`` (off in the offline suite, which calls
:func:`sweep_stalled_steps` directly).
"""

import logging
import uuid
from datetime import UTC, datetime

from dbos import DBOS
from sqlalchemy import func, select, update

from tvashtr.config import get_settings
from tvashtr.control_plane import live_state, run_failure
from tvashtr.db import session_scope
from tvashtr.engines import sandbox_cache
from tvashtr.metering import running_cost
from tvashtr.models import AgentInvocation, AgentNode, Edge, Run, RunEvent

logger = logging.getLogger(__name__)


def _cancel_workflow(run_id: str) -> None:
    DBOS.cancel_workflow(run_id)


def _close_sandboxes(run_id: str) -> None:
    sandbox_cache.close_run_sandboxes(run_id)
    # The cache is per process. On Fly the run's own app can be deleted from anywhere: the Fly
    # reaper deletes the app of every run that is no longer live — and this one just ended.
    if get_settings().agent_sandbox_mode == "fly":
        from tvashtr.control_plane import fly_reaper

        fly_reaper.sweep_orphaned_fly_apps()


def stalled_message(label: str, after_s: float) -> str:
    minutes = max(1, round(after_s / 60))
    return f"The {label} stopped responding: no update for {minutes} minute" + (
        "s" if minutes != 1 else ""
    )


_AGENT_KINDS = ("completion", "agent")


def _can_interrupt(run_id: str) -> bool:
    """M11: whether releasing the run's sandbox HERE would stop its agent — a docker or Fly sandbox
    this process holds (the cache is per process: Fly's other machine, the LOCAL sandbox and a
    Desktop runner can't be stopped from here). When it can't, a failure-path step ends as before
    M11 (the run fails, its workflow cancelled) rather than being left running unstoppably."""
    return get_settings().agent_sandbox_mode in ("docker", "fly") and sandbox_cache.holds_run(
        run_id
    )


def _time_limit(config: dict | None, default: float) -> float:
    """An agent's own time limit (``config.time_limit_s``), else R1's ceiling."""
    limit = (config or {}).get("time_limit_s") if isinstance(config, dict) else None
    return float(limit) if isinstance(limit, int | float) and limit > 0 else default


def time_limit_message(label: str, limit_s: float) -> str:
    minutes = max(1, round(limit_s / 60))
    return f"The {label} ran longer than its time limit of {minutes} minute" + (
        "s" if minutes != 1 else ""
    )


def _end(
    run_id: str,
    inv_id: int,
    node: tuple,
    silent_s: float,
    ceiling: float,
    now: datetime,
    *,
    path: bool = False,
    time_limit_s: float | None = None,
) -> bool:
    """End one step; ``True`` when its run was ended. M11 (R13): ``path`` — the agent has a failure
    path — ends only the step (closed failed, its sandbox released so the step returns failed and
    the walk takes the path), never the run. ``time_limit_s``: the step ran past the agent's own
    time limit rather than going silent."""
    node_id, role_name, kind, config = node
    label = run_failure.node_label(role_name, kind, config)
    if time_limit_s is not None:
        outcome, message = "timed_out", time_limit_message(label, time_limit_s)
    else:
        outcome, message = "stalled", stalled_message(label, ceiling)
    total = running_cost(run_id)
    with session_scope() as session:
        # Guarded on the step as well as the run: a round that closed, or spoke, between the look
        # and this write keeps its run alive.
        newest = session.execute(
            select(func.max(RunEvent.created_at)).where(
                RunEvent.run_id == run_id, RunEvent.invocation_id == inv_id
            )
        ).scalar_one()
        if time_limit_s is None and newest is not None and (now - newest).total_seconds() < ceiling:
            return False
        closed = session.execute(
            update(AgentInvocation)
            .where(AgentInvocation.id == inv_id, AgentInvocation.status == "running")
            .values(
                status="failed",
                outcome=outcome,
                outcome_detail=message,
                ended_at=datetime.now(UTC),
            )
        ).rowcount
        if not closed:
            return False
        if path:
            # M11: the walk carries on along the failure path — the run is left as it is (but the
            # step only ends while the run is still running, as below).
            ended = session.execute(
                select(Run.id).where(Run.id == uuid.UUID(run_id), Run.status == "running")
            ).first()
        else:
            ended = session.execute(
                update(Run)
                .where(Run.id == uuid.UUID(run_id), Run.status == "running")
                .values(
                    status="failed",
                    cost_total_usd=total,
                    failure_code=run_failure.STALLED,
                    failure_message=message,
                    failed_node_id=node_id,
                )
            ).rowcount
        if not ended:
            session.rollback()  # the run ended meanwhile: leave its step as it was too
            return False
    if time_limit_s is None:
        live_state.record_host_event(
            run_id, inv_id, "stalled", {"after_s": int(silent_s), "message": message}
        )
    # With a failure path only the sandbox is released: the step returns failed and the walk
    # takes the path. Without one the workflow is cancelled too, so the walk can't carry on.
    for release in (_close_sandboxes,) if path else (_cancel_workflow, _close_sandboxes):
        try:
            release(run_id)
        except Exception:  # noqa: BLE001 — the step is already ended; never strand the sweep
            logger.warning("stall sweep: %s failed for run %s", release.__name__, run_id)
    return not path


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
        # M11 (R13): the agents among them with a failure path.
        with_path = set(
            session.execute(
                select(Edge.source_node_id).where(
                    Edge.edge_type == "failure",  # team_run.FAILURE_EDGE (not imported: heavy)
                    Edge.source_node_id.in_({node.id for _, node in rows}),
                )
            ).scalars()
        )
        # Plain values, not ORM rows: they outlive this session, and one node can have two rounds.
        due = []
        for inv, node in rows:
            silent = live_state.stalled_for(live[inv.id], now)
            path = node.id in with_path and node.kind in _AGENT_KINDS and _can_interrupt(inv.run_id)
            # An agent with a failure path also ends at its own time limit (R1's ceiling unless
            # set); without one, only the stall ceiling ends a step — exactly as before M11.
            limit = _time_limit(node.config, ceiling) if path else None
            if silent >= ceiling:
                limit = None
            elif limit is None or (now - inv.started_at).total_seconds() < limit:
                continue
            due.append(
                (
                    inv.run_id,
                    inv.id,
                    (node.id, node.role_name, node.kind, node.config),
                    silent,
                    path,
                    limit,
                )
            )
    ended: list[str] = []
    for run_id, inv_id, node, silent, path, limit in due:
        if run_id not in ended and _end(
            run_id, inv_id, node, silent, ceiling, now, path=path, time_limit_s=limit
        ):
            ended.append(run_id)
    if ended:
        logger.warning("stall sweep: ended %d stalled run(s): %s", len(ended), ended)
    return ended


@DBOS.step()
def sweep_step() -> list[str]:
    """The sweep as ONE DBOS step: its reads, writes and workflow cancels are recorded as a unit, so
    a recovered sweep replays its result instead of re-deciding (review finding 10)."""
    return sweep_stalled_steps()


def _periodic_stall_sweep(scheduled_time: datetime, actual_time: datetime) -> None:
    try:
        sweep_step()
    except Exception:  # noqa: BLE001 — a failing sweep must never crash the scheduler
        logger.warning("stall sweep failed", exc_info=True)


# Registered at import (before ``DBOS.launch()``) only when enabled: the offline suite launches DBOS
# through the app and turns it off, so no real cron runs during ``make test``.
if get_settings().stall_sweep_enabled:
    periodic_stall_sweep = DBOS.scheduled(get_settings().stall_sweep_cron)(
        DBOS.workflow()(_periodic_stall_sweep)
    )
