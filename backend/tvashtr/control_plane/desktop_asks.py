"""M-desk-routes (D5) — Ask the node, answered on the owner's Tvashtr Desktop.

Started from the Desktop, an Ask whose node's model is Desktop-routed (a FRESH Claude/Grok
subscription, exactly as a run routes it) is an ``ask`` Desktop job: the instruction is the node's
recorded trail (``run_explain.build_system_prompt``) plus the conversation, told to answer from that
record only; an empty workspace; the answer is the job's final text (no patch applied, no events
written into the asked run, not metered — a subscription). ``POST …/ask`` answers 202 with the job
id as ``ask_id``; ``GET …/asks/{ask_id}`` is polled for the answer.

An Ask has no waiter thread, so the adapter's offline rules are applied when it is read: a job no
Desktop picks up (or whose Desktop goes quiet) expires with the existing offline wording.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import update

from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_jobs
from tvashtr.control_plane.credential_gate import desktop_routed_subscriptions
from tvashtr.db import session_scope
from tvashtr.engines.desktop_runner_adapter import _not_connected_error
from tvashtr.models import DesktopNodeJob

ANSWER_ONLY = (
    "Answer the last question from the record above only. Don't use any tools, don't run "
    "commands and don't create or edit files — reply with your answer as plain text."
)
_SPEAKER = {"user": "The person", "assistant": "You"}
_STATUS = {
    "queued": "queued",
    "claimed": "running",
    "completed": "completed",
    "failed": "failed",
    "expired": "failed",
}


class AskNotFound(Exception):
    """No such Ask of this node of this run for THIS owner (a foreign one reads as missing)."""


def routed_subscription(owner_id: uuid.UUID, model: str) -> str | None:
    """The subscription the node's model runs on from the Desktop, or None (the key path)."""
    routed = desktop_routed_subscriptions(
        [model],
        fresh_subscriptions=desktop_jobs.fresh_subscription_ids(owner_id),
        desktop_target=True,
    )
    return routed[0] if routed else None


def instruction(system_prompt: str, messages: list[dict]) -> str:
    turns = "\n\n".join(f"{_SPEAKER[m['role']]}: {m['content']}" for m in messages)
    return f"{system_prompt}\n\n## The conversation so far\n\n{turns}\n\n{ANSWER_ONLY}"


def start(
    *,
    owner_id: uuid.UUID,
    run_id: str,
    node_id: str,
    provider: str,
    model: str,
    system_prompt: str,
    messages: list[dict],
) -> dict:
    ask_id = desktop_jobs.enqueue_job(
        owner_id=owner_id,
        run_id=run_id,
        node_id=node_id,
        iteration=0,
        invocation_id=None,
        provider=provider,
        model=model,
        instruction=instruction(system_prompt, messages),
        workspace_dir="",  # an empty workspace: its snapshot is a tarball of nothing
        sidecars=[],
        purpose=desktop_jobs.ASK,
        attempt_key=f"ask:{uuid.uuid4().hex}",  # every question is its own job
    )
    return {"ask_id": ask_id, "status": "queued"}


def _settle(job: dict) -> None:
    """The adapter's offline rules, applied on read (an Ask has no waiter)."""
    now = datetime.now(UTC)
    offline_after = timedelta(seconds=get_settings().desktop_runner_offline_seconds)
    owner_id = job["owner_id"]
    if job["status"] == "queued":
        seen, offered = desktop_jobs.runner_last_seen(owner_id)
        if now - max(seen or job["created_at"], job["created_at"]) > offline_after:
            desktop_jobs.expire_job(job["id"], desktop_jobs.OFFLINE_ERROR)
        elif (
            job["provider"] not in offered
            and now - job["created_at"] > offline_after
            and not desktop_jobs.other_job_running(owner_id, job["provider"], job["id"])
        ):
            desktop_jobs.expire_job(job["id"], _not_connected_error(job["provider"]))
    elif job["status"] == "claimed":
        beat = job["heartbeat_at"] or job["claimed_at"] or job["created_at"]
        if now - beat > offline_after:
            desktop_jobs.expire_job(job["id"], desktop_jobs.OFFLINE_ERROR)


def view(owner_id: uuid.UUID, run_id: str, node_id: str, ask_id: str) -> dict:
    """``{ask_id, status: queued|running|completed|failed, answer, error}``."""
    try:
        aid = uuid.UUID(ask_id)
    except ValueError as exc:
        raise AskNotFound(ask_id) from exc
    with session_scope() as session:
        job = session.get(DesktopNodeJob, aid)
        if (
            job is None
            or job.owner_id != owner_id
            or job.purpose != desktop_jobs.ASK
            or job.run_id != run_id
            or job.node_id != node_id
        ):
            raise AskNotFound(ask_id)
        # The chat's poll is a queued Ask's waiter (its heartbeat): one nobody polls any more is
        # expired by the runner's next claim instead of answered for nobody.
        session.execute(
            update(DesktopNodeJob)
            .where(DesktopNodeJob.id == aid, DesktopNodeJob.status == "queued")
            .values(heartbeat_at=datetime.now(UTC))
        )
    _settle(desktop_jobs.get_job(ask_id))
    job = desktop_jobs.get_job(ask_id)
    status = _STATUS.get(job["status"], "failed")
    return {
        "ask_id": job["id"],
        "status": status,
        "answer": job["result_text"] if status == "completed" else None,
        "error": job["error"] if status == "failed" else None,
    }
