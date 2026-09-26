"""``GET /api/public/site`` (website.md B-4): public, the repo, its star count (own 10-minute
cache, never raises) and the latest Desktop release verbatim from ``desktop_release``.
"""

import urllib.error

import pytest

from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_release, site_info

REPO_API = "https://api.github.com/repos/lazyxgenius/Tvashtr"
RELEASE = {
    "tag_name": "desktop-v0.7.0",
    "draft": False,
    "prerelease": False,
    "published_at": "2026-09-27T10:00:00Z",
    "html_url": "https://github.com/lazyxgenius/Tvashtr/releases/tag/desktop-v0.7.0",
}


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    monkeypatch.setattr(get_settings(), "desktop_release_repo", "lazyxgenius/Tvashtr")
    desktop_release.clear_cache()
    site_info.clear_cache()
    yield
    desktop_release.clear_cache()
    site_info.clear_cache()


def _fake(calls: list, repo: object):
    def get_json(url):
        calls.append(url)
        if url == REPO_API:
            if isinstance(repo, Exception):
                raise repo
            return repo
        if url == f"{REPO_API}/releases/latest":
            return RELEASE
        raise AssertionError(url)

    return get_json


def test_site_is_public_with_stars_and_the_release(unauth_client, monkeypatch):
    calls: list = []
    monkeypatch.setattr(desktop_release, "_get_json", _fake(calls, {"stargazers_count": 128}))
    resp = unauth_client.get("/api/public/site")
    assert resp.status_code == 200
    body = resp.json()
    assert body["repo_url"] == "https://github.com/lazyxgenius/Tvashtr"
    assert body["stars"] == 128
    assert body["desktop"]["version"] == "0.7.0"
    assert body["desktop"]["dmg_url"] == desktop_release.stable_dmg_url("lazyxgenius/Tvashtr")
    assert set(body["desktop"]) == set(desktop_release.latest_release())
    assert body["checked_at"].endswith("Z")


def test_stars_are_cached_for_ten_minutes(monkeypatch):
    calls: list = []
    monkeypatch.setattr(desktop_release, "_get_json", _fake(calls, {"stargazers_count": 5}))
    site_info.site_info(now=1000.0)
    site_info.site_info(now=1000.0 + 599)
    assert calls.count(REPO_API) == 1
    site_info.site_info(now=1000.0 + 601)
    assert calls.count(REPO_API) == 2


@pytest.mark.parametrize(
    "answer",
    [urllib.error.URLError("down"), TimeoutError(), {"message": "rate limited"}, None, [1]],
)
def test_stars_are_null_when_github_cant_say(monkeypatch, answer):
    monkeypatch.setattr(desktop_release, "_get_json", _fake([], answer))
    info = site_info.site_info(now=0.0)
    assert info["stars"] is None
    assert info["desktop"]["version"] == "0.7.0"
