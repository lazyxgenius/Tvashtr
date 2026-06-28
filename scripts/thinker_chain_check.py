#!/usr/bin/env python
"""Opt-in *live* thinker_chain run (P1.8c): the non-start thinker, end to end with real models.

Instantiates the ``thinker_chain`` library team (PM → Architect → prd_gate → Engineer → ship),
launches a run on a clone of it, and asserts the structural proof that the SECOND thinker (the
Architect — a non-start ``completion`` node, the residue this milestone unblocks) genuinely ran:

  * the run ships exactly once (``completed`` + one ``ship-{run_id}`` tag), AND
  * the run's spec document has **2 versions** (the PM's v1 + the Architect's refined v2) — robust,
    NOT dependent on an LLM echoing a sentinel.

Thinkers (PM + Architect) run on ``DEFAULT_MODEL``; the Engineer worker runs on
``TVASHTR_AGENT_MODEL`` (the proven NIM agent). Gates auto-approve and the sandbox is local
(``TVASHTR_AUTO_APPROVE_GATES=1`` + ``TVASHTR_AGENT_SANDBOX=local``) so the run is hands-off and
fast. Skips cleanly without ``NVIDIA_BUILD_API_KEY``. Exits non-zero unless the run completes, ships
once, and the spec has exactly 2 versions.

Run via ``make thinker-chain-e2e``.
"""

import os
import sys
import time

POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_THINKER_CHAIN_TIMEOUT_S", "600"))
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}


def main() -> int:
    if not os.environ.get("NVIDIA_BUILD_API_KEY"):
        print(
            "[thinker-chain-e2e] NVIDIA_BUILD_API_KEY not set — skipping live run.\n"
            "              Set it in .env to drive a real PM->Architect->Engineer run. "
            "(Not a failure.)"
        )
        return 0

    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.main import app

    with TestClient(app) as client:
        login_operator(client)  # M-accounts: own runs as the operator
        # 1. Create a thinker_chain library team (the drop-and-edit preset), then launch a run on a
        #    clone of it (clone-on-launch) — exactly what "Run this team" does in the UI.
        created = client.post(
            "/api/teams",
            json={"template": "thinker_chain", "name": "thinker-chain-e2e"},
        )
        if created.status_code != 200:
            print(
                f"[thinker-chain-e2e] FAILED: POST /api/teams -> {created.status_code}: "
                f"{created.text}",
                file=sys.stderr,
            )
            return 1
        team_graph_id = created.json()["team_graph_id"]
        print(f"[thinker-chain-e2e] created thinker_chain team {team_graph_id}")

        run_id = client.post("/api/runs", json={"team_graph_id": team_graph_id}).json()["run_id"]
        print(f"[thinker-chain-e2e] started run_id={run_id}")
        print("[thinker-chain-e2e] polling (PM + Architect completions, then a live agent)…")

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
            print(
                f"[thinker-chain-e2e] FAILED: run did not finish within {POLL_TIMEOUT_S}s",
                file=sys.stderr,
            )
            return 1

        run = final.get("run") or {}

        # 2. The structural proof: the spec document has exactly 2 versions (PM v1 + Architect v2).
        n_versions = 0
        version_authors: list[str] = []
        if run.get("pm_document_id"):
            doc = client.get(f"/api/documents/{run['pm_document_id']}").json()
            versions = doc.get("versions") or []
            n_versions = len(versions)
            version_authors = [v.get("created_by") for v in versions]

        ship_tag = run.get("ship_tag")

        print("\n================= THINKER-CHAIN RUN RESULT =================")
        print(f"run_id           = {run_id}")
        print(f"workflow_status  = {final['workflow_status']}")
        print(f"run.status       = {run.get('status')}")
        print(f"pm_document_id   = {run.get('pm_document_id')}")
        print(f"spec versions    = {n_versions}  authors={version_authors}")
        print(f"ship_tag         = {ship_tag}")
        print(f"cost_total_usd   = {run.get('cost_total_usd')}")

        completed = run.get("status") == "completed"
        shipped_once = ship_tag == f"ship-{run_id}"
        two_versions = n_versions == 2

        print("\nchecks:")
        print(f"  run completed              : {completed}")
        print(f"  shipped exactly once       : {shipped_once} (tag={ship_tag})")
        print(f"  spec has 2 versions        : {two_versions} (the non-start Architect refined it)")
        print("==========================================================")
        return 0 if (completed and shipped_once and two_versions) else 1


if __name__ == "__main__":
    raise SystemExit(main())
