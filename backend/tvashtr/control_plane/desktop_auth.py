"""Tvashtr Desktop sign-in through the system browser (desktop-app.md §3, DT-6..DT-10).

Stateless PKCE over two short-lived, signed itsdangerous payloads — no table:

1. Desktop main makes a verifier and its SHA-256 challenge, then opens the user's default browser
   on ``GET /api/auth/desktop/start?challenge=&state=&account=current|github``.
2. ``account=current`` with a valid ``tv_session`` in that browser answers at once with the return
   page. Otherwise the browser goes to GitHub's authorize page carrying a signed desktop state
   (salt ``tv-desktop-state``, 15 minutes) that holds the challenge and Desktop's own state.
3. GitHub's callback (``auth.github_callback``) recognises the signed desktop state, signs the
   browser in as usual and answers with the return page, whose link is ALWAYS
   ``tvashtr://auth/done?code=<signed {user, challenge}, salt tv-desktop-code, 5 minutes>&state=``.
4. Desktop main posts ``{code, verifier}`` to ``POST /api/auth/desktop/exchange``; the code is
   useless without the verifier, which never leaves Desktop main.
"""

import base64
import hashlib
import html
import json
import re
from typing import Literal
from urllib.parse import quote, urlencode

from fastapi.responses import HTMLResponse
from itsdangerous import BadData, SignatureExpired, URLSafeTimedSerializer

from tvashtr.config import get_settings
from tvashtr.control_plane import github_app

STATE_SALT = "tv-desktop-state"
CODE_SALT = "tv-desktop-code"
STATE_MAX_AGE_SECONDS = 15 * 60
CODE_MAX_AGE_SECONDS = 5 * 60

# The only place a return page ever points. Never a caller-supplied URL (no open redirect).
DONE_LINK = "tvashtr://auth/done"

_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
_STATE_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
_VERIFIER_RE = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")

BROKEN_LINK_COPY = "This sign-in link is broken. Go back to Tvashtr Desktop and try again."
EXPIRED_COPY = "This sign-in has expired. Sign in again."
OTHER_WINDOW_COPY = "This sign-in belongs to another app window. Sign in again."

Outcome = Literal["signed_in", "cancelled", "expired", "broken"]


class DesktopAuthError(Exception):
    """An exchange failure whose message is the exact user-facing ``detail``."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def _serializer(salt: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret.get_secret_value(), salt=salt)


def valid_challenge(value: str | None) -> bool:
    return bool(value) and bool(_CHALLENGE_RE.fullmatch(value))


def valid_state(value: str | None) -> bool:
    return bool(value) and bool(_STATE_RE.fullmatch(value))


def valid_verifier(value: str | None) -> bool:
    return bool(value) and bool(_VERIFIER_RE.fullmatch(value))


def challenge_for(verifier: str) -> str:
    """``base64url(sha256(verifier))`` without padding (RFC 7636 S256)."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def sign_state(challenge: str, state: str) -> str:
    return _serializer(STATE_SALT).dumps({"c": challenge, "s": state})


def read_state(token: str | None, max_age: int = STATE_MAX_AGE_SECONDS) -> dict | None:
    """``{"c", "s", "expired": bool}`` when ``token`` is a desktop state this server signed, else
    ``None``. An expired one is still recognised (so the browser shows the expired page instead of
    signing in to the website by mistake); a forged or foreign one is not."""
    if not token:
        return None
    serializer = _serializer(STATE_SALT)
    try:
        payload = serializer.loads(token, max_age=max_age)
        expired = False
    except SignatureExpired as exc:
        # The signature is genuine (only its age failed); the raw payload still needs decoding.
        try:
            payload = serializer.load_payload(exc.payload) if exc.payload is not None else None
        except BadData:
            return None
        expired = True
    except BadData:
        return None
    if not isinstance(payload, dict):
        return None
    c, s = payload.get("c"), payload.get("s")
    if not (isinstance(c, str) and isinstance(s, str) and valid_challenge(c) and valid_state(s)):
        return None
    return {"c": c, "s": s, "expired": expired}


