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

POLL_TIMEOUT_S = 900
TARGET_FILE = os.environ.get("TVASHTR_SKELETON_FILE", "greeting.txt")
REQUIRED_LINE = os.environ.get("TVASHTR_SKELETON_LINE", "Shipped by the Tvashtr PM->Engineer team")
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / "backend" / ".tvashtr_workspaces"
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}


def main() -> int:
    if not os.environ.get("NVIDIA_BUILD_API_KEY"):
        print(
            "[skeleton-run] NVIDIA_BUILD_API_KEY not set — skipping live run.\n"
            "              Set it in .env to drive a real unified-path run. (Not a failure.)"
        )
        return 0

    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.main import app

    with TestClient(app) as client:
        login_operator(client)  # M-accounts: own runs as the operator
        run_id = client.post("/api/runs", json={}).json()["run_id"]
        print(f"[skeleton-run] started run_id={run_id}")
        print(
            "[skeleton-run] polling (M-unify U1: ENTRY runs the agent loop → REPORT.md, then "
            "the Engineer — be patient)…"
        )

        # M-unify U1: the entry-node invocation wall time (spin-up → REPORT.md pulled + versioned,
        # observed as ``pm_document_id`` first appearing) — the U2 latency baseline.
        t_start = time.time()
        entry_wall = None
        final = None
        deadline = time.time() + POLL_TIMEOUT_S
        while time.time() < deadline:
            body = client.get(f"/api/runs/{run_id}").json()
            wf = body["workflow_status"]
            run_bd = body.get("run") or {}
            run_status = run_bd.get("status")
            if entry_wall is None and run_bd.get("pm_document_id"):
                entry_wall = time.time() - t_start
                print(f"  [ENTRY-NODE WALL TIME] spin-up → REPORT.md pulled: {entry_wall:.1f}s")
            print(f"  workflow={wf}  run={run_status}")
            if wf in _TERMINAL_WF or run_status in {"completed", "failed"}:
                final = body
                break
            time.sleep(4)

        if final is None:
            print(
                f"[skeleton-run] FAILED: run did not finish within {POLL_TIMEOUT_S}s",
                file=sys.stderr,
            )
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
        # M-unify U1: the entry (PM) now runs the agent path, so it writes an agent-cost row (not
        # pm-llm). Two nodes meter → two agent-cost rows (entry + Engineer).
        agent_cost_keys = [k for k in keys if k.startswith(f"{run_id}:agent-cost:")]
        have_agent_cost = len(agent_cost_keys) >= 2  # entry + Engineer both meter (unified path)

        # Run-event feed (the on_event seam): in docker mode the agent's events ride
        # back over the Agent Server WebSocket, so a non-zero count is the P1.3a proof
        # that streaming works over the container — not just the post-run usage read.
        ev_r = client.get(f"/api/spike/run-events/{run_id}")
        ev_resp = ev_r.json() if ev_r.status_code == 200 else {}
        ev_list = ev_resp.get("events", ev_resp) if isinstance(ev_resp, dict) else ev_resp
        if not isinstance(ev_list, list):
            ev_list = []
        ev_kinds: dict[str, int] = {}
        for e in ev_list:
            k = e.get("kind", "?") if isinstance(e, dict) else "?"
            ev_kinds[k] = ev_kinds.get(k, 0) + 1

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
        print("\n--- run events (streamed via on_event) ---")
        print(f"  count = {len(ev_list)}  kinds = {ev_kinds}")

        ok = (
            run.get("status") == "completed"
            and committed.strip() == REQUIRED_LINE
            and have_agent_cost
        )
        print("\nchecks:")
        print(f"  run completed              : {run.get('status') == 'completed'}")
        print(f"  committed file matches line: {committed.strip() == REQUIRED_LINE}")
        print(f"  entry+engineer agent-cost  : {have_agent_cost} ({len(agent_cost_keys)} rows)")
        print(f"  entry-node wall time (s)   : {entry_wall}")
        print("======================================================")
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
