"""M3 (R8) — a run's workspace as a durable checkpoint, and the rebuild from one.

A checkpoint is the workspace's change against the commit its branch started from — the same
start the ship counts from (``shipping._commits_since_branch_start``): a greenfield workspace's
``init`` commit, a brownfield worktree's base. It holds the agent's own commits and its uncommitted
work alike, binary-safe, and leaves Tvashtr's own working files out (``shipping._ship_excludes``).
Rebuilding is: cut a fresh workspace from that base, apply the diff once.

Pure git (stdlib + ``subprocess``), openhands-free, so ``team_run`` may import it.
"""

import logging
import os
import re
import shutil
import subprocess
import tempfile
import uuid

# ponytail: the diff lives in a bytea column; a bigger change is not kept (its later steps can't be
# resumed). Object storage if real repos outgrow it.
MAX_DIFF_BYTES = 20 * 1024 * 1024
_GIT_TIMEOUT_S = 120
_MARKER = "tvashtr-checkpoint"

logger = logging.getLogger(__name__)


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
    Works on a copy of the workspace's index (its stat data keeps a big repo fast, and a committed
    file the ``.gitignore`` matches stays tracked), so the real index — what the ship stages — is
    untouched. Leaves out a step's own files (REPORT.md, the verdict, SPEC.md) and keeps the
    agents' remember captures (``TVASHTR_REMEMBER.jsonl``), which a resumed run still ingests."""
    from tvashtr.control_plane.shipping import _REMEMBER_FILE, _ship_excludes

    if not os.path.isdir(ws):
        raise CheckpointError(f"no workspace at {ws}")
    base = branch_start(ws)
    with tempfile.TemporaryDirectory() as tmp:
        index = os.path.join(tmp, "index")
        env = {"GIT_INDEX_FILE": index}
        real = _git(ws, "rev-parse", "--git-path", "index").stdout.strip()
        real = real if os.path.isabs(real) else os.path.join(ws, real)
        if os.path.exists(real):
            shutil.copyfile(real, index)
        else:
            _git(ws, "read-tree", "HEAD", env=env)
        excludes = [e for e in _ship_excludes(ws) if not e.endswith(_REMEMBER_FILE)]
        _git(ws, "add", "-A", "--", ".", *excludes, env=env)
        if os.path.isfile(os.path.join(ws, _REMEMBER_FILE)):
            _git(ws, "add", "-f", "--", _REMEMBER_FILE, env=env)
        diff = _git(ws, "diff", "--cached", "--binary", base, env=env, text=False).stdout
    if len(diff) > MAX_DIFF_BYTES:
        return {"base_sha": base, "diff": None, "too_large": True}
    return {"base_sha": base, "diff": diff, "too_large": False}


_CREATED = re.compile(r"^ create mode \d+ (.+)$", re.MULTILINE)


def apply(ws: str, diff: bytes, *, marker: str) -> bool:
    """Apply a checkpoint's diff to a freshly made workspace, once: ``marker`` (the checkpoint's
    id) is written into the work tree's git dir, so a replay of the run that finds it applied
    leaves the workspace as it is; a patch already in place (a crash before the stamp) is left too.
    Returns whether it changed the workspace now."""
    path = _marker_path(ws)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            if f.read().strip() == marker:
                return False
    applied = False
    if diff:
        with tempfile.NamedTemporaryFile(suffix=".patch", delete=False) as f:
            f.write(diff)
            patch = f.name
        try:
            # Already there (the process died between the patch and its stamp): leave it.
            if _git(ws, "apply", "--reverse", "--check", patch, check=False).returncode != 0:
                # A file the setup wrote again (a greenfield .gitignore) is replaced by the
                # checkpoint's copy: the checkpoint is what the workspace held.
                summary = _git(ws, "apply", "--summary", patch).stdout
                for rel in _CREATED.findall(summary):
                    path = os.path.join(ws, rel)
                    if os.path.isfile(path) and _untracked(ws, rel):
                        os.remove(path)
                _git(ws, "apply", "--binary", "--whitespace=nowarn", patch)
                applied = True
        finally:
            os.remove(patch)
    stamp(ws, marker)
    return applied


def _untracked(ws: str, rel: str) -> bool:
    return _git(ws, "ls-files", "--error-unmatch", "--", rel, check=False).returncode != 0


# ---- the database side: one row per finished step, and the rebuild of a fresh workspace ----------


def _marker_path(ws: str) -> str:
    return os.path.join(_git(ws, "rev-parse", "--absolute-git-dir").stdout.strip(), _MARKER)


