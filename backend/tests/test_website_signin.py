"""The website's GitHub sign-in (website.md B-2/B-3): ``GET /api/auth/github/start`` and the
callback's website branch. The state cookie carries the CSRF nonce and the return address; every
outcome lands on the sign-in screens. An older client (no state, no cookie) is unchanged — pinned in
tests/test_github_endpoints.py.
"""

import time
import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from itsdangerous import TimestampSigner
from pydantic import SecretStr
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane import github_app, web_signin
from tvashtr.db import session_scope
from tvashtr.models import User

FRONTEND = "https://app.tvashtr.example"
CALLBACK = "/api/auth/github/callback"


@pytest.fixture
def hosted(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "hosted_mode", True)
    monkeypatch.setattr(s, "github_app_client_id", "Iv1.webclient")
    monkeypatch.setattr(s, "github_app_client_secret", SecretStr("web-client-secret"))
    monkeypatch.setattr(s, "public_base_url", "https://tvashtr.example")
    monkeypatch.setattr(s, "frontend_origin", FRONTEND)
    monkeypatch.setattr(s, "cookie_secure", False)


def _fake_github(gh_id: int, *, fail: bool = False):
    def fake_http(method, url, *, token=None, body=None, accept="application/vnd.github+json"):
        if url.endswith("/login/oauth/access_token"):
            if fail:
                raise github_app.GithubAppError("bad_verification_code")
            return {"access_token": "ghu_web", "token_type": "bearer"}
        if "/user/installations" in url:
            return {"total_count": 0, "installations": []}
        if url.endswith("/user"):
            return {"id": gh_id, "login": "web-signin", "email": None}
        raise AssertionError(f"unexpected GitHub URL: {url!r}")

    return fake_http


def _start(client, next_path: str | None = None) -> str:
    """Start a sign-in; returns GitHub's ``state`` (the cookie is now in ``client``'s jar)."""
    url = "/api/auth/github/start" + (f"?next={next_path}" if next_path else "")
    resp = client.get(url, follow_redirects=False)
    assert resp.status_code == 302
    return parse_qs(urlparse(resp.headers["location"]).query)["state"][0]


def test_start_redirects_to_github_with_state_and_sets_the_state_cookie(unauth_client, hosted):
    resp = unauth_client.get("/api/auth/github/start?next=/teams/abc", follow_redirects=False)
    assert resp.status_code == 302
    location = urlparse(resp.headers["location"])
    assert f"{location.scheme}://{location.netloc}{location.path}" == (
        "https://github.com/login/oauth/authorize"
    )
    query = parse_qs(location.query)
    assert query["client_id"] == ["Iv1.webclient"]
    assert query["redirect_uri"] == ["https://tvashtr.example/api/auth/github/callback"]
    state = query["state"][0]
    cookie = resp.headers["set-cookie"]
    assert cookie.startswith("tv_oauth_state=")
    for attr in ("HttpOnly", "Max-Age=600", "Path=/api/auth/github", "SameSite=lax"):
        assert attr in cookie
    value = unauth_client.cookies.get("tv_oauth_state")
    assert web_signin.read_state(value) == {"n": state, "next": "/teams/abc"}


