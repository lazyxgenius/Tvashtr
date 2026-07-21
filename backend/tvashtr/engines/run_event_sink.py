"""Persistence sink for engine run events.

``make_run_event_sink(run_id, invocation_id)`` returns an ``on_event`` callback that
writes each ``EngineEvent`` to ``run_events``, **insert-or-ignore on ``(run_id,
invocation_id, seq)``** (M-ledger C5) — the same at-least-once-safe discipline as P0.2's
metering/version writes. So an event re-emitted on a retry never duplicates a row.

Keying the idempotency check on ``invocation_id`` (not just ``(run_id, seq)``) is
load-bearing: each engine ``run()`` restarts ``seq`` at 0, so a later loop round's
``seq=0`` event would collide with round 1's row and be silently dropped. Scoping the
check to the invocation keeps every round's events. Legacy/unit callers pass no
``invocation_id`` (NULL); Postgres treats NULLs as distinct so the unique constraint
still accepts them.
"""

from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from tvashtr.db import session_scope
from tvashtr.engines.base import EngineEvent
from tvashtr.models import RunEvent


def make_run_event_sink(
    run_id: str, invocation_id: int | None = None, seq_offset: int = 0
) -> Callable[[EngineEvent], None]:
    """Return an ``on_event`` callback that persists events for ``run_id``, scoped to
    ``invocation_id`` (the ``agent_invocations.id`` of the node-execution emitting them).

    ``seq_offset`` (Tvashtr-79 item 7) shifts the persisted ``seq``. It exists for the one case
    where TWO adapter runs share a single invocation: the mid-run provider failover re-runs the
    step on the node's ``fallback_model``, and every ``run()`` restarts ``seq`` at 0 — so an
    un-offset retry collides with the first attempt's rows on ``(run_id, invocation_id, seq)`` and
    is SILENTLY DROPPED by the idempotency probe below, splicing attempt 1's head onto attempt 2's
    tail in the feed. Offsetting by the first attempt's event count keeps both, in order. The
    default ``0`` leaves every existing call site byte-identical."""

    def sink(event: EngineEvent) -> None:
        seq = event.seq + seq_offset
        with session_scope() as session:
            # Existence probe via ``.limit(1).first()`` (not ``scalar_one_or_none``): a real
            # ``invocation_id`` is unique on ``(run_id, invocation_id, seq)`` (<=1 row), but a
            # legacy/unit caller omitting it writes NULL — distinct in the unique index — so the
            # "already exists?" probe must tolerate more than one NULL-invocation match.
            exists = session.execute(
                select(RunEvent.id)
                .where(
                    RunEvent.run_id == run_id,
                    RunEvent.invocation_id == invocation_id,
                    RunEvent.seq == seq,
                )
                .limit(1)
            ).first()
            if exists is not None:
                return  # already persisted — idempotent re-emit
            session.add(
                RunEvent(
                    run_id=run_id,
                    invocation_id=invocation_id,
                    seq=seq,
                    kind=event.kind,
                    payload=event.payload,
                )
            )
            try:
                session.flush()
            except IntegrityError:
                # Lost the race on (run_id, invocation_id, seq); the row exists — ignore.
                session.rollback()

    return sink
