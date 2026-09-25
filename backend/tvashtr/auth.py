"""Minimal email/password authentication (M-accounts Slice A).

One openhands-free module holding the whole identity surface for this slice:

* password hashing (bcrypt),
* a signed, timed ``tv_session`` cookie (itsdangerous),
* the ``get_current_user`` FastAPI dependency that gates the product surface, and
* the ``/api/auth`` router (register / login / logout / me).

This slice is identity + login enforcement ONLY. (M-accounts Slice B then made model-key resolution
per-owner — a run resolves its owner's encrypted ``provider_credentials`` key, no ``.env`` fallback;
see :mod:`tvashtr.control_plane.credentials`.)
"""

import logging
import uuid
from typing import Annotated
from urllib.parse import urlparse

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from itsdangerous import BadData, URLSafeTimedSerializer
from pydantic import BaseModel
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane import github_app
from tvashtr.db import session_scope
from tvashtr.models import GithubInstallation, User

logger = logging.getLogger("tvashtr.auth")

# The session cookie the browser carries after login. HttpOnly + signed; the payload is the user id.
SESSION_COOKIE_NAME = "tv_session"
# 14 days — a comfortable "stay logged in" window for local/dev use.
SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60
# A fixed salt namespaces this serializer's signatures (itsdangerous best practice).
_COOKIE_SALT = "tv-session"


# ---- Password hashing (bcrypt) ----


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt (a fresh random salt per hash). bcrypt truncates the
    input at 72 bytes — acceptable for v1 (we deliberately do not pre-hash)."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """True iff ``password`` matches ``password_hash``. Returns False (never raises) on a malformed
    stored hash, so a corrupt row can't 500 the login path."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


# ---- The signed session cookie (itsdangerous) ----


def _serializer() -> URLSafeTimedSerializer:
    # Read the secret at call time (not import time) so the env-configured secret is honored and
    # tests can point at a different secret if needed.
    return URLSafeTimedSerializer(
        get_settings().session_secret.get_secret_value(), salt=_COOKIE_SALT
    )


def make_session_cookie_value(user_id: str) -> str:
    """Sign ``user_id`` into the timed, tamper-evident ``tv_session`` cookie value."""
    return _serializer().dumps(str(user_id))


def read_session_cookie(value: str, max_age: int = SESSION_MAX_AGE_SECONDS) -> str | None:
    """Return the signed user id, or ``None`` if the cookie is tampered/forged/expired.

    ``max_age`` defaults to the real 14-day window; it is a seam so expiry is unit-testable without
    time travel (``read_session_cookie(v, max_age=-1)`` forces expiry)."""
    try:
        return _serializer().loads(value, max_age=max_age)
    except BadData:
        # BadData is the base of BadSignature + SignatureExpired → covers forged/tampered/expired.
        return None


def set_session_cookie(response: Response, user_id: str) -> None:
    """Attach the signed ``tv_session`` cookie to ``response``.

    ``secure`` comes from config (M-h4): FALSE locally, because a browser will not store a Secure
    cookie delivered over ``http://localhost``; TRUE in the deployed app, where TLS is real and the
    flag stops the session from ever riding a plain-http request. ``SameSite=lax`` stays — the SPA
    is served one-origin from this same backend, so the cookie is first-party and needs no
    cross-site relaxation."""
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=make_session_cookie_value(user_id),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """Expire the ``tv_session`` cookie (logout).

    EVERY attribute must match the ``set_session_cookie`` call above — path, samesite AND ``secure``
    (M-h4). A browser matches the clearing ``Set-Cookie`` against the stored cookie's attributes, so
    a non-Secure expiry leaves a Secure cookie sitting in the jar: logout would return 204 and the
    user would still be signed in."""
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        samesite="lax",
        secure=get_settings().cookie_secure,
    )


# ---- The current-user dependency + the auth router ----


class UserOut(BaseModel):
    """The minimal public identity returned by the auth endpoints and ``get_current_user`` —
    enough for the endpoints today and for ownership in a later slice."""

    id: str
    email: str


def get_current_user(request: Request) -> UserOut:
    """FastAPI dependency: resolve the logged-in user from the ``tv_session`` cookie, else 401.

    Raises ``HTTPException(401)`` when the cookie is absent, tampered, forged, expired, or names a
    user that no longer exists. This is the single gate the product router hangs off."""
    raw = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = read_session_cookie(raw)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        pk = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="Not authenticated") from None
    with session_scope() as session:
        user = session.get(User, pk)
        if user is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return UserOut(id=str(user.id), email=user.email)


def _normalize_email(email: str) -> str:
    """The canonical stored form: trimmed + lower-cased. The unique constraint is on this value."""
    return email.strip().lower()


class _Credentials(BaseModel):
    email: str
    password: str


auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


