"""M1 stall guard — live proof on the LOCAL sandbox: a run whose entry node hangs shows its states
through the API (Working → Quiet → Stalled), lands in Needs you, and the sweep ends it as Failed
("stalled"), freeing its slot.

No LLM is called: ``TVASHTR_FORCE_HANG_ROLE=pm`` makes the PM wait like a model that never answers.
The R1 numbers are shrunk (Quiet 4 s, Stalled 8 s, ended at 16 s) and the sweep runs every 2 s.

Run on an ISOLATED, migrated database (a concurrent app process would recover this run):

    make stall-guard-check DATABASE_URL=postgresql://…/tvashtr_m1live

Exits non-zero unless every state is seen and the run ends ``failed`` / ``stalled``.
"""

import os
import sys
import time

os.environ.update(
    {
        "TVASHTR_AGENT_SANDBOX": "local",
        "TVASHTR_FORCE_HANG_ROLE": "pm",
        "TVASHTR_QUIET_AFTER_S": "4",
        "TVASHTR_STALLED_AFTER_S": "8",
        "TVASHTR_STALL_FAIL_AFTER_S": "16",
        "TVASHTR_STALL_SWEEP": "1",
        "TVASHTR_STALL_SWEEP_CRON": "*/2 * * * * *",
    }
)
sys.path.insert(0, os.path.dirname(__file__))

TIMEOUT_S = 90


def main() -> int:
    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.main import app

    with TestClient(app) as client:
        login_operator(client)
        team = client.post(
            "/api/teams",
            json={"template": "review_loop", "name": f"stall-guard-{int(time.time())}"},
        ).json()["team_graph_id"]
        created = client.post("/api/runs", json={"team_graph_id": team})
        if created.status_code != 200:
            print(f"[stall-guard] FAILED: POST /api/runs -> {created.status_code} {created.text}")
            return 1
        run_id = created.json()["run_id"]
        print(f"[stall-guard] run {run_id} started (PM forced to hang)")

        seen: list[str] = []
        inbox_kinds: set[str] = set()
        started = time.time()
        final = None
        while time.time() - started < TIMEOUT_S:
            graph = client.get(f"/api/runs/{run_id}/graph").json()
            pm = next(n for n in graph["nodes"] if n["role_name"] == "pm")
            state = pm["live"]["live_state"]
            if not seen or seen[-1] != state:
                seen.append(state)
                print(
                    f"  t+{time.time() - started:5.1f}s  pm={state:<9} run={graph['live_state']:<8}"
                    f" last={pm['live']['last_event_at']}  activity={pm['live']['activity']!r}"
                )
            for item in client.get("/api/inbox").json()["items"]:
                if item.get("run", {}).get("id") == run_id:
                    if item["kind"] not in inbox_kinds:
                        print(f"  t+{time.time() - started:5.1f}s  inbox: {item['key']}")
                    inbox_kinds.add(item["kind"])
            run = client.get(f"/api/runs/{run_id}").json()["run"]
            if run["status"] in ("failed", "completed", "cancelled"):
                final = run
                break
            time.sleep(1)

        if final is None:
            print(f"[stall-guard] FAILED: the run did not end within {TIMEOUT_S}s (seen {seen})")
            return 1
        print(
            f"[stall-guard] run ended: status={final['status']} live_state={final['live_state']}"
            f" failure={final['failure']}"
        )
        checks = {
            "saw working": "working" in seen,
            "saw quiet": "quiet" in seen,
            "saw stalled": "stalled" in seen,
            "Needs you listed run_stalled": "run_stalled" in inbox_kinds,
            "run failed": final["status"] == "failed",
            "failure code stalled": (final.get("failure") or {}).get("code") == "stalled",
            "slot freed (not in the active list)": run_id
            not in {
                r["run_id"]
                for r in client.get("/api/runs", params={"status": "active"}).json()["runs"]
            },
        }
        for name, ok in checks.items():
            print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
        ok = all(checks.values())
        print(f"stall-guard-check: {'PASSED' if ok else 'FAILED'}")
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
