"""M1 stall guard: what a running step is doing, as the Activity feed shows it.

For now, only the executor's own run events (a switch to the backup model, ...), written in a
``seq`` band of their own so they never collide with the engine's events or the connector proxy's.
Openhands-free + litellm-free at import, like every module ``team_run`` imports.
"""

import logging
import zlib

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from tvashtr.db import session_scope
from tvashtr.models import RunEvent

logger = logging.getLogger("tvashtr.control_plane.live_state")

# Above the engine's events (from 0) and the connector proxy's band (``EVENT_SEQ_BAND``, 1e9).
HOST_EVENT_SEQ_BAND = 1_500_000_000
_SEQ_ATTEMPTS = 5
_LOCK_NAMESPACE = 0x4853  # advisory-lock namespace ("HS"), next to the proxy's "CN"


def record_host_event(run_id: str, invocation_id: int | None, kind: str, payload: dict) -> None:
    """One ``run_events`` row in the host band for ``(run_id, invocation_id)``: ``seq`` is the
    band's max + 1, taken under a transaction lock so concurrent writers never pick the same one
    (the unique-constraint retry is the backstop) — ``connector_proxy._write_event``'s discipline.
    Never raises: a lost event must not fail the step that reported it."""
    try:
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
        logger.warning("live_state: gave up recording a %s event for run %s", kind, run_id)
    except Exception:
        logger.warning(
            "live_state: could not record a %s event for run %s", kind, run_id, exc_info=True
        )
