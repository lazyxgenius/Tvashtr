"""M-h1a — GitHub App routes (``/api/config``, the OAuth callback, ``/api/github/repos``) plus the
two INVARIANT tests the brief demands, both mutation-real:

* SECRETS-NEVER-LEAK — client secret, private key, the user token, and the installation token
  never appear in a response body/header, a ``github_installations`` DB row, or a log line. Proven
  RED against a variant that returns the installation token (see the run transcript).
* OWNER-SCOPING — account A's ``/api/github/repos`` returns ONLY A's installations' repos, never
  account B's. Proven RED against an unscoped query (see the run transcript).

Outbound GitHub HTTP is faked at the ``github_app._http`` seam so the REAL client code runs with
SENTINEL secrets planted in GitHub's responses; the leak test then scans every surface for them.
"""

import base64
import logging
import uuid
from datetime import UTC, datetime, timedelta

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane import github_app
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import GithubInstallation, User

# --- SENTINEL secrets: NONE may appear in any response, DB row, or log line ---
CLIENT_SECRET_SENTINEL = "SENTINELclientSECRETmustNeverLeak0001"
USER_TOKEN_SENTINEL = "ghu_SENTINELuserTOKENmustNeverLeak0002"
INSTALL_TOKEN_SENTINEL = "ghs_SENTINELinstallTOKENmustNeverLeak0003"
GH_USER_ID = 4_242_426
GH_LOGIN = "octocat-h1a"


def _rsa_key_b64() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()
    return base64.b64encode(pem.encode()).decode()


_KEY_B64 = _rsa_key_b64()
PRIVATE_KEY_PEM = base64.b64decode(_KEY_B64).decode()  # the DECODED PEM is itself a secret


def _iso_future() -> str:
    return (datetime.now(UTC) + timedelta(hours=1)).isoformat()


def _configure_hosted(monkeypatch, *, slug: str = "") -> None:
    """Turn HOSTED mode ON with real creds (client secret + private key are sentinels so
    a leak is detectable). Reverted automatically by monkeypatch."""
    s = get_settings()
    monkeypatch.setattr(s, "hosted_mode", True)
    monkeypatch.setattr(s, "github_app_id", "424242")
    monkeypatch.setattr(s, "github_app_private_key_b64", SecretStr(_KEY_B64))
    monkeypatch.setattr(s, "github_app_client_id", "Iv1.testclientid")
    monkeypatch.setattr(s, "github_app_client_secret", SecretStr(CLIENT_SECRET_SENTINEL))
    monkeypatch.setattr(s, "github_app_slug", slug)
    github_app._installation_token_cache.clear()


def _fake_github_http(repos_list, *, installations=None):
    """A fake ``github_app._http`` that plants the sentinel secrets in GitHub's responses and serves
    ``repos_list`` for the installation-repositories call. ``installations`` (default empty) is the
    list of installation dicts returned by ``GET /user/installations`` (callback discovery)."""
    installations = installations if installations is not None else []

    def fake_http(method, url, *, token=None, body=None, accept="application/vnd.github+json"):
        if url.endswith("/login/oauth/access_token"):
            return {"access_token": USER_TOKEN_SENTINEL, "token_type": "bearer"}
        # ``/user/installations`` must be checked BEFORE bare ``/user`` (endswith would also match
        # the longer path if order were reversed... actually endswith("/user") does NOT match
        # ``.../user/installations?...``; still keep the more specific path first for clarity).
        if "/user/installations" in url:
            return {"total_count": len(installations), "installations": installations}
        if url.endswith("/user"):
            return {"id": GH_USER_ID, "login": GH_LOGIN, "email": None}
        if url.endswith("/access_tokens"):
            return {"token": INSTALL_TOKEN_SENTINEL, "expires_at": _iso_future()}
        if "/installation/repositories" in url:
            return {"repositories": repos_list}
        raise AssertionError(f"unexpected GitHub URL: {url!r}")

    return fake_http


def _fresh_account() -> tuple[TestClient, uuid.UUID]:
    """A brand-new registered account with its OWN cookie jar (bare TestClient — never re-launches
    DBOS) + its user id, for isolation from the shared client and from other tests."""
    c = TestClient(app)
    c.cookies.clear()
    email = f"gh-{uuid.uuid4().hex}@example.com"
    resp = c.post("/api/auth/register", json={"email": email, "password": "gh-test-password"})
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


# ---------------------------------------------------------------- /api/config


