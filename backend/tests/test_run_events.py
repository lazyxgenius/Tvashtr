"""RunEvent sink idempotency — no network.

Extends the standing at-least-once-safe convention to the engine layer: pushing
the same ``(run_id, seq)`` event twice through the sink writes exactly one row.
"""

from uuid import uuid4

from sqlalchemy import func, select

from tvashtr.db import session_scope
from tvashtr.engines.base import EngineEvent
from tvashtr.engines.run_event_sink import make_run_event_sink
from tvashtr.models import RunEvent


def _count(run_id: str) -> int:
    with session_scope() as session:
        return session.execute(
            select(func.count()).select_from(RunEvent).where(RunEvent.run_id == run_id)
        ).scalar_one()


def test_run_event_sink_is_idempotent_on_run_id_seq():
    run_id = f"test-{uuid4().hex}"
    sink = make_run_event_sink(run_id)

    event = EngineEvent(seq=0, kind="action", payload={"tool_name": "terminal"}, ts=1.0)
    sink(event)
    assert _count(run_id) == 1

    # Re-emit the identical (run_id, seq) — at-least-once retry — stays one row.
    sink(event)
    assert _count(run_id) == 1

    # A new seq appends.
    sink(EngineEvent(seq=1, kind="observation", payload={"ok": True}, ts=2.0))
    assert _count(run_id) == 2


def test_run_event_sink_persists_kind_and_payload():
    run_id = f"test-{uuid4().hex}"
    make_run_event_sink(run_id)(
        EngineEvent(seq=0, kind="message", payload={"text": "hello"}, ts=1.0)
    )
    with session_scope() as session:
        row = session.execute(select(RunEvent).where(RunEvent.run_id == run_id)).scalar_one()
        assert row.seq == 0
        assert row.kind == "message"
        assert row.payload == {"text": "hello"}


def test_run_event_sink_persists_a_condensation_event():
    """Tvashtr-79 item 5: the FIFTH engine-neutral kind lands in the EXISTING ``kind`` Text column —
    no schema change (alembic head stays ``0030``). Guards the durable end of the condensation path
    whose adapter end is proven in ``test_condenser_wiring.py``."""
    run_id = f"test-{uuid4().hex}"
    make_run_event_sink(run_id)(
        EngineEvent(
            seq=0,
            kind="condensation",
            payload={"forgotten_count": 12, "summary": "folded 12 events"},
            ts=1.0,
        )
    )
    with session_scope() as session:
        row = session.execute(select(RunEvent).where(RunEvent.run_id == run_id)).scalar_one()
        assert row.kind == "condensation"
        assert row.payload["forgotten_count"] == 12


def test_run_event_sink_seq_offset_lets_a_second_attempt_append():
    """Tvashtr-79 item 7: a mid-run provider failover re-runs the adapter INSIDE THE SAME
    invocation, and every adapter ``run()`` restarts ``seq`` at 0 — so WITHOUT an offset the retry's
    events collide with the first attempt's rows on ``(run_id, invocation_id, seq)`` and are
    SILENTLY DROPPED by the idempotency probe (the feed would show attempt 1's head spliced onto
    attempt 2's tail). ``seq_offset`` re-keys the retry so both attempts survive, in order.

    Mutation teeth: the middle assertion pins the collision that motivates the parameter, and the
    final one fails if ``seq_offset`` is ignored."""
    run_id = f"test-{uuid4().hex}"
    invocation_id = 4242
    make_run_event_sink(run_id, invocation_id)(
        EngineEvent(seq=0, kind="message", payload={"text": "attempt-1"}, ts=1.0)
    )
    # Un-offset, the retry's seq=0 is swallowed as an at-least-once re-emit of attempt 1's row.
    make_run_event_sink(run_id, invocation_id)(
        EngineEvent(seq=0, kind="message", payload={"text": "swallowed"}, ts=2.0)
    )
    assert _count(run_id) == 1

    # Offset by the first attempt's event count, the retry APPENDS instead.
    make_run_event_sink(run_id, invocation_id, seq_offset=1)(
        EngineEvent(seq=0, kind="message", payload={"text": "attempt-2"}, ts=3.0)
    )
    assert _count(run_id) == 2
    with session_scope() as session:
        rows = list(
            session.execute(
                select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.seq)
            ).scalars()
        )
    assert [r.seq for r in rows] == [0, 1]
    assert [r.payload["text"] for r in rows] == ["attempt-1", "attempt-2"]


def test_run_event_sink_default_seq_offset_is_byte_identical():
    """``seq_offset`` is ADDITIVE with a 0 default — the un-offset call path must be unchanged."""
    run_id = f"test-{uuid4().hex}"
    make_run_event_sink(run_id)(EngineEvent(seq=7, kind="action", payload={}, ts=1.0))
    with session_scope() as session:
        row = session.execute(select(RunEvent).where(RunEvent.run_id == run_id)).scalar_one()
    assert row.seq == 7
