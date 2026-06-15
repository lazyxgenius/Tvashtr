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
