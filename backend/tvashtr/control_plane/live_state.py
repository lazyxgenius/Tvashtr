"""What each running step is doing right now — derived at read time (M1 stall guard, ruling R1).

No column stores it: a running ``agent_invocations`` row plus its newest ``run_events`` say it all.

* ``running_command`` — the newest terminal action has no observation yet. Never Quiet: a command
  is bounded by its own tool's timeout, and shows its own running time.
* ``stalled`` / ``quiet`` — no new event for ``stalled_after_s`` (300) / ``quiet_after_s`` (90).
  A step with no events yet counts from when it started, so a brand-new step is Working.
* ``retrying`` — the newest event is a host ``retry`` (the gateway's envelope, R2).
* ``working`` — anything else.

The host's own events (``retry``, ``backup_model``, ``stalled``) are written by
:func:`record_host_event` in a ``seq`` band of their own. Plain words for a step's activity live in
:func:`activity_line` — the one place the run view's words come from (M2 extends it).

Openhands-free and litellm-free at import, so ``team_run`` may use it.
"""

import logging
import re
import zlib
from datetime import UTC, datetime

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, RunEvent

logger = logging.getLogger(__name__)

# The worst-first order a run's (or Home's) single state is picked by.
WORST_ORDER = (
    "stalled",
    "needs_you",
    "quiet",
    "retrying",
    "running_command",
    "working",
    "waiting",
)
TERMINAL_TOOLS = ("terminal", "execute_bash", "bash")

# ponytail: host events share the int ``seq`` column with the engine's (from 0), the Desktop
# runner's (from 100) and the connector proxy's (from 1e9); this band starts at 1.5e9, under the
# int4 ceiling. Give the kinds their own column if they ever need more room.
HOST_EVENT_SEQ_BAND = 1_500_000_000
_SEQ_ATTEMPTS = 5
_LOCK_NAMESPACE = 0x4C56  # advisory-lock namespace ("LV"), next to the proxy's "CN"

_COMMAND = re.compile(r"command=(['\"])(.*?)\1", re.DOTALL)
_RETRY_LEAD = {"busy": "Model busy", "timeout": "No answer", "unavailable": "Model unavailable"}


def _command_of(payload: dict) -> str:
    action = str((payload or {}).get("action") or "")
    match = _COMMAND.search(action)
    return (match.group(2) if match else action).strip()[:200]


def activity_line(kind: str | None, payload: dict | None) -> str:
    """One plain line for what a step's newest event says it is doing."""
    payload = payload or {}
    if kind == "retry":
        lead = _RETRY_LEAD.get(payload.get("reason"), "Model busy")
        return (
            f"{lead} · trying again in {float(payload.get('wait_s') or 0):g} s "
            f"({payload.get('attempt')} of {payload.get('of')})"
        )
    if kind == "backup_model":
        return f"Switched to the backup model, {payload.get('to_model')}"
    if kind == "stalled":
        return "Stopped responding"
    if kind == "action":
        tool = payload.get("tool_name")
        if tool in TERMINAL_TOOLS:
            return f"Running a command: {_command_of(payload)}"
        if tool == "finish":
            return "Finished its step"
        if tool == "file_editor":
            return "Edited a file"
        return f"Used {tool}" if tool else "Took a step"
    if kind == "message" and payload.get("source") == "agent":
        return "Wrote a message"
    if kind == "error":
        return "Hit an error"
    if kind in ("connector_call", "connector_skipped"):
        return "Used a connector"
    if kind == "condensation":
        return "Condensed its notes"
    # A tool result, the instruction itself, or nothing yet: the model is choosing what to do next.
    return "Asked the model for the next step"


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def derive(
    *,
    started_at: datetime,
    now: datetime,
    last: dict | None = None,
    terminal: dict | None = None,
    backup_model: str | None = None,
    quiet_after_s: float | None = None,
    stalled_after_s: float | None = None,
) -> dict:
    """The live state of one RUNNING step. ``last`` / ``terminal`` are ``{kind, payload,
    created_at}`` — the newest event, and the newest terminal action or observation."""
    settings = get_settings()
    quiet_after = quiet_after_s if quiet_after_s is not None else settings.quiet_after_s
    stalled_after = stalled_after_s if stalled_after_s is not None else settings.stalled_after_s
    last_at = last["created_at"] if last else started_at
    retry = None
    if terminal is not None and terminal["kind"] == "action":
        state = "running_command"
        activity = activity_line("action", terminal["payload"])
        activity_at = terminal["created_at"]
    else:
        age = (now - last_at).total_seconds()
        activity = activity_line(last["kind"] if last else None, last["payload"] if last else None)
        activity_at = last_at
        if age >= stalled_after:
            state = "stalled"
        elif age >= quiet_after:
            state = "quiet"
        elif last is not None and last["kind"] == "retry":
            state = "retrying"
            p = last["payload"] or {}
            retry = {"attempt": p.get("attempt"), "of": p.get("of"), "next_at": p.get("next_at")}
        else:
            state = "working"
    return {
        "live_state": state,
        "last_event_at": _iso(last_at),
        "activity": activity,
        "activity_started_at": _iso(activity_at),
        "retry": retry,
        "backup_model": backup_model,
    }


