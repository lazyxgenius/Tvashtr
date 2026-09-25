"""Account — per-account preferences, and duplicating a team."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane.preferences import (
    PreferenceError,
    get_preferences,
    update_preferences,
)
from tvashtr.control_plane.teams import duplicate_library_team

router = APIRouter()


@router.get("/api/account/preferences")
def get_account_preferences(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The current account's UI preferences, defaults merged in —
    ``{"get_started_hidden": false}``."""
    prefs = get_preferences(uuid.UUID(current_user.id))
    if prefs is None:  # a now-deleted user (get_current_user already 401s first)
        raise HTTPException(status_code=401, detail="Not authenticated")
    return prefs


@router.patch("/api/account/preferences")
def patch_account_preferences(
    current_user: Annotated[UserOut, Depends(get_current_user)],
    body: Annotated[dict[str, Any], Body()],
) -> dict:
    """Merge ``body`` into the current account's preferences and return the full object. 422 on an
    unknown key ("Unknown preference: <key>.") or a value of the wrong type ("<key> must be true or
    false."); nothing is stored then."""
    try:
        prefs = update_preferences(uuid.UUID(current_user.id), body)
    except PreferenceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if prefs is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return prefs


class DuplicateTeamRequest(BaseModel):
    """``POST /api/teams/{id}/duplicate`` body (optional): the copy's name, default
    ``"{name} (copy)"``."""

    name: str | None = None


@router.post("/api/teams/{team_id}/duplicate", status_code=201)
def duplicate_team(
    team_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
    body: DuplicateTeamRequest | None = None,
) -> dict:
    """Duplicate one of the current account's library teams — same agents, settings, wiring and
    layout; no runs, no agent memories — and return the new team's summary (201). 400 on a
    malformed id; 404 if it is not the current account's library team; 422 "A team name is
    required." on a blank ``name``."""
    try:
        tid = uuid.UUID(team_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid team id") from exc
    try:
        summary = duplicate_library_team(
            tid, uuid.UUID(current_user.id), body.name if body is not None else None
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="A team name is required.") from exc
    if summary is None:
        raise HTTPException(status_code=404, detail="library team not found")
    return summary
