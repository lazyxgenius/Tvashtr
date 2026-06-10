"""The ``hello_durable`` spike: a 3-step DBOS workflow that survives a crash.

Each step records (workflow_id, step_name, pid) into ``spike_hello_events``.
Between step 1 and step 2 the workflow performs a *durable* sleep, so a process
killed mid-sleep resumes after restart without re-running completed steps.
"""

import os

from dbos import DBOS

from tvashtr.db import session_scope
from tvashtr.models import SpikeHelloEvent

STEP_ONE = "step1_start"
STEP_TWO = "step2_middle"
STEP_THREE = "step3_end"


@DBOS.step()
def record_event(workflow_id: str, step_name: str) -> int:
    """Durable step: insert one row recording this step and the OS pid.

    Because this is a ``@DBOS.step()``, its completion is checkpointed. On crash
    recovery a *completed* step is not re-executed — DBOS replays its recorded
    result — so each step inserts exactly one row even across a mid-run crash.
    Returns the pid so the workflow/caller can observe which process ran it.
    """
    pid = os.getpid()
    with session_scope() as session:
        session.add(SpikeHelloEvent(workflow_id=workflow_id, step_name=step_name, pid=pid))
    return pid


@DBOS.workflow()
def hello_durable(run_label: str, sleep_seconds: float) -> str:
    """Three durable steps with a crash-safe sleep between the first two.

    ``sleep_seconds`` is a workflow argument (checkpointed by DBOS), so its value
    is stable across recovery; tests shrink it to run fast.
    """
    wf_id = DBOS.workflow_id
    DBOS.logger.info(f"hello_durable[{run_label}] start wf={wf_id} pid={os.getpid()}")

    record_event(wf_id, STEP_ONE)
    # Durable sleep — the wait itself is crash-safe. If the process dies during
    # the sleep, recovery resumes for only the remaining duration after restart.
    DBOS.sleep(sleep_seconds)
    record_event(wf_id, STEP_TWO)
    record_event(wf_id, STEP_THREE)

    DBOS.logger.info(f"hello_durable[{run_label}] done wf={wf_id} pid={os.getpid()}")
    return f"hello_durable[{run_label}] complete"