def stamp(ws: str, marker: str) -> None:
    """Say the workspace holds this checkpoint (its git dir's marker)."""
    with open(_marker_path(ws), "w", encoding="utf-8") as f:
        f.write(marker)


def step_marker(invocation_id: int) -> str:
    return f"inv:{invocation_id}"


def seed_marker(run_id: str) -> str:
    return f"seed:{run_id}"


def record(
    run_id: str,
    invocation_id: int,
    node_id: str,
    iteration: int,
    workspace: str | None,
    state: dict,
) -> None:
    """After a finished step: the workspace as a checkpoint, written once per step. A plain call
    from the walk (never a DBOS step, so no recorded history moves); a replay finds the row and
    leaves it. The workspace's marker is stamped BEFORE the row is written, so a live workspace
    always carries one (``restore`` patches only a workspace without any). Never raises: a step
    that can't be checkpointed only means Resume can't start after it."""
    from sqlalchemy import select
    from sqlalchemy.dialects.postgresql import insert

    from tvashtr.db import session_scope
    from tvashtr.models import RunCheckpoint

    if workspace is None:
        return
    try:
        with session_scope() as session:
            done = session.execute(
                select(RunCheckpoint.id).where(RunCheckpoint.invocation_id == invocation_id)
            ).first()
        if done is not None:
            return
        cp = capture(workspace)
        stamp(workspace, step_marker(invocation_id))
        with session_scope() as session:
            session.execute(
                insert(RunCheckpoint)
                .values(
                    run_id=uuid.UUID(run_id),
                    invocation_id=invocation_id,
                    node_id=uuid.UUID(node_id),
                    iteration=iteration,
                    base_sha=cp["base_sha"],
                    diff=cp["diff"],
                    too_large=cp["too_large"],
                    state=state,
                )
                .on_conflict_do_nothing(index_elements=["invocation_id"])
            )
    except Exception:  # noqa: BLE001 — a missed checkpoint must never fail the run
        logger.warning(
            "checkpoint failed run_id=%s invocation=%s", run_id, invocation_id, exc_info=True
        )


def newest(run_id: str):
    """The run's newest usable checkpoint (its own last step's, else its seed), or None."""
    from sqlalchemy import select

    from tvashtr.db import session_scope
    from tvashtr.models import RunCheckpoint

    with session_scope() as session:
        rows = (
            session.execute(
                select(RunCheckpoint)
                .where(
                    RunCheckpoint.run_id == uuid.UUID(run_id), RunCheckpoint.too_large.is_(False)
                )
                .order_by(RunCheckpoint.invocation_id.desc().nulls_last())
            )
            .scalars()
            .all()
        )
        for row in rows:
            session.expunge(row)
    return rows[0] if rows else None


def restore(run_id: str, workspace: str) -> None:
    """Rebuild a FRESH workspace — one with no marker: a resumed run's first, or one a recovery
    re-made on another machine — from the run's newest checkpoint. A live workspace (marked) is left
    alone. A resumed run whose carried work won't apply raises :class:`CheckpointError` (the walk
    fails the run, readably); a recovered run's own checkpoint that won't apply falls back to its
    seed, else to the fresh workspace (the old behaviour)."""
    if os.path.exists(_marker_path(workspace)):
        return
    cp = newest(run_id)
    if cp is None:
        return
    if cp.invocation_id is None:
        apply(workspace, cp.diff or b"", marker=seed_marker(run_id))
        return
    try:
        apply(workspace, cp.diff or b"", marker=step_marker(cp.invocation_id))
    except CheckpointError:
        logger.warning("checkpoint restore failed run_id=%s", run_id, exc_info=True)
        seed = _seed(run_id)
        if seed is not None:
            apply(workspace, seed.diff or b"", marker=seed_marker(run_id))


def _seed(run_id: str):
    from sqlalchemy import select

    from tvashtr.db import session_scope
    from tvashtr.models import RunCheckpoint

    with session_scope() as session:
        row = session.execute(
            select(RunCheckpoint).where(
                RunCheckpoint.run_id == uuid.UUID(run_id), RunCheckpoint.invocation_id.is_(None)
            )
        ).scalar_one_or_none()
        if row is not None:
            session.expunge(row)
    return row


def rebuild_base(run_id: str) -> str | None:
    """The commit a rebuilt workspace is cut from: the newest checkpoint's base (a resumed run's
    seed, or a recovered run's own), else None (cut it as usual)."""
    cp = newest(run_id)
    return cp.base_sha if cp is not None and cp.base_sha else None


def has_commit(repo: str, sha: str) -> bool:
    return _git(repo, "cat-file", "-e", f"{sha}^{{commit}}", check=False).returncode == 0