@auth_router.post("/register", response_model=UserOut)
def register(body: _Credentials, response: Response) -> UserOut:
    """Open registration (v1): create an account and log it in. 422 on light validation failure,
    409 if the email is taken."""
    email = _normalize_email(body.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="A valid email is required.")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")
    with session_scope() as session:
        if session.scalar(select(User).where(User.email == email)) is not None:
            raise HTTPException(status_code=409, detail="That email is already registered.")
        user = User(email=email, password_hash=hash_password(body.password))
        session.add(user)
        session.flush()  # populate user.id before the scope commits/closes
        user_id = str(user.id)
    set_session_cookie(response, user_id)
    return UserOut(id=user_id, email=email)


@auth_router.post("/login", response_model=UserOut)
def login(body: _Credentials, response: Response) -> UserOut:
    """Log in an existing account. 401 on unknown email OR bad password (one message — don't leak
    which emails exist)."""
    email = _normalize_email(body.email)
    with session_scope() as session:
        user = session.scalar(select(User).where(User.email == email))
        if user is None or not verify_password(body.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password.")
        user_id = str(user.id)
    set_session_cookie(response, user_id)
    return UserOut(id=user_id, email=email)


@auth_router.post("/logout", status_code=204)
def logout() -> Response:
    """Clear the session cookie. 204, no body."""
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


@auth_router.get("/me", response_model=UserOut)
def me(current_user: Annotated[UserOut, Depends(get_current_user)]) -> UserOut:
    """The logged-in identity — 401 (via the dependency) without a valid session. The FE login gate
    calls this on load."""
    return current_user


# ---- GitHub App sign-in (M-h1a, HOSTED mode) ----

# A Django "unusable password" sentinel: NOT a valid bcrypt hash, so ``verify_password`` (which
# returns False on a malformed hash) can NEVER match it. A GitHub-authenticated account exists but
# has no password and can only sign in via GitHub — the password path's schema (NOT NULL
# ``password_hash``) is untouched, so every existing gate still authenticates.
UNUSABLE_PASSWORD_HASH = "!github-oauth-no-password"


def _github_email(identity: dict) -> str:
    """The account email for a GitHub identity: the account's GitHub email if present, else the
    stable ``<login>@users.noreply.github.com`` fallback (GitHub may keep the email private).
    Normalized exactly like the password path so the ``users.email`` unique constraint matches."""
    raw = identity.get("email") or f"{identity.get('login')}@users.noreply.github.com"
    return _normalize_email(raw)


def _find_or_link_github_user(
    session, github_user_id: int, github_login: str | None, email: str
) -> User:
    """Find-or-create-or-LINK the account behind a GitHub identity:

    1. an account already linked to this ``github_user_id`` -> reuse it (refresh the login);
    2. else one with the same ``email`` -> LINK it (attach github_user_id/login), so a user who
       first registered with email/password and later "Continue with GitHub" keeps ONE account;
    3. else create a new account with an unusable placeholder password (GitHub-only sign-in).

    ``session.flush()`` populates ``user.id`` before the scope closes (mirrors ``register``)."""
    user = session.scalar(select(User).where(User.github_user_id == github_user_id))
    if user is None and email:
        user = session.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            password_hash=UNUSABLE_PASSWORD_HASH,
            github_user_id=github_user_id,
            github_login=github_login,
        )
        session.add(user)
    else:
        user.github_user_id = github_user_id
        user.github_login = github_login
    session.flush()
    return user


def _store_installation(session, owner_id, installation_id: str) -> None:
    """Record (or re-own) the installation for this account. ``installation_id`` is UNIQUE
    — a re-auth by the same owner is a no-op; a re-install re-points ownership to whoever just
    proved control via OAuth. NO token is stored (installation tokens are minted on demand)."""
    try:
        inst_id = int(installation_id)
    except (TypeError, ValueError):
        return
    row = session.scalar(
        select(GithubInstallation).where(GithubInstallation.installation_id == inst_id)
    )
    if row is None:
        session.add(GithubInstallation(owner_id=owner_id, installation_id=inst_id))
    else:
        row.owner_id = owner_id


# Desktop Electron (loopback) may proxy the GitHub callback and ask Fly to (a) exchange the code
# with the loopback ``redirect_uri`` and (b) bounce the browser back to the local SPA origin.
# ONLY 127.0.0.1 / localhost over http are accepted — never an arbitrary Origin (open redirect).
_DESKTOP_REDIRECT_URI_HEADER = "x-tvashtr-redirect-uri"
_DESKTOP_FRONTEND_ORIGIN_HEADER = "x-tvashtr-frontend-origin"


def _is_allowlisted_desktop_loopback(url: str, *, expect_callback_path: bool) -> bool:
    """True iff ``url`` is http://127.0.0.1|localhost[:port][/…] with no credentials.

    When ``expect_callback_path`` is True, the path must be the GitHub OAuth callback path.
    When False (frontend origin), the path must be empty or ``/`` with no query/fragment.
    """
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return False
    if parsed.scheme != "http":
        return False
    if parsed.hostname not in ("127.0.0.1", "localhost"):
        return False
    if parsed.username is not None or parsed.password is not None:
        return False
    if expect_callback_path:
        return parsed.path.rstrip("/") == github_app.GITHUB_CALLBACK_PATH.rstrip("/")
    return parsed.path in ("", "/") and not parsed.query and not parsed.fragment


