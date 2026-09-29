"""The public website's live facts (website.md B-4): the repo, its GitHub star count and the latest
Desktop release. Stars have their own 10-minute in-process cache (per machine) and a 3 s timeout;
the release comes from :mod:`desktop_release` (its setting, fetcher and cache — no second fetch).
Never raises: an unknown value is ``None``.
"""

import logging
import threading
import time
from datetime import UTC, datetime

from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_release

logger = logging.getLogger("tvashtr.site_info")

_lock = threading.Lock()
_stars: dict = {"at": None, "repo": None, "value": None}


def _repo() -> str:
    return get_settings().desktop_release_repo.strip() or "lazyxgenius/Tvashtr"


def _star_count(repo: str, clock: float) -> int | None:
    with _lock:
        if _stars["repo"] == repo and _stars["at"] is not None:
            if clock - _stars["at"] < desktop_release.CACHE_SECONDS:
                return _stars["value"]
    try:
        data = desktop_release._get_json(f"https://api.github.com/repos/{repo}")
        count = data.get("stargazers_count") if isinstance(data, dict) else None
        value = count if isinstance(count, int) and not isinstance(count, bool) else None
    except Exception as exc:  # never raise from a public page's decoration
        logger.warning("star count check failed: %s", type(exc).__name__)
        value = None
    with _lock:
        _stars.update(at=clock, repo=repo, value=value)
    return value


def site_info(*, now: float | None = None) -> dict:
    """``{repo_url, stars, desktop, checked_at}``; ``desktop`` is ``latest_release()`` verbatim."""
    repo = _repo()
    clock = time.monotonic() if now is None else now
    return {
        "repo_url": f"https://github.com/{repo}",
        "stars": _star_count(repo, clock),
        "desktop": desktop_release.latest_release(now=now),
        "checked_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


def clear_cache() -> None:
    with _lock:
        _stars.update(at=None, repo=None, value=None)
