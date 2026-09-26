"""The website's GitHub sign-in state (website.md B-2/B-3; contract ``plans/api/website.md``).

``GET /api/auth/github/start`` sends the browser to GitHub with a random ``state`` and keeps that
nonce, plus the app address to return to (``next``), in a signed, 10-minute ``tv_oauth_state``
cookie scoped to ``/api/auth/github``. The callback accepts the sign-in only when GitHub's
``state`` equals the cookie's nonce (login CSRF). No table: the cookie is the whole state.
"""

import re
import secrets

from itsdangerous import BadData, URLSafeTimedSerializer

from tvashtr.config import get_settings

STATE_COOKIE = "tv_oauth_state"
COOKIE_PATH = "/api/auth/github"
MAX_AGE_SECONDS = 10 * 60
_SALT = "tv-web-state"
# An app address like ``/teams/<id>?node=x`` — never ``//host`` or a scheme (no open redirect).
_NEXT_RE = re.compile(r"/(?!/)[A-Za-z0-9/_?=&.%-]{0,300}")


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret.get_secret_value(), salt=_SALT)


def safe_next(value: str | None) -> str | None:
    """``value`` when it is an app address, else ``None`` (dropped, never an error)."""
    return value if value and _NEXT_RE.fullmatch(value) else None


def new_state(next_path: str | None) -> tuple[str, str]:
    """``(nonce, cookie value)`` for one sign-in attempt."""
    nonce = secrets.token_urlsafe(24)
    return nonce, _serializer().dumps({"n": nonce, "next": safe_next(next_path)})


def read_state(value: str | None, max_age: int = MAX_AGE_SECONDS) -> dict | None:
    """``{"n", "next"}`` from a genuine, unexpired cookie; ``None`` when missing, forged or old."""
    if not value:
        return None
    try:
        payload = _serializer().loads(value, max_age=max_age)
    except BadData:
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("n"), str):
        return None
    return {"n": payload["n"], "next": safe_next(payload.get("next"))}
