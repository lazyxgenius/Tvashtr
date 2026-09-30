"""Connectors — the catalog, connections and per-agent grants (``/api/connectors…``).

Thin HTTP layer over :mod:`tvashtr.control_plane.connectors` (the rules) and
:mod:`tvashtr.control_plane.connector_catalog`. Every route needs a session and is owner-scoped:
another account's connection or agent is a 404. Contract:
``docs/superpowers/plans/api/connectors.md``.

``/api/connectors/catalog`` is declared before ``/api/connectors/{connection_id}`` so the literal
path is never read as an id.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import connector_catalog, connectors
from tvashtr.control_plane.connectors import ConnectorError

router = APIRouter()

CurrentUser = Annotated[UserOut, Depends(get_current_user)]


def _owner(user: UserOut) -> uuid.UUID:
    return uuid.UUID(user.id)


def _http(exc: ConnectorError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/api/connectors")
def list_connections(current_user: CurrentUser) -> dict:
    """``{"connections": [connection…]}``, oldest first, ``pending`` rows left out."""
    return {"connections": connectors.list_connections(_owner(current_user))}


@router.post("/api/connectors", status_code=201)
def connect(body: dict, current_user: CurrentUser) -> dict:
    """Connect a catalog entry (``{"key", "access"?, "credentials"?}``) or a custom address
    (``{"url", "name"?, "access"?}``) → the connection."""
    try:
        return connectors.connect(_owner(current_user), body)
    except ConnectorError as exc:
        raise _http(exc) from None


@router.get("/api/connectors/catalog")
def catalog(
    current_user: CurrentUser,
    q: str | None = None,
    category: str | None = None,
    offset: int = 0,
    limit: int = connector_catalog.DEFAULT_LIMIT,
) -> dict:
    """One page of what can be connected: Featured first, then the MCP Registry snapshot by name
    → ``{"items", "total", "next_offset", "categories"}``."""
    try:
        return connectors.catalog(_owner(current_user), q, category, offset, limit)
    except ConnectorError as exc:
        raise _http(exc) from None


@router.get("/api/connectors/{connection_id}")
def get_connection(connection_id: str, current_user: CurrentUser) -> dict:
    """One connection with ``used_by_agents``, ``recent_use`` and ``revoke_hint``."""
    try:
        return connectors.get_connection(_owner(current_user), connection_id)
    except ConnectorError as exc:
        raise _http(exc) from None


@router.patch("/api/connectors/{connection_id}")
def change(connection_id: str, body: dict, current_user: CurrentUser) -> dict:
    """Change ``access``, ``scope``, ``name`` or (a key connection) ``credentials`` → the
    connection."""
    try:
        return connectors.change(_owner(current_user), connection_id, body)
    except ConnectorError as exc:
        raise _http(exc) from None


@router.delete("/api/connectors/{connection_id}")
def disconnect(connection_id: str, current_user: CurrentUser) -> dict:
    """Disconnect: every agent loses it → ``{"removed_from_agents", "revoked"}``."""
    try:
        return connectors.disconnect(_owner(current_user), connection_id)
    except ConnectorError as exc:
        raise _http(exc) from None


@router.post("/api/connectors/{connection_id}/check")
def check(connection_id: str, current_user: CurrentUser) -> dict:
    """Make sure the sign-in still works and list the tools again → the connection."""
    try:
        return connectors.check(_owner(current_user), connection_id)
    except ConnectorError as exc:
        raise _http(exc) from None


@router.get("/api/connectors/{connection_id}/scope-options")
def scope_options(connection_id: str, current_user: CurrentUser) -> dict:
    """The projects the connection can be narrowed to → ``{"param", "label", "manual",
    "options"}``."""
    try:
        return connectors.scope_options(_owner(current_user), connection_id)
    except ConnectorError as exc:
        raise _http(exc) from None
