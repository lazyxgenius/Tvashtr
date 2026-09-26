"""Tvashtr Desktop app screens — sign-in through the browser, the latest release, job release
(desktop-app.md §3; contract ``docs/superpowers/plans/api/desktop-app.md``).

Two routers:

* ``public_router`` — mounted in ``main.py`` WITHOUT ``get_current_user`` (like ``auth_router``):
  ``GET /api/auth/desktop/start``, ``POST /api/auth/desktop/exchange`` (how Desktop obtains its
  session) and ``GET /api/desktop/release`` (public release data only).
* ``router`` — session-gated and owner-scoped: ``POST /api/desktop-runner/jobs/{job_id}/release``.

The logic lives in :mod:`tvashtr.control_plane.desktop_auth`, ``desktop_release`` and
``desktop_jobs.release_job``.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from tvashtr.auth import (
    SESSION_COOKIE_NAME,
    UserOut,
    display_name_for,
    get_current_user,
    read_session_cookie,
    set_session_cookie,
)
from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_auth, desktop_jobs, desktop_release
from tvashtr.db import session_scope
from tvashtr.models import User

public_router = APIRouter()
router = APIRouter()

CurrentUser = Annotated[UserOut, Depends(get_current_user)]


def _require_hosted() -> None:
    if not get_settings().hosted_mode:
        raise HTTPException(status_code=404, detail="Not found")


def _load_user(user_id: str | None) -> UserOut | None:
    if not user_id:
        return None
    try:
        pk = uuid.UUID(user_id)
    except ValueError:
        return None
    with session_scope() as session:
        user = session.get(User, pk)
        if user is None:
            return None
        return UserOut(
            id=str(user.id),
            email=user.email,
            github_login=user.github_login,
            display_name=display_name_for(user.email, user.github_login),
        )


@public_router.get("/api/auth/desktop/start")
def desktop_start(
    request: Request,
    challenge: str | None = None,
    state: str | None = None,
    account: str = "github",
) -> Response:
    """Start a Desktop sign-in in the user's browser. ``account=current`` with a valid browser
    session answers at once with the return page (no GitHub step); otherwise → GitHub."""
    _require_hosted()
    if (
        not desktop_auth.valid_challenge(challenge)
        or not desktop_auth.valid_state(state)
        or account not in ("current", "github")
    ):
        return desktop_auth.return_page(desktop_auth.DONE_LINK, "broken", status_code=400)
    assert challenge is not None and state is not None  # narrowed by the checks above
    if account == "current":
        raw = request.cookies.get(SESSION_COOKIE_NAME)
        user = _load_user(read_session_cookie(raw) if raw else None)
        if user is not None:
            code = desktop_auth.make_code(user.id, challenge)
            link = desktop_auth.done_link(state=state, code=code)
            return desktop_auth.return_page(link, "signed_in")
    url = desktop_auth.authorize_url(desktop_auth.sign_state(challenge, state))
    if not url:
        # Hosted mode without a GitHub App client id: nothing to send the browser to.
        return desktop_auth.return_page(desktop_auth.DONE_LINK, "broken", status_code=400)
    return RedirectResponse(
        url=url,
        status_code=302,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


class DesktopExchangeRequest(BaseModel):
    code: str
    verifier: str


@public_router.post("/api/auth/desktop/exchange", response_model=UserOut)
def desktop_exchange(body: DesktopExchangeRequest, response: Response) -> UserOut:
    """Desktop main redeems the one-time code with its PKCE verifier → the Desktop session."""
    _require_hosted()
    try:
        user_id = desktop_auth.redeem_code(body.code, body.verifier)
    except desktop_auth.DesktopAuthError as exc:
        raise HTTPException(status_code=400, detail=exc.detail) from None
    user = _load_user(user_id)
    if user is None:
        raise HTTPException(status_code=400, detail=desktop_auth.EXPIRED_COPY)
    set_session_cookie(response, user.id)
    response.headers["Cache-Control"] = "no-store"
    return user


class DesktopReleaseResponse(BaseModel):
    version: str | None
    tag: str | None
    published_at: str | None
    dmg_url: str
    release_url: str | None
    checked_at: str


@public_router.get("/api/desktop/release", response_model=DesktopReleaseResponse)
def desktop_latest_release() -> DesktopReleaseResponse:
    """The latest ``desktop-v*`` GitHub release (cached 10 minutes; nulls when GitHub is down)."""
    return DesktopReleaseResponse(**desktop_release.latest_release())


class JobReleaseResponse(BaseModel):
    job_id: str
    status: str


@router.post("/api/desktop-runner/jobs/{job_id}/release", response_model=JobReleaseResponse)
def release_desktop_job(job_id: str, current_user: CurrentUser) -> JobReleaseResponse:
    """Desktop is quitting or restarting: hand the claimed job back to the queue so the relaunched
    runner starts the step again."""
    try:
        out = desktop_jobs.release_job(uuid.UUID(current_user.id), job_id)
    except desktop_jobs.JobNotFound:
        raise HTTPException(status_code=404, detail="job not found") from None
    except desktop_jobs.JobConflict:
        raise HTTPException(status_code=409, detail=desktop_jobs.NOT_CLAIMED_ERROR) from None
    return JobReleaseResponse(**out)
