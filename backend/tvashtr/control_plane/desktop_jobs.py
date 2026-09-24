"""M-subs-desktop — the queue between the control plane and the owner's Tvashtr Desktop runner.

Analogy: a GitHub Actions self-hosted runner. The control plane still owns the team graph; a
subscription node's "hands" run on the owner's own machine with the owner's own CLI sign-in. This
module is the job queue in between: the ``desktop-runner`` engine adapter ENQUEUES a node job and
waits; the Desktop runner (``/api/desktop-runner/*``) heartbeats, CLAIMS the owner's next job,
streams its CLI output as run events and posts back the final text + a git patch, which the adapter
APPLIES to the run workspace.

Invariants:
* owner-scoped — a runner only ever sees, feeds or finishes its own owner's jobs;
* at most ONE claimed job per (owner, provider) — "ordinary, individual" subscription use;
* idempotent on ``(run_id, "{node_id}:{iteration}")`` — a DBOS recovery re-execution finds the
  SAME job (never a second dispatch), and a patch already on disk is never applied twice;
* secret-free — no body carrying a token/cookie/api-key-like field is accepted, and nothing from a
  vendor login is ever stored (only status, prompts, CLI output, the patch);
* machine-aware (M-subs-prod) — prod runs several Fly machines, each with its own disk, and the run
  workspace lives only on the machine executing the workflow. A job records that machine's
  ``FLY_MACHINE_ID``; the snapshot (the ONE runner call that reads the disk) is served only there.
  Claim, events and result touch Postgres alone, so any machine may answer them.
"""

import io
import os
import subprocess
import tarfile
import tempfile
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from tvashtr.config import get_settings
from tvashtr.control_plane.credential_gate import RUNNER_SUBSCRIPTIONS
from tvashtr.db import session_scope
from tvashtr.engines.base import EngineEvent
from tvashtr.engines.run_event_sink import make_run_event_sink
from tvashtr.models import (
    DesktopNodeJob,
    DesktopRunnerHeartbeat,
    EngineSubscriptionStatus,
    Run,
)

OFFLINE_ERROR = "Tvashtr Desktop went offline — reopen it and retry."
RUN_ENDED_ERROR = "The run ended before Tvashtr Desktop finished this node."

# Run statuses after which a queued/claimed job must never run.
_TERMINAL_RUN_STATUSES = frozenset({"completed", "failed", "rejected", "cancelled", "over_budget"})
_ACTIVE_JOB_STATUSES = ("queued", "claimed")

# Runner events share the node invocation's ``seq`` space with the adapter's own messages
# (0, 1, …): offsetting them keeps both, in order, and a runner retry of the same batch dedups.
RUNNER_SEQ_OFFSET = 100

# Top-level + nested KEY names a runner body must never carry (compared lower-cased, exact). The
# status mirror uses the same idea; this list is wider because runner bodies are richer.
SECRET_KEY_NAMES = frozenset(
    {
        "api_key",
        "apikey",
        "x-api-key",
        "token",
        "access_token",
        "refresh_token",
        "id_token",
        "oauth_token",
        "session_token",
        "bearer",
        "cookie",
        "cookies",
        "secret",
        "client_secret",
        "authorization",
        "password",
        "credential",
        "credentials",
        "session_key",
    }
)


class JobNotFound(Exception):
    """No such job for THIS owner (a foreign job is indistinguishable from a missing one)."""


class JobConflict(Exception):
    """The job is not in a state that accepts this call (e.g. a result after it expired)."""


class SnapshotTooLarge(Exception):
    pass


class PatchApplyError(Exception):
    pass


class WorkspaceElsewhere(Exception):
    """The job's workspace is on another Fly machine (``machine_id``) — replay the request there."""

    def __init__(self, machine_id: str):
        super().__init__(f"the run workspace is on machine {machine_id}")
        self.machine_id = machine_id


def this_machine_id() -> str | None:
    """The Fly machine this process runs on (Fly sets ``FLY_MACHINE_ID``), or ``None`` off Fly."""
    return os.environ.get("FLY_MACHINE_ID") or None


def _now() -> datetime:
    return datetime.now(UTC)


def find_secret_keys(data, _depth: int = 0) -> list[str]:
    """Every secret-looking KEY anywhere in a JSON body (values are never inspected — a patch or a
    CLI transcript may legitimately mention the word "token")."""
    found: set[str] = set()
    if _depth > 20:
        return []
    if isinstance(data, dict):
        for k, v in data.items():
            if str(k).strip().lower() in SECRET_KEY_NAMES:
                found.add(str(k))
            found.update(find_secret_keys(v, _depth + 1))
    elif isinstance(data, list):
        for item in data:
            found.update(find_secret_keys(item, _depth + 1))
    return sorted(found)


# --------------------------------------------------------------------------------- heartbeat


