"""Assert the crash-resume invariants for a hello_durable run.

Usage:
    check_crash_result.py <workflow_id> <old_pid> <new_pid> <base_url>

Exits non-zero (with a message) if any invariant fails. Run with the backend
venv python so ``tvashtr`` is importable.
"""

import json
import sys
import urllib.request

from sqlalchemy import select

from tvashtr.db import session_scope
from tvashtr.models import SpikeHelloEvent

EXPECTED_STEPS = ["step1_start", "step2_middle", "step3_end"]


def fail(msg: str) -> None:
    print(f"  [FAIL] {msg}")
    sys.exit(1)


def ok(msg: str) -> None:
    print(f"  [ok]   {msg}")


def main() -> None:
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(2)
    wf_id = sys.argv[1]
    old_pid = int(sys.argv[2])
    new_pid = int(sys.argv[3])
    base = sys.argv[4]

    with session_scope() as session:
        rows = (
            session.execute(
                select(SpikeHelloEvent)
                .where(SpikeHelloEvent.workflow_id == wf_id)
                .order_by(SpikeHelloEvent.id)
            )
            .scalars()
            .all()
        )
    events = [(r.step_name, r.pid) for r in rows]

    with urllib.request.urlopen(f"{base}/api/spike/hello-durable/{wf_id}") as resp:
        status = json.load(resp).get("status")

    print(f"workflow_id   = {wf_id}")
    print(f"process pids  = old(pre-crash):{old_pid}  new(restarted):{new_pid}")
    print(f"DBOS status   = {status}")
    print("events:")
    for step_name, pid in events:
        print(f"    {step_name:<14} pid={pid}")
    print("assertions:")

    if status != "SUCCESS":
        fail(f"DBOS status is {status!r}, expected SUCCESS")
    ok("DBOS workflow status is SUCCESS")

    if len(rows) != 3:
        fail(f"expected exactly 3 event rows, got {len(rows)}")
    ok("exactly 3 event rows (one per step)")

    names = [name for name, _ in events]
    if names != EXPECTED_STEPS:
        fail(f"step order {names} != expected {EXPECTED_STEPS}")
    ok("steps recorded once each, in order")

    pid_by_step = dict(events)
    if pid_by_step["step1_start"] == pid_by_step["step2_middle"]:
        fail("step1 pid == step2 pid — step1 may have re-executed after the crash")
    ok(
        f"step1 pid ({pid_by_step['step1_start']}) != steps 2-3 pid "
        f"({pid_by_step['step2_middle']}) — step1 was NOT re-run"
    )

    if pid_by_step["step2_middle"] != pid_by_step["step3_end"]:
        fail("step2 pid != step3 pid — steps 2-3 did not share one process")
    ok("step2 pid == step3 pid — both ran in the restarted process")

    if pid_by_step["step1_start"] != old_pid:
        fail(f"step1 pid {pid_by_step['step1_start']} != pre-crash pid {old_pid}")
    ok("step1 ran in the original (pre-crash) process")

    if pid_by_step["step2_middle"] != new_pid:
        fail(f"steps 2-3 pid {pid_by_step['step2_middle']} != restarted pid {new_pid}")
    ok("steps 2-3 ran in the restarted process")

    print("\nALL CRASH-RESUME ASSERTIONS PASSED")


if __name__ == "__main__":
    main()
