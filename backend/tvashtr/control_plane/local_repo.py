"""Desktop local-folder runs (revamp P10) — the source bundle in, the result bundle out.

Tvashtr Desktop talks to the HOSTED backend, which never reads a path on the user's computer. So
Desktop makes a ``git bundle`` of the chosen base branch and uploads it
(``POST /api/desktop/repo-snapshots`` → a ``kind='source'`` :class:`RepoSnapshot`). A launch with
``local_repo`` claims that snapshot for the new run (``RepoSnapshot.run_id``), and the durable
``clone_local_snapshot_step`` clones it into the run's clone directory and sets ``runs.repo_path`` —
from there the executor treats it as an ordinary brownfield run (worktree on ``tvashtr/<run_id>``,
grounding, ship). Ship does not open a PR: it stores a ``kind='result'`` bundle of the
``tvashtr/<run_id>`` branch, which Desktop downloads (``GET /api/runs/{id}/ship-bundle``) and
``git fetch``-es into the user's folder as a new branch, never touching their working tree.

Bundles live in Postgres, not on a machine's disk, so whichever backend machine runs the workflow
can read them. A source snapshot is marked ``consumed_at`` and its bytes emptied once cloned; an
unclaimed one is purged after 24h (on the owner's next upload).

Stdlib + ``git`` + SQLAlchemy only — openhands-free, so ``team_run`` may import it.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select, update

from tvashtr.control_plane import clone_reaper
from tvashtr.control_plane.resolution_warnings import record_resolution_warning
from tvashtr.control_plane.worktree import branch_name_for, is_work_tree, subpath_is_tracked_dir
from tvashtr.db import session_scope
from tvashtr.models import RepoSnapshot, Run

# An unclaimed source snapshot older than this is dropped on the owner's next upload.
SOURCE_TTL = timedelta(hours=24)
# Failure codes the executor records (``runs.failure_code``) for a folder run.
FOLDER_CLONE_FAILED = "folder_clone"
FOLDER_DELIVERY = "folder_delivery"
# Bundles can be large (up to the upload cap), so git gets longer than the usual 30s here.
_GIT_TIMEOUT_S = 600
_LABEL_MAX = 300
# What ``GET /api/runs/{id}/ship-bundle`` serves.
BUNDLE_MEDIA_TYPE = "application/x-git-bundle"


class LocalRepoError(HTTPException):
    """A refusal with a readable ``detail = {code, message, …}``.

    An ``HTTPException`` so ``create_run`` can call :func:`check_launch` / :func:`claim_snapshot`
    without wrapping them; the routes raise it as-is."""

    def __init__(self, status_code: int, code: str, message: str, **extra: Any) -> None:
        detail = {"code": code, "message": message, **extra}
        super().__init__(status_code=status_code, detail=detail)


class LocalRepoTarget(BaseModel):
    """``POST /api/runs`` ``local_repo``: the uploaded snapshot plus how the UI names the folder."""

    snapshot_id: str
    label: str | None = None
    base_ref: str | None = None
    subpath: str | None = None


@dataclass(frozen=True)
class LocalLaunch:
    """A validated ``local_repo`` launch target."""

    snapshot_id: uuid.UUID
    label: str
    base_ref: str
    subpath: str | None


# ---------------------------------------------------------------------------- git helpers


def _git(*args: str, cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, timeout=_GIT_TIMEOUT_S
    )


def _git_ok(*args: str, cwd: str | None = None) -> str:
    """Run git and return stdout; on failure raise a short ``RuntimeError`` naming the command."""
    proc = _git(*args, cwd=cwd)
    if proc.returncode != 0:
        first = next((ln for ln in proc.stderr.splitlines() if ln.strip()), "").strip()
        raise RuntimeError(f"git {args[0]} failed" + (f": {first}" if first else ""))
    return proc.stdout


def normalise_branch(base_ref: str | None) -> str | None:
    """``main`` for ``main`` or ``refs/heads/main``; ``None`` when it is not a valid branch name."""
    name = (base_ref or "").strip()
    if name.startswith("refs/heads/"):
        name = name[len("refs/heads/") :]
    if not name or name.startswith("-"):
        return None
    if _git("check-ref-format", "--branch", name).returncode != 0:
        return None
    return name


def _bundle_heads(bundle_path: str) -> dict[str, str]:
    """``{refname: sha}`` for every ref the bundle carries (``git bundle list-heads``)."""
    heads: dict[str, str] = {}
    for line in _git_ok("bundle", "list-heads", bundle_path).splitlines():
        sha, _, ref = line.strip().partition(" ")
        if sha and ref:
            heads[ref] = sha
    return heads


def verify_bundle(data: bytes, base_ref: str) -> dict:
    """Check ``data`` is a complete git bundle that carries branch ``base_ref``.

    ``git bundle verify`` needs a repository to check prerequisites against, so it runs inside an
    EMPTY bare repo: a bundle that leaves out older history (a thin ``a..b`` bundle) fails there,
    which is what we want — the run clones from this bundle alone. Returns ``{head_sha,
    branches}``; raises :class:`LocalRepoError` (422) otherwise."""
    with tempfile.TemporaryDirectory(prefix="tvashtr-bundle-") as tmp:
        path = str(Path(tmp) / "source.bundle")
        Path(path).write_bytes(data)
        probe = str(Path(tmp) / "probe.git")
        _git_ok("init", "--quiet", "--bare", probe)
        verify = _git("bundle", "verify", path, cwd=probe)
        if verify.returncode != 0:
            if "prerequisite" in verify.stderr:
                raise LocalRepoError(
                    422,
                    "bundle_incomplete",
                    "The bundle leaves out older history. Make it from the whole branch "
                    "(git bundle create <file> <branch>).",
                )
            raise LocalRepoError(422, "bundle_invalid", "That file isn't a git bundle.")
        heads = _bundle_heads(path)
    branches = sorted(r[len("refs/heads/") :] for r in heads if r.startswith("refs/heads/"))
    sha = heads.get(f"refs/heads/{base_ref}")
    if sha is None:
        raise LocalRepoError(
            422,
            "base_ref_not_in_bundle",
            f"The bundle doesn't contain the branch {base_ref}.",
            base_ref=base_ref,
            branches=branches,
        )
    return {"head_sha": sha, "branches": branches}


def clean_label(label: str | None) -> str | None:
    text = " ".join((label or "").split())
    return text[:_LABEL_MAX] or None


# ---------------------------------------------------------------------------- upload


def purge_stale_sources(owner_id: uuid.UUID) -> int:
    """Drop the owner's source snapshots that no run consumed within :data:`SOURCE_TTL` — never
    one a live run has claimed but not cloned yet. Returns how many rows went."""
    live = select(Run.id).where(Run.status.in_(clone_reaper.LIVE_STATUSES))
    with session_scope() as session:
        result = session.execute(
            delete(RepoSnapshot).where(
                RepoSnapshot.owner_id == owner_id,
                RepoSnapshot.kind == "source",
                RepoSnapshot.consumed_at.is_(None),
                RepoSnapshot.created_at < func.now() - SOURCE_TTL,
                or_(RepoSnapshot.run_id.is_(None), RepoSnapshot.run_id.not_in(live)),
            )
        )
        return result.rowcount or 0


def create_source_snapshot(
    owner_id: uuid.UUID, data: bytes, *, label: str | None, base_ref: str | None
) -> dict:
    """Validate and store an uploaded source bundle (the size cap is the route's job)."""
    if not data:
        raise LocalRepoError(422, "bundle_invalid", "That file isn't a git bundle.")
    if not (base_ref or "").strip():
        raise LocalRepoError(
            422, "base_ref_missing", "Say which branch the bundle was made from (base_ref)."
        )
    branch = normalise_branch(base_ref)
    if branch is None:
        raise LocalRepoError(
            422, "base_ref_invalid", f"{base_ref.strip()} isn't a valid branch name."
        )
    info = verify_bundle(data, branch)
    purge_stale_sources(owner_id)
    snapshot = RepoSnapshot(
        owner_id=owner_id,
        kind="source",
        label=clean_label(label),
        base_ref=branch,
        size_bytes=len(data),
        data=data,
    )
    with session_scope() as session:
        session.add(snapshot)
        session.flush()
        return {
            "snapshot_id": str(snapshot.id),
            "size_bytes": snapshot.size_bytes,
            "label": snapshot.label,
            "base_ref": branch,
            "head_sha": info["head_sha"],
            "created_at": snapshot.created_at.isoformat(),
        }


# ---------------------------------------------------------------------------- launch


def _clean_subpath(subpath: str | None) -> str | None:
    sp = (subpath or "").strip().strip("/")
    if not sp:
        return None
    parts = sp.split("/")
    if "\\" in sp or any(p in ("", ".", "..") for p in parts):
        raise LocalRepoError(422, "subpath_invalid", f"{sp} isn't a folder inside the repository.")
    return sp


_NOT_FOUND = "That folder snapshot wasn't found. Choose the folder again."
_USED = (
    "That folder snapshot was already used by another run. Launch again from Tvashtr Desktop to "
    "send a fresh one."
)


def check_launch(owner_id: uuid.UUID, body: Any) -> LocalLaunch:
    """Validate ``POST /api/runs``'s ``local_repo`` (``body`` is the ``CreateRunRequest``).

    Only a Desktop launch may use it, never alongside ``github_repo`` / ``repo_path``, and the
    snapshot must be one of the caller's own unused SOURCE snapshots (someone else's is a 404)."""
    target: LocalRepoTarget = body.local_repo
    if body.github_repo is not None or body.repo_path is not None:
        raise LocalRepoError(
            422,
            "local_repo_exclusive",
            "Choose a folder or a GitHub repository for the run, not both.",
        )
    if not body.desktop_target:
        raise LocalRepoError(
            422, "local_repo_needs_desktop", "Runs on a local folder start from Tvashtr Desktop."
        )
    try:
        sid = uuid.UUID(str(target.snapshot_id))
    except ValueError:
        raise LocalRepoError(404, "snapshot_not_found", _NOT_FOUND) from None
    with session_scope() as session:
        snap = session.execute(
            select(
                RepoSnapshot.owner_id,
                RepoSnapshot.kind,
                RepoSnapshot.run_id,
                RepoSnapshot.consumed_at,
                RepoSnapshot.label,
                RepoSnapshot.base_ref,
            ).where(RepoSnapshot.id == sid)
        ).one_or_none()
    if snap is None or snap.owner_id != owner_id or snap.kind != "source":
        raise LocalRepoError(404, "snapshot_not_found", _NOT_FOUND)
    if snap.consumed_at is not None or snap.run_id is not None:
        raise LocalRepoError(422, "snapshot_used", _USED)
    base_ref = snap.base_ref
    if target.base_ref is not None and normalise_branch(target.base_ref) != base_ref:
        raise LocalRepoError(
            422,
            "base_ref_mismatch",
            f"The folder snapshot was taken from {base_ref}, not {target.base_ref.strip()}. "
            "Launch again to send a fresh one.",
            base_ref=base_ref,
        )
    label = clean_label(target.label) or snap.label or "Local folder"
    return LocalLaunch(sid, label, base_ref, _clean_subpath(target.subpath))


def claim_snapshot(session, launch: LocalLaunch, run_id: uuid.UUID) -> None:
    """Tie the snapshot to the run being inserted in ``session`` — atomically, so two launches
    racing for one snapshot can't both win (the loser's whole insert rolls back)."""
    session.flush()  # the Run row must exist for the FK
    claimed = session.execute(
        update(RepoSnapshot)
        .where(
            RepoSnapshot.id == launch.snapshot_id,
            RepoSnapshot.kind == "source",
            RepoSnapshot.run_id.is_(None),
            RepoSnapshot.consumed_at.is_(None),
        )
        .values(run_id=run_id)
    )
    if claimed.rowcount != 1:
        raise LocalRepoError(422, "snapshot_used", _USED)


# ---------------------------------------------------------------------------- executor


def is_folder_run(run_id: str) -> bool:
    """Whether ``run_id`` works on a Desktop folder. Read in the WORKFLOW BODY to gate the folder
    steps: ``local_snapshot_id`` is written once at create and never changes, so the answer is the
    same on every replay, and every other run's recorded step sequence stays exactly as before."""
    with session_scope() as session:
        sid = session.execute(
            select(Run.local_snapshot_id).where(Run.id == uuid.UUID(run_id))
        ).scalar_one_or_none()
    return sid is not None


def _clone_bundle(data: bytes, base_ref: str, dest: str) -> None:
    """Clone ``data`` (a bundle) into ``dest`` with ``base_ref`` checked out, drop the ``origin``
    remote (it pointed at a temp file) and give the clone a repo-local commit identity, as
    ``init_workspace_repo`` does — the hosted image has no global git config."""
    target = Path(dest)
    if target.exists():
        shutil.rmtree(target)  # a half-made clone from a crashed attempt — ours, under CLONE_ROOT
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tvashtr-bundle-") as tmp:
        path = str(Path(tmp) / "source.bundle")
        Path(path).write_bytes(data)
        _git_ok("clone", "--quiet", "--branch", base_ref, "--", path, dest)
    _git_ok("remote", "remove", "origin", cwd=dest)
    _git_ok("config", "user.email", "agent@tvashtr.local", cwd=dest)
    _git_ok("config", "user.name", "Tvashtr Agent", cwd=dest)


def materialize_folder_clone(run_id: str) -> dict:
    """``clone_local_snapshot_step``'s body: clone the run's claimed source bundle into its clone
    directory (``clone_reaper`` reclaims it at run end), check out ``base_ref``, set ``repo_path``,
    then mark the snapshot consumed and empty its bytes.

    Returns ``{"ok": True, "repo_path"}``, or ``{"ok": False, "reason"}`` for the workflow to fail
    the run with — never raises, so a bad bundle ends the run readably instead of wedging it.
    Idempotent: a clone already on this machine is kept as-is."""
    rid = uuid.UUID(run_id)
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == rid)).scalar_one()
        snapshot_id, repo_path = run.local_snapshot_id, run.repo_path
        base_ref, subpath, label = run.base_ref, run.subpath, run.local_repo_label
    if snapshot_id is None:
        return {"ok": True, "repo_path": repo_path}
    if repo_path and is_work_tree(repo_path):
        return {"ok": True, "repo_path": repo_path}
    try:
        with session_scope() as session:
            data = session.execute(
                select(RepoSnapshot.data).where(
                    RepoSnapshot.id == snapshot_id,
                    RepoSnapshot.kind == "source",
                    RepoSnapshot.run_id == rid,
                    RepoSnapshot.consumed_at.is_(None),
                )
            ).scalar_one_or_none()
        if not data:
            return {
                "ok": False,
                "reason": "The folder snapshot for this run is no longer on the server. Start the "
                "run again from Tvashtr Desktop.",
            }
        dest = clone_reaper.clone_dir_for_run(run_id)
        _clone_bundle(bytes(data), base_ref or "HEAD", dest)
        keep_scope = subpath is None or subpath_is_tracked_dir(dest, subpath)
        with session_scope() as session:
            values: dict = {"repo_path": dest}
            if not keep_scope:
                values["subpath"] = None
            session.execute(update(Run).where(Run.id == rid).values(**values))
            session.execute(
                update(RepoSnapshot)
                .where(RepoSnapshot.id == snapshot_id)
                .values(consumed_at=func.now(), data=b"")
            )
    except Exception as exc:  # noqa: BLE001 — surfaced as the run's failure reason
        return {"ok": False, "reason": f"Couldn't open the folder snapshot: {exc}"}
    if not keep_scope:
        record_resolution_warning(
            run_id,
            "scope",
            subpath,
            f"{subpath} isn't a folder on {base_ref} in {label or 'the folder'} — the run used the "
            "whole folder",
        )
    return {"ok": True, "repo_path": dest}