def test_start_is_404_when_not_hosted(unauth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    resp = unauth_client.get("/api/auth/github/start", follow_redirects=False)
    assert resp.status_code == 404


@pytest.mark.parametrize(
    "value,kept",
    [
        ("/teams/abc?node=x&tab=runs", "/teams/abc?node=x&tab=runs"),
        ("/home", "/home"),
        ("//evil.example/x", None),
        ("https://evil.example", None),
        ("/teams/<script>", None),
        ("/" + "a" * 301, None),
        ("", None),
    ],
)
def test_next_is_kept_only_when_it_is_an_app_address(value, kept):
    _, cookie = web_signin.new_state(value)
    assert web_signin.read_state(cookie)["next"] == kept


def test_callback_signs_in_and_returns_to_signin_done_with_next(unauth_client, hosted, monkeypatch):
    gh_id = uuid.uuid4().int % 2_000_000_000
    monkeypatch.setattr(github_app, "_http", _fake_github(gh_id))
    state = _start(unauth_client, "/teams/abc")
    resp = unauth_client.get(f"{CALLBACK}?code=c1&state={state}", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == f"{FRONTEND}/#/signin/done?next=%2Fteams%2Fabc"
    cookies = resp.headers.get_list("set-cookie")
    assert any(c.startswith("tv_session=") for c in cookies)
    assert any(c.startswith('tv_oauth_state=""') or "tv_oauth_state=;" in c for c in cookies)
    assert unauth_client.get("/api/auth/me").json()["github_login"] == "web-signin"
    with session_scope() as s:
        assert s.execute(select(User).where(User.github_user_id == gh_id)).scalar_one()


def test_callback_without_next_goes_to_signin_done(unauth_client, hosted, monkeypatch):
    monkeypatch.setattr(github_app, "_http", _fake_github(uuid.uuid4().int % 2_000_000_000))
    state = _start(unauth_client)
    resp = unauth_client.get(f"{CALLBACK}?code=c1&state={state}", follow_redirects=False)
    assert resp.headers["location"] == f"{FRONTEND}/#/signin/done"


@pytest.mark.parametrize(
    "error,shown", [("access_denied", "cancelled"), ("server_error", "failed")]
)
def test_github_error_returns_to_signin_with_a_reason(unauth_client, hosted, error, shown):
    state = _start(unauth_client)
    resp = unauth_client.get(f"{CALLBACK}?error={error}&state={state}", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == f"{FRONTEND}/#/signin?error={shown}"
    assert "tv_session=" not in resp.headers.get("set-cookie", "")


def test_state_mismatch_is_expired_and_signs_no_one_in(unauth_client, hosted, monkeypatch):
    monkeypatch.setattr(github_app, "_http", _fake_github(uuid.uuid4().int % 2_000_000_000))
    _start(unauth_client)
    resp = unauth_client.get(f"{CALLBACK}?code=c1&state=forged-state-0001", follow_redirects=False)
    assert resp.headers["location"] == f"{FRONTEND}/#/signin?error=expired"
    assert "tv_session=" not in resp.headers.get("set-cookie", "")
    assert unauth_client.get("/api/auth/me").status_code == 401


def test_a_state_cookie_without_github_state_is_expired(unauth_client, hosted, monkeypatch):
    monkeypatch.setattr(github_app, "_http", _fake_github(uuid.uuid4().int % 2_000_000_000))
    _start(unauth_client)
    resp = unauth_client.get(f"{CALLBACK}?code=c1", follow_redirects=False)
    assert resp.headers["location"] == f"{FRONTEND}/#/signin?error=expired"
    assert "tv_session=" not in resp.headers.get("set-cookie", "")


def test_an_old_state_cookie_is_expired(unauth_client, hosted, monkeypatch):
    monkeypatch.setattr(github_app, "_http", _fake_github(uuid.uuid4().int % 2_000_000_000))
    with monkeypatch.context() as m:
        m.setattr(TimestampSigner, "get_timestamp", lambda self: int(time.time()) - 601)
        nonce, cookie = web_signin.new_state(None)
    resp = unauth_client.get(
        f"{CALLBACK}?code=c1&state={nonce}",
        headers={"cookie": f"tv_oauth_state={cookie}"},
        follow_redirects=False,
    )
    assert resp.headers["location"] == f"{FRONTEND}/#/signin?error=expired"


def test_github_refusing_the_code_is_failed_not_a_json_400(unauth_client, hosted, monkeypatch):
    monkeypatch.setattr(github_app, "_http", _fake_github(1, fail=True))
    state = _start(unauth_client)
    resp = unauth_client.get(f"{CALLBACK}?code=c1&state={state}", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == f"{FRONTEND}/#/signin?error=failed"
    assert "tv_session=" not in resp.headers.get("set-cookie", "")
