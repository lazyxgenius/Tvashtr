"""Persistence sink for engine run events.

``make_run_event_sink(run_id)`` returns an ``on_event`` callback that writes each
``EngineEvent`` to ``run_events``, **insert-or-ignore on ``(run_id, seq)``** — the
same at-least-once-safe discipline as P0.2's metering/version writes. So an event
re-emitted on a retry never duplicates a row.
"""

from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from tvashtr.db import session_scope
from tvashtr.engines.base import EngineEvent
from tvashtr.models import RunEvent


def make_run_event_sink(run_id: str) -> Callable[[EngineEvent], None]:
    """Return an ``on_event`` callback that persists events for ``run_id``."""

    def sink(event: EngineEvent) -> None:
        with session_scope() as session:
            exists = session.execute(
                select(RunEvent.id).where(RunEvent.run_id == run_id, RunEvent.seq == event.seq)
            ).scalar_one_or_none()
            if exists is not None:
                return  # already persisted — idempotent re-emit
            session.add(
                RunEvent(
                    run_id=run_id,
                    seq=event.seq,
                    kind=event.kind,
                    payload=event.payload,
                )
            )
            try:
                session.flush()
            except IntegrityError:
                # Lost the race on (run_id, seq); the row exists — ignore.
                session.rollback()

    return sink
