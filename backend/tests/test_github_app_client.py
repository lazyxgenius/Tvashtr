"""M-h1a — GitHub App client unit tests (``tvashtr.control_plane.github_app``).

Exercises the credential chain in isolation: the app JWT is REAL RS256 with ``iss`` = the app id and
``exp`` <= 10 min (verified against the public key); the installation token is minted once + cached
until near expiry; ``list_installation_repositories`` returns a whitelist only; and a bad/absent key
raises WITHOUT echoing key material. Outbound HTTP is faked at the ``_http`` seam — the repo
convention (no respx/MockTransport exists; see ``litellm_admin``).
"""

import base64
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr

from tvashtr.config import get_settings
from tvashtr.control_plane import github_app


def _rsa_key_b64() -> tuple[str, str]:
    """A fresh RSA-2048 keypair: (base64 of the PKCS#1 PEM private key, the public PEM). PKCS#1 =
    ``TraditionalOpenSSL`` => the ``-----BEGIN RSA PRIVATE KEY-----`` form the brief specifies."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()
    pub = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return base64.b64encode(pem.encode()).decode(), pub


# One keypair for the whole module (RSA keygen is the slow part).
_KEY_B64, _PUB_PEM = _rsa_key_b64()
_APP_ID = "424242"


def _iso_in(**delta) -> str:
    return (datetime.now(UTC) + timedelta(**delta)).isoformat()


@pytest.fixture
def gh(monkeypatch):
    """Configure the shared Settings with a real key + app id and reset the token cache."""
    s = get_settings()
    monkeypatch.setattr(s, "github_app_id", _APP_ID)
    # The two SECRET fields are SecretStr and assignment does not coerce — wrap them, or the
    # production ``.get_secret_value()`` read hits a plain str.
    monkeypatch.setattr(s, "github_app_private_key_b64", SecretStr(_KEY_B64))
    monkeypatch.setattr(s, "github_app_client_id", "Iv1.testclientid")
    monkeypatch.setattr(s, "github_app_client_secret", SecretStr("test-client-secret"))
    monkeypatch.setattr(s, "github_app_slug", "")
    github_app._installation_token_cache.clear()
    yield s
    github_app._installation_token_cache.clear()


def test_app_jwt_is_rs256_with_iss_and_exp_under_10min(gh):
    now = 1_700_000_000
    token = github_app.mint_app_jwt(now=now)
    # Verify with the PUBLIC key — proves it was signed with the app private key, RS256.
    claims = jwt.decode(token, _PUB_PEM, algorithms=["RS256"], options={"verify_exp": False})
    assert claims["iss"] == _APP_ID
    assert claims["exp"] <= now + 600  # GitHub's 10-minute cap
    assert claims["iat"] <= now  # back-dated for clock skew
    assert jwt.get_unverified_header(token)["alg"] == "RS256"


def test_app_jwt_unconfigured_raises_naming_the_missing_var(monkeypatch):
    monkeypatch.setattr(get_settings(), "github_app_id", "")
    with pytest.raises(github_app.GithubAppError) as exc:
        github_app.mint_app_jwt()
    assert "GITHUB_APP_ID" in str(exc.value)


def test_bad_private_key_raises_without_echoing_the_value(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "github_app_id", _APP_ID)
    not_a_pem = base64.b64encode(b"this-is-secret-key-material-not-a-pem").decode()
    monkeypatch.setattr(s, "github_app_private_key_b64", SecretStr(not_a_pem))
    with pytest.raises(github_app.GithubAppError) as exc:
        github_app.mint_app_jwt()
    assert not_a_pem not in str(exc.value)  # the (secret) value never appears in the message


def test_installation_token_minted_once_then_cached(gh, monkeypatch):
    calls = {"n": 0}

    def fake_http(method, url, *, token=None, body=None, accept=None):
        calls["n"] += 1
        assert url.endswith("/access_tokens") and method == "POST"
        return {"token": "ghs_installtoken", "expires_at": _iso_in(hours=1)}

    monkeypatch.setattr(github_app, "_http", fake_http)
    first = github_app.get_installation_token(147133756)
    second = github_app.get_installation_token(147133756)
    assert first == second == "ghs_installtoken"
    assert calls["n"] == 1  # minted ONCE, then served from the in-process cache


def test_installation_token_refreshed_when_within_skew(gh, monkeypatch):
    calls = {"n": 0}

    def fake_http(method, url, *, token=None, body=None, accept=None):
        calls["n"] += 1
        # Expires in 1 minute -> inside the 5-minute refresh skew -> never cached, always re-minted.
        return {"token": f"ghs_tok{calls['n']}", "expires_at": _iso_in(minutes=1)}

    monkeypatch.setattr(github_app, "_http", fake_http)
    github_app.get_installation_token(1)
    github_app.get_installation_token(1)
    assert calls["n"] == 2  # re-minted because the cached token was within the refresh skew


def test_list_repositories_returns_whitelist_only(gh, monkeypatch):
    def fake_http(method, url, *, token=None, body=None, accept=None):
        if url.endswith("/access_tokens"):
            return {"token": "ghs_tok", "expires_at": _iso_in(hours=1)}
        assert "/installation/repositories" in url
        return {
            "repositories": [
                {
                    "name": "trade_mcp",
                    "full_name": "o/trade_mcp",
                    "private": True,
                    "default_branch": "main",
                    "html_url": "https://github.com/o/trade_mcp",
                    "owner": {"login": "o", "id": 1},  # extra fields must be DROPPED
                    "permissions": {"admin": True},
                }
            ]
        }

    monkeypatch.setattr(github_app, "_http", fake_http)
    repos = github_app.list_installation_repositories(147133756)
    assert repos == [
        {
            "name": "trade_mcp",
            "full_name": "o/trade_mcp",
            "private": True,
            "default_branch": "main",
            "html_url": "https://github.com/o/trade_mcp",
        }
    ]
    assert "owner" not in repos[0] and "permissions" not in repos[0]  # whitelist drops the rest


def test_list_user_installations_paginates_and_parses(gh, monkeypatch):
    """GET /user/installations: paginate (per_page=100), parse installations[].id as ints, skip
    malformed entries, stop when a page is short. Never depends on real network."""
    pages_seen: list[int] = []
    # Page 1: 100 well-formed ids (forces a second page); page 2: short page + junk to skip.
    page1_ids = list(range(1, 101))
    page2_ids = [101, 102]

    def fake_http(method, url, *, token=None, body=None, accept=None):
        assert method == "GET"
        assert "/user/installations" in url
        assert "per_page=100" in url
        assert token == "ghu_user_token_never_logged"
        # Parse page= explicitly — naive ``"page=1" in url`` also matches ``per_page=100``.
        assert "&page=" in url
        page_num = int(url.rsplit("&page=", 1)[-1])
        pages_seen.append(page_num)
        if page_num == 1:
            return {
                "total_count": 102,
                "installations": [{"id": i, "account": {"login": f"a{i}"}} for i in page1_ids],
            }
        if page_num == 2:
            return {
                "total_count": 102,
                "installations": [
                    {"id": page2_ids[0]},
                    {"id": str(page2_ids[1])},  # string id still coerces via int()
                    {"id": None},  # skipped
                    {"no_id": True},  # skipped
                    "not-a-dict",  # skipped
                ],
            }
        raise AssertionError(f"unexpected page: {url!r}")

    monkeypatch.setattr(github_app, "_http", fake_http)
    ids = github_app.list_user_installations("ghu_user_token_never_logged")
    assert pages_seen == [1, 2]
    assert ids == page1_ids + page2_ids
    # Defensive shape: non-dict body / missing installations → empty (no raise).
    monkeypatch.setattr(github_app, "_http", lambda *a, **k: ["not", "a", "dict"])
    assert github_app.list_user_installations("tok") == []
    monkeypatch.setattr(github_app, "_http", lambda *a, **k: {"installations": "nope"})
    assert github_app.list_user_installations("tok") == []


def test_build_install_url_is_oauth_authorize_primary(monkeypatch):
    """Rider 1: the sign-in door is the OAuth authorize URL (client_id) — it authorises an EXISTING
    installation AND prompts a first-timer to install, so a RETURNING user is actually signed in.
    The slug ``installations/new`` page only works once (GitHub then bounces an already-installed
    user to its settings and issues no ``code``), so it is NO LONGER the sign-in primary even when a
    slug is set.

    M-h4 re-pointed the expected string: the URL now also carries an explicit, URL-encoded
    ``redirect_uri`` naming THIS deployment's callback, because the App carries two registered
    callbacks (local + deployed) and GitHub would otherwise choose between them itself. The
    authorize-URL-is-primary decision this test exists to pin is unchanged."""
    s = get_settings()
    monkeypatch.setattr(s, "github_app_client_id", "Iv1.abc")
    monkeypatch.setattr(s, "github_app_slug", "tvashtr")  # slug set, but no longer wins for sign-in
    monkeypatch.setattr(s, "public_base_url", "http://localhost:8000")
    assert github_app.build_install_url() == (
        "https://github.com/login/oauth/authorize?client_id=Iv1.abc"
        "&redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fapi%2Fauth%2Fgithub%2Fcallback"
    )
    monkeypatch.setattr(s, "github_app_client_id", "")
    assert github_app.build_install_url() == ""  # no client_id -> nothing to authorize


def test_build_manage_url_is_slug_install_page_or_empty(monkeypatch):
    """Rider 2: the SECONDARY "add repositories" URL is the slug ``installations/new`` install page,
    for a signed-in user whose installation covers no repos and needs to grant access. Empty when no
    slug is configured (nothing public to link to)."""
    s = get_settings()
    monkeypatch.setattr(s, "github_app_slug", "tvashtr")
    assert github_app.build_manage_url() == "https://github.com/apps/tvashtr/installations/new"
    monkeypatch.setattr(s, "github_app_slug", "")
    assert github_app.build_manage_url() == ""


def test_build_manage_url_tolerates_a_pasted_full_url_slug(monkeypatch):
    """Rider 3: GitHub's settings page offers the app link as a full URL with a copy button, so a
    slug pasted as ``https://github.com/apps/tvashtr-dev`` (any scheme, optional trailing slash)
    must still yield a SANE install URL, never the doubled ``…/apps/https://github.com/apps/…``."""
    s = get_settings()
    for pasted in (
        "https://github.com/apps/tvashtr-dev",
        "https://github.com/apps/tvashtr-dev/",
        "http://github.com/apps/tvashtr-dev",
        "github.com/apps/tvashtr-dev",
    ):
        monkeypatch.setattr(s, "github_app_slug", pasted)
        assert (
            github_app.build_manage_url() == "https://github.com/apps/tvashtr-dev/installations/new"
        )