def heartbeat(owner_id: uuid.UUID, providers: list[str]) -> None:
    """Record a runner poll — the A3 freshness signal."""
    offered = sorted({p for p in providers if p in RUNNER_SUBSCRIPTIONS})
    now = _now()
    with session_scope() as session:
        session.execute(
            pg_insert(DesktopRunnerHeartbeat)
            .values(owner_id=owner_id, last_seen_at=now, providers=offered)
            .on_conflict_do_update(
                index_elements=[DesktopRunnerHeartbeat.owner_id],
                set_={"last_seen_at": now, "providers": offered},
            )
        )


def runner_last_seen(owner_id: uuid.UUID) -> tuple[datetime | None, list[str]]:
    with session_scope() as session:
        row = session.get(DesktopRunnerHeartbeat, owner_id)
        if row is None:
            return None, []
        return row.last_seen_at, list(row.providers or [])


def runner_fresh(owner_id: uuid.UUID) -> bool:
    seen, _ = runner_last_seen(owner_id)
    window = timedelta(seconds=get_settings().desktop_runner_fresh_seconds)
    return seen is not None and _now() - seen <= window


def fresh_subscription_ids(owner_id: uuid.UUID) -> set[str]:
    """Subscriptions that count for a Desktop launch RIGHT NOW (A3): the mirror says connected AND
    the owner's Desktop runner polled recently AND the Desktop can run that engine."""
    if not runner_fresh(owner_id):
        return set()
    with session_scope() as session:
        rows = session.execute(
            select(EngineSubscriptionStatus.provider).where(
                EngineSubscriptionStatus.owner_id == owner_id,
                EngineSubscriptionStatus.connected.is_(True),
            )
        ).scalars()
        return {p for p in rows if p in RUNNER_SUBSCRIPTIONS}


# --------------------------------------------------------------------------------- queue


def _job_dict(job: DesktopNodeJob) -> dict:
    return {
        "id": str(job.id),
        "owner_id": job.owner_id,
        "run_id": job.run_id,
        "node_id": job.node_id,
        "invocation_id": job.invocation_id,
        "provider": job.provider,
        "model": job.model,
        "status": job.status,
        "result_text": job.result_text,
        "patch": job.patch,
        "error": job.error,
        "usage": job.usage,
        "files_changed": job.files_changed,
        "applied_at": job.applied_at,
        "created_at": job.created_at,
        "claimed_at": job.claimed_at,
        "heartbeat_at": job.heartbeat_at,
        "workspace_dir": job.workspace_dir,
    }


def enqueue_job(
    *,
    owner_id: uuid.UUID,
    run_id: str,
    node_id: str,
    iteration: int,
    invocation_id: int | None,
    provider: str,
    model: str,
    instruction: str,
    workspace_dir: str,
    sidecars: list[str],
) -> str:
    """Queue a node job, or return the EXISTING one for this (run, node, iteration).

    The caller runs inside the run's workflow, i.e. on the machine whose disk holds
    ``workspace_dir``, so the job records THIS machine. Re-entering for an existing job means DBOS
    recovered the workflow (possibly onto another machine, where ``ensure_run_workspace`` has just
    re-materialized the workspace): a still-active job's workspace + machine follow it there, so the
    runner's next snapshot is served from the live copy. A finished job is never touched."""
    if provider not in RUNNER_SUBSCRIPTIONS:
        raise ValueError(f"no Desktop runner for subscription {provider!r}")
    attempt_key = f"{node_id}:{iteration}"
    machine_id = this_machine_id()
    with session_scope() as session:
        stmt = pg_insert(DesktopNodeJob).values(
            id=uuid.uuid4(),
            owner_id=owner_id,
            run_id=run_id,
            node_id=node_id,
            attempt_key=attempt_key,
            invocation_id=invocation_id,
            provider=provider,
            model=model,
            instruction=instruction,
            workspace_dir=workspace_dir,
            workspace_machine_id=machine_id,
            sidecars=list(sidecars),
            status="queued",
            created_at=_now(),
        )
        session.execute(
            stmt.on_conflict_do_update(
                constraint="uq_desktop_node_jobs_run_attempt",
                set_={
                    "workspace_dir": stmt.excluded.workspace_dir,
                    "workspace_machine_id": stmt.excluded.workspace_machine_id,
                },
                where=DesktopNodeJob.status.in_(_ACTIVE_JOB_STATUSES),
            )
        )
        return str(
            session.execute(
                select(DesktopNodeJob.id).where(
                    DesktopNodeJob.run_id == run_id, DesktopNodeJob.attempt_key == attempt_key
                )
            ).scalar_one()
        )


def get_job(job_id: str) -> dict:
    with session_scope() as session:
        job = session.get(DesktopNodeJob, uuid.UUID(job_id))
        if job is None:
            raise JobNotFound(job_id)
        return _job_dict(job)


