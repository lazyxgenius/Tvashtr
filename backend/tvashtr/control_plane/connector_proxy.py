"""Connectors: the run-time proxy's rules (run tokens, the read-only filter, call records).

Stream B3 (build plan B3.1, B3.3, B3.5); the MCP mount that calls it is
``tvashtr/mcp/connectors.py``. Contract: ``docs/superpowers/plans/api/connectors.md`` (Run time,
What a run shows).
"""

import uuid
from dataclasses import dataclass

from itsdangerous import BadData, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from tvashtr.config import get_settings
from tvashtr.control_plane.run_views import TERMINAL_STATUSES
from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection, Run

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


def recent_use(session: Session, owner_id: uuid.UUID, connection_id: uuid.UUID) -> list:
    """Up to 10 rows, newest first, one per run and agent, read from the ``connector_call`` events
    of the owner's last 30 runs: ``{"run_id", "run_number", "agent", "reads", "writes", "at"}``.

    Phase 0 stub: nothing has been used yet. Stream B3.5 fills it."""
    return []
