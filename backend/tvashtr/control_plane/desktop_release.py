"""The latest Tvashtr Desktop release (desktop-app.md §3, DT-43).

Reads GitHub's releases for ``settings.desktop_release_repo``: ``/releases/latest`` first, and when
its tag isn't a ``desktop-v*`` tag, the first non-draft, non-prerelease ``desktop-v*`` release in
``/releases?per_page=20``. The answer is cached in this process for 10 minutes, every GitHub call
has a 3 s timeout, and :func:`latest_release` never raises: when GitHub can't be reached the
version keys are ``None``. ``dmg_url`` is ALWAYS the stable ``Tvashtr-mac.dmg`` link, never a
versioned one (the download must keep working after the next release).
"""

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime

from tvashtr.config import get_settings

logger = logging.getLogger("tvashtr.desktop_release")

CACHE_SECONDS = 10 * 60
TIMEOUT_SECONDS = 3.0
TAG_PREFIX = "desktop-v"
DMG_NAME = "Tvashtr-mac.dmg"

_lock = threading.Lock()
_cache: dict = {"at": None, "repo": None, "value": None}


def stable_dmg_url(repo: str) -> str:
    return f"https://github.com/{repo}/releases/latest/download/{DMG_NAME}"


def _get_json(url: str) -> object:
    request = urllib.request.Request(  # noqa: S310 — a fixed https://api.github.com URL
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "tvashtr",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310
        return json.loads(resp.read().decode() or "null")


def _is_desktop(release: object) -> bool:
    return (
        isinstance(release, dict)
        and isinstance(release.get("tag_name"), str)
        and release["tag_name"].startswith(TAG_PREFIX)
        and not release.get("draft")
        and not release.get("prerelease")
    )


def _find_release(repo: str) -> dict | None:
    base = f"https://api.github.com/repos/{repo}"
    latest = _get_json(f"{base}/releases/latest")
    if _is_desktop(latest):
        return latest  # type: ignore[return-value]
    listing = _get_json(f"{base}/releases?per_page=20")
    if isinstance(listing, list):
        for release in listing:
            if _is_desktop(release):
                return release
    return None


def _answer(repo: str, release: dict | None, checked_at: str) -> dict:
    tag = release.get("tag_name") if release else None
    return {
        "version": tag[len(TAG_PREFIX) :] if tag else None,
        "tag": tag,
        "published_at": release.get("published_at") if release else None,
        "dmg_url": stable_dmg_url(repo),
        "release_url": (release.get("html_url") if release else None)
        or (f"https://github.com/{repo}/releases/tag/{tag}" if tag else None),
        "checked_at": checked_at,
    }


def latest_release(*, now: float | None = None) -> dict:
    """``{version, tag, published_at, dmg_url, release_url, checked_at}``. Never raises."""
    repo = get_settings().desktop_release_repo.strip() or "lazyxgenius/Tvashtr"
    clock = time.monotonic() if now is None else now
    with _lock:
        at, cached_repo, value = _cache["at"], _cache["repo"], _cache["value"]
        if value is not None and cached_repo == repo and at is not None:
            if clock - at < CACHE_SECONDS:
                return dict(value)
    checked_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    try:
        release = _find_release(repo)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        logger.warning("desktop release check failed: %s", type(exc).__name__)
        release = None
    except Exception:  # never raise from an update check
        logger.exception("desktop release check failed")
        release = None
    value = _answer(repo, release, checked_at)
    with _lock:
        _cache.update(at=clock, repo=repo, value=value)
    return dict(value)


def clear_cache() -> None:
    with _lock:
        _cache.update(at=None, repo=None, value=None)
