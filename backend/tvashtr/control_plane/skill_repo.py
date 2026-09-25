"""Skills from a GitHub repo (revamp B-TOOLKIT, "Add from GitHub"): parse a repo URL, scan a repo at
a ref for the SKILL.md files the SDK loader would load, and import the chosen ones as library rows.

Openhands-free at import (stdlib + the app's own modules only).
"""

from __future__ import annotations

import re

_OWNER = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})"
_REPO = r"[A-Za-z0-9._-]{1,100}"
_URL_RE = re.compile(
    rf"^(?:(?:https?://)?(?:www\.)?github\.com/)?(?P<owner>{_OWNER})/(?P<repo>{_REPO}?)"
    r"(?:\.git)?/?$"
)


def parse_github_repo(url: object) -> tuple[str, str] | None:
    """``(owner, name)`` from ``https://github.com/<o>/<r>`` (``.git`` / trailing slash / no scheme
    / bare ``<o>/<r>`` accepted), or ``None`` when it isn't a GitHub repo URL."""
    if not isinstance(url, str):
        return None
    match = _URL_RE.match(url.strip())
    if match is None:
        return None
    owner, repo = match.group("owner"), match.group("repo")
    if repo.endswith(".git"):
        repo = repo[: -len(".git")]
    if not repo or repo in (".", ".."):
        return None
    return owner, repo


def repo_url(owner: str, repo: str) -> str:
    """The canonical ``https://github.com/<owner>/<repo>`` form stored on a repo skill source."""
    return f"https://github.com/{owner}/{repo}"
