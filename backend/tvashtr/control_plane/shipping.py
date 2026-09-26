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


# Tvashtr's own working files at the workspace root: a report-only node's deliverable (team_run's
# REPORT_FILENAME), the reviewer's verdict sidecar and the large-spec handle (context_compiler's
# SPEC_HANDLE_FILENAME). A greenfield workspace's .gitignore keeps them out of the ship, but a
# hosted clone or a local folder has no Tvashtr .gitignore, so the ship leaves them out itself —
# unless the repo already tracks a file of that name: then it is the user's own and ships as usual.
_OWN_FILES = ("REPORT.md", "REVIEW_VERDICT.json", "SPEC.md")


_REMEMBER_FILE = "TVASHTR_REMEMBER.jsonl"


def _ship_excludes(workspace_dir: str) -> list[str]:
    """The ``git add`` exclude pathspecs for this ship. Git refuses an ``add`` whose pathspec names
    an ignored file that exists, even as an exclude, so a file is only named when git would
    otherwise stage it: Tvashtr's own files when they are untracked and not ignored (a greenfield
    workspace's .gitignore already ignores them); the remember sidecar whenever it isn't ignored."""
    stageable = set(
        _git(
            workspace_dir,
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            *_OWN_FILES,
            check=False,
        ).stdout.split()
    )
    names = [name for name in _OWN_FILES if name in stageable]
    if _git(workspace_dir, "check-ignore", "-q", _REMEMBER_FILE, check=False).returncode != 0:
        names.insert(0, _REMEMBER_FILE)
    return [f":(exclude){name}" for name in names]


def _commits_since_branch_start(workspace_dir: str) -> int:
    """How many commits the checked-out branch has gained since it was created — the oldest entry
    of the branch's own reflog is where it started (a fresh workspace's ``init`` commit, or the base
    a ``tvashtr/<run_id>`` branch or worktree was created from). ``0`` when git can't tell (detached
    HEAD, no reflog), so the caller keeps its "nothing to ship" behaviour."""
    branch = _git(workspace_dir, "symbolic-ref", "-q", "HEAD", check=False)
    if branch.returncode != 0:
        return 0
    log = _git(workspace_dir, "reflog", "show", "--format=%H", branch.stdout.strip(), check=False)
    shas = log.stdout.split() if log.returncode == 0 else []
    if not shas:
        return 0
    count = _git(workspace_dir, "rev-list", "--count", f"{shas[-1]}..HEAD", check=False)
    return int(count.stdout.strip() or 0) if count.returncode == 0 else 0


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

    # `git add -A` EXCEPT the M-memory S4 agent-remember capture sidecar (``TVASHTR_REMEMBER.jsonl``
    # = context_compiler.REMEMBER_FILENAME): it is read at run-end but must NEVER ship. A pathspec
    # exclude (mount-agnostic: covers both the greenfield workspace and a brownfield
    # worktree) leaves
    # the file on disk for the run-end read while keeping it out of the commit.
    # Tvashtr's own untracked working files (``_OWN_FILES``) are left out the same way.
    _git(workspace_dir, "add", "-A", "--", ".", *_ship_excludes(workspace_dir))
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
        # The agent committed its own work on the run's branch (the OpenHands agent's system prompt
        # tells it to commit): ship those commits as they are, tagged like any ship.
        if _commits_since_branch_start(workspace_dir) > 0:
            _git(workspace_dir, "tag", tag)
            sha = _git(workspace_dir, "rev-parse", "HEAD").stdout.strip()
            return {"sha": sha, "tag": tag, "created": True}
        raise RuntimeError(
            f"nothing to ship for run {run_id}: no staged changes in {workspace_dir}"
        )

    _git(workspace_dir, "commit", "-q", "-m", f"Ship: {run_id}")
    _git(workspace_dir, "tag", tag)
    sha = _git(workspace_dir, "rev-parse", "HEAD").stdout.strip()
    return {"sha": sha, "tag": tag, "created": True}
