"""The public website (website.md §3; contract ``docs/superpowers/plans/api/website.md``).

``public_router`` is mounted in ``main.py`` WITHOUT ``get_current_user`` (like ``auth_router``):
nothing here reads or writes an account.

* ``GET /api/auth/github/start?next=`` — hosted mode only: start the website's GitHub sign-in with
  a CSRF ``state`` and remember where to return (``control_plane.web_signin``). The callback's
  website branch lives in ``auth.github_callback``.
* ``GET /api/public/site`` — repo, star count and latest Desktop release
  (``control_plane.site_info``).
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from tvashtr.config import get_settings
from tvashtr.control_plane import github_app, site_info, web_signin

public_router = APIRouter()


@public_router.get("/api/auth/github/start")
def github_start(next: str | None = None) -> RedirectResponse:  # noqa: A002 — the query name
    settings = get_settings()
    authorize = github_app.build_install_url() if settings.hosted_mode else ""
    if not authorize:
        raise HTTPException(status_code=404, detail="Not found")
    nonce, cookie = web_signin.new_state(next)
    response = RedirectResponse(url=f"{authorize}&state={nonce}", status_code=302)
    response.set_cookie(
        key=web_signin.STATE_COOKIE,
        value=cookie,
        max_age=web_signin.MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path=web_signin.COOKIE_PATH,
    )
    return response


@public_router.get("/api/public/site")
def public_site() -> dict:
    return site_info.site_info()
