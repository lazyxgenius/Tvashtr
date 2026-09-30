"""Connectors — the catalog, connections and per-agent grants (``/api/connectors…``).

Thin HTTP layer over :mod:`tvashtr.control_plane.connectors` (the rules) and
:mod:`tvashtr.control_plane.connector_catalog`. Every route needs a session and is owner-scoped:
another account's connection or agent is a 404. Contract:
``docs/superpowers/plans/api/connectors.md``. Phase 0 has the list only; stream B1 adds the rest.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import connectors
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
