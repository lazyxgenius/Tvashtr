"""M-accounts Slice A — the auth surface (register/login/logout/me), enforcement, and the
cookie/hash primitives. Mutation-real: real status codes, the cookie actually set/cleared, and a
tampered/expired cookie genuinely rejected — not smoke asserts.
"""

import uuid

from tvashtr.auth import (
    hash_password,
    make_session_cookie_value,
    read_session_cookie,
    verify_password,
)


def _uuid_email() -> str:
    return f"auth-test-{uuid.uuid4().hex}@tvashtr.local"


# ---- register ----


def test_register_creates_account_sets_cookie_and_authenticates(unauth_client):
    email = _uuid_email()
    resp = unauth_client.post(
        "/api/auth/register", json={"email": email, "password": "password123"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email"] == email
    assert uuid.UUID(body["id"])  # a real uuid id was returned
    # The cookie is actually set, HttpOnly + SameSite=lax.
    assert "tv_session" in resp.cookies
    set_cookie = resp.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=lax" in set_cookie
    # The client now carries the session — /me resolves to the same identity.
    me = unauth_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == body


def test_register_normalizes_email(unauth_client):
    raw = "  MixedCase-" + uuid.uuid4().hex + "@TvAshtr.local  "
    resp = unauth_client.post("/api/auth/register", json={"email": raw, "password": "password123"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["email"] == raw.strip().lower()


def test_register_duplicate_email_409(unauth_client):
    email = _uuid_email()
    assert (
        unauth_client.post(
            "/api/auth/register", json={"email": email, "password": "password123"}
        ).status_code
        == 200
    )
    # Same email (any case/whitespace variant normalizes to the same stored value) → conflict.
    dup = unauth_client.post(
        "/api/auth/register", json={"email": email.upper(), "password": "password123"}
    )
    assert dup.status_code == 409


def test_register_validation_422(unauth_client):
    # No "@" in the email.
    assert (
        unauth_client.post(
            "/api/auth/register", json={"email": "not-an-email", "password": "password123"}
        ).status_code
        == 422
    )
    # Empty email.
    assert (
        unauth_client.post(
            "/api/auth/register", json={"email": "   ", "password": "password123"}
        ).status_code
        == 422
    )
    # Password shorter than 8.
    assert (
        unauth_client.post(
            "/api/auth/register", json={"email": _uuid_email(), "password": "short"}
        ).status_code
        == 422
    )


# ---- login ----


def test_login_succeeds_with_correct_credentials(unauth_client):
    email, pw = _uuid_email(), "password123"
    assert (
        unauth_client.post("/api/auth/register", json={"email": email, "password": pw}).status_code
        == 200
    )
    unauth_client.cookies.clear()  # forget the register session — log in from a clean slate
    resp = unauth_client.post("/api/auth/login", json={"email": email, "password": pw})
    assert resp.status_code == 200, resp.text
    assert resp.json()["email"] == email
    assert "tv_session" in resp.cookies
    assert unauth_client.get("/api/auth/me").status_code == 200


def test_login_wrong_password_401(unauth_client):
    email, pw = _uuid_email(), "password123"
    unauth_client.post("/api/auth/register", json={"email": email, "password": pw})
    unauth_client.cookies.clear()
    resp = unauth_client.post(
        "/api/auth/login", json={"email": email, "password": "wrong-password"}
    )
    assert resp.status_code == 401
    assert "tv_session" not in resp.cookies


def test_login_unknown_email_401(unauth_client):
    resp = unauth_client.post(
        "/api/auth/login", json={"email": _uuid_email(), "password": "password123"}
    )
    assert resp.status_code == 401


# ---- logout ----


def test_logout_clears_the_session(unauth_client):
    email, pw = _uuid_email(), "password123"
    unauth_client.post("/api/auth/register", json={"email": email, "password": pw})
    assert unauth_client.get("/api/auth/me").status_code == 200  # logged in

    out = unauth_client.post("/api/auth/logout")
    assert out.status_code == 204
    # The logout response actively expires the cookie (an expired/empty Set-Cookie).
    assert "tv_session" in out.headers.get("set-cookie", "").lower()
    # Mutation-real: the session is genuinely gone — the next /me is 401.
    assert unauth_client.get("/api/auth/me").status_code == 401


# ---- me / the current-user dependency ----


def test_me_requires_a_session(unauth_client):
    assert unauth_client.get("/api/auth/me").status_code == 401


def test_me_returns_identity_for_the_authenticated_client(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    body = resp.json()
    assert uuid.UUID(body["id"]) and "@" in body["email"]


def test_tampered_cookie_is_rejected(unauth_client):
    unauth_client.cookies.set("tv_session", "forged.tampered.value")
    assert unauth_client.get("/api/auth/me").status_code == 401


def test_valid_signature_unknown_user_is_rejected(unauth_client):
    # A correctly-SIGNED cookie for a user id that doesn't exist must still 401 (the dependency
    # loads the user from the DB, not just trusts the signature).
    unauth_client.cookies.set("tv_session", make_session_cookie_value(str(uuid.uuid4())))
    assert unauth_client.get("/api/auth/me").status_code == 401


# ---- enforcement on the product surface (the reproduce-first analog) ----


def test_protected_endpoint_401_without_session_200_with(unauth_client, client):
    # GET /api/teams is 401 without a session ...
    assert unauth_client.get("/api/teams").status_code == 401
    # ... and 200 with one (the authenticated shared client).
    assert client.get("/api/teams").status_code == 200


def test_health_stays_open(unauth_client):
    # The liveness probe the e2e harness curls must NOT require a session.
    assert unauth_client.get("/health").status_code == 200


def test_spike_endpoints_require_a_session(unauth_client):
    assert unauth_client.get("/api/spike/hello-durable/nope").status_code == 401
    assert unauth_client.post("/api/spike/hello-durable").status_code == 401


# ---- the cookie + hash primitives (units, no HTTP) ----


def test_password_hash_roundtrip():
    h = hash_password("correct horse battery staple")
    assert h != "correct horse battery staple"  # actually hashed
    assert verify_password("correct horse battery staple", h)
    assert not verify_password("wrong", h)
    # A malformed stored hash returns False rather than raising (a corrupt row can't 500 login).
    assert not verify_password("anything", "not-a-bcrypt-hash")


def test_session_cookie_signs_reads_and_expires():
    uid = str(uuid.uuid4())
    value = make_session_cookie_value(uid)
    assert read_session_cookie(value) == uid
    # Expired (forced via the max_age seam) → None.
    assert read_session_cookie(value, max_age=-1) is None
    # Tampered → None.
    tampered = value[:-1] + ("A" if value[-1] != "A" else "B")
    assert read_session_cookie(tampered) is None