def _run_status(session, run_id: str) -> str | None:
    try:
        rid = uuid.UUID(run_id)
    except ValueError:
        return None
    return session.execute(select(Run.status).where(Run.id == rid)).scalar_one_or_none()


def run_ended(run_id: str) -> bool:
    with session_scope() as session:
        status = _run_status(session, run_id)
    return status is None or status in _TERMINAL_RUN_STATUSES


def claim_next(owner_id: uuid.UUID, providers: list[str]) -> dict | None:
    """Hand the owner's oldest queued job for a free provider to their runner (or ``None``)."""
    now = _now()
    with session_scope() as session:
        busy = set(
            session.execute(
                select(DesktopNodeJob.provider).where(
                    DesktopNodeJob.owner_id == owner_id, DesktopNodeJob.status == "claimed"
                )
            ).scalars()
        )
        allowed = [
            p for p in dict.fromkeys(providers) if p in RUNNER_SUBSCRIPTIONS and p not in busy
        ]
        if not allowed:
            return None
        queued = (
            session.execute(
                select(DesktopNodeJob)
                .where(
                    DesktopNodeJob.owner_id == owner_id,
                    DesktopNodeJob.status == "queued",
                    DesktopNodeJob.provider.in_(allowed),
                )
                .order_by(DesktopNodeJob.created_at)
                .with_for_update(skip_locked=True)
            )
            .scalars()
            .all()
        )
        for job in queued:
            status = _run_status(session, job.run_id)
            if status is None or status in _TERMINAL_RUN_STATUSES:
                job.status = "expired"
                job.error = RUN_ENDED_ERROR
                job.finished_at = now
                continue
            job.status = "claimed"
            job.claimed_at = now
            job.heartbeat_at = now
            session.flush()
            return {
                "id": str(job.id),
                "provider": job.provider,
                "model": job.model,
                "instruction": job.instruction,
                "sidecars": list(job.sidecars or []),
                "run_id": job.run_id,
                "node_id": job.node_id,
            }
    return None


def _owned_job(session, owner_id: uuid.UUID, job_id: str) -> DesktopNodeJob:
    try:
        jid = uuid.UUID(job_id)
    except ValueError as exc:
        raise JobNotFound(job_id) from exc
    job = session.get(DesktopNodeJob, jid, with_for_update=True)
    if job is None or job.owner_id != owner_id:
        raise JobNotFound(job_id)
    return job


def record_events(owner_id: uuid.UUID, job_id: str, events: list[dict]) -> dict:
    """Persist the runner's events into the node's run log (idempotent per seq) — also the job's
    heartbeat. ``cancelled`` tells the runner to stop (job expired / run ended)."""
    with session_scope() as session:
        job = _owned_job(session, owner_id, job_id)
        run_status = _run_status(session, job.run_id)
        if job.status != "claimed" or run_status is None or run_status in _TERMINAL_RUN_STATUSES:
            if job.status in _ACTIVE_JOB_STATUSES:
                job.status = "expired"
                job.error = RUN_ENDED_ERROR
                job.finished_at = _now()
            return {"ok": True, "cancelled": True}
        job.heartbeat_at = _now()
        run_id, invocation_id = job.run_id, job.invocation_id
    sink = make_run_event_sink(run_id, invocation_id, seq_offset=RUNNER_SEQ_OFFSET)
    for ev in events:
        sink(EngineEvent(seq=int(ev["seq"]), kind=ev["kind"], payload=ev["payload"]))
    return {"ok": True, "cancelled": False}


def submit_result(
    owner_id: uuid.UUID,
    job_id: str,
    *,
    status: str,
    final_text: str,
    patch: str,
    error: str | None,
    usage: dict | None,
) -> None:
    with session_scope() as session:
        job = _owned_job(session, owner_id, job_id)
        if job.status != "claimed":
            raise JobConflict(f"job is {job.status}")
        job.status = "completed" if status == "completed" else "failed"
        job.result_text = final_text
        job.patch = patch
        job.error = error if job.status == "failed" else None
        job.usage = usage
        job.finished_at = _now()
        job.heartbeat_at = job.finished_at


def expire_job(job_id: str, error: str) -> bool:
    """Expire a still-active job (True) — never clobbers a result that just landed (False)."""
    with session_scope() as session:
        res = session.execute(
            update(DesktopNodeJob)
            .where(
                DesktopNodeJob.id == uuid.UUID(job_id),
                DesktopNodeJob.status.in_(_ACTIVE_JOB_STATUSES),
            )
            .values(status="expired", error=error, finished_at=_now())
        )
        return bool(res.rowcount)


