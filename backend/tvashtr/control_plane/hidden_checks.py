"""M9 — a set compare run's hidden check (rulings R11, R12; contract
``docs/superpowers/plans/api/task-sets.md`` › The hidden check).

:func:`run_for` is called by the walk at a set compare run's compare terminal — after the run's
last step, before it is finalized and torn down — as a PLAIN call (no DBOS step or workflow),
gated on the recorded ``load_graph_step`` dict. It runs the task's hidden check in the run's OWN
sandbox: Fly — the run's microVM, in a fresh dir pushed from the host workspace; docker — a fresh
container; LOCAL (dev only) — the host workspace, its process group killed at the limit. Never on
the control-plane host in hosted mode. Pass = exit code 0 within the limit (10 minutes, M7's
replay cap); the last 12 lines of output are kept, secrets masked. Idempotent: a recovered walk
that finds the run's result does not run it again. The run stays ``running`` (its slot counted,
R12) until the check ends.

R11: the command is read here from ``task_set_items`` and handed only to the sandbox. It is never
written to the run, its events, invocations, documents, memories, the workspace or any task an
agent gets, and never logged. Openhands-free at import (the adapters' helpers load lazily)."""

from __future__ import annotations

import contextlib
import logging
import os
import shlex
import signal
import subprocess
import tempfile
import time
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from tvashtr.config import get_settings
from tvashtr.control_plane.guardrails import mask_secrets
from tvashtr.db import session_scope
from tvashtr.models import HiddenCheckResult, Run, TaskSetItem

logger = logging.getLogger(__name__)

NOT_HERE = "Hidden checks can't run on this server."
_LIVE = ("pending", "running", "awaiting_human")
_TAIL = 12
# What a LOCAL check's shell gets from the server's environment: enough to find its tools,
# none of the server's settings or keys.
_ENV_KEEP = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "USER", "SHELL")
# Only the end of a check's output is ever read: a check that prints without end must not fill the
# server's memory (only 12 lines are kept anyway).
OUTPUT_CAP = 65536
# A sandbox check runs on its own timer (GNU ``timeout``, below); the SDK's poll and the sandbox
# server's timer get this much longer, so ours always fires first — its exit code says it timed out
# and neither of theirs logs the command.
GRACE_S = 30
# The SDK module that logs the commands it runs (at DEBUG, and the command again on its timeout).
SDK_LOGGER = "openhands.sdk.workspace.remote.remote_workspace_mixin"


def run_local(cwd: str, command: str, limit_s: float) -> tuple[int | None, str, bool]:
    """``(exit code, output, timed out)`` of ``command`` in ``cwd`` on this machine — dev only. Its
    own process group, killed whole at the limit (exit code None). The output goes to a temporary
    file and only its last :data:`OUTPUT_CAP` bytes are read."""
    with tempfile.TemporaryFile() as out:
        proc = subprocess.Popen(  # noqa: S602 — the owner's own check command, in their own dev box
            command,
            shell=True,
            cwd=cwd,
            stdout=out,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env={k: os.environ[k] for k in _ENV_KEEP if k in os.environ},
        )
        try:
            proc.wait(timeout=limit_s)
            code, timed_out = proc.returncode, False
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            code, timed_out = None, True
        out.seek(max(0, os.fstat(out.fileno()).st_size - OUTPUT_CAP))
        return code, out.read().decode(errors="replace"), timed_out


def sandbox_command(command: str, limit_s: float) -> str:
    """The check as a sandbox runs it: under GNU ``timeout`` (its own process group, killed whole at
    the limit, exit 124), stdout and stderr in one stream in order, and only the last
    :data:`OUTPUT_CAP` bytes passed back (``pipefail`` keeps the check's own exit code)."""
    inner = (
        f"timeout -k 5 {int(limit_s)} bash -c {shlex.quote(command)} 2>&1 | tail -c {OUTPUT_CAP}"
    )
    return f"bash -o pipefail -c {shlex.quote(inner)}"


class _DropCommand(logging.Filter):
    def __init__(self, text: str) -> None:
        super().__init__()
        self.text = text

    def filter(self, record: logging.LogRecord) -> bool:
        return self.text not in record.getMessage()


