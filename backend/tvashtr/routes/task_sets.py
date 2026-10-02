"""M9 — task sets (contract ``docs/superpowers/plans/api/task-sets.md``). Every route is
owner-scoped: another account's team or set is a 404."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import compare, task_sets
from tvashtr.db import session_scope

router = APIRouter()
CurrentUser = Annotated[UserOut, Depends(get_current_user)]


class TaskSetItemIn(BaseModel):
    # Generous caps against oversized bodies; the real limits (80 / 2000, 1–20 tasks) are checked
    # after trimming, with plain words.
    task: str = Field(max_length=20_000)
    starts_from: str | None = Field(default=None, max_length=255)
    hidden_check: str = Field(max_length=20_000)


class TaskSetIn(BaseModel):
    name: str = Field(max_length=1_000)
    items: list[TaskSetItemIn] = Field(max_length=200)


def _owner(user: UserOut) -> uuid.UUID:
    return uuid.UUID(user.id)


@router.get("/api/teams/{team_id}/task-sets")
def list_task_sets(team_id: str, current_user: CurrentUser) -> dict:
    """The team's task sets: tasks with their hidden checks, when each was last used, and what
    comparing two versions on it would cost."""
    with session_scope() as session:
        team = compare._require_team(session, team_id, _owner(current_user))
        return task_sets.listing(session, team)


@router.post("/api/teams/{team_id}/task-sets", status_code=201)
def create_task_set(team_id: str, body: TaskSetIn, current_user: CurrentUser) -> dict:
    owner = _owner(current_user)
    with session_scope() as session:
        team = compare._require_team(session, team_id, owner)
        return task_sets.create(
            session, team, owner, body.name, [i.model_dump() for i in body.items]
        )


@router.patch("/api/task-sets/{set_id}")
def update_task_set(set_id: str, body: TaskSetIn, current_user: CurrentUser) -> dict:
    """Rename it and replace its tasks as a whole (409 while a compare on it is running)."""
    with session_scope() as session:
        return task_sets.update(
            session, _owner(current_user), set_id, body.name, [i.model_dump() for i in body.items]
        )


@router.delete("/api/task-sets/{set_id}", status_code=204)
def delete_task_set(set_id: str, current_user: CurrentUser) -> Response:
    """Delete it; its compares and runs stay (409 while a compare on it is running)."""
    with session_scope() as session:
        task_sets.remove(session, _owner(current_user), set_id)
    return Response(status_code=204)
