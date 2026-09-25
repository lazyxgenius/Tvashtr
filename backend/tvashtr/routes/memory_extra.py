"""Memory — requeue, scope changes, repo list, counts.

The revamp's additions to the memory surface (Toolkit › Memory, the agent drawer's Memory tab). The
existing ``/api/memories`` CRUD stays in ``routers.py`` (its ``PATCH`` gained ``scope``).
Thin: validate, call ``control_plane``, map ``None`` to 404. Owner-scoped via ``current_user``.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import memory_repos, memory_review

router = APIRouter()


@router.post("/api/memories/{memory_id}/requeue")
def requeue_memory_endpoint(
    memory_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Send a memory back to the Inbox — the Undo of Keep (promote, incl. a merge or supersede) and
    of Discard (reject). 404 unless it is the caller's memory."""
    row = memory_review.requeue(uuid.UUID(current_user.id), memory_id)
    if row is None:
        raise HTTPException(status_code=404, detail="memory not found")
    return row


@router.get("/api/memories/counts")
def memory_counts_endpoint(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """``{"inbox", "active", "archive"}`` for the Memory tabs and the nav badge."""
    return memory_repos.memory_counts(uuid.UUID(current_user.id))


@router.get("/api/memory/repos")
def memory_repos_endpoint(
    current_user: Annotated[UserOut, Depends(get_current_user)], include_github: bool = False
) -> dict:
    """The repos a memory can be scoped to (repo filter, Add memory's repo select)."""
    return {
        "repos": memory_repos.list_memory_repos(
            uuid.UUID(current_user.id), include_github=include_github
        )
    }