def run_remote(workspace, command: str, cwd: str, limit_s: float) -> tuple[int | None, str, bool]:
    """``(exit code, output, timed out)`` of the check through an SDK workspace (the Fly and docker
    helpers). A sandbox that fails (the SDK's "Remote execution error", exit -1) raises — the check
    couldn't run — and the SDK never logs the command (R11)."""
    wrapped = sandbox_command(command, limit_s)
    quiet = _DropCommand(wrapped)
    sdk_logger = logging.getLogger(SDK_LOGGER)
    sdk_logger.addFilter(quiet)
    began = time.monotonic()
    try:
        result = workspace.execute_command(wrapped, cwd=cwd, timeout=limit_s + GRACE_S)
    finally:
        sdk_logger.removeFilter(quiet)
    elapsed = time.monotonic() - began
    output = ((result.stdout or "") + (result.stderr or ""))[-OUTPUT_CAP:]
    timed_out = bool(result.timeout_occurred) or (
        result.exit_code in (124, 137) and elapsed >= limit_s - 1
    )
    if timed_out:
        return None, output, True
    if result.exit_code == -1:
        raise RuntimeError("the sandbox failed while running the check")
    return result.exit_code, output, False


def _execute(
    run_id: str, workspace: str, command: str, mode: str, limit_s: float
) -> tuple[int | None, str, bool]:
    """The check in the run's own sandbox, by the configured sandbox mode."""
    sandbox = get_settings().agent_sandbox_mode
    if sandbox == "fly":
        from tvashtr.engines.openhands_fly_adapter import run_check

        return run_check(run_id, workspace, command, mode, limit_s)
    if sandbox == "docker":
        from tvashtr.engines.openhands_docker_adapter import run_check

        return run_check(run_id, workspace, command, mode, limit_s)
    return run_local(workspace, command, limit_s)


def run_for(run_id: str, workspace: str | None, mode: str) -> None:
    """Run (once) the hidden check of a set compare run's task and record the result. A no-op for
    a run that already has one, has ended, or has no task."""
    # Lazy: M7's runner is heavy, and this module rides team_run's import.
    from tvashtr.control_plane.agent_test_runner import REPLAY_CAP_S, TOO_LONG

    rid = uuid.UUID(run_id)
    with session_scope() as session:
        if session.execute(
            select(HiddenCheckResult.id).where(HiddenCheckResult.run_id == rid)
        ).first():
            return
        run = session.get(Run, rid)
        if run is None or run.status not in _LIVE or run.task_set_item_id is None:
            return
        command = session.execute(
            select(TaskSetItem.hidden_check).where(TaskSetItem.id == run.task_set_item_id)
        ).scalar_one_or_none()
    if command is None or workspace is None:
        return
    settings = get_settings()
    began = time.monotonic()
    # The hosted control plane (a Fly machine) never runs a check on itself; a developer's hosted
    # stack on the LOCAL sandbox runs it where its agents ran.
    on_fly_host = bool(os.environ.get("FLY_MACHINE_ID"))
    if (
        settings.hosted_mode
        and on_fly_host
        and settings.agent_sandbox_mode not in ("fly", "docker")
    ):
        code, output, timed_out = None, NOT_HERE, False
    else:
        try:
            code, output, timed_out = _execute(run_id, workspace, command, mode, REPLAY_CAP_S)
        except Exception as exc:  # noqa: BLE001 — a check that can't run fails; the run goes on
            logger.warning("hidden check could not run run_id=%s (%s)", run_id, type(exc).__name__)
            code, output, timed_out = None, f"The check couldn't run ({type(exc).__name__}).", False
    lines = [ln.rstrip() for ln in mask_secrets(output).splitlines() if ln.strip()]
    if timed_out:
        lines.append(TOO_LONG)
    with session_scope() as session:
        session.execute(
            insert(HiddenCheckResult)
            .values(
                run_id=rid,
                passed=code == 0 and not timed_out,
                exit_code=code,
                timed_out=timed_out,
                output_tail="\n".join(lines[-_TAIL:]),
                duration_s=round(time.monotonic() - began, 3),
            )
            .on_conflict_do_nothing(index_elements=["run_id"])
        )
