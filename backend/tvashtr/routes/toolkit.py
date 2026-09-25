"""Toolkit — tool/skill usage, turning tools and skills on for agents, imports, secrets extras.

Thin HTTP layer over :mod:`tvashtr.control_plane.toolkit` (the rules) and
:mod:`tvashtr.control_plane.tool_usage` (who uses what). Every route is owner-scoped: another
account's tool/skill/agent is a 404. This router is included BEFORE ``routers.py`` in ``main.py``,
so literal paths such as ``/api/tool-library/import`` are never shadowed by an ``{item_id}`` route.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import toolkit
from tvashtr.control_plane.toolkit import ToolkitError

router = APIRouter()

CurrentUser = Annotated[UserOut, Depends(get_current_user)]


def _owner(user: UserOut) -> uuid.UUID:
    return uuid.UUID(user.id)


def _http(exc: ToolkitError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/api/toolkit/summary")
def toolkit_summary(current_user: CurrentUser) -> dict:
    """Counts for the Toolkit nav badges: ``{tools, tools_needing_attention, skills,
    memory:{inbox,active,archive}, secrets_missing}``."""
    return toolkit.summary(_owner(current_user))


@router.get("/api/agents")
def list_agents(
    current_user: CurrentUser, tool_id: str | None = None, skill_id: str | None = None
) -> dict:
    """The account's library-team agents grouped by team, each saying whether it uses
    ``tool_id`` / ``skill_id`` (``enabled``) and whether an inline item overrides it."""
    try:
        return toolkit.list_agents(_owner(current_user), tool_id=tool_id, skill_id=skill_id)
    except ToolkitError as exc:
        raise _http(exc) from None
