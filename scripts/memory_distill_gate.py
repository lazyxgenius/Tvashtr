#!/usr/bin/env python
"""M-memory S2 run-END distillation LIVE gate (operator-run; NOT in ``make test``).

Drives ONE ``review_loop`` run to COMPLETION on the LOCAL sandbox with a REAL deepseek Engineer +
forced reviewer approve (``TVASHTR_FORCE_REVISIONS=1`` cycles changes_requested→approved),
so the run SHIPS — which fires the terminal ship arm's best-effort ``distill_run_memory_step``. Then
it asserts the WRITE half of the memory loop actually happened, end-to-end on a REAL trail:

  1. ``run.status == completed`` (the ship arm — and thus distillation — fired);
  2. ``GET /api/runs/{id}/memories`` returns >=1 ACTIVE LABELED (polarity/status/tier) fact
     from the real trail;
  3. a ``CostRecord`` (``workflow_id == run_id``, key ``{run_id}:memory-distill``) exists — the
     distiller completion was metered ON the run (the owner's key), not off-ledger.

Needs ``DEEPSEEK_API_KEY`` (run) + ``OPENAI_API_KEY`` (distiller ``openai/gpt-4o-mini`` + the
embeds); skips cleanly without either. In-process ``TestClient`` (no port needed; the worktree
convention is backend ``:8001`` / Vite ``:5174``). Run via ``make memory-distill-gate``.
"""

import os
import sys
import time
import uuid

POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_DISTILL_TIMEOUT_S", "1200"))
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
_TERMINAL_RUN = {"completed", "failed", "over_budget", "rejected", "cancelled"}


def main() -> int:
    if not os.environ.get("DEEPSEEK_API_KEY") or not os.environ.get("OPENAI_API_KEY"):
        print(
            "[distill-gate] needs DEEPSEEK_API_KEY (run) + OPENAI_API_KEY (distill/embed) — "
            "skipping (not a failure)."
        )
        return 0

    from fastapi.testclient import TestClient
    from sqlalchemy import select

    from tvashtr.db import session_scope
    from tvashtr.main import app
    from tvashtr.models import CostRecord

    model = os.environ.get("TVASHTR_AGENT_MODEL", "deepseek/deepseek-chat")
    failed = False

    with TestClient(app) as client:
        # A FRESH account per run — a CLEAN memory slate, so this run's distilled facts are all NEW
        # (source_run_id == this run). Reusing an account would (correctly) DEDUP against a prior
        # identical run's facts — consolidation confirming them — leaving this run with 0 new rows.
        email = f"distill-gate-{uuid.uuid4().hex}@tvashtr.local"
        reg = client.post(
            "/api/auth/register", json={"email": email, "password": "distill-gate-pw-123456"}
        )
        reg.raise_for_status()
        print(f"[distill-gate] registered fresh account {email}")
        # Seed BOTH providers the gate exercises: deepseek (the agent nodes) + openai (the distiller
        # model openai/gpt-4o-mini + the fact embeds). Idempotent upsert via the dashboard endpoint.
        for provider, env_name in (("deepseek", "DEEPSEEK_API_KEY"), ("openai", "OPENAI_API_KEY")):
            r = client.post(
                "/api/providers", json={"provider": provider, "api_key": os.environ[env_name]}
            )
            print(f"[distill-gate] seeded '{provider}' from {env_name} (HTTP {r.status_code})")
        print(
            f"[distill-gate] model={model}  sandbox={os.environ.get('TVASHTR_AGENT_SANDBOX')}  "
            f"forced_revisions={os.environ.get('TVASHTR_FORCE_REVISIONS')}  "
            f"distiller={os.environ.get('TVASHTR_MEMORY_DISTILLER_MODEL', 'openai/gpt-4o-mini')}"
        )

        run_id = client.post("/api/runs", json={"team_shape": "review_loop"}).json()["run_id"]
        print(f"[distill-gate] started review_loop run_id={run_id}; polling to completion…")

        final = None
        deadline = time.time() + POLL_TIMEOUT_S
        while time.time() < deadline:
            body = client.get(f"/api/runs/{run_id}").json()
            wf = body["workflow_status"]
            rs = (body.get("run") or {}).get("status")
            print(f"  workflow={wf}  run={rs}")
            # Wait for the WORKFLOW terminal (SUCCESS), NOT just run.status: distillation is
            # best-effort and runs AFTER finalize_run_step; breaking on run.status tears DBOS down
            # (TestClient exit) mid-distill. The workflow terminal guarantees distill ran (no such
            # race under a persistent uvicorn — only the in-process TestClient).
            if wf in _TERMINAL_WF:
                final = body
                break
            if rs in _TERMINAL_RUN:
                print("  (run row terminal; waiting for the workflow to finish the distill step…)")
            time.sleep(5)

        if final is None:
            print(
                f"[distill-gate] FAILED: run did not finish within {POLL_TIMEOUT_S}s",
                file=sys.stderr,
            )
            return 1

        run = final.get("run") or {}
        status = run.get("status")

        print("\n================= M-MEMORY S2 DISTILLATION GATE =================")
        print(f"run_id          = {run_id}")
        print(f"workflow_status = {final['workflow_status']}   run.status = {status}")

        # 1. the run shipped → the terminal ship arm fired distill_run_memory_step
        if status == "completed":
            print("  [ok]   run.status == completed (ship arm fired distill_run_memory_step)")
        else:
            print(
                f"  [FAIL] run.status {status!r} != completed — ship arm (+ distill) did not fire"
            )
            failed = True

        # 2. the run's taught memories — >=1 ACTIVE, LABELED fact from the REAL trail
        mem_resp = client.get(f"/api/runs/{run_id}/memories")
        if mem_resp.status_code != 200:
            print(f"  [FAIL] GET /api/runs/{run_id}/memories → HTTP {mem_resp.status_code}")
            return 1
        mems = mem_resp.json()["memories"]
        active = [m for m in mems if m.get("status") == "active"]
        print(f"  taught facts: {len(mems)} ({len(active)} active) —")
        for m in mems:
            print(f"    - [{m['status']}/{m['polarity']}/{m['tier']}] {m['content']}")
        labeled = [m for m in active if m.get("polarity") and m.get("status") and m.get("tier")]
        if labeled:
            print(
                f"  [ok]   >=1 ACTIVE labeled fact distilled from the real trail ({len(labeled)})"
            )
        else:
            print("  [FAIL] no ACTIVE labeled fact returned by GET /api/runs/{id}/memories")
            failed = True

        # 3. the distiller completion was metered ON the run (owner's key), not off-ledger
        with session_scope() as session:
            cost = session.execute(
                select(CostRecord).where(
                    CostRecord.workflow_id == run_id,
                    CostRecord.idempotency_key == f"{run_id}:memory-distill",
                )
            ).scalar_one_or_none()
        if cost is not None:
            print(
                f"  [ok]   distill metered on-run: CostRecord workflow_id={run_id} "
                f"model={cost.model_used} tokens={cost.total_tokens}"
            )
        else:
            print(
                f"  [FAIL] no CostRecord workflow_id={run_id} key={run_id}:memory-distill "
                "(distill not metered on-run)"
            )
            failed = True

        print("================================================================")
        if failed:
            print("\nM-MEMORY S2 DISTILLATION GATE FAILED")
            return 1
        print(
            "\nALL M-MEMORY S2 DISTILLATION GATE ASSERTIONS PASSED "
            "(shipped → distilled >=1 active labeled fact, metered on-run)"
        )
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
