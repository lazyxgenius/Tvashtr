"""Connectors — the OAuth sign-in routes.

``router`` needs a session (``POST /api/connectors/{id}/oauth/start``). ``public_router`` does not:
the browser that finishes a sign-in may hold no Tvashtr session (Desktop opens the system
browser), so the callback, its confirm step and the client metadata document are public, and the
owner comes from the row found by the ``state``. Thin HTTP layer over
:mod:`tvashtr.control_plane.connector_oauth`. Contract:
``docs/superpowers/plans/api/connectors.md`` (OAuth).
"""

import html
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse

from tvashtr.auth import SESSION_COOKIE_NAME, UserOut, get_current_user, read_session_cookie
from tvashtr.control_plane import connector_oauth
from tvashtr.control_plane.connector_oauth import Outcome
from tvashtr.control_plane.connectors import ConnectorError

router = APIRouter()
public_router = APIRouter()

CurrentUser = Annotated[UserOut, Depends(get_current_user)]


@router.post("/api/connectors/{connection_id}/oauth/start")
def start_sign_in(connection_id: str, current_user: CurrentUser) -> dict:
    """``{"authorize_url", "signin_host", "expires_in"}``: where to send the browser. Works on a
    ``pending``, ``needs_signin`` or ``connected`` row ("Sign in again")."""
    try:
        return connector_oauth.start(uuid.UUID(current_user.id), connection_id)
    except ConnectorError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


# ---- the public pages ----

CONFIRM_PATH = "/api/connectors/oauth/confirm"

_EXPIRED = "This sign-in link has expired. Go back to Tvashtr and try again."
_OTHER_ACCOUNT = (
    "This browser is signed in to Tvashtr as a different account. Nothing was connected. "
    "Log out of Tvashtr in this browser, then start the sign-in again."
)
# The address of these pages carries ``code`` and ``state``: never cached, never sent on in a
# ``Referer``, never framed (the confirm button must be pressed by the person looking at it).
_PAGE_HEADERS = {
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
}
_STYLE = """
:root { color-scheme: light; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #faf9f5; color: #141413;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { width: 440px; max-width: calc(100% - 32px); display: flex; flex-direction: column;
  align-items: center; gap: 16px; text-align: center; }
p { margin: 0; font-size: 16px; line-height: 1.55; }
button { height: 40px; padding: 0 18px; border: 0; border-radius: 10px; background: #d97757;
  color: #fff; font-size: 14px; font-weight: 500; cursor: pointer; }
button:hover { background: #c8623f; }
"""


def _page(message: str, extra: str = "") -> HTMLResponse:
    """One message and, optionally, trusted markup after it. ``message`` is escaped here: no
    text from a provider, a connection's name or the request is ever rendered raw."""
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Tvashtr</title>
<style>{_STYLE}</style>
</head>
<body>
<main>
<p>{html.escape(message)}</p>
{extra}
</main>
</body>
</html>
"""
    return HTMLResponse(content=page, headers=_PAGE_HEADERS)


def _hidden(name: str, value: str) -> str:
    return f'<input type="hidden" name="{name}" value="{html.escape(value, quote=True)}">'


def _render(outcome: Outcome, state: str, code: str, iss: str) -> HTMLResponse:
    name = outcome.name
    if outcome.kind == "connected":
        # Closes the web app's popup; an ordinary browser tab stays open with the message.
        return _page(
            f"{name} is connected. You can close this window.", "<script>window.close()</script>"
        )
    if outcome.kind == "confirm":
        # The owner's email in full: a masked one is matched by any account an attacker registers.
        fields = (
            _hidden("state", state) + _hidden("code", code) + (_hidden("iss", iss) if iss else "")
        )
        form = (
            f'<form method="post" action="{CONFIRM_PATH}">{fields}'
            '<button type="submit">Connect</button></form>'
        )
        return _page(f"Connect {name} to the Tvashtr account {outcome.email}?", form)
    if outcome.kind == "denied":
        return _page(f"You didn’t allow access on {name}.")
    if outcome.kind == "other_account":
        return _page(_OTHER_ACCOUNT)
    if outcome.kind == "failed":
        return _page(f"{name} didn’t finish the sign-in. Try again.")
    return _page(_EXPIRED)


@public_router.get("/api/connectors/oauth/callback", response_class=HTMLResponse)
def oauth_callback(
    request: Request, state: str = "", code: str = "", iss: str = "", error: str = ""
) -> HTMLResponse:
    """Where the provider sends the browser back. Always an HTML page, never JSON and never a
    redirect into the app (the app polls the connection instead)."""
    cookie = request.cookies.get(SESSION_COOKIE_NAME)
    session_user = read_session_cookie(cookie) if cookie else None
    outcome = connector_oauth.callback(state, code, iss or None, error or None, session_user)
    return _render(outcome, state, code, iss)


@public_router.post(CONFIRM_PATH, response_class=HTMLResponse)
def oauth_confirm(
    state: Annotated[str, Form()] = "",
    code: Annotated[str, Form()] = "",
    iss: Annotated[str, Form()] = "",
) -> HTMLResponse:
    """The confirm page's button (a browser with no Tvashtr session)."""
    return _render(connector_oauth.confirm(state, code, iss or None), state, code, iss)


@public_router.get(connector_oauth.CLIENT_METADATA_PATH)
def client_metadata_document() -> dict:
    """Tvashtr's client ID metadata document: what a sign-in server fetches when Tvashtr names
    this address as its ``client_id``. 404 unless ``TVASHTR_PUBLIC_BASE_URL`` is ``https://``."""
    document = connector_oauth.client_metadata()
    if document is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return document
