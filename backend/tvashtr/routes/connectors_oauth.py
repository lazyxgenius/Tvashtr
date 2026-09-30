"""Connectors — the OAuth sign-in routes.

``router`` needs a session (``POST /api/connectors/{id}/oauth/start``). ``public_router`` does not:
the browser that finishes a sign-in may hold no Tvashtr session (Desktop opens the system
browser), so the callback, its confirm step and the client metadata document are public, and the
owner comes from the row found by the ``state``. Thin HTTP layer over
:mod:`tvashtr.control_plane.connector_oauth`. Contract:
``docs/superpowers/plans/api/connectors.md`` (OAuth).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import connector_oauth
from tvashtr.control_plane.connectors import ConnectorError

router = APIRouter()
public_router = APIRouter()

CurrentUser = Annotated[UserOut, Depends(get_current_user)]


@router.post("/api/connectors/{connection_id}/oauth/start")
def start_sign_in(connection_id: str, current_user: CurrentUser) -> dict:
    """``{"authorize_url", "signin_host", "expires_in"}``: where to send the browser. Works on a
    ``pending``, ``needs_signin`` or ``connected`` row ("Sign in again")."""
    try:
        return connector_oauth.start(uuid.UUID(current_user.id), connection_id)
    except ConnectorError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
