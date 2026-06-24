"""Assert the crash-resume invariants for a 2-node skeleton run (P0.4b).

Usage:
    check_skeleton_crash.py <run_id> <old_pid> <new_pid> <base_url>

The keystone: the coarse agent step re-executed (>= 2 attempts, distinct pids,
OLD_PID -> NEW_PID) yet the outcome is exactly-once (one ship tag/commit, one PRD
version, one agent-cost row, and the committed file matches). Exits non-zero with
a message on any failure. Run with the backend venv so ``tvashtr`` is importable.
"""

import json
import subprocess
import sys
import urllib.request
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, select

from tvashtr.db import session_scope
from tvashtr.models import CostRecord, DocumentVersion, EngineerRunAttempt, RunEvent

REQUIRED_LINE = "Shipped by the Tvashtr PM->Engineer team"
TARGET_FILE = "greeting.txt"
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

    # --- recovered & completed ---
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

    ship_commits = [
        ln
        for ln in _git(
            ws, "log", "--all", "--grep", f"Ship: {run_id}", "--oneline"
        ).stdout.splitlines()
        if ln.strip()
    ]
    if len(ship_commits) != 1:
        fail(f"expected exactly one 'Ship: {run_id}' commit, got {len(ship_commits)}")
    else:
        ok("exactly one ship commit")

    # --- feature present ---
    content = _git(ws, "show", f"{tag}:{TARGET_FILE}").stdout
    if content.strip() != REQUIRED_LINE:
        fail(f"committed {TARGET_FILE} {content.strip()!r} != {REQUIRED_LINE!r}")
    else:
        ok(f"committed {TARGET_FILE} matches required line")

    # --- one PRD version, one of each cost row, the attempt rows ---
    with session_scope() as session:
        pm_doc_id = run.get("pm_document_id")
        n_versions = (
            session.execute(
                select(func.count())
                .select_from(DocumentVersion)
                .where(DocumentVersion.document_id == UUID(pm_doc_id))
            ).scalar_one()
            if pm_doc_id
            else None
        )
        n_agent = session.execute(
            select(func.count())
            .select_from(CostRecord)
            # P1.5a: the agent-cost key gained an :iteration suffix; the 2-node Engineer
            # runs once -> exactly one ``{run_id}:agent-cost:1`` row (count semantics
            # unchanged). ``run_id`` is a UUID, so it carries no SQL LIKE wildcards.
            .where(CostRecord.idempotency_key.like(f"{run_id}:agent-cost:%"))
        ).scalar_one()
        n_pm = session.execute(
            select(func.count())
            .select_from(CostRecord)
            .where(CostRecord.idempotency_key == f"{run_id}:pm-llm")
        ).scalar_one()
        attempts = (
            session.execute(
                select(EngineerRunAttempt)
                .where(EngineerRunAttempt.run_id == run_id)
                .order_by(EngineerRunAttempt.id)
            )
            .scalars()
            .all()
        )
        n_events = session.execute(
            select(func.count()).select_from(RunEvent).where(RunEvent.run_id == run_id)
        ).scalar_one()

    if n_versions != 1:
        fail(f"expected exactly 1 PRD DocumentVersion, got {n_versions}")
    else:
        ok("exactly one PRD version (the atomic doc helper held across the crash)")
    if n_agent != 1:
        fail(f"expected exactly 1 agent-cost row, got {n_agent}")
    else:
        ok("exactly one agent-cost CostRecord")
    if n_pm != 1:
        fail(f"expected exactly 1 pm-llm row, got {n_pm}")
    else:
        ok("exactly one pm-llm CostRecord")

    # --- re-execution proof (the keystone) ---
    pids = [a.pid for a in attempts]
    print(f"  engineer_run_attempts pids (in order) = {pids}")
    if len(attempts) < 2:
        fail(f"expected >= 2 engineer attempts, got {len(attempts)}")
    elif pids[0] != old_pid:
        fail(f"earliest attempt pid {pids[0]} != OLD_PID {old_pid}")
    elif pids[-1] != new_pid:
        fail(f"latest attempt pid {pids[-1]} != NEW_PID {new_pid}")
    elif old_pid == new_pid:
        fail("OLD_PID == NEW_PID (no real restart)")
    else:
        ok(
            f"agent step re-executed: pid {pids[0]} (pre-crash) -> {pids[-1]} (restarted), "
            "distinct — yet shipped exactly once"
        )

    print(f"  (report-only) run_events rows for run = {n_events}")

    if _failed:
        print("\nSKELETON CRASH-RESUME CHECK FAILED")
        sys.exit(1)
    print("\nALL SKELETON CRASH-RESUME ASSERTIONS PASSED")


if __name__ == "__main__":
    main()