def other_job_running(owner_id: uuid.UUID, provider: str, job_id: str) -> bool:
    with session_scope() as session:
        return (
            session.execute(
                select(DesktopNodeJob.id)
                .where(
                    DesktopNodeJob.owner_id == owner_id,
                    DesktopNodeJob.provider == provider,
                    DesktopNodeJob.status == "claimed",
                    DesktopNodeJob.id != uuid.UUID(job_id),
                )
                .limit(1)
            ).first()
            is not None
        )


def mark_applied(job_id: str, files_changed: list[str]) -> None:
    with session_scope() as session:
        session.execute(
            update(DesktopNodeJob)
            .where(DesktopNodeJob.id == uuid.UUID(job_id))
            .values(applied_at=_now(), files_changed=files_changed)
        )


# --------------------------------------------------------------------------------- snapshot


def build_snapshot(owner_id: uuid.UUID, job_id: str) -> bytes:
    """A gzipped tarball of the job's workspace (everything but ``.git``) — the base the runner's
    temporary copy starts from.

    Raises :class:`WorkspaceElsewhere` when the job names ANOTHER Fly machine than this one. The
    recorded machine is authoritative even if a directory exists here: the path is per-run, so a
    copy on this disk can only be a stale one left by an earlier machine hop."""
    with session_scope() as session:
        job = _owned_job(session, owner_id, job_id)
        if job.status != "claimed":
            raise JobConflict(f"job is {job.status}")
        workspace = job.workspace_dir
        holder = job.workspace_machine_id
    here = this_machine_id()
    if holder and here and holder != here:
        raise WorkspaceElsewhere(holder)
    root = Path(workspace)
    if not root.is_dir():
        raise JobConflict("the run workspace is not on this server")
    limit = get_settings().desktop_snapshot_max_bytes

    def keep(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
        rel = info.name[2:] if info.name.startswith("./") else info.name
        if rel == ".git" or rel.startswith(".git/"):
            return None
        if not (info.isfile() or info.isdir() or info.issym()):
            return None
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        return info

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(str(root), arcname=".", filter=keep)
    data = buf.getvalue()
    if len(data) > limit:
        raise SnapshotTooLarge(f"workspace snapshot is {len(data)} bytes (limit {limit})")
    return data


# --------------------------------------------------------------------------------- patch


def _git(workspace: str, args: list[str]) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        # A workspace that is not itself a repo must never be treated as part of an enclosing one.
        "GIT_CEILING_DIRECTORIES": str(Path(workspace).resolve().parent),
        "GIT_TERMINAL_PROMPT": "0",
    }
    return subprocess.run(
        ["git", *args], cwd=workspace, env=env, capture_output=True, text=True, check=False
    )


def _patch_paths(workspace: str, patch_file: str) -> list[str]:
    res = _git(workspace, ["apply", "--numstat", "-z", patch_file])
    if res.returncode != 0:
        raise PatchApplyError(res.stderr.strip() or "unreadable patch")
    parts = res.stdout.split("\0")
    paths: list[str] = []
    i = 0
    while i < len(parts):
        entry = parts[i]
        if not entry:
            i += 1
            continue
        fields = entry.split("\t")
        if len(fields) >= 3 and fields[2]:
            paths.append(fields[2])
            i += 1
        else:  # rename/copy: "added\tdeleted\t" then old, new
            if i + 2 < len(parts):
                paths.append(parts[i + 2])
            i += 3
    return paths


def apply_job_patch(
    workspace: str, patch: str | None, pull_paths: tuple[str, ...] | None
) -> list[str]:
    """Apply the runner's ``git diff --binary`` to the run workspace, honouring the node's pull
    scope exactly like the sandboxed adapters (``None`` ⇒ everything; a tuple ⇒ only those paths).
    Idempotent: a patch that is already on disk (recovery after a crash between applying and
    recording it) is detected with a reverse check and not applied again."""
    if not patch or not patch.strip():
        return []
    fd, patch_file = tempfile.mkstemp(suffix=".patch")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(patch if patch.endswith("\n") else patch + "\n")
        paths = _patch_paths(workspace, patch_file)
        if pull_paths is not None:
            allowed = set(pull_paths)
            paths = [p for p in paths if p in allowed]
            if not paths:
                return []
        includes = [f"--include={p}" for p in pull_paths] if pull_paths is not None else []
        base = ["apply", "--binary", "--whitespace=nowarn", *includes]
        forward = _git(workspace, [*base, "--check", patch_file])
        if forward.returncode == 0:
            done = _git(workspace, [*base, patch_file])
            if done.returncode != 0:
                raise PatchApplyError(done.stderr.strip())
        else:
            already = _git(workspace, [*base, "--reverse", "--check", patch_file])
            if already.returncode != 0:
                raise PatchApplyError(forward.stderr.strip())
        return sorted(dict.fromkeys(paths))
    finally:
        os.unlink(patch_file)
