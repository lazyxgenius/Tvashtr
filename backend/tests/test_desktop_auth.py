"""Desktop sign-in through the system browser (desktop-app.md §3, DT-6..DT-10).

``GET /api/auth/desktop/start`` → GitHub (or straight back with ``account=current``) → the GitHub
callback's desktop branch → the return page linking ``tvashtr://auth/done?code=&state=`` →
``POST /api/auth/desktop/exchange {code, verifier}``. Stateless PKCE: the code is useless without
the verifier, and the return page only ever links ``tvashtr://auth/done``.
"""

import base64
import functools
import hashlib
import re
import secrets
import uuid
from urllib.parse import parse_qs, unquote, urlparse

from fastapi.testclient import TestClient
from pydantic import SecretStr

from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_auth, github_app
from tvashtr.main import app

GH_USER_ID = 7_300_001
GH_LOGIN = "lazyx-desktop"
CLIENT_SECRET_SENTINEL = "SENTINELdesktopCLIENTsecret0001"
USER_TOKEN_SENTINEL = "ghu_SENTINELdesktopUSERtoken0002"

_LINK_RE = re.compile(r'href="(tvashtr://auth/done[^"]*)"')


def _hosted(monkeypatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "hosted_mode", True)
    monkeypatch.setattr(s, "github_app_client_id", "Iv1.desktopclient")
    monkeypatch.setattr(s, "github_app_client_secret", SecretStr(CLIENT_SECRET_SENTINEL))
    monkeypatch.setattr(s, "public_base_url", "https://tvashtr.example")


def _fake_github(gh_id: int = GH_USER_ID, login: str = GH_LOGIN):
    def fake_http(method, url, *, token=None, body=None, accept="application/vnd.github+json"):
        if url.endswith("/login/oauth/access_token"):
            return {"access_token": USER_TOKEN_SENTINEL, "token_type": "bearer"}
        if "/user/installations" in url:
            return {"total_count": 0, "installations": []}
        if url.endswith("/user"):
            return {"id": gh_id, "login": login, "email": None}
        raise AssertionError(f"unexpected GitHub URL: {url!r}")

    return fake_http


