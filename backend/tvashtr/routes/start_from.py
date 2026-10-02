"""M10 — Start a new run from this one (ruling R9; contract
``docs/superpowers/plans/api/start-from-run.md``). Every route is owner-scoped: another account's
run is a 404."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import start_from

router = APIRouter()
CurrentUser = Annotated[UserOut, Depends(get_current_user)]


class Carry(BaseModel):
    """What the person ticked in the dialog (each kind comes along when true)."""

    spec: bool = True
    decisions: bool = True
    memories: bool = True
    summaries: bool = True


class NextRequest(BaseModel):
    task: str = Field(max_length=20_000)
    carry: Carry = Carry()
    start_from: Literal["pr", "main"]


def _owner(user: UserOut) -> uuid.UUID:
    return uuid.UUID(user.id)


@router.get("/api/runs/{run_id}/next")
def next_dialog(run_id: str, current_user: CurrentUser) -> dict:
    """The dialog: what can come along, where the next run can start, the team version it uses."""
    return start_from.dialog(_owner(current_user), run_id)


@router.post("/api/runs/{run_id}/next", status_code=201)
def start_next(run_id: str, body: NextRequest, current_user: CurrentUser) -> dict:
    """Start the next run (``POST /api/runs``'s path) with a snapshot of what came along."""
    return start_from.start(
        _owner(current_user),
        run_id,
        task=body.task,
        carry=body.carry.model_dump(),
        start_from=body.start_from,
    )


@router.get("/api/runs/{run_id}/carry")
def came_along(run_id: str, current_user: CurrentUser) -> dict:
    """ "See what came along": the run's snapshot (404 for a run that didn't start from one)."""
    return start_from.came_along(_owner(current_user), run_id)


_MEDIA = {"text": "text/plain; charset=utf-8", "jsonl": "application/x-ndjson; charset=utf-8"}


@router.get("/api/runs/{run_id}/log")
def run_log(
    run_id: str, current_user: CurrentUser, format: Literal["text", "jsonl"] = "text"
) -> Response:
    """Download the run log — every step in order, secrets shown as ••••."""
    content, filename = start_from.log(_owner(current_user), run_id, format)
    return Response(
        content,
        media_type=_MEDIA[format],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
