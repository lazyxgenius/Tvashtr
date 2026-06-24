"""Assert the MID-LOOP crash-resume invariants for a 3-node review-loop run (P1.5a).

Usage:
    check_loop_crash.py <run_id> <old_pid> <new_pid> <base_url>

The cyclic analog of ``check_skeleton_crash.py``. Driven by ``loop_crash_demo.sh``,
which runs the ``review_loop`` team with ``TVASHTR_FORCE_REVISIONS=2`` (the Reviewer
returns ``changes_requested`` for rounds 1 and 2, then ``approved`` at round 3 -> the
Engineer runs exactly 3 times, approving BELOW the ``max_review_iterations`` cap so no
escalation fires) and crashes the backend with ``kill -9`` DURING the Engineer's 2nd
iteration (detected by the ``engineer_run_attempts`` count reaching 2 — i.e. iteration 2
began after one real loop-back).

The keystone (richer than the linear skeleton proof): the in-flight iteration re-executed
in the NEW process (an ``EngineerRunAttempt`` @NEW_PID appears, so the row count exceeds the
no-crash count of 3) WHILE the completed iterations did NOT — evidenced by the final durable
state being exactly-once-per-iteration: Engineer ``AgentInvocation`` ``[1,2,3]`` all ``done``,
Reviewer ``[1,2,3]`` outcomes ``[changes_requested, changes_requested, approved]``, exactly 3
``agent-cost`` rows, one ship. Together that proves the loop RESUMED MID-CYCLE (the completed
iterations were replayed, not re-run) and KEPT CYCLING to a single ship.

Exits non-zero with a message on any failure. Run with the backend venv so ``tvashtr`` is
importable. ``EngineerRunAttempt`` has no ``iteration`` column (confirmed against the model),
so per-iteration attempt attribution isn't available; the proof leans on the OLD->NEW pid span
for re-execution plus the exactly-once-per-iteration final state for correct mid-loop resume.
"""

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

from sqlalchemy import func, select

from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, CostRecord, EngineerRunAttempt, Run

REQUIRED_LINE = "Shipped by the Tvashtr PM->Engineer team"
TARGET_FILE = "greeting.txt"
# FORCE_REVISIONS=2 -> the Engineer runs exactly 3 times (the no-crash count); the crash
# re-executes the in-flight iteration, so the attempt-row count must EXCEED this.
NO_CRASH_ENGINEER_ITERATIONS = 3
EXPECTED_ENGINEER_ITERS = [1, 2, 3]
EXPECTED_REVIEWER_OUTCOMES = ["changes_requested", "changes_requested", "approved"]
_WS_ROOT = Path(__file__).resolve().parents[1] / "backend" / ".tvashtr_workspaces"

_failed = False


def fail(msg: str) -> None:
    global _failed
    print(f"  [FAIL] {msg}")
    _failed = True


def ok(msg: str) -> None:
    print(f"  [ok]   {msg}")


def _git(ws: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(ws), *args], capture_output=True, text=True)


