"""The ``desktop-runner`` engine adapter (M-subs-desktop §3.1–§3.2).

A subscription node of a desktop-targeted run does not run on this server at all: its job is queued
for the owner's Tvashtr Desktop, which runs the owner's OWN installed Claude Code / Grok CLI with
the owner's own sign-in on the owner's own machine (never Fly, never another user's machine), and
sends back only the final text + a git patch. This adapter is the control-plane half: it plugs into
the unchanged ``EngineAdapter`` boundary, so routing, gates, documents, loop caps and PR shipping in
``team_run`` treat the node exactly like an OpenHands node.

DBOS-safety: ``agent_run_step`` is an at-least-once step. The job is keyed on
``(run_id, node_id, iteration)``, so a recovery re-execution finds the SAME job (never a second
dispatch) and keeps waiting on it — or, if it already finished, applies its patch at most once
(``desktop_jobs.apply_job_patch`` detects a patch that is already on disk). A Desktop that stops
checking in fails the node with :data:`OFFLINE_ERROR`.
"""

import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_jobs
from tvashtr.control_plane.context_compiler import REMEMBER_FILENAME
from tvashtr.engines.base import AgentRunResult, AgentTask, EngineEvent

OFFLINE_ERROR = desktop_jobs.OFFLINE_ERROR

# The workspace files the control plane harvests after a node (team_run.REPORT_FILENAME, the
# reviewer verdict, the agent-remember sidecar). Greenfield workspaces gitignore them so they never
# ship; the runner force-adds them so the patch still carries them home.
SIDECARS = ("REPORT.md", "REVIEW_VERDICT.json", REMEMBER_FILENAME)

_DISPLAY = {"claude": ("Claude Code", "Claude"), "grok": ("Grok Build", "Grok")}


def _not_connected_error(provider: str) -> str:
    _, plan = _DISPLAY.get(provider, (provider, provider))
    return (
        f"Your {plan} subscription is not connected in Tvashtr Desktop — "
        "connect it on the Engines page and retry."
    )


def _failed(error: str) -> AgentRunResult:
    return AgentRunResult(status="failed", summary="", events=[], files_changed=[], error=error)


class DesktopRunnerAdapter:
    name = "desktop-runner"

    def run(
        self, task: AgentTask, on_event: Callable[[EngineEvent], None] | None = None
    ) -> AgentRunResult:
        spec = task.desktop
        if spec is None:
            return _failed("desktop-runner needs a desktop job spec (not a desktop-routed node)")
        settings = get_settings()
        emit = on_event or (lambda _e: None)
        owner_id = uuid.UUID(spec.owner_id)
        cli, plan = _DISPLAY.get(spec.provider, (spec.provider, spec.provider))

        job_id = desktop_jobs.enqueue_job(
            owner_id=owner_id,
            run_id=spec.run_id,
            node_id=spec.node_id,
            iteration=spec.iteration,
            invocation_id=spec.invocation_id,
            provider=spec.provider,
            model=task.model or "",
            instruction=task.instruction,
            workspace_dir=task.workspace_dir,
            sidecars=list(SIDECARS),
        )
        emit(
            EngineEvent(
                seq=0,
                kind="message",
                payload={
                    "source": "tvashtr",
                    "text": (
                        f"Sent to your Tvashtr Desktop — your own {cli} runs this node on your "
                        f"computer with your {plan} subscription."
                    ),
                },
            )
        )

        said_waiting = False
        while True:
            job = desktop_jobs.get_job(job_id)
            status = job["status"]
            if status == "completed":
                return self._completed(job, task)
            if status in ("failed", "expired"):
                return _failed(job["error"] or f"{cli} did not finish this node.")

            if desktop_jobs.run_ended(spec.run_id):
                if desktop_jobs.expire_job(job_id, desktop_jobs.RUN_ENDED_ERROR):
                    return _failed(desktop_jobs.RUN_ENDED_ERROR)
                continue

            now = datetime.now(UTC)
            offline_after = timedelta(seconds=settings.desktop_runner_offline_seconds)
            if status == "queued":
                seen, offered = desktop_jobs.runner_last_seen(owner_id)
                last_sign_of_life = max(seen or job["created_at"], job["created_at"])
                if now - last_sign_of_life > offline_after:
                    if desktop_jobs.expire_job(job_id, OFFLINE_ERROR):
                        return _failed(OFFLINE_ERROR)
                    continue
                busy = desktop_jobs.other_job_running(owner_id, spec.provider, job_id)
                if busy and not said_waiting:
                    said_waiting = True
                    emit(
                        EngineEvent(
                            seq=1,
                            kind="message",
                            payload={
                                "source": "tvashtr",
                                "text": (
                                    f"Waiting for your {plan} subscription — one job at a time."
                                ),
                            },
                        )
                    )
                elif (
                    not busy
                    and spec.provider not in offered
                    and now - job["created_at"] > offline_after
                ):
                    error = _not_connected_error(spec.provider)
                    if desktop_jobs.expire_job(job_id, error):
                        return _failed(error)
                    continue
            else:  # claimed: the job's own event stream is its heartbeat
                beat = job["heartbeat_at"] or job["claimed_at"] or job["created_at"]
                if now - beat > offline_after:
                    if desktop_jobs.expire_job(job_id, OFFLINE_ERROR):
                        return _failed(OFFLINE_ERROR)
                    continue
            time.sleep(settings.desktop_runner_poll_seconds)

    @staticmethod
    def _completed(job: dict, task: AgentTask) -> AgentRunResult:
        if job["applied_at"] is not None:
            files = list(job["files_changed"] or [])
        else:
            try:
                files = desktop_jobs.apply_job_patch(
                    task.workspace_dir, job["patch"], task.pull_paths
                )
            except desktop_jobs.PatchApplyError as exc:
                return _failed(f"Couldn't apply the change from Tvashtr Desktop: {exc}")
            desktop_jobs.mark_applied(job["id"], files)
        usage = job["usage"] or {}
        return AgentRunResult(
            status="completed",
            summary=job["result_text"] or "",
            events=[],
            files_changed=files,
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            total_tokens=int(usage.get("total_tokens") or 0),
            # A subscription is not billed per token — Tvashtr records usage, never a price.
            cost_usd=0.0,
        )