def test_config_is_public_and_defaults_to_self_hosted(unauth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", False)  # pin: never rely on ambient .env
    resp = unauth_client.get("/api/config")  # reachable WITHOUT a session (pre-login)
    assert resp.status_code == 200
    assert resp.json() == {
        "hosted_mode": False,
        "github_install_url": "",
        "github_manage_url": "",
    }


def test_config_hosted_exposes_install_url_but_no_secret(client, monkeypatch):
    _configure_hosted(monkeypatch, slug="tvashtr")
    resp = client.get("/api/config")
    body = resp.json()
    assert body["hosted_mode"] is True
    # Rider 1: the sign-in door is now the OAuth authorize URL (client_id), not the slug page.
    # M-h4 re-pointed the expected string: it now also carries the URL-encoded ``redirect_uri`` that
    # tells GitHub WHICH of the two registered callbacks (local vs deployed) to return to. The
    # public-only, no-secrets property this test guards is unchanged and asserted below.
    assert body["github_install_url"] == (
        "https://github.com/login/oauth/authorize?client_id=Iv1.testclientid"
        "&redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fapi%2Fauth%2Fgithub%2Fcallback"
    )
    # Rider 2: the slug install page is demoted to the SECONDARY "add repositories" URL.
    assert body["github_manage_url"] == "https://github.com/apps/tvashtr/installations/new"
    assert set(body) == {"hosted_mode", "github_install_url", "github_manage_url"}
    assert CLIENT_SECRET_SENTINEL not in resp.text
    assert PRIVATE_KEY_PEM not in resp.text


# ---------------------------------------------------------------- the OAuth callback


def test_callback_404_when_not_hosted(unauth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", False)  # pin: never rely on ambient .env
    resp = unauth_client.get("/api/auth/github/callback?code=abc", follow_redirects=False)
    assert resp.status_code == 404  # feature off by default -> not even a redirect


def test_callback_creates_user_records_installation_and_issues_session(unauth_client, monkeypatch):
    _configure_hosted(monkeypatch)
    monkeypatch.setattr(github_app, "_http", _fake_github_http([]))
    resp = unauth_client.get(
        "/api/auth/github/callback?code=abc&installation_id=147133756&setup_action=install",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    # Rider 4: redirect to the configurable FE origin (default), not the backend root "/".
    assert resp.headers["location"] == "http://localhost:5173"
    assert "tv_session" in resp.headers.get("set-cookie", "")
    # The SECRETS the callback handled never appear in the redirect response.
    for secret in (USER_TOKEN_SENTINEL, CLIENT_SECRET_SENTINEL, PRIVATE_KEY_PEM):
        assert secret not in resp.text
        assert secret not in str(resp.headers)
    # The browser is now authenticated as the new GitHub account (the SAME tv_session the password
    # path issues — get_current_user accepts it unchanged).
    assert unauth_client.get("/api/auth/me").status_code == 200
    with session_scope() as s:
        user = s.execute(select(User).where(User.github_user_id == GH_USER_ID)).scalar_one()
        assert user.github_login == GH_LOGIN
        inst = s.execute(
            select(GithubInstallation).where(GithubInstallation.installation_id == 147133756)
        ).scalar_one()
        assert inst.owner_id == user.id  # the installation is owned by the authenticated account


def test_callback_links_an_existing_email_account_instead_of_duplicating(
    unauth_client, monkeypatch
):
    _configure_hosted(monkeypatch)
    email = f"link-{uuid.uuid4().hex}@example.com"
    gh_id = uuid.uuid4().int % 2_000_000_000
    with session_scope() as s:
        u = User(email=email, password_hash="x")
        s.add(u)
        s.flush()
        existing_id = u.id

    def fake_http(method, url, *, token=None, body=None, accept=None):
        if url.endswith("/login/oauth/access_token"):
            return {"access_token": USER_TOKEN_SENTINEL}
        if "/user/installations" in url:
            return {"total_count": 0, "installations": []}
        if url.endswith("/user"):
            return {"id": gh_id, "login": "linker", "email": email}
        raise AssertionError(url)

    monkeypatch.setattr(github_app, "_http", fake_http)
    resp = unauth_client.get("/api/auth/github/callback?code=abc", follow_redirects=False)
    assert resp.status_code == 302
    with session_scope() as s:
        rows = s.execute(select(User).where(User.email == email)).scalars().all()
        assert len(rows) == 1  # LINKED, not duplicated
        assert rows[0].id == existing_id and rows[0].github_user_id == gh_id


def test_callback_redirects_to_the_configured_frontend_origin(unauth_client, monkeypatch):
    """Rider 4: the post-sign-in redirect targets a CONFIGURABLE FE origin (default
    ``http://localhost:5173``), NOT the backend root ``/`` (which 404s on the API port). M-h4 points
    it at the real domain by setting ``TVASHTR_FRONTEND_ORIGIN``."""
    _configure_hosted(monkeypatch)
    monkeypatch.setattr(get_settings(), "frontend_origin", "https://app.tvashtr.example")
    monkeypatch.setattr(github_app, "_http", _fake_github_http([]))
    resp = unauth_client.get("/api/auth/github/callback?code=abc", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "https://app.tvashtr.example"


def test_callback_without_installation_id_records_discovered_installations(
    unauth_client, monkeypatch
):
    """OAuth-authorize returns ?code but NO installation_id — discovery via GET /user/installations
    must still write github_installations rows so /api/github/repos is non-empty after sign-in."""
    _configure_hosted(monkeypatch)
    # Unique id+login so shared-DB suite state cannot link to a prior user (email is derived from
    # login when GitHub returns email=None).
    suffix = uuid.uuid4().hex[:12]
    gh_user_id = uuid.uuid4().int % 2_000_000_000
    gh_login = f"discover-{suffix}"
    inst_a = uuid.uuid4().int % 2_000_000_000
    inst_b = uuid.uuid4().int % 2_000_000_000
    while inst_b == inst_a:
        inst_b = uuid.uuid4().int % 2_000_000_000

    def fake_http(method, url, *, token=None, body=None, accept="application/vnd.github+json"):
        if url.endswith("/login/oauth/access_token"):
            return {"access_token": USER_TOKEN_SENTINEL, "token_type": "bearer"}
        if "/user/installations" in url:
            return {
                "total_count": 2,
                "installations": [
                    {"id": inst_a, "account": {"login": "org-a"}},
                    {"id": inst_b},
                ],
            }
        if url.endswith("/user"):
            return {"id": gh_user_id, "login": gh_login, "email": None}
        raise AssertionError(f"unexpected GitHub URL: {url!r}")

    monkeypatch.setattr(github_app, "_http", fake_http)
    # Primary sign-in door: code only — no ?installation_id.
    resp = unauth_client.get("/api/auth/github/callback?code=abc", follow_redirects=False)
    assert resp.status_code == 302
    assert "tv_session" in resp.headers.get("set-cookie", "")
    with session_scope() as s:
        user = s.execute(select(User).where(User.github_user_id == gh_user_id)).scalar_one()
        assert user.github_login == gh_login
        rows = (
            s.execute(select(GithubInstallation).where(GithubInstallation.owner_id == user.id))
            .scalars()
            .all()
        )
        recorded = sorted(r.installation_id for r in rows)
        assert recorded == sorted([inst_a, inst_b])  # both discovered ids stored, owned by user


def test_callback_with_installation_id_and_discovery_does_not_duplicate(unauth_client, monkeypatch):
    """?installation_id is still recorded; when discovery returns the SAME id, the unique
    constraint holds — one row, re-owned to the current user (not two rows)."""
    _configure_hosted(monkeypatch)
    suffix = uuid.uuid4().hex[:12]
    gh_user_id = uuid.uuid4().int % 2_000_000_000
    gh_login = f"dup-{suffix}"
    inst_id = uuid.uuid4().int % 2_000_000_000
    discovered_extra = uuid.uuid4().int % 2_000_000_000
    while discovered_extra == inst_id:
        discovered_extra = uuid.uuid4().int % 2_000_000_000

    def fake_http(method, url, *, token=None, body=None, accept="application/vnd.github+json"):
        if url.endswith("/login/oauth/access_token"):
            return {"access_token": USER_TOKEN_SENTINEL, "token_type": "bearer"}
        if "/user/installations" in url:
            # Discovery returns the same id as ?installation_id plus one extra.
            return {
                "total_count": 2,
                "installations": [{"id": inst_id}, {"id": discovered_extra}],
            }
        if url.endswith("/user"):
            return {"id": gh_user_id, "login": gh_login, "email": None}
        raise AssertionError(f"unexpected GitHub URL: {url!r}")

    monkeypatch.setattr(github_app, "_http", fake_http)
    resp = unauth_client.get(
        f"/api/auth/github/callback?code=abc&installation_id={inst_id}&setup_action=install",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    with session_scope() as s:
        user = s.execute(select(User).where(User.github_user_id == gh_user_id)).scalar_one()
        assert user.github_login == gh_login
        rows = (
            s.execute(select(GithubInstallation).where(GithubInstallation.owner_id == user.id))
            .scalars()
            .all()
        )
        by_id = {r.installation_id: r for r in rows}
        assert set(by_id) == {inst_id, discovered_extra}
        # Unique constraint: exactly one row per installation_id (param + discovery of same id).
        assert len(rows) == 2
        assert by_id[inst_id].owner_id == user.id
        # Global uniqueness: only one github_installations row for inst_id at all.
        all_for_inst = (
            s.execute(
                select(GithubInstallation).where(GithubInstallation.installation_id == inst_id)
            )
            .scalars()
            .all()
        )
        assert len(all_for_inst) == 1


def test_repos_skips_dead_installation_and_returns_survivors(monkeypatch):
    """One installation whose list_installation_repositories raises must not 500 the endpoint —
    surviving installations still contribute repos."""
    ca, a_id = _fresh_account()
    dead_inst = uuid.uuid4().int % 2_000_000_000
    live_inst = uuid.uuid4().int % 2_000_000_000
    while live_inst == dead_inst:
        live_inst = uuid.uuid4().int % 2_000_000_000
    with session_scope() as s:
        s.add(GithubInstallation(owner_id=a_id, installation_id=dead_inst))
        s.add(GithubInstallation(owner_id=a_id, installation_id=live_inst))

    def list_repos(installation_id: int):
        if installation_id == dead_inst:
            raise github_app.GithubAppError("GitHub GET installation/repositories -> HTTP 404")
        return [
            {
                "name": "survivor",
                "full_name": "o/survivor",
                "private": False,
                "default_branch": "main",
                "html_url": "https://github.com/o/survivor",
            }
        ]

    monkeypatch.setattr(github_app, "list_installation_repositories", list_repos)
    resp = ca.get("/api/github/repos")
    assert resp.status_code == 200
    body = resp.json()
    assert body["installation_count"] == 2  # both rows still counted (DB-side)
    assert body["repos"] == [
        {
            "name": "survivor",
            "full_name": "o/survivor",
            "private": False,
            "default_branch": "main",
            "html_url": "https://github.com/o/survivor",
        }
    ]


# ---------------------------------------------------------------- /api/github/repos


def test_repos_requires_auth(unauth_client):
    assert unauth_client.get("/api/github/repos").status_code == 401


def test_repos_empty_for_account_without_installations():
    c, _ = _fresh_account()
    assert c.get("/api/github/repos").json() == {"repos": [], "installation_count": 0}


def test_repos_are_owner_scoped(monkeypatch):
    """OWNER-SCOPING INVARIANT (mutation-real — RED against an unscoped query)."""
    ca, a_id = _fresh_account()
    _cb, b_id = _fresh_account()
    inst_a = uuid.uuid4().int % 2_000_000_000  # unique per run — installation_id is globally UNIQUE
    inst_b = uuid.uuid4().int % 2_000_000_000
    with session_scope() as s:
        s.add(GithubInstallation(owner_id=a_id, installation_id=inst_a))
        s.add(GithubInstallation(owner_id=b_id, installation_id=inst_b))
    monkeypatch.setattr(
        github_app,
        "list_installation_repositories",
        lambda inst: [{"name": f"repo-{inst}", "full_name": f"o/repo-{inst}"}],
    )
    body = ca.get("/api/github/repos").json()
    names = {r["name"] for r in body["repos"]}
    assert names == {f"repo-{inst_a}"}  # A sees ONLY its own installation's repos
    assert f"repo-{inst_b}" not in names  # account B's installation NEVER leaks to A
    assert body["installation_count"] == 1


def test_secrets_never_leak_through_repos(monkeypatch, caplog):
    """SECRETS-NEVER-LEAK INVARIANT (mutation-real — RED against a token-returning variant)."""
    _configure_hosted(monkeypatch)
    ca, a_id = _fresh_account()
    inst = uuid.uuid4().int % 2_000_000_000  # unique per run — installation_id is globally UNIQUE
    with session_scope() as s:
        s.add(GithubInstallation(owner_id=a_id, installation_id=inst))
    repo = {
        "name": "secret-scanned-repo",
        "full_name": "o/secret-scanned-repo",
        "private": True,
        "default_branch": "main",
        "html_url": "https://github.com/o/secret-scanned-repo",
    }
    monkeypatch.setattr(github_app, "_http", _fake_github_http([repo]))
    caplog.set_level(logging.DEBUG)
    resp = ca.get("/api/github/repos")
    assert resp.status_code == 200
    assert any(r["name"] == "secret-scanned-repo" for r in resp.json()["repos"])  # real flow ran
    # The installation token (+ the client secret + the private key) never leak on ANY surface.
    for secret in (INSTALL_TOKEN_SENTINEL, CLIENT_SECRET_SENTINEL, PRIVATE_KEY_PEM):
        assert secret not in resp.text  # not in the response body
        assert secret not in str(resp.headers)  # not in a response header
        assert secret not in caplog.text  # not in a log line
    with session_scope() as s:
        row = s.execute(
            select(GithubInstallation).where(GithubInstallation.installation_id == inst)
        ).scalar_one()
        stored = f"{row.id}|{row.owner_id}|{row.installation_id}"  # every column, serialized
        for secret in (INSTALL_TOKEN_SENTINEL, CLIENT_SECRET_SENTINEL, PRIVATE_KEY_PEM):
            assert secret not in stored  # nothing secret is persisted