def worst(states) -> str | None:
    """The single state a run (or a Home card) shows: the worst of its steps'."""
    ranked = [s for s in states if s in WORST_ORDER]
    return min(ranked, key=WORST_ORDER.index) if ranked else None


def _newest(session, invocation_ids: list[int], *conditions) -> dict[int, dict]:
    rows = session.execute(
        select(RunEvent)
        .where(RunEvent.invocation_id.in_(invocation_ids), *conditions)
        .distinct(RunEvent.invocation_id)
        .order_by(RunEvent.invocation_id, RunEvent.created_at.desc(), RunEvent.id.desc())
    ).scalars()
    return {
        e.invocation_id: {"kind": e.kind, "payload": e.payload, "created_at": e.created_at}
        for e in rows
    }


def invocation_live(
    session, invocations: list[AgentInvocation], now: datetime | None = None
) -> dict[int, dict]:
    """``{invocation id: derive(...)}`` for RUNNING invocations — three queries per batch."""
    running = [i for i in invocations if i.status == "running"]
    if not running:
        return {}
    now = now or datetime.now(UTC)
    ids = [i.id for i in running]
    # ``run_events.invocation_id`` is not a foreign key: scope to these runs too, so a number
    # another run wrote (a legacy or test row) is never read as this step's news.
    of_these_runs = RunEvent.run_id.in_({i.run_id for i in running})
    last = _newest(session, ids, of_these_runs)
    terminal = _newest(
        session,
        ids,
        of_these_runs,
        RunEvent.kind.in_(("action", "observation")),
        RunEvent.payload["tool_name"].astext.in_(TERMINAL_TOOLS),
    )
    backups = _newest(session, ids, of_these_runs, RunEvent.kind == "backup_model")
    return {
        inv.id: derive(
            started_at=inv.started_at,
            now=now,
            last=last.get(inv.id),
            terminal=terminal.get(inv.id),
            backup_model=(backups[inv.id]["payload"] or {}).get("to_model")
            if inv.id in backups
            else None,
        )
        for inv in running
    }


def stalled_for(live: dict, now: datetime) -> float:
    """Seconds a step has been without news (0 for a running command)."""
    if live["live_state"] == "running_command" or not live["last_event_at"]:
        return 0.0
    return (now - datetime.fromisoformat(live["last_event_at"])).total_seconds()


def record_host_event(run_id: str, invocation_id: int | None, kind: str, payload: dict) -> None:
    """One ``run_events`` row written by the host (a retry, the backup switch, a stall), in the
    host band. Writers take their ``seq`` one at a time under a transaction lock on
    ``(run_id, invocation_id)`` — the connector proxy's discipline. Never raises."""
    for _ in range(_SEQ_ATTEMPTS):
        try:
            with session_scope() as session:
                session.execute(
                    text("SELECT pg_advisory_xact_lock(:ns, :k)"),
                    {
                        "ns": _LOCK_NAMESPACE,
                        "k": zlib.crc32(f"{run_id}:{invocation_id}".encode()) - 2**31,
                    },
                )
                last = session.execute(
                    select(func.max(RunEvent.seq)).where(
                        RunEvent.run_id == run_id,
                        RunEvent.invocation_id.is_not_distinct_from(invocation_id),
                        RunEvent.seq >= HOST_EVENT_SEQ_BAND,
                    )
                ).scalar_one()
                session.add(
                    RunEvent(
                        run_id=run_id,
                        invocation_id=invocation_id,
                        seq=HOST_EVENT_SEQ_BAND if last is None else last + 1,
                        kind=kind,
                        payload=payload,
                    )
                )
            return
        except IntegrityError:
            continue
        except Exception:  # noqa: BLE001 — a missing note must never break the run
            logger.warning("live_state: could not record a %s event for run %s", kind, run_id)
            return
    logger.warning("live_state: gave up recording a %s event for run %s", kind, run_id)


# A finished step's state is its invocation status; a run's, once it is over, its run status.
_ENDED_STATE = {"done": "done", "failed": "failed", "stopped": "stopped"}
_RUN_ENDED_STATE = {
    "completed": "done",
    "failed": "failed",
    "rejected": "stopped",
    "cancelled": "stopped",
    "over_budget": "stopped",
}
STEP_KINDS = ("agent", "completion")


def _plain(state: str) -> dict:
    return {
        "live_state": state,
        "last_event_at": None,
        "activity": None,
        "activity_started_at": None,
        "retry": None,
        "backup_model": None,
    }


def node_live(kind: str, latest: AgentInvocation | None, live_by_inv: dict[int, dict]) -> dict:
    """A node's live block for the run view: from its latest invocation (``None`` = not reached)."""
    if latest is None:
        return _plain("waiting")
    if latest.status != "running":
        return _plain(_ENDED_STATE.get(latest.status, latest.status))
    if kind == "gate":
        return _plain("needs_you")
    return live_by_inv.get(latest.id) or _plain("working")


def run_live_state(run_status: str, step_states) -> str | None:
    """A run's one state: its run status once it is over, else the worst of its steps' (an
    ``awaiting_human`` run needs you even when no gate step is open)."""
    if run_status in _RUN_ENDED_STATE:
        return _RUN_ENDED_STATE[run_status]
    states = list(step_states)
    if run_status == "awaiting_human":
        states.append("needs_you")
    return worst(states) or "waiting"
