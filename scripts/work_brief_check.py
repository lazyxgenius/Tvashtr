#!/usr/bin/env python
"""Opt-in *live* executor-populate proof for the per-node work-brief (Option A, §6.1).

The most important + cheapest e2e evidence: run a REAL ``review_loop`` team (PM thinker → Engineer
worker ↔ Reviewer) on the NIM agent model with forced revisions (so the loop genuinely cycles), then
GET ``/api/runs/{id}/graph`` and assert on disk that the per-node ``outcome_detail`` brief is
populated for MORE than just the Reviewer:

  * the THINKER (PM) node's latest ``outcome_detail`` == "Drafted the spec from the idea."
    (non-NULL, the first-thinker brief), AND
  * the WORKER (Engineer) node's latest ``outcome_detail`` is a well-formed files-changed brief
    (non-NULL — "Built the feature — changed N file(s): …" for a real build, or the no-files line),
    NOT NULL as it was before this milestone, AND
  * the EMITTING worker (Reviewer) round-1 ``outcome_detail`` is still its VERDICT REASONS (the
    forced-revision marker), NOT a work-brief — proving the Reviewer is left byte-stable.

API-driven via the in-process TestClient (no Vite/Playwright). Thinkers run on ``DEFAULT_MODEL``;
the Engineer worker runs on ``TVASHTR_AGENT_MODEL`` (the proven NIM agent). Gates auto-approve, the
sandbox is LOCAL, and ``TVASHTR_FORCE_REVISIONS=1`` makes the Reviewer return ``changes_requested``
then ``approved`` (no LLM for the Reviewer) so the Engineer runs twice. Skips cleanly without
``NVIDIA_BUILD_API_KEY``. Exits non-zero unless every assertion holds.

Run via ``make work-brief-e2e`` (step C).
"""

import os
import re
import sys
import time

POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_WORK_BRIEF_TIMEOUT_S", "1200"))
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
# A well-formed NON-emitting worker brief: the files-changed line (the expected real-build case) or
# the no-files fallback. Either is a valid non-NULL brief; both prove "more than the Reviewer".
_WORKER_BRIEF_RE = re.compile(
    r"^Built the feature — changed \d+ file\(s\): .+|^Ran but changed no files\.$"
)
_THINKER_BRIEF = "Drafted the spec from the idea."


def _latest_detail(node: dict) -> str | None:
    invs = node.get("invocations") or []
    return invs[-1].get("outcome_detail") if invs else None


def main() -> int:
    if not os.environ.get("NVIDIA_BUILD_API_KEY"):
        print(
            "[work-brief-e2e] NVIDIA_BUILD_API_KEY not set — skipping live run.\n"
            "              Set it in .env to drive a real review_loop run. (Not a failure.)"
        )
        return 0

    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.main import app

    with TestClient(app) as client:
        login_operator(client)  # M-accounts: own runs as the operator
        # 1. Create a review_loop library team, then launch a run on a clone of it
        #    (clone-on-launch), exactly as "Run this team" does in the UI.
        name = f"work-brief-e2e-{int(time.time())}"
        created = client.post("/api/teams", json={"template": "review_loop", "name": name})
        if created.status_code != 200:
            print(
                f"[work-brief-e2e] FAILED: POST /api/teams -> "
                f"{created.status_code}: {created.text}",
                file=sys.stderr,
            )
            return 1
        team_graph_id = created.json()["team_graph_id"]
        run_id = client.post("/api/runs", json={"team_graph_id": team_graph_id}).json()["run_id"]
        print(f"[work-brief-e2e] created review_loop team {team_graph_id}, started run_id={run_id}")
        print(
            "[work-brief-e2e] polling (PM completion, then a real Engineer x2 with one loop-back)…"
        )

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
                f"[work-brief-e2e] FAILED: run did not finish within {POLL_TIMEOUT_S}s",
                file=sys.stderr,
            )
            return 1

        run = final.get("run") or {}
        if run.get("status") != "completed":
            print(
                f"[work-brief-e2e] FAILED: run ended '{run.get('status')}', not completed",
                file=sys.stderr,
            )
            return 1

        # 2. Read the run graph and pull each node's latest outcome_detail brief.
        graph = client.get(f"/api/runs/{run_id}/graph").json()
        by_role = {n["role_name"]: n for n in graph["nodes"]}
        pm_detail = _latest_detail(by_role.get("pm", {}))
        eng_detail = _latest_detail(by_role.get("engineer", {}))
        rev_invs = by_role.get("reviewer", {}).get("invocations") or [{}]
        rev_round1 = rev_invs[0].get("outcome_detail")

        print("\n===== WORK-BRIEF outcome_detail (read from /api/runs/{id}/graph) =====")
        print(f"run_id                       = {run_id}")
        print(f"THINKER (pm).outcome_detail  = {pm_detail!r}")
        print(f"WORKER  (engineer).detail    = {eng_detail!r}")
        print(f"EMITTING (reviewer) r1 detail= {rev_round1!r}")

        # 3. The assertions: the brief is populated for the thinker AND the worker (more than just
        #    the Reviewer), and the Reviewer's detail is still its verdict reasons (byte-stable).
        pm_ok = pm_detail == _THINKER_BRIEF
        eng_ok = isinstance(eng_detail, str) and bool(_WORKER_BRIEF_RE.match(eng_detail))
        eng_is_files_changed = isinstance(eng_detail, str) and eng_detail.startswith(
            "Built the feature — changed"
        )
        rev_ok = isinstance(rev_round1, str) and "forced revision" in rev_round1

        print("\nchecks:")
        print(f"  thinker(PM) brief == '{_THINKER_BRIEF}'   : {pm_ok}")
        print(
            f"  worker(Engineer) brief well-formed non-NULL : {eng_ok} "
            f"(files={eng_is_files_changed})"
        )
        print(f"  brief populated for MORE than the Reviewer  : {pm_ok and eng_ok}")
        print(f"  reviewer outcome_detail still its REASONS   : {rev_ok}")
        print("=====================================================================")
        return 0 if (pm_ok and eng_ok and rev_ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
