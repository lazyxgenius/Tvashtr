"""The base branch and scope of a hosted GitHub run (revamp P6).

``create_run`` used to overwrite ``base_ref`` with the repo's default branch and drop ``subpath``
for every GitHub run. Home's composer lets the user pick both, so the launch now checks them
against the repo itself (through the owner's GitHub App installation) and keeps them; the Options
popover lists the choices with :func:`branches_for` and :func:`subpaths_for`.

Every function authorizes first: the repo must be reachable through an installation the OWNER
controls (a user may send any ``owner/name``). GitHub I/O never runs inside a DB session.
"""

import http.client
import os
import uuid

from sqlalchemy import select

from tvashtr.control_plane import github_app
from tvashtr.db import session_scope
from tvashtr.models import GithubInstallation


def owner_repo(owner_id: uuid.UUID, full_name: str) -> tuple[int, dict] | None:
    """``(installation_id, repo)`` when ``full_name`` is one of the owner's App repos, else None."""
    with session_scope() as session:
        installation_ids = [
            row.installation_id
            for row in session.execute(
                select(GithubInstallation).where(GithubInstallation.owner_id == owner_id)
            ).scalars()
        ]
    if not installation_ids:
        return None
    return github_app.find_repo_in_installations(installation_ids, full_name)


def branch_sha(installation_id: int, full_name: str, branch: str) -> tuple[str | None, list[str]]:
    """``(sha or None, listed branch names)`` for ``branch`` — the listing first, then a direct
    lookup when the listing was capped."""
    branches, truncated = github_app.list_branches(installation_id, full_name)
    sha = next((b["sha"] for b in branches if b["name"] == branch), None)
    if sha is None and truncated:
        sha = github_app.get_branch_sha(installation_id, full_name, branch)
    return sha, [b["name"] for b in branches]


def target_problem(
    installation_id: int,
    full_name: str,
    *,
    base_ref: str,
    default_branch: str,
    subpath: str | None,
) -> dict | None:
    """The 422 ``detail`` for a launch whose base branch or scope the repo doesn't have, else
    ``None``. The default branch needs no lookup; a scope is checked on the chosen branch."""
    if base_ref != default_branch:
        sha, names = branch_sha(installation_id, full_name, base_ref)
        if sha is None:
            return {
                "code": "unknown_base_ref",
                "message": f"base_ref is not a branch of {full_name}",
                "base_ref": base_ref,
                "branches": names,
            }
    if subpath and not github_app.path_is_dir(installation_id, full_name, base_ref, subpath):
        return {
            "code": "unknown_subpath",
            "message": f"subpath is not a folder of {full_name} on {base_ref}",
            "subpath": subpath,
        }
    return None


def branches_for(installation_id: int, repo: dict) -> dict:
    """``{default_branch, branches, truncated}`` — the default branch first, then GitHub's order."""
    full_name = repo["full_name"]
    default = repo.get("default_branch") or "main"
    listed, truncated = github_app.list_branches(installation_id, full_name)
    names = [b["name"] for b in listed]
    ordered = [default] + [n for n in names if n != default] if default in names else names
    return {"default_branch": default, "branches": ordered, "truncated": truncated}


def subpaths_for(installation_id: int, repo: dict, ref: str | None) -> dict | None:
    """``{ref, subpaths, truncated}`` for ``ref`` (default: the default branch), or ``None`` when
    the repo has no such branch."""
    full_name = repo["full_name"]
    ref = ref or repo.get("default_branch") or "main"
    sha, _names = branch_sha(installation_id, full_name, ref)
    if sha is None:
        return None
    subpaths, truncated = github_app.tree_subpaths(installation_id, full_name, sha)
    return {"ref": ref, "subpaths": subpaths, "truncated": truncated}


# ---- M-desk-5 L3: a finished GitHub run's changes, from GitHub ---------------------------------

_FILE_STATUS = {"added": "added", "removed": "deleted"}


def never_pushed(status: str | None, pr_url: str | None, ship_commit_sha: str | None) -> bool:
    """M-desk-6 S3: a GitHub run that stopped before Ship made its commit has nothing on GitHub —
    the push follows the ship commit, so no commit means no branch was pushed. A completed run
    always pushed (a failed push fails the run), so only a run that didn't finish counts."""
    return status != "completed" and not pr_url and not ship_commit_sha


def reads_from_github(github_repo: str | None, status: str | None, repo_path: str | None) -> bool:
    """A finished GitHub run whose clone is gone (M-clonegc reaps it at run end): its changes come
    from GitHub. A live run, a local-folder run and a greenfield run keep reading their own copy."""
    from tvashtr.control_plane.clone_reaper import LIVE_STATUSES

    return (
        bool(github_repo)
        and status not in LIVE_STATUSES
        and not (repo_path and os.path.isdir(repo_path))
    )


def run_files(
    owner_id: uuid.UUID,
    run_id: str,
    github_repo: str,
    base_ref: str | None,
    ship_branch: str | None,
    pr_url: str | None,
) -> list[dict] | None:
    """``compute_run_diff``'s ``files`` for a finished GitHub run, through the owner's GitHub App
    installation: its pull request's Files changed (GitHub's comparison of its base and ship
    branch, kept right after a merge), else the comparison of the two branches. ``None`` when
    GitHub can't answer (the App removed, the branch gone, offline)."""
    number = pr_url.rstrip("/").rsplit("/", 1)[-1] if pr_url else ""
    try:
        found = owner_repo(owner_id, github_repo)
        if found is None:
            return None
        if number.isdigit():
            raw = github_app.pull_request_files(found[0], github_repo, int(number))
        else:
            raw = github_app.compare_files(
                found[0], github_repo, base_ref or "main", ship_branch or f"tvashtr/{run_id}"
            )
    # OSError: a socket timeout mid-read; HTTPException: a response cut off mid-body.
    except (github_app.GithubAppError, OSError, ValueError, http.client.HTTPException):
        return None
    return [
        {
            "path": f["filename"],
            "status": _FILE_STATUS.get(f.get("status"), "modified"),
            "additions": int(f.get("additions") or 0),
            "deletions": int(f.get("deletions") or 0),
            "patch": f.get("patch") or "",
        }
        for f in raw
        if isinstance(f, dict) and f.get("filename") and f["filename"] != "TVASHTR_REMEMBER.jsonl"
    ]
