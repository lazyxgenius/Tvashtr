"""Connectors: connections (the rules behind ``/api/connectors``) and the helpers every stream
shares.

Final in Phase 0: :class:`ConnectorError`, :func:`get_owned`, :func:`read_secret`,
:func:`write_secret`, :func:`stored_tools`, :func:`serialize`, :func:`upstream_headers`.
:func:`upstream_target` is a stub (stream B1.5). Stream B1 adds connect, change, check, scope,
disconnect and grants. Contract: ``docs/superpowers/plans/api/connectors.md``.
"""

import json
import time
import uuid
from urllib.parse import urlsplit

from mcp.types import Tool
from sqlalchemy import select
from sqlalchemy.orm import Session

from tvashtr.control_plane import connector_catalog, connector_net, connector_oauth
from tvashtr.control_plane.credentials import decrypt_secret, encrypt_secret
from tvashtr.control_plane.node_library import _as_uuid
from tvashtr.control_plane.tool_usage import usage_counts
from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection

NOT_FOUND = "Connector not found."
SIGNIN_TTL_SECONDS = 600  # a started sign-in is pending for ten minutes


class ConnectorError(Exception):
    """A rule violation with the HTTP status and ``detail`` (a user-facing string, or a
    ``{code, message, …}`` dict) the route returns verbatim."""

    def __init__(self, status_code: int, detail: str | dict) -> None:
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


def get_owned(
    session: Session, owner_id: uuid.UUID, connection_id: object, *, for_update: bool = False
) -> ConnectorConnection:
    """The owner's connection, or a 404 :class:`ConnectorError` (an unparseable, absent or foreign
    id all answer the same). ``for_update`` takes the row lock (``SELECT … FOR UPDATE``): the one
    lock every writer of the stored sign-in holds before it reads or writes that sign-in."""
    rid = _as_uuid(connection_id)
    query = select(ConnectorConnection).where(
        ConnectorConnection.id == rid, ConnectorConnection.owner_id == owner_id
    )
    if for_update:
        query = query.with_for_update()
    row = session.execute(query).scalar_one_or_none() if rid is not None else None
    if row is None:
        raise ConnectorError(404, NOT_FOUND)
    return row


def _column(pending: bool) -> str:
    return "pending_encrypted" if pending else "secret_encrypted"


def read_secret(row: ConnectorConnection, *, pending: bool = False) -> dict | None:
    """The decrypted sign-in JSON (``secret_encrypted``), or the sign-in in flight with
    ``pending=True`` (``pending_encrypted``). ``None`` when the column is empty. Never return or
    log what this gives back."""
    ciphertext = getattr(row, _column(pending))
    return json.loads(decrypt_secret(ciphertext)) if ciphertext else None


def write_secret(row: ConnectorConnection, value: dict | None, *, pending: bool = False) -> None:
    """Encrypt ``value`` onto the row (``None`` clears the column). The caller's session commits."""
    setattr(row, _column(pending), encrypt_secret(json.dumps(value)) if value is not None else None)


def stored_tools(tools: list[Tool]) -> list[dict]:
    """A provider's tool list in the shape kept in ``tools``: ``{"name", "title", "read_only"}``.
    ``read_only`` is true only for an explicit ``readOnlyHint: true``."""
    return [
        {
            "name": tool.name,
            "title": tool.title or (tool.annotations.title if tool.annotations else None),
            "read_only": bool(tool.annotations and tool.annotations.readOnlyHint is True),
        }
        for tool in tools
    ]


def _signin(row: ConnectorConnection) -> tuple[str | None, bool]:
    """``(signin_host, signin_pending)`` for an OAuth connection, from the sign-in in flight and
    then the stored one."""
    if row.auth_kind != "oauth":
        return None, False
    pending = read_secret(row, pending=True) or {}
    stored = read_secret(row) or {}
    endpoint = (
        pending.get("authorization_endpoint")
        or stored.get("authorization_endpoint")
        or pending.get("issuer")
        or stored.get("issuer")
    )
    started = pending.get("started_at")
    in_flight = (
        row.state_hash is not None
        and isinstance(started, int | float)
        and time.time() - started < SIGNIN_TTL_SECONDS
    )
    return (urlsplit(endpoint).hostname if endpoint else None), in_flight


