"""M8 — Compare two versions (ruling R5; contract ``docs/superpowers/plans/api/compare.md``).
Every route is owner-scoped: another account's team or compare is a 404."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import compare
from tvashtr.db import session_scope

router = APIRouter()
CurrentUser = Annotated[UserOut, Depends(get_current_user)]
Number = Annotated[int, Field(ge=1, le=2**31 - 1)]  # a version number (an INTEGER column)


class CompareRequest(BaseModel):
    a: Number
    b: Number
    task: str = Field(max_length=20_000)
    auto_approve: bool = True


def _owner(user: UserOut) -> uuid.UUID:
    return uuid.UUID(user.id)


@router.get("/api/teams/{team_id}/compare")
def compare_tab(team_id: str, current_user: CurrentUser) -> dict:
    """The Compare tab: the versions, previous vs current, the target, the estimate and the newest
    compare of the team."""
    owner = _owner(current_user)
    with session_scope() as session:
        return compare.page(session, compare._require_team(session, team_id, owner), owner)


@router.get("/api/teams/{team_id}/compare/changes")
def compare_changes(
    team_id: str,
    current_user: CurrentUser,
    a: Annotated[int, Query(ge=1, le=2**31 - 1)],
    b: Annotated[int, Query(ge=1, le=2**31 - 1)],
) -> dict:
    """What changed from vA to vB (M5's What changed rows). 404 for an unknown version."""
    with session_scope() as session:
        team = compare._require_team(session, team_id, _owner(current_user))
        return compare.changes(session, team, a, b)


@router.post("/api/teams/{team_id}/compare", status_code=201)
def start_compare(team_id: str, body: CompareRequest, current_user: CurrentUser) -> dict:
    """Run vA and vB on one task at once (or wait for two free slots)."""
    return compare.create(
        _owner(current_user),
        team_id,
        a=body.a,
        b=body.b,
        task=body.task,
        auto_approve=body.auto_approve,
    )


@router.get("/api/compares/{compare_id}")
def get_compare(compare_id: str, current_user: CurrentUser) -> dict:
    """The running page (polled every 2 s, R15): both lanes, then the results."""
    return compare.view(_owner(current_user), compare_id)


@router.post("/api/compares/{compare_id}/stop")
def stop_compare(compare_id: str, current_user: CurrentUser) -> dict:
    """Stop a waiting or running compare: both runs end Stopped. Idempotent."""
    return compare.stop(_owner(current_user), compare_id)