def _pkce() -> tuple[str, str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    state = base64.urlsafe_b64encode(secrets.token_bytes(24)).decode().rstrip("=")
    return verifier, challenge, state


def _bare() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    return c


def _done_link(resp) -> dict:
    """The page's ``tvashtr://auth/done`` link, parsed (the same link the auto-open script uses)."""
    links = _LINK_RE.findall(resp.text)
    assert links, resp.text
    link = links[0].replace("&amp;", "&")
    assert f'window.location.href = "{link}"' in resp.text
    parsed = urlparse(link)
    assert (parsed.scheme, parsed.netloc, parsed.path) == ("tvashtr", "auth", "/done")
    return {k: v[0] for k, v in parse_qs(parsed.query).items()}


def _assert_return_page_headers(resp) -> None:
    assert resp.headers["cache-control"] == "no-store"
    assert resp.headers["referrer-policy"] == "no-referrer"
    assert resp.headers["content-type"].startswith("text/html")


# ---------------------------------------------------------------- start


def test_start_is_404_when_not_hosted(unauth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    _, challenge, state = _pkce()
    resp = unauth_client.get(
        f"/api/auth/desktop/start?challenge={challenge}&state={state}", follow_redirects=False
    )
    assert resp.status_code == 404


def test_start_with_broken_params_shows_the_broken_link_page(unauth_client, monkeypatch):
    _hosted(monkeypatch)
    _, challenge, state = _pkce()
    for query in (
        f"challenge=short&state={state}",
        f"challenge={challenge}&state=bad!",
        f"state={state}",
        f"challenge={challenge}&state={state}&account=someone-else",
    ):
        resp = unauth_client.get(f"/api/auth/desktop/start?{query}", follow_redirects=False)
        assert resp.status_code == 400, query
        _assert_return_page_headers(resp)
        assert desktop_auth.BROKEN_LINK_COPY in resp.text
        # No result to hand back: the page links the bare app link and never auto-opens it.
        assert 'href="tvashtr://auth/done"' in resp.text
        assert "window.location" not in resp.text


def test_start_sends_the_browser_to_github_with_a_signed_desktop_state(unauth_client, monkeypatch):
    _hosted(monkeypatch)
    _, challenge, state = _pkce()
    resp = unauth_client.get(
        f"/api/auth/desktop/start?challenge={challenge}&state={state}&account=github",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    loc = urlparse(resp.headers["location"])
    assert (loc.scheme, loc.netloc, loc.path) == ("https", "github.com", "/login/oauth/authorize")
    q = {k: v[0] for k, v in parse_qs(loc.query).items()}
    assert q["client_id"] == "Iv1.desktopclient"
    assert q["redirect_uri"] == "https://tvashtr.example/api/auth/github/callback"
    signed = desktop_auth.read_state(unquote(q["state"]))
    assert signed is not None
    assert (signed["c"], signed["s"], signed["expired"]) == (challenge, state, False)
    # "Use a different account" must be able to pick another GitHub account (review finding).
    assert q["prompt"] == "select_account"
    # The flow is bound to this browser: GitHub's callback must come back to it.
    flow = unauth_client.cookies.get(desktop_auth.FLOW_COOKIE)
    assert flow and flow == signed["n"]
    assert resp.headers["cache-control"] == "no-store"


def test_start_account_current_without_a_session_still_goes_to_github(unauth_client, monkeypatch):
    _hosted(monkeypatch)
    _, challenge, state = _pkce()
    resp = unauth_client.get(
        f"/api/auth/desktop/start?challenge={challenge}&state={state}&account=current",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"].startswith("https://github.com/login/oauth/authorize")


def test_handoff_account_current_reuses_the_browser_session(client, monkeypatch):
    """DT-10: the website's browser is signed in → straight back with a code, no GitHub step."""
    _hosted(monkeypatch)
    browser = _bare()
    email = f"handoff-{uuid.uuid4().hex}@tvashtr.local"
    reg = browser.post("/api/auth/register", json={"email": email, "password": "handoff-pass-1"})
    user_id = reg.json()["id"]
    verifier, challenge, state = _pkce()

    resp = browser.get(
        f"/api/auth/desktop/start?challenge={challenge}&state={state}&account=current",
        follow_redirects=False,
    )
    assert resp.status_code == 200
    _assert_return_page_headers(resp)
    # Review finding: never hand a code out by itself — name the account this browser is signed
    # in as and wait for a click (a planted session or another tvashtr:// handler gets nothing).
    assert "window.location" not in resp.text
    login = reg.json()["display_name"]
    assert f"Continue as {login}" in resp.text
    assert (
        f'href="/api/auth/desktop/start?challenge={challenge}&amp;state={state}&amp;account=github"'
        in resp.text
    ), "Use a different account starts the GitHub path with the same Desktop sign-in"
    link = _LINK_RE.findall(resp.text)[0].replace("&amp;", "&")
    params = {k: v[0] for k, v in parse_qs(urlparse(link).query).items()}
    assert params["state"] == state
    assert "error" not in params

    desktop = _bare()
    out = desktop.post(
        "/api/auth/desktop/exchange", json={"code": params["code"], "verifier": verifier}
    )
    assert out.status_code == 200, out.text
    assert out.json()["id"] == user_id
    assert out.json()["email"] == email
    assert "tv_session" in out.headers.get("set-cookie", "")
    assert desktop.get("/api/auth/me").json()["id"] == user_id


# ---------------------------------------------------------------- the GitHub callback's branch


def _start_state(browser: TestClient, challenge: str, state: str) -> str:
    """Start the flow the way Desktop does, in ``browser``: the signed state GitHub will echo back,
    and ``browser`` now holds the flow cookie that binds the sign-in to it."""
    resp = browser.get(
        f"/api/auth/desktop/start?challenge={challenge}&state={state}&account=github",
        follow_redirects=False,
    )
    assert resp.status_code == 302, resp.text
    q = parse_qs(urlparse(resp.headers["location"]).query)
    return unquote(q["state"][0])


def test_callback_with_a_desktop_state_signs_in_and_hands_back_a_code(unauth_client, monkeypatch):
    _hosted(monkeypatch)
    monkeypatch.setattr(github_app, "_http", _fake_github())
    verifier, challenge, state = _pkce()
    resp = unauth_client.get(
        "/api/auth/github/callback",
        params={"code": "gh-code", "state": _start_state(unauth_client, challenge, state)},
        follow_redirects=False,
    )
    assert resp.status_code == 200, resp.text
    _assert_return_page_headers(resp)
    # The browser is signed in too (the same cookie the website sign-in issues).
    assert "tv_session" in resp.headers.get("set-cookie", "")
    browser_me = unauth_client.get("/api/auth/me").json()
    assert browser_me["github_login"] == GH_LOGIN
    for secret in (USER_TOKEN_SENTINEL, CLIENT_SECRET_SENTINEL):
        assert secret not in resp.text
    params = _done_link(resp)
    assert params["state"] == state

    desktop = _bare()
    out = desktop.post(
        "/api/auth/desktop/exchange", json={"code": params["code"], "verifier": verifier}
    )
    assert out.status_code == 200, out.text
    assert out.json()["id"] == browser_me["id"]
    assert out.json()["display_name"] == GH_LOGIN


def test_callback_cancelled_on_github_links_back_with_cancelled(unauth_client, monkeypatch):
    _hosted(monkeypatch)
    monkeypatch.setattr(github_app, "_http", _fake_github())
    _, challenge, state = _pkce()
    resp = unauth_client.get(
        "/api/auth/github/callback",
        params={
            "error": "access_denied",
            "error_description": "The user has denied your application access.",
            "state": _start_state(unauth_client, challenge, state),
        },
        follow_redirects=False,
    )
    assert resp.status_code == 200
    _assert_return_page_headers(resp)
    assert "Sign-in cancelled" in resp.text
    assert "tv_session" not in resp.headers.get("set-cookie", "")
    assert _done_link(resp) == {"error": "cancelled", "state": state}


def test_callback_whose_github_exchange_fails_links_back_with_failed(unauth_client, monkeypatch):
    # GitHub refused the code (expired / a hiccup): Desktop is told at once, not after 10 minutes.
    _hosted(monkeypatch)

    def refusing_http(method, url, **_kwargs):
        raise github_app.GithubAppError("bad_verification_code")

    monkeypatch.setattr(github_app, "_http", refusing_http)
    _, challenge, state = _pkce()
    resp = unauth_client.get(
        "/api/auth/github/callback",
        params={"code": "gh-code", "state": _start_state(unauth_client, challenge, state)},
        follow_redirects=False,
    )
    assert resp.status_code == 400
    _assert_return_page_headers(resp)
    assert "Sign-in didn’t finish" in resp.text
    assert "bad_verification_code" not in resp.text
    assert "tv_session" not in resp.headers.get("set-cookie", "")
    assert _done_link(resp) == {"error": "failed", "state": state}


def test_callback_with_an_expired_desktop_state_links_back_with_expired(unauth_client, monkeypatch):
    _hosted(monkeypatch)
    monkeypatch.setattr(github_app, "_http", _fake_github())
    monkeypatch.setattr(
        desktop_auth, "read_state", functools.partial(desktop_auth.read_state, max_age=-1)
    )
    _, challenge, state = _pkce()
    resp = unauth_client.get(
        "/api/auth/github/callback",
        params={"code": "gh-code", "state": _start_state(unauth_client, challenge, state)},
        follow_redirects=False,
    )
    assert resp.status_code == 200
    assert "tv_session" not in resp.headers.get("set-cookie", ""), (
        "an expired start signs no one in"
    )
    assert _done_link(resp) == {"error": "expired", "state": state}


def test_callback_without_a_desktop_state_is_unchanged(unauth_client, monkeypatch):
    _hosted(monkeypatch)
    monkeypatch.setattr(github_app, "_http", _fake_github())
    # A foreign/forged state is not a desktop state: the website redirect, as before.
    resp = unauth_client.get(
        "/api/auth/github/callback",
        params={"code": "gh-code", "state": "not-a-signed-state"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"] == get_settings().frontend_origin


# ---------------------------------------------------------------- exchange


def _code_for_new_user(verifier_challenge: str) -> tuple[str, str]:
    c = _bare()
    reg = c.post(
        "/api/auth/register",
        json={"email": f"exch-{uuid.uuid4().hex}@tvashtr.local", "password": "exchange-pass-1"},
    )
    user_id = reg.json()["id"]
    return desktop_auth.make_code(user_id, verifier_challenge), user_id


def test_exchange_rejects_a_verifier_from_another_window(client, monkeypatch):
    _hosted(monkeypatch)
    _, challenge, _ = _pkce()
    code, _ = _code_for_new_user(challenge)
    other_verifier, _, _ = _pkce()
    resp = _bare().post(
        "/api/auth/desktop/exchange", json={"code": code, "verifier": other_verifier}
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "This sign-in belongs to another app window. Sign in again."}
    assert "tv_session" not in resp.headers.get("set-cookie", "")


def test_exchange_rejects_an_expired_or_forged_code(client, monkeypatch):
    _hosted(monkeypatch)
    verifier, challenge, _ = _pkce()
    code, _ = _code_for_new_user(challenge)
    for bad in ("garbage", code[:-3] + "xyz"):
        resp = _bare().post("/api/auth/desktop/exchange", json={"code": bad, "verifier": verifier})
        assert resp.status_code == 400
        assert resp.json() == {"detail": "This sign-in has expired. Sign in again."}
    monkeypatch.setattr(
        desktop_auth, "redeem_code", functools.partial(desktop_auth.redeem_code, max_age=-1)
    )
    resp = _bare().post("/api/auth/desktop/exchange", json={"code": code, "verifier": verifier})
    assert resp.status_code == 400
    assert resp.json() == {"detail": "This sign-in has expired. Sign in again."}


def test_exchange_for_a_deleted_account_is_expired(client, monkeypatch):
    _hosted(monkeypatch)
    verifier, challenge, _ = _pkce()
    code = desktop_auth.make_code(str(uuid.uuid4()), challenge)
    resp = _bare().post("/api/auth/desktop/exchange", json={"code": code, "verifier": verifier})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "This sign-in has expired. Sign in again."


def test_exchange_is_404_when_not_hosted(unauth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    resp = unauth_client.post("/api/auth/desktop/exchange", json={"code": "x", "verifier": "y"})
    assert resp.status_code == 404


# ---------------------------------------------------------------- the return page itself


def test_return_page_only_ever_links_the_desktop_app():
    page = desktop_auth.return_page("https://evil.example/steal", "signed_in")
    assert "evil.example" not in page.body.decode()
    assert 'href="tvashtr://auth/done"' in page.body.decode()
    ok = desktop_auth.return_page(desktop_auth.done_link(state="s" * 20, code="abc"), "signed_in")
    assert "tvashtr://auth/done?code=abc&amp;state=" in ok.body.decode()


def test_pkce_challenge_matches_rfc7636():
    # RFC 7636 appendix B test vector.
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert desktop_auth.challenge_for(verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


# ------------------------------------------------------------ independent review (revamp-finish)


def test_account_current_without_a_session_goes_to_github_without_the_account_picker(
    unauth_client, monkeypatch
):
    _hosted(monkeypatch)
    _, challenge, state = _pkce()
    resp = unauth_client.get(
        f"/api/auth/desktop/start?challenge={challenge}&state={state}&account=current",
        follow_redirects=False,
    )
    q = parse_qs(urlparse(resp.headers["location"]).query)
    assert "prompt" not in q


def test_callback_in_a_browser_that_did_not_start_the_flow_signs_no_one_in(
    unauth_client, monkeypatch
):
    """An attacker's own desktop state + their GitHub code, replayed into a victim's browser, must
    not plant the attacker's session there."""
    _hosted(monkeypatch)
    monkeypatch.setattr(github_app, "_http", _fake_github())
    _, challenge, state = _pkce()
    attacker = _bare()
    signed = _start_state(attacker, challenge, state)
    victim = _bare()
    resp = victim.get(
        "/api/auth/github/callback",
        params={"code": "gh-code", "state": signed},
        follow_redirects=False,
    )
    assert "tv_session" not in resp.headers.get("set-cookie", "")
    assert victim.get("/api/auth/me").status_code == 401
    assert _done_link(resp) == {"error": "expired", "state": state}


def test_callback_with_a_github_error_other_than_access_denied_is_failed_not_cancelled(
    unauth_client, monkeypatch
):
    _hosted(monkeypatch)
    monkeypatch.setattr(github_app, "_http", _fake_github())
    for params in ({"error": "redirect_uri_mismatch"}, {}):
        _, challenge, state = _pkce()
        resp = unauth_client.get(
            "/api/auth/github/callback",
            params={**params, "state": _start_state(unauth_client, challenge, state)},
            follow_redirects=False,
        )
        assert "Sign-in cancelled" not in resp.text, params
        assert "Sign-in didn’t finish" in resp.text, params
        assert "tv_session" not in resp.headers.get("set-cookie", "")
        assert _done_link(resp) == {"error": "failed", "state": state}, params
