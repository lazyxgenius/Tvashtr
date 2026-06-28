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

import uuid
from typing import Annotated

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from itsdangerous import BadData, URLSafeTimedSerializer
from pydantic import BaseModel
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.models import User

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
    return URLSafeTimedSerializer(get_settings().session_secret, salt=_COOKIE_SALT)


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

    ``secure=False`` for local http dev. PRODUCTION over https MUST set ``secure=True`` (and supply
    a real ``TVASHTR_SESSION_SECRET``); ``SameSite=lax`` already blocks cross-site sends."""
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=make_session_cookie_value(user_id),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """Expire the ``tv_session`` cookie (logout). Path/SameSite must match the set call to clear."""
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/", samesite="lax")


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
