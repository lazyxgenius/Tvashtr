"""B-TOOLKIT — ``GET /api/github/status`` (the Browse card's install state + repo count) and the
GitHub callback tolerating a missing ``code``. GitHub is never called (``_http`` is faked)."""

import uuid

from sqlalchemy import select
from toolkit_helpers import fresh_account

from tvashtr.config import get_settings
from tvashtr.control_plane import github_app
from tvashtr.db import session_scope
from tvashtr.models import GithubInstallation, User

TOKENS = {}


def _hosted(monkeypatch, counts: dict[int, int] | None = None, dead: set[int] = frozenset()):
    """Hosted mode with a fake GitHub: installation ``iid`` sees ``counts[iid]`` repos; an
    installation in ``dead`` fails with a 404."""
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    counts = counts or {}
    monkeypatch.setattr(github_app, "get_installation_token", lambda iid: f"tok-{iid}")
    monkeypatch.setattr(github_app, "list_app_installations", lambda: [])

    def fake_http(method, url, *, token=None, body=None, accept=None):
        assert url.endswith("/installation/repositories?per_page=1"), url
        iid = int(token.split("-", 1)[1])
        if iid in dead:
            raise github_app.GithubAppError("GitHub GET x -> HTTP 404")
        return {"total_count": counts.get(iid, 0), "repositories": []}

    monkeypatch.setattr(github_app, "_http", fake_http)


def _install(owner: uuid.UUID) -> int:
    iid = 700_000_000 + uuid.uuid4().int % 100_000_000
    with session_scope() as session:
        session.add(GithubInstallation(owner_id=owner, installation_id=iid))
    return iid


def test_status_self_hosted_answers_without_github(monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", False)

    def boom(*a, **k):
        raise AssertionError("GitHub must not be called")

    monkeypatch.setattr(github_app, "_http", boom)
    c, _ = fresh_account()
    assert c.get("/api/github/status").json() == {
        "hosted": False,
        "installed": False,
        "installation_count": 0,
        "repo_count": 0,
    }


def test_status_counts_repos_across_the_owners_installations(monkeypatch):
    c, owner = fresh_account()
    other_c, other = fresh_account()
    a, b, dead = _install(owner), _install(owner), _install(owner)
    theirs = _install(other)
    _hosted(monkeypatch, counts={a: 2, b: 3, theirs: 50}, dead={dead})
    resp = c.get("/api/github/status")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "hosted": True,
        "installed": True,
        "installation_count": 3,
        "repo_count": 5,  # the dead installation is skipped, the other account's never counted
    }
    assert other_c.get("/api/github/status").json()["repo_count"] == 50


def test_status_not_installed_and_the_zero_row_backfill(monkeypatch):
    c, owner = fresh_account()
    _hosted(monkeypatch)
    assert c.get("/api/github/status").json() == {
        "hosted": True,
        "installed": False,
        "installation_count": 0,
        "repo_count": 0,
    }
    gh_id = uuid.uuid4().int % 2_000_000_000
    with session_scope() as session:
        session.get(User, owner).github_user_id = gh_id
    iid = 600_000_000 + uuid.uuid4().int % 100_000_000
    monkeypatch.setattr(
        github_app,
        "list_app_installations",
        lambda: [{"id": iid, "account": {"id": gh_id, "login": "me"}}],
    )
    body = c.get("/api/github/status").json()
    assert body["installed"] is True and body["installation_count"] == 1


def test_callback_without_a_code_redirects_back_and_records_nothing(unauth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    monkeypatch.setattr(get_settings(), "frontend_origin", "https://app.tvashtr.example")

    def boom(*a, **k):
        raise AssertionError("no code: GitHub must not be called")

    monkeypatch.setattr(github_app, "_http", boom)
    iid = 500_000_000 + uuid.uuid4().int % 100_000_000
    resp = unauth_client.get(
        f"/api/auth/github/callback?installation_id={iid}&setup_action=install",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"] == "https://app.tvashtr.example"
    assert "tv_session" not in resp.headers.get("set-cookie", "")
    with session_scope() as session:
        assert (
            session.execute(
                select(GithubInstallation).where(GithubInstallation.installation_id == iid)
            ).first()
            is None
        )
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    assert unauth_client.get("/api/auth/github/callback", follow_redirects=False).status_code == 404
