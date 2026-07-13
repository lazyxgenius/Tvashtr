"""Read-only per-file diff of a run's reviewed work — the substrate for the run-view "Changes" tab
(M-changes). Given a run's stored coordinates it shells out to ``git`` (subprocess, no new
dependency) and returns a per-file ``{path, status, additions, deletions, patch}`` list plus a
total.

Two modes, one diff machinery. The range is three-dot (``base...head``, a MERGE-BASE compare, like a
PR/compare view) so commits made on the base branch AFTER the run's branch was cut never leak into
the run's diff — only what the run actually changed shows:
- **Brownfield** (``repo_path`` set): ``git -C <repo_path> diff <base_ref>...<ship_branch>`` — the
  real change the run landed on its ``tvashtr/<run_id>`` branch, against the branch it was cut from.
- **Greenfield** (``repo_path`` NULL): the produced files under the run's throwaway workspace,
  diffed as ``<root/init commit>...HEAD`` so every shipped file reports as ``added`` with its
  content as the patch (root is a true ancestor of HEAD, so three-dot == two-dot here).

A run with nothing to diff yet (no workspace, an unresolvable ref, an empty range) yields an empty
list — never an exception. Kept **openhands-free and DBOS-free** (pure functions over ``subprocess``
+ ``pathlib``, mirroring ``shipping.py`` / ``worktree.py``) so it is importable anywhere and
unit-testable against a throwaway temp repo.
"""

import subprocess
from pathlib import Path

# Bound every git call so a wedged repo can't hang the request (mirrors worktree.py).
_GIT_TIMEOUT_S = 30

# The greenfield workspace root, resolved from run_id EXACTLY as openhands_adapter._WORKSPACE_ROOT
# does (its parents[2] and this module's parents[2] are both ``backend/``) — replicated, not
# imported, to keep this module openhands-free (invariant #1). A read-only recompute; never mkdir.
_WORKSPACE_ROOT = Path(__file__).resolve().parents[2] / ".tvashtr_workspaces"

# git name-status letter -> the diff status vocabulary the endpoint exposes. ``--no-renames`` keeps
# every change in {A, M, D} (a rename surfaces as delete-old + add-new); anything else -> modified.
_STATUS = {"A": "added", "M": "modified", "D": "deleted"}


def _git(cwd: str, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    """``git -C <cwd> -c core.quotePath=false <args>``, capturing output. ``core.quotePath=false``
    keeps non-ASCII paths literal (not octal-escaped). Timeout-bounded."""
    return subprocess.run(
        ["git", "-C", str(cwd), "-c", "core.quotePath=false", *args],
        check=check,
        capture_output=True,
        text=True,
        # A tracked file/path with non-UTF-8 bytes must not abort decoding (git emits the raw bytes
        # in the patch). Replace them rather than raise UnicodeDecodeError — a read must never 500.
        errors="replace",
        timeout=_GIT_TIMEOUT_S,
    )


def compute_run_diff(
    *,
    run_id: str,
    repo_path: str | None,
    base_ref: str | None,
    ship_branch: str | None,
) -> dict:
    """The run's per-file change set. ``repo_path`` set -> brownfield (branch-vs-base); NULL ->
    greenfield (produced files vs the empty init tree). Returns
    ``{run_id, base_ref, ship_branch, files:[{path, status, additions, deletions, patch}], total}``;
    an empty ``files`` for a run with nothing to diff (200, not an error)."""
    if repo_path:
        head = ship_branch or f"tvashtr/{run_id}"
        base = base_ref or "HEAD"
        files = _diff_files(repo_path, base, head)
    else:
        files = _greenfield_files(run_id)
    return {
        "run_id": run_id,
        "base_ref": base_ref,
        "ship_branch": ship_branch,
        "files": files,
        "total": len(files),
    }


def _greenfield_files(run_id: str) -> list[dict]:
    """The produced files in the run's throwaway workspace, as ``root..HEAD`` (root = the empty
    init commit), so each shipped file is an ``added`` diff. Empty if the workspace is gone / not a
    repo."""
    ws = _WORKSPACE_ROOT / run_id
    if not (ws / ".git").exists():
        return []
    root = _root_commit(str(ws))
    if root is None:
        return []
    return _diff_files(str(ws), root, "HEAD")


def _diff_files(cwd: str, base: str, head: str) -> list[dict]:
    """``git diff <base>...<head>`` (merge-base compare) as a per-file list. Read-only and
    crash-proof: a missing dir, unresolvable ref, absent git, timeout, or an undecodable byte all
    yield ``[]``."""
    try:
        if not Path(cwd).exists():
            return []
        if not (_rev_ok(cwd, base) and _rev_ok(cwd, head)):
            return []
        counts = _numstat(cwd, base, head)
        files: list[dict] = []
        for letter, path in _name_status(cwd, base, head):
            # M-memory S4: the agent-remember capture sidecar (``TVASHTR_REMEMBER.jsonl``) never
            # surfaces in a run's reviewed diff (defense-in-depth beside the ship-time exclude).
            if path == "TVASHTR_REMEMBER.jsonl":
                continue
            additions, deletions = counts.get(path, (0, 0))
            files.append(
                {
                    "path": path,
                    "status": _STATUS.get(letter[:1], "modified"),
                    "additions": additions,
                    "deletions": deletions,
                    "patch": _git(
                        cwd, "diff", "--no-renames", f"{base}...{head}", "--", path, check=False
                    ).stdout,
                }
            )
        return files
    except (subprocess.SubprocessError, OSError, ValueError):
        return []


def _rev_ok(cwd: str, ref: str) -> bool:
    """True iff ``ref`` resolves to a commit in ``cwd`` (so the diff range is valid)."""
    probe = _git(cwd, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}", check=False)
    return probe.returncode == 0


def _numstat(cwd: str, base: str, head: str) -> dict[str, tuple[int, int]]:
    """path -> (additions, deletions). A binary file reports ``-``/``-`` -> (0, 0)."""
    out = _git(cwd, "diff", "--numstat", "--no-renames", f"{base}...{head}", check=False)
    counts: dict[str, tuple[int, int]] = {}
    for line in out.stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        adds, dels, path = parts
        counts[path] = (
            int(adds) if adds.isdigit() else 0,
            int(dels) if dels.isdigit() else 0,
        )
    return counts


def _name_status(cwd: str, base: str, head: str) -> list[tuple[str, str]]:
    """[(status_letter, path)] in git's walk order (``--no-renames`` -> letters are A / M / D)."""
    out = _git(cwd, "diff", "--name-status", "--no-renames", f"{base}...{head}", check=False)
    rows: list[tuple[str, str]] = []
    for line in out.stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        rows.append((parts[0], parts[1]))
    return rows


def _root_commit(cwd: str) -> str | None:
    """The workspace's root (init) commit — the empty base a greenfield diff is taken against."""
    try:
        out = _git(cwd, "rev-list", "--max-parents=0", "HEAD", check=False)
    except (subprocess.SubprocessError, OSError):
        return None
    if out.returncode != 0:
        return None
    lines = [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
    return lines[-1] if lines else None