def test_list_app_installations_paginates_parses_and_drops_extras(gh, monkeypatch):
    """M-legible: ``GET /app/installations`` (App JWT, NO user token) discovers installations for an
    account whose user token was never stored. It returns a TOP-LEVEL ARRAY (not an
    ``{installations: […]}`` envelope), paginates ``per_page=100``, reduces each element to the
    NON-secret ``{id, account: {id, login}}`` the backfill needs, and is defensive on shape. The App
    JWT is PRESENTED (a real RS256 token verifiable against the public key), never returned."""
    pages_seen: list[int] = []
    # Page 1: 100 well-formed entries (forces a second page); the app_id/secret extras must DROP.
    page1 = [
        {"id": i, "account": {"id": 5000 + i, "login": f"acct{i}"}, "app_id": 99, "secret": "x"}
        for i in range(1, 101)
    ]
    # Page 2: short page mixing valid + malformed entries to skip.
    page2 = [
        {"id": 101, "account": {"id": 5101, "login": "acct101"}},
        {"id": None, "account": {"id": 1}},  # skipped (no id)
        {"no_id": True},  # skipped
        "not-a-dict",  # skipped
        {"id": 102, "account": "not-a-dict"},  # account non-dict → {id:None, login:None}
    ]

    def fake_http(method, url, *, token=None, body=None, accept="application/vnd.github+json"):
        assert method == "GET"
        assert "/app/installations" in url
        assert "per_page=100" in url
        # The App JWT is presented — a REAL RS256 token with iss = the app id (never a user token).
        claims = jwt.decode(token, _PUB_PEM, algorithms=["RS256"], options={"verify_exp": False})
        assert claims["iss"] == _APP_ID
        page_num = int(url.rsplit("&page=", 1)[-1])
        pages_seen.append(page_num)
        if page_num == 1:
            return page1
        if page_num == 2:
            return page2
        raise AssertionError(f"unexpected page: {url!r}")

    monkeypatch.setattr(github_app, "_http", fake_http)
    installs = github_app.list_app_installations()
    assert pages_seen == [1, 2]
    # Each well-formed entry reduced to the non-secret whitelist (extras dropped).
    assert installs[0] == {"id": 1, "account": {"id": 5001, "login": "acct1"}}
    assert {"app_id", "secret"}.isdisjoint(installs[0])
    ids = [i["id"] for i in installs]
    assert ids == [*range(1, 102), 102]  # 1..101 then 102; the malformed three skipped
    assert installs[-1] == {"id": 102, "account": {"id": None, "login": None}}
    # Defensive shape: a non-list (enveloped) body → empty, never a raise.
    monkeypatch.setattr(github_app, "_http", lambda *a, **k: {"installations": "nope"})
    assert github_app.list_app_installations() == []
