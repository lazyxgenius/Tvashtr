#!/usr/bin/env python
"""Opt-in *live* 2-node skeleton run (P0.4a): idea -> PM PRD -> Engineer ships.

Only if ``OPENROUTER_API_KEY`` is set, drives one ``run_team`` workflow end to end
(via an in-process TestClient, assuming ``db-up`` + ``migrate`` already ran):
POST /api/runs, poll GET /api/runs/{run_id} to SUCCESS, then print the PRD, the
engineer's ``files_changed``, the ship sha + tag, the **committed** file contents
(``git show ship-{run_id}:<file>``), and both cost rows. Skips cleanly without a
key. Exits non-zero unless the run completes, the committed file matches, and both
cost rows are present.

Run via ``make skeleton-run``.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

POLL_TIMEOUT_S = 360
TARGET_FILE = os.environ.get("TVASHTR_SKELETON_FILE", "greeting.txt")
REQUIRED_LINE = os.environ.get(
    "TVASHTR_SKELETON_LINE", "Shipped by the Tvashtr PM->Engineer team"
)
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / "backend" / ".tvashtr_workspaces"
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}


def main() -> int:
    if not os.environ.get("OPENROUTER_API_KEY"):
        print(
            "[skeleton-run] OPENROUTER_API_KEY not set — skipping live run.\n"
            "              Set it in .env to drive a real PM->Engineer run. (Not a failure.)"
        )
        return 0

    from fastapi.testclient import TestClient

    from tvashtr.main import app

    with TestClient(app) as client:
        run_id = client.post("/api/runs", json={}).json()["run_id"]
        print(f"[skeleton-run] started run_id={run_id}")
        print("[skeleton-run] polling (PM completion, then a live OpenHands agent — be patient)…")

        final = None
        deadline = time.time() + POLL_TIMEOUT_S
        while time.time() < deadline:
            body = client.get(f"/api/runs/{run_id}").json()
            wf = body["workflow_status"]
            run_status = (body.get("run") or {}).get("status")
            print(f"  workflow={wf}  run={run_status}")
            if wf in _TERMINAL_WF or run_status in {"completed", "failed"}:
                final = body
                break
            time.sleep(4)

        if final is None:
            print(f"[skeleton-run] FAILED: run did not finish within {POLL_TIMEOUT_S}s", file=sys.stderr)
            return 1

        run = final.get("run") or {}
        costs = final.get("costs") or []

        # PRD (from the document endpoint).
        prd_text = "<missing>"
        if run.get("pm_document_id"):
            doc = client.get(f"/api/documents/{run['pm_document_id']}").json()
            versions = doc.get("versions") or []
            if versions:
                prd_text = versions[0]["content"]

        # Committed file straight out of the tagged commit.
        workspace = _WORKSPACE_ROOT / run_id
        ship_tag = run.get("ship_tag") or f"ship-{run_id}"
        committed = subprocess.run(
            ["git", "-C", str(workspace), "show", f"{ship_tag}:{TARGET_FILE}"],
            capture_output=True,
            text=True,
        ).stdout

        keys = {c["idempotency_key"] for c in costs}
        have_pm_cost = f"{run_id}:pm-llm" in keys
        have_agent_cost = f"{run_id}:agent-cost" in keys

        print("\n================= SKELETON RUN RESULT =================")
        print(f"run_id           = {run_id}")
        print(f"workflow_status  = {final['workflow_status']}")
        print(f"run.status       = {run.get('status')}")
        print(f"pm_document_id   = {run.get('pm_document_id')}")
        print(f"ship_commit_sha  = {run.get('ship_commit_sha')}")
        print(f"ship_tag         = {run.get('ship_tag')}")
        print(f"cost_total_usd   = {run.get('cost_total_usd')}")
        print("\n--- PRD (document v1) ---")
        print(prd_text)
        print("\n--- cost rows ---")
        for c in costs:
            print(
                f"  {c['idempotency_key']:<28} model={c['model_used']} "
                f"tokens={c['total_tokens']} cost=${c['cost_usd']}"
            )
        print(f"\n--- committed {TARGET_FILE} (via git show {ship_tag}:{TARGET_FILE}) ---")
        print(repr(committed))

        ok = (
            run.get("status") == "completed"
            and committed.strip() == REQUIRED_LINE
            and have_pm_cost
            and have_agent_cost
        )
        print("\nchecks:")
        print(f"  run completed              : {run.get('status') == 'completed'}")
        print(f"  committed file matches line: {committed.strip() == REQUIRED_LINE}")
        print(f"  pm-llm cost row present    : {have_pm_cost}")
        print(f"  agent-cost row present     : {have_agent_cost}")
        print("======================================================")
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
