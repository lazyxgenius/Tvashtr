"""Home — the cross-run inbox, the run list views, spend, GitHub branches and scopes."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import spend

router = APIRouter()

CurrentUser = Annotated[UserOut, Depends(get_current_user)]


@router.get("/api/spend")
def get_spend(current_user: CurrentUser, tz: str = "UTC") -> dict:
    """The account's spend this calendar month and this week (Monday start) in the caller's time
    zone ``tz`` (IANA name), plus this month per library team. Live: in-flight, failed and
    cancelled runs count. 422 on an unknown time zone."""
    try:
        return spend.owner_spend(uuid.UUID(current_user.id), tz)
    except spend.UnknownTimeZoneError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
