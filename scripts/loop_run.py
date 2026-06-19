#!/usr/bin/env python
"""Opt-in *live* 3-node review-loop run (P1.5a): prove the cycle GENUINELY ran.

Only if ``OPENROUTER_API_KEY`` is set, drives one ``run_team`` workflow over the
3-node ``review_loop`` team (PM -> Engineer <-> Reviewer) end to end via an
in-process TestClient (assuming ``db-up`` + ``migrate`` already ran). The Makefile
pins ``TVASHTR_AGENT_SANDBOX=local`` (orchestration, not containment),
``TVASHTR_AUTO_APPROVE_GATES=1`` (no human at the PRD gate), and
``TVASHTR_FORCE_REVISIONS=1`` (the Reviewer returns ``changes_requested`` for round
1, then ``approved`` — a deterministic forced loop-back so the proof is non-vacuous;
no LLM, no cost for the Reviewer).

Then it asserts the loop actually cycled (NOT just that the run completed):
  * the Engineer (agent) node has ``AgentInvocation`` rows for iterations {1, 2}
  * the Reviewer node has rows for iterations {1, 2} with outcomes
    [changes_requested, approved] (exactly one loop-back)
  * ``EngineerRunAttempt`` has exactly 2 rows for the run (the Engineer ran twice)
  * exactly 2 ``{run_id}:agent-cost:{i}`` CostRecords (per-iteration metering)
  * exactly one ``ship-{run_id}`` git tag, run ``completed``, committed file matches

Skips cleanly without a key. Exits non-zero unless every assertion holds.

Run via ``make loop-run``.
"""

import os
import subprocess
import sys
import time
from pathlib import Path
from uuid import UUID

POLL_TIMEOUT_S = 600
TARGET_FILE = os.environ.get("TVASHTR_SKELETON_FILE", "greeting.txt")
REQUIRED_LINE = os.environ.get(
    "TVASHTR_SKELETON_LINE", "Shipped by the Tvashtr PM->Engineer team"
)
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / "backend" / ".tvashtr_workspaces"
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
_TERMINAL_RUN = {"completed", "failed", "over_budget", "rejected", "cancelled"}

_failed = False


def fail(msg: str) -> None:
    global _failed
    print(f"  [FAIL] {msg}")
    _failed = True


def ok(msg: str) -> None:
    print(f"  [ok]   {msg}")