def main() -> None:
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(2)
    run_id, old_pid, new_pid, base = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    ws = _WS_ROOT / run_id
    tag = f"ship-{run_id}"

    with urllib.request.urlopen(f"{base}/api/runs/{run_id}") as resp:
        body = json.load(resp)
    run = body.get("run") or {}

    print(f"run_id        = {run_id}")
    print(f"pids          = old(pre-crash):{old_pid}  new(restarted):{new_pid}")
    print(f"workflow      = {body.get('workflow_status')}   run.status = {run.get('status')}")
    print("assertions:")

    # --- recovered & completed (DBOS recovered the in-flight run_team in process 2) ---
    if body.get("workflow_status") != "SUCCESS":
        fail(f"DBOS workflow status {body.get('workflow_status')!r} != SUCCESS")
    else:
        ok("DBOS workflow recovered to SUCCESS")
    if run.get("status") != "completed":
        fail(f"runs.status {run.get('status')!r} != completed")
    else:
        ok("runs.status == completed")

    # --- shipped exactly once ---
    if run.get("ship_tag") != tag or not run.get("ship_commit_sha"):
        fail(f"runs ship_tag/sha wrong: tag={run.get('ship_tag')} sha={run.get('ship_commit_sha')}")
    else:
        ok(f"runs.ship_tag == {tag} and ship_commit_sha set")

    tags = _git(ws, "tag", "--list", tag).stdout.split()
    if tags != [tag]:
        fail(f"expected exactly one {tag} tag, got {tags}")
    else:
        ok(f"exactly one git tag {tag}")

    ship_log = _git(ws, "log", "--all", "--grep", f"Ship: {run_id}", "--oneline").stdout
    ship_commits = [ln for ln in ship_log.splitlines() if ln.strip()]
    if len(ship_commits) != 1:
        fail(f"expected exactly one 'Ship: {run_id}' commit, got {len(ship_commits)}")
    else:
        ok("exactly one ship commit")

    # --- feature present ---
    content = _git(ws, "show", f"{tag}:{TARGET_FILE}").stdout
    # Substring, not byte-exact: a forced-revision round may cosmetically edit the deliverable;
    # this target proves durability/resume (byte-exact content is skeleton-crash's proof).
    if REQUIRED_LINE not in content:
        fail(f"committed {TARGET_FILE} {content.strip()!r} does not contain {REQUIRED_LINE!r}")
    else:
        ok(
            f"committed {TARGET_FILE} contains required line "
            "(tolerating a forced-revision cosmetic edit)"
        )

    # --- the loop ran + resumed correctly, and per-iteration metering held across the crash ---
    with session_scope() as session:
        run_row = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        nodes = (
            session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == run_row.team_graph_id)
            )
            .scalars()
            .all()
            if run_row is not None
            else []
        )
        by_role = {n.role_name: n for n in nodes}

        def _invocations(node_id):
            return (
                session.execute(
                    select(AgentInvocation)
                    .where(
                        AgentInvocation.run_id == run_id,
                        AgentInvocation.node_id == node_id,
                    )
                    .order_by(AgentInvocation.iteration)
                )
                .scalars()
                .all()
            )

        eng_invs = _invocations(by_role["engineer"].id) if "engineer" in by_role else []
        rev_invs = _invocations(by_role["reviewer"].id) if "reviewer" in by_role else []

        attempts = (
            session.execute(
                select(EngineerRunAttempt)
                .where(EngineerRunAttempt.run_id == run_id)
                .order_by(EngineerRunAttempt.id)
            )
            .scalars()
            .all()
        )
        n_agent = session.execute(
            select(func.count())
            .select_from(CostRecord)
            # One per-iteration ``{run_id}:agent-cost:{i}`` row per Engineer iteration. The
            # crashed iteration's wasted spend is NOT separately recorded (idempotent on the
            # iteration key) — the §15 exact-spend-across-crashes gap; count stays per-iteration.
            .where(CostRecord.idempotency_key.like(f"{run_id}:agent-cost:%"))
        ).scalar_one()
        n_pm = session.execute(
            select(func.count())
            .select_from(CostRecord)
            .where(CostRecord.idempotency_key == f"{run_id}:pm-llm")
        ).scalar_one()

    # --- Engineer ran 3 times, all done (exactly-once per iteration despite the crash) ---
    eng_iters = [i.iteration for i in eng_invs]
    eng_statuses = [i.status for i in eng_invs]
    if eng_iters == EXPECTED_ENGINEER_ITERS and eng_statuses == ["done", "done", "done"]:
        ok(f"Engineer invocations {eng_iters} all done (one row per iteration, no crash dup)")
    else:
        fail(
            f"Engineer invocations {eng_iters} statuses {eng_statuses} "
            f"!= {EXPECTED_ENGINEER_ITERS} / all done"
        )

    # --- Reviewer ran 3 times: two loop-backs then approved (the cycle kept cycling) ---
    rev_iters = [i.iteration for i in rev_invs]
    rev_outcomes = [i.outcome for i in rev_invs]
    if rev_iters == EXPECTED_ENGINEER_ITERS and rev_outcomes == EXPECTED_REVIEWER_OUTCOMES:
        ok(f"Reviewer invocations {rev_iters} outcomes {rev_outcomes} (two loop-backs, then ship)")
    else:
        fail(
            f"Reviewer invocations {rev_iters} outcomes {rev_outcomes} "
            f"!= {EXPECTED_ENGINEER_ITERS} / {EXPECTED_REVIEWER_OUTCOMES}"
        )

    # --- per-iteration metering held across the crash ---
    if n_agent == NO_CRASH_ENGINEER_ITERATIONS:
        ok(f"exactly {NO_CRASH_ENGINEER_ITERATIONS} per-iteration agent-cost CostRecords")
    else:
        fail(f"expected {NO_CRASH_ENGINEER_ITERATIONS} agent-cost rows, got {n_agent}")
    if n_pm == 1:
        ok("exactly one pm-llm CostRecord")
    else:
        fail(f"expected exactly 1 pm-llm row, got {n_pm}")

    # --- the keystone re-execution proof (richer than skeleton-crash) ---
    pids = [a.pid for a in attempts]
    print(f"  engineer_run_attempts pids (in order) = {pids}")
    if len(attempts) <= NO_CRASH_ENGINEER_ITERATIONS:
        fail(
            f"expected > {NO_CRASH_ENGINEER_ITERATIONS} engineer attempts (the in-flight "
            f"iteration must re-execute post-crash), got {len(attempts)}"
        )
    elif pids[0] != old_pid:
        fail(f"earliest attempt pid {pids[0]} != OLD_PID {old_pid}")
    elif pids[-1] != new_pid:
        fail(f"latest attempt pid {pids[-1]} != NEW_PID {new_pid}")
    elif old_pid == new_pid:
        fail("OLD_PID == NEW_PID (no real restart)")
    else:
        ok(
            f"mid-loop re-execution: {len(attempts)} attempts span pid {pids[0]} (pre-crash) -> "
            f"{pids[-1]} (restarted) — the in-flight iteration re-ran while completed iterations "
            "replayed (exactly-once-per-iteration durable state above), so the loop resumed "
            "mid-cycle and kept cycling to a single ship"
        )

    if _failed:
        print("\nLOOP CRASH-RESUME CHECK FAILED")
        sys.exit(1)
    print(
        "\nALL LOOP CRASH-RESUME ASSERTIONS PASSED (resumed mid-iteration-2, kept cycling: "
        "Engineer x3, Reviewer [cr, cr, approved], ship once)"
    )


if __name__ == "__main__":
    main()
