"""Human-in-the-loop **gates** — the durable pause primitive (P1.1a).

A gate pauses a running workflow on a ``DBOS.recv(topic)`` until a human resolves
a :class:`~tvashtr.models.HumanTask` (approve/reject). The mechanism is three
idempotent steps plus an inline ``recv`` loop, composed by :func:`wait_at_gate`:

* :func:`open_gate_step` — idempotently create the pending ``HumanTask`` and (if
  blocking) move ``Run.status`` to ``"awaiting_human"``.
* the ``recv`` loop (kept in the **workflow body**, not nested in a step) — block
  until a real resolution arrives.
* :func:`close_gate_step` — idempotently mark the task resolved and move
  ``Run.status`` back to ``"running"``.

DBOS 2.23.0 facts this relies on (verified against the installed package):

* ``DBOS.recv`` has **no infinite timeout**; on timeout it returns **None**. The
  loop treats ``None`` (and any non-resolution payload) as "still waiting" and
  re-waits — it NEVER reads a timeout as "proceed". A timed-out ``recv`` records a
  non-NULL output (pickled ``None``), so the re-wait loop also replays cleanly
  across a crash.
* ``DBOS.cancel_workflow`` does **not** interrupt a blocked ``recv`` (it only
  flips the workflow status to ``CANCELLED``); the cancel takes effect at the next
  step/recv boundary, where DBOS raises ``DBOSWorkflowCancelledError``. The cancel
  API therefore writes ``Run.status="cancelled"`` itself rather than relying on the
  workflow running another step. A ``CANCELLED`` workflow is excluded from
  recovery's ``get_pending_workflows`` (PENDING-only), so the kill switch is not
  resurrected on reboot.

This module imports neither ``litellm`` nor ``openhands.*`` — it stays inside the
offline/no-heavy-imports boundary.
"""

import os
import uuid

from dbos import DBOS
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from tvashtr.db import session_scope
from tvashtr.models import HumanTask, Run

# ``recv`` has no infinite timeout; use a large per-wait window and re-wait in a
# loop so the gate is effectively indefinite. A ``send`` wakes the recv instantly
# via Postgres NOTIFY, so this only bounds the fallback re-poll cadence.
GATE_WAIT_SECONDS: float = 3600.0

# Opt-in flag (set by the deterministic live harnesses: skeleton-run/-crash) that
# auto-approves gates so those paths don't block on a human. Read inside a recorded
# step so a crash-resume replays the same decision regardless of the new process's
# environment. Never set in production.
AUTO_APPROVE_ENV = "TVASHTR_AUTO_APPROVE_GATES"
_TRUTHY = {"1", "true", "yes", "on"}


@DBOS.step()
def open_gate_step(
    run_id: str,
    *,
    kind: str,
    topic: str,
    priority: str,
    blocking: bool,
    title: str,
    description: str,
) -> int:
    """Idempotently open a gate: insert the pending ``HumanTask`` (unique on
    ``(run_id, topic)``) and, if blocking, set ``Run.status="awaiting_human"``.

    Returns the task id. A crash-then-resume re-running this step returns the
    existing task instead of inserting a duplicate (insert-or-return, same shape
    as the metering/document writes)."""
    with session_scope() as session:
        existing = session.execute(
            select(HumanTask).where(HumanTask.run_id == run_id, HumanTask.topic == topic)
        ).scalar_one_or_none()
        if existing is not None:
            task_id = existing.id
        else:
            task = HumanTask(
                run_id=run_id,
                kind=kind,
                priority=priority,
                blocking=blocking,
                topic=topic,
                title=title,
                description=description,
                status="pending",
            )
            session.add(task)
            try:
                session.flush()
            except IntegrityError:
                session.rollback()
                won = session.execute(
                    select(HumanTask).where(HumanTask.run_id == run_id, HumanTask.topic == topic)
                ).scalar_one()
                return won.id
            task_id = task.id

        if blocking:
            session.execute(
                update(Run).where(Run.id == uuid.UUID(run_id)).values(status="awaiting_human")
            )
        return task_id


@DBOS.step()
def close_gate_step(run_id: str, *, topic: str, resolution: str, note: str | None) -> None:
    """Idempotently close a gate: mark the matching *pending* ``HumanTask``
    resolved (``resolved_at``/``resolution``/``resolution_note``) and move
    ``Run.status`` back to ``"running"``.

    The pending filter makes a re-run a no-op (a second close matches no rows).
    This step is the **single writer** of a gate's resolution — the resolve API
    only signals via ``DBOS.send``."""
    with session_scope() as session:
        session.execute(
            update(HumanTask)
            .where(
                HumanTask.run_id == run_id,
                HumanTask.topic == topic,
                HumanTask.status == "pending",
            )
            .values(
                status="resolved",
                resolution=resolution,
                resolution_note=note,
                resolved_at=func.now(),
            )
        )
        session.execute(update(Run).where(Run.id == uuid.UUID(run_id)).values(status="running"))


@DBOS.step()
def gate_auto_resolution_step(run_id: str, topic: str) -> str | None:
    """Recorded auto-approve decision for the deterministic live harnesses.

    Returns ``"approved"`` when ``TVASHTR_AUTO_APPROVE_GATES`` is set, else
    ``None``. Being a step, the decision is checkpointed, so a crash-resume
    replays it identically even if the restarted process lacks the env var."""
    if os.environ.get(AUTO_APPROVE_ENV, "").strip().lower() in _TRUTHY:
        return "approved"
    return None


def wait_at_gate(
    run_id: str,
    topic: str,
    *,
    kind: str,
    priority: str,
    blocking: bool,
    title: str,
    description: str,
    timeout_seconds: float = GATE_WAIT_SECONDS,
) -> dict:
    """Open a gate, block until a human resolves it, close it, return the result.

    Call this from a **workflow body** (it issues ``DBOS.recv`` directly, which
    must run in workflow context — do not wrap it in a ``@DBOS.step``). Returns
    ``{"resolution": "approved"|"rejected", "note": str | None}``.
    """
    open_gate_step(
        run_id,
        kind=kind,
        topic=topic,
        priority=priority,
        blocking=blocking,
        title=title,
        description=description,
    )

    auto = gate_auto_resolution_step(run_id, topic)
    if auto is not None:
        close_gate_step(run_id, topic=topic, resolution=auto, note="auto-approved")
        return {"resolution": auto, "note": "auto-approved"}

    # recv has no infinite timeout: loop, re-waiting on the timeout sentinel
    # (None) or any non-resolution payload until a real resolution arrives.
    while True:
        message = DBOS.recv(topic, timeout_seconds=timeout_seconds)
        if isinstance(message, dict) and message.get("resolution") in {"approved", "rejected"}:
            resolution = message["resolution"]
            note = message.get("note")
            break

    close_gate_step(run_id, topic=topic, resolution=resolution, note=note)
    return {"resolution": resolution, "note": note}