def serialize(row: ConnectorConnection, users: list[dict] | None = None) -> dict:
    """One connection as every connection endpoint returns it. ``users`` are the usage rows of the
    agents that have it (they become ``used_by``). Nothing encrypted and no ``state_hash`` is ever
    in the result."""
    entry = connector_catalog.resolve(row.connector_key) or {}
    host = urlsplit(row.url).hostname
    signin_host, signin_pending = _signin(row)
    picker = entry.get("scope_picker")
    agent_count, team_count = usage_counts(users or [])
    tools = None
    if row.tools is not None:
        tools = []
        for tool in row.tools:
            write = connector_catalog.is_write(entry, tool, row.access)
            tools.append(
                {
                    "name": tool.get("name"),
                    "title": tool.get("title"),
                    "write": write,
                    "on": row.access == "write" or not write,
                }
            )
    return {
        "id": str(row.id),
        "connector_key": row.connector_key,
        "name": row.name,
        "slug": row.slug,
        "publisher": entry.get("publisher"),
        "featured": bool(entry.get("featured")),
        "reviewed": bool(entry.get("featured")),
        "category": entry.get("category"),
        "host": host,
        "auth_kind": row.auth_kind,
        "signin_host": signin_host,
        "signin_host_differs": bool(
            signin_host and host and connector_net.site(signin_host) != connector_net.site(host)
        ),
        "access": row.access,
        "access_modes": list(entry.get("access_modes") or ["read", "write"]),
        "read_only_by": entry.get("read_only_by") or "annotations",
        "scope": row.scope,
        "scope_picker": {"param": picker["param"], "label": picker["label"]} if picker else None,
        "status": row.status,
        "signin_pending": signin_pending,
        "last_error": row.last_error,
        "tools": tools,
        "used_by": {"agent_count": agent_count, "team_count": team_count},
        "connected_at": row.connected_at.isoformat() if row.connected_at else None,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def upstream_headers(row: ConnectorConnection, *, rejected: str | None = None) -> dict:
    """The credential headers for a request to the provider: the key's stored headers, or
    ``Authorization: Bearer`` with a token from ``connector_oauth.ensure_access_token`` (which may
    refresh; ``rejected`` is the token the provider just answered 401 to), or nothing. Raises
    ``connector_oauth.SignInRefused`` / ``Unreachable`` for an OAuth connection. Don't call it
    while holding this row's lock: the token call takes that lock in its own session."""
    if row.auth_kind == "api_key":
        return dict((read_secret(row) or {}).get("headers") or {})
    if row.auth_kind == "oauth":
        token = connector_oauth.ensure_access_token(row.id, rejected=rejected)
        return {"Authorization": f"Bearer {token}"}
    return {}


def upstream_target(row: ConnectorConnection, access: str) -> tuple[str, str]:
    """``(url, transport)`` for a request to the provider at the effective ``access``: the row's
    address plus the scope parameter, plus the entry's read-only parameters when ``access`` is
    ``read``.

    Phase 0 stub: the row's own ``url`` and ``transport``. Stream B1.5 adds the parameters."""
    return row.url, row.transport


def list_connections(owner_id: uuid.UUID) -> list[dict]:
    """The owner's connections, oldest first, ``pending`` rows left out
    (``GET /api/connectors``)."""
    with session_scope() as session:
        rows = session.execute(
            select(ConnectorConnection)
            .where(
                ConnectorConnection.owner_id == owner_id, ConnectorConnection.status != "pending"
            )
            .order_by(ConnectorConnection.created_at, ConnectorConnection.id)
        ).scalars()
        return [serialize(row) for row in rows]