def store_result_bundle(run_id: str, repo_dir: str, branch: str | None) -> dict:
    """Ship for a folder run: bundle the ``tvashtr/<run_id>`` branch (its whole history, so it
    fetches into any clone) and store it as the run's ``kind='result'`` snapshot, replacing any
    earlier one (a replayed ship stores the same branch again). Raises on failure — the caller
    fails the run, because a throwaway clone's commit that never got packaged shipped nothing."""
    if not branch:
        raise RuntimeError(f"run {run_id} has no ship branch to package")
    rid = uuid.UUID(run_id)
    with tempfile.TemporaryDirectory(prefix="tvashtr-bundle-") as tmp:
        out = str(Path(tmp) / "result.bundle")
        _git_ok("bundle", "create", "--quiet", out, f"refs/heads/{branch}", cwd=repo_dir)
        data = Path(out).read_bytes()
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == rid)).scalar_one()
        session.execute(
            delete(RepoSnapshot).where(RepoSnapshot.run_id == rid, RepoSnapshot.kind == "result")
        )
        snapshot = RepoSnapshot(
            owner_id=run.owner_id,
            kind="result",
            run_id=rid,
            label=run.local_repo_label,
            base_ref=run.base_ref,
            size_bytes=len(data),
            data=data,
        )
        session.add(snapshot)
        session.flush()
        return {"snapshot_id": str(snapshot.id), "size_bytes": len(data), "branch": branch}


# ---------------------------------------------------------------------------- download


def result_bundle(owner_id: uuid.UUID, run_id: str) -> tuple[bytes, str]:
    """The owner's run's result bundle and the branch it carries; 404 otherwise."""
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        if run is None or run.owner_id != owner_id:
            raise LocalRepoError(404, "run_not_found", "run not found")
        if run.local_snapshot_id is None:
            raise LocalRepoError(
                404, "not_a_folder_run", "This run didn't work on a folder from Tvashtr Desktop."
            )
        data = session.execute(
            select(RepoSnapshot.data).where(
                RepoSnapshot.run_id == run.id, RepoSnapshot.kind == "result"
            )
        ).scalar_one_or_none()
        branch = run.ship_branch or branch_name_for(str(run.id))
    if not data:
        raise LocalRepoError(404, "not_shipped", "This run hasn't shipped a branch yet.")
    return bytes(data), branch
