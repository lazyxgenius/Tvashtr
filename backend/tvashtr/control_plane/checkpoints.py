"""M3 (R8) — a run's workspace as a durable checkpoint, and the rebuild from one.

A checkpoint is the workspace's change against the commit its branch started from — the same
start the ship counts from (``shipping._commits_since_branch_start``): a greenfield workspace's
``init`` commit, a brownfield worktree's base. It holds the agent's own commits and its uncommitted
work alike, binary-safe, and leaves Tvashtr's own working files out (``shipping._ship_excludes``).
Rebuilding is: cut a fresh workspace from that base, apply the diff once.

Pure git (stdlib + ``subprocess``), openhands-free, so ``team_run`` may import it.
"""

import os
import re
import subprocess
import tempfile

# ponytail: the diff lives in a bytea column; a bigger change is not kept (its later steps can't be
# resumed). Object storage if real repos outgrow it.
MAX_DIFF_BYTES = 20 * 1024 * 1024
_GIT_TIMEOUT_S = 120
_MARKER = "tvashtr-checkpoint"


class CheckpointError(RuntimeError):
    """The workspace can't be captured or rebuilt (not a work tree, a patch that won't apply)."""


def _git(ws: str, *args: str, env: dict | None = None, check: bool = True, text: bool = True):
    try:
        return subprocess.run(
            ["git", "-C", ws, *args],
            check=check,
            capture_output=True,
            text=text,
            env={**os.environ, **env} if env else None,
            timeout=_GIT_TIMEOUT_S,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        detail = getattr(exc, "stderr", "") or ""
        if isinstance(detail, bytes):
            detail = detail.decode(errors="replace")
        raise CheckpointError(f"git {args[0]} failed in {ws}: {detail.strip() or exc}") from exc


def branch_start(ws: str) -> str:
    """The commit the checked-out branch started from: the oldest entry of its reflog, else the
    root commit (no reflog — e.g. a clone made without one)."""
    head = _git(ws, "symbolic-ref", "-q", "HEAD", check=False)
    if head.returncode == 0:
        log = _git(ws, "reflog", "show", "--format=%H", head.stdout.strip(), check=False)
        shas = log.stdout.split() if log.returncode == 0 else []
        if shas:
            return shas[-1]
    roots = _git(ws, "rev-list", "--max-parents=0", "HEAD").stdout.split()
    return roots[-1]


def capture(ws: str) -> dict:
    """``{"base_sha", "diff": bytes | None, "too_large": bool}`` for the workspace as it is now.
    Uses a throwaway index, so the workspace's own index (what the ship stages) is untouched."""
    from tvashtr.control_plane.shipping import _ship_excludes

    if not os.path.isdir(ws):
        raise CheckpointError(f"no workspace at {ws}")
    base = branch_start(ws)
    with tempfile.TemporaryDirectory() as tmp:
        env = {"GIT_INDEX_FILE": os.path.join(tmp, "index")}
        # Start from the base's tree so a tracked file that is also ignored isn't read as deleted.
        _git(ws, "read-tree", base, env=env)
        _git(ws, "add", "-A", "--", ".", *_ship_excludes(ws), env=env)
        diff = _git(ws, "diff", "--cached", "--binary", base, env=env, text=False).stdout
    if len(diff) > MAX_DIFF_BYTES:
        return {"base_sha": base, "diff": None, "too_large": True}
    return {"base_sha": base, "diff": diff, "too_large": False}


_CREATED = re.compile(r"^ create mode \d+ (.+)$", re.MULTILINE)


def apply(ws: str, diff: bytes, *, marker: str) -> bool:
    """Apply a checkpoint's diff to a freshly made workspace, once: ``marker`` (the checkpoint's
    id) is written into the work tree's git dir, so a replay of the run that finds it applied
    leaves the workspace as it is. Returns whether it applied now."""
    git_dir = _git(ws, "rev-parse", "--absolute-git-dir").stdout.strip()
    stamp = os.path.join(git_dir, _MARKER)
    if os.path.exists(stamp):
        with open(stamp, encoding="utf-8") as f:
            if f.read().strip() == marker:
                return False
    if diff:
        with tempfile.NamedTemporaryFile(suffix=".patch", delete=False) as f:
            f.write(diff)
            patch = f.name
        try:
            # A file the setup wrote again (a greenfield .gitignore) is replaced by the
            # checkpoint's copy: the checkpoint is what the workspace held.
            summary = _git(ws, "apply", "--summary", patch).stdout
            for rel in _CREATED.findall(summary):
                path = os.path.join(ws, rel)
                if os.path.isfile(path) and _untracked(ws, rel):
                    os.remove(path)
            _git(ws, "apply", "--binary", "--whitespace=nowarn", patch)
        finally:
            os.remove(patch)
    with open(stamp, "w", encoding="utf-8") as f:
        f.write(marker)
    return True


def _untracked(ws: str, rel: str) -> bool:
    return _git(ws, "ls-files", "--error-unmatch", "--", rel, check=False).returncode != 0
