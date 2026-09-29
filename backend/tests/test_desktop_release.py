"""The latest Tvashtr Desktop release (desktop-app.md §3, DT-43): ``GET /api/desktop/release``.

Public, ``desktop-v*`` releases only, cached 10 minutes in process, never raises, and ``dmg_url``
is always the stable ``Tvashtr-mac.dmg`` link (never a versioned one).
"""

import urllib.error

import pytest

from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_release

STABLE = "https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg"


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    monkeypatch.setattr(get_settings(), "desktop_release_repo", "lazyxgenius/Tvashtr")
    desktop_release.clear_cache()
    yield
    desktop_release.clear_cache()


def _release(tag, **extra):
    return {
        "tag_name": tag,
        "draft": False,
        "prerelease": False,
        "published_at": "2026-09-30T10:12:00Z",
        "html_url": f"https://github.com/lazyxgenius/Tvashtr/releases/tag/{tag}",
        **extra,
    }


def _fake(responses: dict, calls: list):
    def get_json(url):
        calls.append(url)
        value = responses[url.rsplit("/repos/lazyxgenius/Tvashtr", 1)[1]]
        if isinstance(value, Exception):
            raise value
        return value

    return get_json


def test_latest_desktop_release_is_served_publicly(unauth_client, monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        desktop_release,
        "_get_json",
        _fake({"/releases/latest": _release("desktop-v0.6.0")}, calls),
    )
    resp = unauth_client.get("/api/desktop/release")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == "0.6.0"
    assert body["tag"] == "desktop-v0.6.0"
    assert body["published_at"] == "2026-09-30T10:12:00Z"
    assert body["dmg_url"] == STABLE
    assert (
        body["release_url"] == "https://github.com/lazyxgenius/Tvashtr/releases/tag/desktop-v0.6.0"
    )
    assert body["checked_at"].endswith("Z")
    assert set(body) == {"version", "tag", "published_at", "dmg_url", "release_url", "checked_at"}


def test_a_non_desktop_latest_falls_back_to_the_newest_desktop_tag(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        desktop_release,
        "_get_json",
        _fake(
            {
                "/releases/latest": _release("v2.0.0"),
                "/releases?per_page=20": [
                    _release("v2.0.0"),
                    _release("desktop-v0.7.0", draft=True),
                    _release("desktop-v0.7.0-rc1", prerelease=True),
                    _release("desktop-v0.6.1"),
                    _release("desktop-v0.6.0"),
                ],
            },
            calls,
        ),
    )
    out = desktop_release.latest_release()
    assert out["version"] == "0.6.1"
    assert out["dmg_url"] == STABLE, "never a versioned download link"


def test_the_answer_is_cached_for_ten_minutes(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        desktop_release, "_get_json", _fake({"/releases/latest": _release("desktop-v0.6.0")}, calls)
    )
    desktop_release.latest_release(now=1000.0)
    desktop_release.latest_release(now=1000.0 + 599)
    assert len(calls) == 1
    desktop_release.latest_release(now=1000.0 + 601)
    assert len(calls) == 2


def test_github_unreachable_gives_nulls_and_never_raises(unauth_client, monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        desktop_release,
        "_get_json",
        _fake({"/releases/latest": urllib.error.URLError("timed out")}, calls),
    )
    resp = unauth_client.get("/api/desktop/release")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] is None
    assert body["tag"] is None
    assert body["published_at"] is None
    assert body["release_url"] is None
    assert body["dmg_url"] == STABLE


def test_an_unexpected_error_never_raises(monkeypatch):
    def boom(url):
        raise RuntimeError("surprise")

    monkeypatch.setattr(desktop_release, "_get_json", boom)
    assert desktop_release.latest_release()["version"] is None


def test_no_desktop_release_at_all_gives_nulls(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        desktop_release,
        "_get_json",
        _fake(
            {"/releases/latest": _release("v1.0.0"), "/releases?per_page=20": [_release("v1.0.0")]},
            calls,
        ),
    )
    out = desktop_release.latest_release()
    assert out["version"] is None
    assert out["dmg_url"] == STABLE


def test_every_github_call_has_a_three_second_timeout(monkeypatch):
    seen: list = []

    def fake_urlopen(request, timeout=None):
        seen.append((request.full_url, timeout))
        raise urllib.error.URLError("offline")

    monkeypatch.setattr(desktop_release.urllib.request, "urlopen", fake_urlopen)
    assert desktop_release.latest_release()["version"] is None
    assert seen == [("https://api.github.com/repos/lazyxgenius/Tvashtr/releases/latest", 3.0)]