def make_code(user_id: str, challenge: str) -> str:
    return _serializer(CODE_SALT).dumps({"u": str(user_id), "c": challenge})


def redeem_code(code: str, verifier: str, max_age: int = CODE_MAX_AGE_SECONDS) -> str:
    """The user id the code names, once the verifier proves this is the Desktop that started the
    sign-in. Raises :class:`DesktopAuthError` with the exact ``detail`` copy otherwise.
    ``max_age`` is a seam so expiry is testable without time travel."""
    try:
        payload = _serializer(CODE_SALT).loads(code, max_age=max_age)
    except BadData:
        raise DesktopAuthError(EXPIRED_COPY) from None
    if not isinstance(payload, dict):
        raise DesktopAuthError(EXPIRED_COPY)
    user_id, challenge = payload.get("u"), payload.get("c")
    if not isinstance(user_id, str) or not isinstance(challenge, str):
        raise DesktopAuthError(EXPIRED_COPY)
    if not valid_verifier(verifier) or challenge_for(verifier) != challenge:
        raise DesktopAuthError(OTHER_WINDOW_COPY)
    return user_id


def authorize_url(signed_state: str) -> str:
    """GitHub's authorize page with the SAME explicit callback as the website's sign-in
    (``github_app.build_install_url``) plus the signed desktop state. Empty when no client id is
    configured."""
    base = github_app.build_install_url()
    if not base:
        return ""
    return f"{base}&state={quote(signed_state, safe='')}"


def done_link(*, state: str, code: str | None = None, error: str | None = None) -> str:
    params: dict[str, str] = {}
    if code is not None:
        params["code"] = code
    if error is not None:
        params["error"] = error
    params["state"] = state
    return f"{DONE_LINK}?{urlencode(params)}"


_COPY: dict[str, tuple[str, str]] = {
    "signed_in": (
        "You’re signed in",
        "Go back to Tvashtr Desktop to continue. You can close this tab.",
    ),
    "cancelled": ("Sign-in cancelled", "Nothing was changed. Go back to Tvashtr Desktop."),
    "expired": ("This sign-in expired", EXPIRED_COPY),
    "broken": ("This link doesn’t work", BROKEN_LINK_COPY),
}


def return_page(link: str, outcome: Outcome, status_code: int = 200) -> HTMLResponse:
    """The page the browser shows after a Desktop sign-in. It opens ``link`` once by itself (when
    the link carries a result) and offers the same link as a button. ``link`` must start with
    :data:`DONE_LINK`; anything else is replaced by it (defence in depth)."""
    if not (link == DONE_LINK or link.startswith(DONE_LINK + "?")):
        link = DONE_LINK
    title, body = _COPY[outcome]
    auto = link != DONE_LINK
    script = f"<script>window.location.href = {json.dumps(link)};</script>" if auto else ""
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>{html.escape(title)} · Tvashtr</title>
<style>
:root {{ color-scheme: light; }}
body {{ margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(90% 70% at 50% 0%, #f7e7df 0%, rgba(247, 231, 223, 0.2) 45%,
  transparent 70%), #faf9f5; color: #141413;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
main {{ width: 440px; max-width: calc(100% - 32px); display: flex; flex-direction: column;
  align-items: center; gap: 16px; text-align: center; }}
h1 {{ margin: 0; font-family: Newsreader, Georgia, serif; font-weight: 400; font-size: 32px; }}
p {{ margin: 0; font-size: 15px; line-height: 1.55; color: #57544c; }}
a.button {{ display: inline-flex; align-items: center; height: 40px; padding: 0 18px;
  border-radius: 10px; background: #d97757; color: #fff; font-size: 14px; font-weight: 500;
  text-decoration: none; }}
a.button:hover {{ background: #c8623f; }}
</style>
</head>
<body>
<main>
<h1>{html.escape(title)}</h1>
<p>{html.escape(body)}</p>
<a class="button" href="{html.escape(link, quote=True)}">Open Tvashtr Desktop</a>
</main>
{script}
</body>
</html>
"""
    return HTMLResponse(
        content=page,
        status_code=status_code,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )
