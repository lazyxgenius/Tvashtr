"""Connectors: the run-time proxy's rules (run tokens, the read-only filter, call records).

Stream B3 (build plan B3.1, B3.3, B3.5); the MCP mount that calls it is
``tvashtr/mcp/connectors.py``. Contract: ``docs/superpowers/plans/api/connectors.md`` (Run time,
What a run shows).
"""

import logging
import uuid
from dataclasses import dataclass

from itsdangerous import BadData, URLSafeTimedSerializer
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tvashtr.config import get_settings
from tvashtr.control_plane.node_library import _as_uuid
from tvashtr.control_plane.resolution_warnings import record_resolution_warning
from tvashtr.control_plane.run_views import TERMINAL_STATUSES
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, ConnectorConnection, Run, RunEvent

logger = logging.getLogger(__name__)

# ---- The run token: the only credential an agent's sandbox gets for a connector ----

RUN_TOKEN_MAX_AGE_SECONDS = 14 * 24 * 3600
_RUN_TOKEN_SALT = "tvashtr.connector-run"


@dataclass(frozen=True)
class RunGrant:
    """What a good run token names. ``access`` is the grant's access when the token was signed;
    the proxy applies the lower of it and the connection's current access on every request."""

    run_id: str
    node_id: str | None
    connection_id: uuid.UUID
    access: str  # "read" | "write"


def _signer() -> URLSafeTimedSerializer:
    # The secret is read at call time, like the session cookie's serializer.
    return URLSafeTimedSerializer(
        get_settings().session_secret.get_secret_value(), salt=_RUN_TOKEN_SALT
    )


def sign_run_token(
    run_id: object, node_id: object | None, connection_id: object, access: str
) -> str:
    """The token for one run, one agent (``node_id``, or ``None``) and one connection."""
    return _signer().dumps(
        {
            "r": str(run_id),
            "n": str(node_id) if node_id is not None else None,
            "c": str(connection_id),
            "a": "write" if access == "write" else "read",
        }
    )


def read_run_token(value: object, max_age: int = RUN_TOKEN_MAX_AGE_SECONDS) -> RunGrant | None:
    """The grant a token names, or ``None`` when it must not be honoured: a bad signature, over
    ``max_age`` old, a run that is gone, ended or another account's than the connection, or a
    connection that is gone or still ``pending``. Reads the database: call it off the event loop.
    """
    if not isinstance(value, str):
        return None
    try:
        data = _signer().loads(value, max_age=max_age)
        run_id, connection_id = uuid.UUID(data["r"]), uuid.UUID(data["c"])
        node_id, access = data["n"], data["a"]
    except (BadData, KeyError, TypeError, ValueError, AttributeError):
        return None
    with session_scope() as session:
        run = session.get(Run, run_id)
        row = session.get(ConnectorConnection, connection_id)
        if (
            run is None
            or row is None
            or row.status == "pending"
            or run.owner_id != row.owner_id
            or run.status in TERMINAL_STATUSES
        ):
            return None
    return RunGrant(
        run_id=str(run_id),
        node_id=str(node_id) if node_id is not None else None,
        connection_id=connection_id,
        access="write" if access == "write" else "read",
    )


# ---- What a run records: ``connector_skipped`` (and, below, ``connector_call``) events ----

# Why a run went without a connector (the contract's Warnings table).
DISCONNECTED = "it was disconnected"
SIGNIN_EXPIRED = "its sign-in expired"
KEY_STOPPED = "its key stopped working"
UNREACHABLE = "we couldn’t reach it"

# ponytail: the proxy's events share the int ``seq`` column with the engine's own (from 0) and
# the Desktop runner's (from ``desktop_jobs.RUNNER_SEQ_OFFSET`` = 100), in a band of their own per
# invocation. The three never meet below a billion events; give the kinds their own column if
# they ever need to.
EVENT_SEQ_BAND = 1_000_000_000
_SEQ_ATTEMPTS = 5


def _latest_invocation(session: Session, run_id: str, node_id: object) -> int | None:
    """The round that is running: the latest ``agent_invocations`` row for the run and node.
    ``None`` without a node, or before its first round opened."""
    nid = _as_uuid(node_id)
    if nid is None:
        return None
    return session.execute(
        select(AgentInvocation.id)
        .where(AgentInvocation.run_id == run_id, AgentInvocation.node_id == nid)
        .order_by(AgentInvocation.iteration.desc())
        .limit(1)
    ).scalar_one_or_none()


def _next_seq(session: Session, run_id: str, invocation_id: int | None) -> int:
    last = session.execute(
        select(func.max(RunEvent.seq)).where(
            RunEvent.run_id == run_id,
            RunEvent.invocation_id.is_not_distinct_from(invocation_id),
            RunEvent.seq >= EVENT_SEQ_BAND,
        )
    ).scalar_one()
    return EVENT_SEQ_BAND if last is None else last + 1


def _write_event(run_id: str, node_id: object, kind: str, payload: dict) -> None:
    """One ``run_events`` row in the proxy's band. Two writers can read the same next ``seq``; the
    loser of ``(run_id, invocation_id, seq)`` reads again."""
    for _ in range(_SEQ_ATTEMPTS):
        try:
            with session_scope() as session:
                invocation_id = _latest_invocation(session, run_id, node_id)
                session.add(
                    RunEvent(
                        run_id=run_id,
                        invocation_id=invocation_id,
                        seq=_next_seq(session, run_id, invocation_id),
                        kind=kind,
                        payload=payload,
                    )
                )
            return
        except IntegrityError:
            continue
    logger.warning("connectors: gave up recording a %s event for run %s", kind, run_id)


def record_skip(
    run_id: str, node_id: object, connection_id: object | None, name: str, reason: str
) -> None:
    """A run went without a connector: the ``run_warnings`` row and the ``connector_skipped``
    event, always together. ``connection_id`` is ``None`` (and ``name`` "a connector") when the
    grant names nothing of the owner's. Sync database work: call it off the event loop."""
    record_resolution_warning(run_id, "connector", name, reason)
    _write_event(
        run_id,
        node_id,
        "connector_skipped",
        {
            "connection_id": str(connection_id) if connection_id is not None else None,
            "connector": name,
            "reason": reason,
        },
    )


def sign_in_expired(run_id: str, node_id: object, row: ConnectorConnection) -> None:
    """The provider no longer takes ``row``'s sign-in (or key): the row becomes ``needs_signin``
    (a row that already is keeps its own ``last_error``) and the run records the skip. Takes the
    row lock in its own session, like every writer of the sign-in."""
    reason = KEY_STOPPED if row.auth_kind == "api_key" else SIGNIN_EXPIRED
    with session_scope() as session:
        live = session.get(ConnectorConnection, row.id, with_for_update=True)
        if live is not None and live.status == "connected":
            live.status = "needs_signin"
            live.last_error = f"{reason[0].upper()}{reason[1:]}."
    record_skip(run_id, node_id, row.id, row.name, reason)


def recent_use(session: Session, owner_id: uuid.UUID, connection_id: uuid.UUID) -> list:
    """Up to 10 rows, newest first, one per run and agent, read from the ``connector_call`` events
    of the owner's last 30 runs: ``{"run_id", "run_number", "agent", "reads", "writes", "at"}``.

    Phase 0 stub: nothing has been used yet. Stream B3.5 fills it."""
    return []