def _desktop_redirect_uri_from_request(request: Request) -> str | None:
    raw = request.headers.get(_DESKTOP_REDIRECT_URI_HEADER)
    if not raw:
        return None
    if _is_allowlisted_desktop_loopback(raw, expect_callback_path=True):
        return raw.strip()
    logger.warning("Ignoring non-allowlisted desktop redirect_uri header")
    return None


def _desktop_frontend_origin_from_request(request: Request) -> str | None:
    raw = request.headers.get(_DESKTOP_FRONTEND_ORIGIN_HEADER)
    if not raw:
        return None
    candidate = raw.strip().rstrip("/")
    # Accept with or without trailing slash for allowlist check.
    if _is_allowlisted_desktop_loopback(candidate, expect_callback_path=False) or (
        _is_allowlisted_desktop_loopback(candidate + "/", expect_callback_path=False)
    ):
        return candidate
    logger.warning("Ignoring non-allowlisted desktop frontend-origin header")
    return None


@auth_router.get("/github/callback")
def github_callback(
    request: Request,
    code: str | None = None,
    installation_id: str | None = None,
    setup_action: str | None = None,
) -> RedirectResponse:
    """Complete GitHub App sign-in (HOSTED mode). GitHub redirects the browser here after the user
    authorizes/installs:``?code`` identifies the user; ``?installation_id`` + ``?setup_action``
    name the installation they granted. Exchange the code for a user token, read the identity,
    find-or-create-or-link the account, record the installation, then issue the SAME signed
    ``tv_session`` cookie the password path issues and redirect into the app.

    Desktop Electron may proxy this callback from ``http://127.0.0.1:<port>`` and send
    ``X-Tvashtr-Redirect-Uri`` + ``X-Tvashtr-Frontend-Origin`` (loopback allowlist only) so the
    token exchange matches the authorize ``redirect_uri`` and the post-login bounce returns to the
    local SPA — without changing fly.dev web login.

    Unauthenticated by design — it is how a GitHub user obtains their first session, so it lives on
    ``auth_router`` (mounted WITHOUT ``get_current_user``). 404s when ``hosted_mode`` is off."""
    settings = get_settings()
    if not settings.hosted_mode:
        raise HTTPException(status_code=404, detail="Not found")
    if not code:
        # Revamp (Toolkit › Browse "Install GitHub App"): an App whose Setup URL is this callback
        # but which does not request user authorization on install returns ``?installation_id`` +
        # ``?setup_action`` with NO ``code``. Without a code nothing proves who installed it, so
        # nothing is recorded (``/api/github/status`` backfills installations App-side) and the
        # session is left as it is — just send the browser back to the app, which re-reads status.
        frontend = _desktop_frontend_origin_from_request(request) or settings.frontend_origin
        return RedirectResponse(url=frontend, status_code=302)
    desktop_redirect_uri = _desktop_redirect_uri_from_request(request)
    try:
        user_token = github_app.exchange_code_for_user_token(
            code, redirect_uri=desktop_redirect_uri
        )
        identity = github_app.get_authenticated_user(user_token)
    except github_app.GithubAppError:
        # Never surface the underlying GitHub error (defense-in-depth: it could echo a code/secret).
        raise HTTPException(status_code=400, detail="GitHub sign-in failed.") from None

    # Discover installations the user already granted (OAuth-authorize returns ?code but NO
    # installation_id). A GitHub hiccup must NOT break sign-in — the user still gets their session.
    discovered_ids: list[int] = []
    try:
        discovered_ids = github_app.list_user_installations(user_token)
    except github_app.GithubAppError:
        logger.exception(
            "list_user_installations failed during GitHub callback; continuing sign-in"
        )

    with session_scope() as session:
        user = _find_or_link_github_user(
            session, int(identity["id"]), identity.get("login"), _github_email(identity)
        )
        user_id = str(user.id)
        # Prefer the explicit ?installation_id (install flow) AND every id discovered from
        # GET /user/installations. _store_installation is idempotent on the unique installation_id
        # constraint (re-owns to the current user; no duplicate rows).
        if installation_id:
            _store_installation(session, user.id, installation_id)
        for iid in discovered_ids:
            _store_installation(session, user.id, str(iid))

    # Rider 4 (M-h1b): bounce to the CONFIGURABLE FE origin, not the backend root "/" (which 404s on
    # the API port). Desktop may override with an allowlisted loopback origin via proxy header.
    frontend = _desktop_frontend_origin_from_request(request) or settings.frontend_origin
    response = RedirectResponse(url=frontend, status_code=302)
    set_session_cookie(response, user_id)
    return response
