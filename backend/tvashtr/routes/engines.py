"""Engines — provider usage, the provider directory, Desktop check-in status."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane.engine_usage import engine_usage

router = APIRouter()


@router.get("/api/engines/usage")
def get_engine_usage(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """Which of the caller's library teams (agent/completion nodes, incl. fallback models) and
    domains use each provider. Owner-scoped and read-only; see ``control_plane.engine_usage``."""
    return engine_usage(uuid.UUID(current_user.id))