def main() -> int:
    if not os.environ.get("OPENROUTER_API_KEY"):
        print(
            "[loop-run] OPENROUTER_API_KEY not set — skipping live run.\n"
            "          Set it in .env to drive a real PM -> Engineer <-> Reviewer loop. "
            "(Not a failure.)"
        )
        return 0

    from sqlalchemy import func, select
    from fastapi.testclient import TestClient

    from tvashtr.db import session_scope
    from tvashtr.models import AgentInvocation, AgentNode, CostRecord, EngineerRunAttempt, Run
    from tvashtr.main import app

    with TestClient(app) as client:
        run_id = client.post("/api/runs", json={"team_shape": "review_loop"}).json()["run_id"]
        print(f"[loop-run] started review_loop run_id={run_id}")
        print("[loop-run] polling (PM, then a forced Engineer<->Reviewer cycle — be patient)…")

        final = None
        deadline = time.time() + POLL_TIMEOUT_S
        while time.time() < deadline:
            body = client.get(f"/api/runs/{run_id}").json()
            wf = body["workflow_status"]
            run_status = (body.get("run") or {}).get("status")
            print(f"  workflow={wf}  run={run_status}")
            if wf in _TERMINAL_WF or run_status in _TERMINAL_RUN:
                final = body
                break
            time.sleep(4)

        if final is None:
            print(f"[loop-run] FAILED: run did not finish within {POLL_TIMEOUT_S}s", file=sys.stderr)
            return 1

        run = final.get("run") or {}
        ws = _WORKSPACE_ROOT / run_id
        tag = f"ship-{run_id}"

        print("\n================= LOOP RUN PROOF =================")
        print(f"run_id           = {run_id}")
        print(f"workflow_status  = {final['workflow_status']}")
        print(f"run.status       = {run.get('status')}")
        print(f"ship_tag         = {run.get('ship_tag')}")
        print("assertions:")

        with session_scope() as session:
            run_row = session.execute(
                select(Run).where(Run.workflow_id == run_id)
            ).scalar_one_or_none()
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

            n_attempts = session.execute(
                select(func.count())
                .select_from(EngineerRunAttempt)
                .where(EngineerRunAttempt.run_id == run_id)
            ).scalar_one()
            n_agent_cost = session.execute(
                select(func.count())
                .select_from(CostRecord)
                .where(CostRecord.idempotency_key.like(f"{run_id}:agent-cost:%"))
            ).scalar_one()
            pm_doc_id = run.get("pm_document_id")

        # --- the Engineer ran twice (iterations 1 and 2) ---
        eng_iters = [i.iteration for i in eng_invs]
        if eng_iters == [1, 2]:
            ok(f"Engineer invocations iterations == {eng_iters} (ran twice)")
        else:
            fail(f"Engineer invocation iterations {eng_iters} != [1, 2]")

        # --- the Reviewer ran twice, exactly one loop-back ---
        rev_iters = [i.iteration for i in rev_invs]
        rev_outcomes = [i.outcome for i in rev_invs]
        if rev_iters == [1, 2] and rev_outcomes == ["changes_requested", "approved"]:
            ok(f"Reviewer invocations {rev_iters} outcomes {rev_outcomes} (one loop-back)")
        else:
            fail(f"Reviewer invocations {rev_iters} outcomes {rev_outcomes} "
                 "!= [1, 2] / [changes_requested, approved]")

        # --- the agent step re-executed twice (distinct EngineerRunAttempt rows) ---
        if n_attempts == 2:
            ok("exactly 2 EngineerRunAttempt rows (the agent step ran twice)")
        else:
            fail(f"expected 2 EngineerRunAttempt rows, got {n_attempts}")

        # --- per-iteration metering (one cost row per Engineer iteration) ---
        if n_agent_cost == 2:
            ok("exactly 2 per-iteration agent-cost CostRecords")
        else:
            fail(f"expected 2 agent-cost rows, got {n_agent_cost}")

        # --- shipped exactly once, completed, file matches ---
        if run.get("status") == "completed":
            ok("run.status == completed")
        else:
            fail(f"run.status {run.get('status')!r} != completed")

        tags = subprocess.run(
            ["git", "-C", str(ws), "tag", "--list", tag], capture_output=True, text=True
        ).stdout.split()
        if tags == [tag]:
            ok(f"exactly one git tag {tag}")
        else:
            fail(f"expected exactly one {tag} tag, got {tags}")

        committed = subprocess.run(
            ["git", "-C", str(ws), "show", f"{tag}:{TARGET_FILE}"], capture_output=True, text=True
        ).stdout
        # Substring, not byte-exact: a forced-revision round may cosmetically edit the deliverable;
        # this target proves the cycle RAN (byte-exact content is skeleton-run's proof).
        if REQUIRED_LINE in committed:
            ok(f"committed {TARGET_FILE} contains required line "
               "(tolerating a forced-revision cosmetic edit)")
        else:
            fail(f"committed {TARGET_FILE} {committed.strip()!r} "
                 f"does not contain {REQUIRED_LINE!r}")

        print(f"  (info) pm_document_id = {pm_doc_id}")
        print("=================================================")
        if _failed:
            print("\nLOOP-RAN PROOF FAILED")
            return 1
        print("\nALL LOOP-RAN ASSERTIONS PASSED "
              "(Engineer x2, Reviewer x2 [changes_requested, approved], one loop-back, ship once)")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
