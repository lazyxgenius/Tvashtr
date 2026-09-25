"""Home — the cross-run inbox, the run list views, spend, GitHub branches and scopes."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import github_app, github_targets, inbox, spend

router = APIRouter()

CurrentUser = Annotated[UserOut, Depends(get_current_user)]


class DismissalRequest(BaseModel):
    """``POST /api/inbox/dismissals``: dismiss an item, or snooze it until ``until``."""

    key: str
    action: Literal["dismiss", "snooze"]
    until: datetime | None = None
    # Which Home the item was seen on — Desktop's setup gaps are ``setup:<team>:desktop``.
    surface: Literal["website", "desktop"] = "website"


@router.get("/api/inbox")
def get_inbox(current_user: CurrentUser, surface: str = "website") -> dict:
    """Home's "Needs you": approvals, budget nudges, failed runs, setup gaps and memories to
    review, across every run and team the caller owns, oldest first (dismissed and snoozed items
    left out). ``surface=desktop`` reports a team's gap for this computer when it has one."""
    try:
        return inbox.get_inbox(uuid.UUID(current_user.id), surface=surface)
    except inbox.InboxError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc


@router.post("/api/inbox/dismissals")
def post_inbox_dismissal(body: DismissalRequest, current_user: CurrentUser) -> dict:
    """Dismiss or snooze one current inbox item. 404 unless the key is one of the caller's current
    items; 422 for dismissing an approval (snooze only) or snoozing without a future ``until``."""
    try:
        return inbox.dismiss(
            uuid.UUID(current_user.id), body.key, body.action, body.until, surface=body.surface
        )
    except inbox.InboxError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc


@router.delete("/api/inbox/dismissals/{key:path}", status_code=204)
def delete_inbox_dismissal(key: str, current_user: CurrentUser) -> Response:
    """Undo a dismissal or snooze (idempotent: 204 whether or not one existed)."""
    inbox.undo(uuid.UUID(current_user.id), key)
    return Response(status_code=204)


@router.get("/api/spend")
def get_spend(current_user: CurrentUser, tz: str = "UTC") -> dict:
    """The account's spend this calendar month and this week (Monday start) in the caller's time
    zone ``tz`` (IANA name), plus this month per library team. Live: in-flight, failed and
    cancelled runs count. 422 on an unknown time zone."""
    try:
        return spend.owner_spend(uuid.UUID(current_user.id), tz)
    except spend.UnknownTimeZoneError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


_GITHUB_UNREACHABLE = "Couldn't reach GitHub. Try again in a moment."


def _owned_repo(current_user: UserOut, owner: str, repo: str) -> tuple[int, dict]:
    try:
        match = github_targets.owner_repo(uuid.UUID(current_user.id), f"{owner}/{repo}")
    except github_app.GithubAppError as exc:
        raise HTTPException(status_code=502, detail=_GITHUB_UNREACHABLE) from exc
    if match is None:
        raise HTTPException(status_code=404, detail="repo not found")
    return match


@router.get("/api/github/repos/{owner}/{repo}/branches")
def get_github_branches(owner: str, repo: str, current_user: CurrentUser) -> dict:
    """The branches of one of the caller's GitHub App repos (default branch first, capped at 300)
    — the composer's Base branch option. 404 unless an installation the caller owns reaches it."""
    installation_id, found = _owned_repo(current_user, owner, repo)
    try:
        return github_targets.branches_for(installation_id, found)
    except github_app.GithubAppError as exc:
        raise HTTPException(status_code=502, detail=_GITHUB_UNREACHABLE) from exc


@router.get("/api/github/repos/{owner}/{repo}/subpaths")
def get_github_subpaths(
    owner: str, repo: str, current_user: CurrentUser, ref: str | None = None
) -> dict:
    """The top-level folders (with file counts) of one of the caller's GitHub App repos on ``ref``
    (default: its default branch) — the composer's Scope option. 404 for a repo the caller can't
    reach, 422 for an unknown branch."""
    installation_id, found = _owned_repo(current_user, owner, repo)
    try:
        result = github_targets.subpaths_for(installation_id, found, ref)
    except github_app.GithubAppError as exc:
        raise HTTPException(status_code=502, detail=_GITHUB_UNREACHABLE) from exc
    if result is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unknown_ref",
                "message": f"ref is not a branch of {owner}/{repo}",
                "ref": ref,
            },
        )
    return result
