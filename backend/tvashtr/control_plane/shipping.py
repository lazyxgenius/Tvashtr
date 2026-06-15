"""Idempotent 'ship' of an agent's work into the run's local git repo.

Decision 1: the agent run is one coarse DBOS step that gets re-run on crash; we
make the *outcome* idempotent rather than checkpointing inside the agent loop —
the ship is a git commit **dedup'd by a deterministic tag ``ship-{run_id}``**, so
re-running the agent (which overwrites files harmlessly) ships exactly once.

These are pure functions (no DBOS), so they're unit-testable; the workflow's
``ship_step`` wraps them. Commits use **repo-local** identity, so they work
without any global git config.
"""

import subprocess
from pathlib import Path


def _git(workspace_dir: str, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(workspace_dir), *args],
        check=check,
        capture_output=True,
        text=True,
    )


def init_workspace_repo(workspace_dir: str) -> None:
    """Idempotently ``git init`` the workspace with repo-local identity + an empty
    initial commit. No-op if it is already a repo."""
    if (Path(workspace_dir) / ".git").exists():
        return
    _git(workspace_dir, "init", "-q")
    _git(workspace_dir, "config", "user.email", "agent@tvashtr.local")
    _git(workspace_dir, "config", "user.name", "Tvashtr Agent")
    _git(workspace_dir, "commit", "--allow-empty", "-q", "-m", "init")


def idempotent_ship(workspace_dir: str, run_id: str) -> dict:
    """Commit the workspace's changes once, tagged ``ship-{run_id}``.

    Returns ``{sha, tag, created}``. If the tag already exists, returns the
    existing commit with ``created=False`` (no new commit). If there is nothing
    to commit, raises (the agent shipped nothing).
    """
    tag = f"ship-{run_id}"
    existing = _git(workspace_dir, "rev-parse", "--verify", "-q", f"refs/tags/{tag}", check=False)
    if existing.returncode == 0:
        return {"sha": existing.stdout.strip(), "tag": tag, "created": False}

    _git(workspace_dir, "add", "-A")
    # `git diff --cached --quiet` exits 0 when there is NOTHING staged.
    if _git(workspace_dir, "diff", "--cached", "--quiet", check=False).returncode == 0:
        # Crash window: the process may have died *between* commit and tag. If HEAD
        # is already this run's ship commit, recover by re-tagging it (idempotent);
        # only raise if HEAD is genuinely not a ship commit (nothing was produced).
        head_subject = _git(workspace_dir, "log", "-1", "--format=%s", check=False)
        if head_subject.returncode == 0 and head_subject.stdout.strip() == f"Ship: {run_id}":
            _git(workspace_dir, "tag", tag)
            sha = _git(workspace_dir, "rev-parse", "HEAD").stdout.strip()
            return {"sha": sha, "tag": tag, "created": False}
        raise RuntimeError(
            f"nothing to ship for run {run_id}: no staged changes in {workspace_dir}"
        )

    _git(workspace_dir, "commit", "-q", "-m", f"Ship: {run_id}")
    _git(workspace_dir, "tag", tag)
    sha = _git(workspace_dir, "rev-parse", "HEAD").stdout.strip()
    return {"sha": sha, "tag": tag, "created": True}
