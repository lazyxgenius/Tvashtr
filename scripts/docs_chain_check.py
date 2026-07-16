#!/usr/bin/env python
"""Opt-in *live* M-docs journey: PM writes the PRD -> Architect READS it + authors its OWN "design"
document -> Engineer READS BOTH — end to end with a real model, LOCAL sandbox.

Instantiates the registered ``plan_review`` team (PM -> Architect -> Engineer <-> Reviewer), seeds
the NEW per-node document routing on a clone-on-launch library team (the Architect's
``writes_to="design"`` + the Engineer's ``reads_from=["spec","design"]``), launches a run, and
asserts the M-docs proof:

  * the run produced TWO distinct documents — ``spec`` (the PM's PRD) AND ``design`` (the Architect
    authored via writes_to) — off ``GET /api/runs/{id}/documents`` (the new picker endpoint), AND
  * the Architect's compiled context PROVABLY contained the PM's PRD — its trajectory
    ``context_manifest`` carries a ``spec`` part (built ONLY from the live PRD), while the PM's
    first invocation has none. Deterministic — NOT an LLM-echo check — and it survives even if the
    downstream Engineer/Reviewer loop does not ship.

Every node runs on the PROVEN NIM agent model ``nvidia_nim/meta/llama-3.3-70b-instruct`` (the same
path ``make thinker-chain-e2e`` uses — serialization-clean AND it reliably writes ``REPORT.md`` to
its workspace, unlike weaker models), LOCAL sandbox, gates auto-approve (``TVASHTR_AGENT_SANDBOX=
local`` + ``TVASHTR_AUTO_APPROVE_GATES=1``). Skips cleanly without ``NVIDIA_BUILD_API_KEY``. Exits
non-zero unless BOTH proofs hold.

Run via ``make docs-chain-e2e``.
"""

import os
import sys
import time
from pathlib import Path

POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_DOCS_CHAIN_TIMEOUT_S", "600"))
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
_MODEL = "nvidia_nim/meta/llama-3.3-70b-instruct"


def _load_dotenv() -> None:
    """Load ../.env with a defensive parser (the §15 x-api-key= gotcha: a hyphenated key breaks a
    plain ``source``). Only ``KEY=value`` identifier lines are set; existing env wins."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.isidentifier():
            os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def main() -> int:
    _load_dotenv()
    if not os.environ.get("NVIDIA_BUILD_API_KEY"):
        print(
            "[docs-chain-e2e] NVIDIA_BUILD_API_KEY not set — skipping live run.\n"
            "              Set it in .env to drive the PM->Architect->Engineer journey. "
            "(Not a failure.)"
        )
        return 0

    # Pin the serialization-proven model + LOCAL sandbox + auto-approve gates BEFORE the settings
    # cache is populated by the app import below.
    os.environ["TVASHTR_AGENT_SANDBOX"] = "local"
    os.environ["TVASHTR_AGENT_MODEL"] = _MODEL
    os.environ["DEFAULT_MODEL"] = _MODEL
    os.environ["TVASHTR_AUTO_APPROVE_GATES"] = "1"

    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.main import app

    with TestClient(app) as client:
        login_operator(client)  # M-accounts: own the run as the operator

        created = client.post(
            "/api/teams", json={"template": "plan_review", "name": "docs-chain-e2e"}
        )
        if created.status_code != 200:
            print(
                f"[docs-chain-e2e] FAILED: POST /api/teams -> {created.status_code} {created.text}",
                file=sys.stderr,
            )
            return 1
        team_graph_id = created.json()["team_graph_id"]
        nodes = {
            n["role_name"]: n
            for n in client.get(f"/api/teams/{team_graph_id}/graph").json()["nodes"]
        }

        # Seed the NEW per-node document routing + pin the proven model on every agent/completion
        # node (the clone-on-launch carries this into the run). The Architect AUTHORS "design"; the
        # Engineer READS both. writes_to is NOT set on the emitting Reviewer (that would warn).
        for role in ("pm", "architect", "engineer", "reviewer"):
            node = nodes.get(role)
            if node is None:
                continue
            body: dict = {"prompt": node["prompt"], "model": _MODEL}
            if role == "architect":
                body["writes_to"] = "design"
            if role == "engineer":
                body["reads_from"] = ["spec", "design"]
            resp = client.patch(f"/api/teams/{team_graph_id}/nodes/{node['id']}", json=body)
            if resp.status_code != 200:
                print(
                    f"[docs-chain-e2e] FAILED: PATCH {role} -> {resp.status_code}: {resp.text}",
                    file=sys.stderr,
                )
                return 1
        print(
            f"[docs-chain-e2e] seeded plan_review team {team_graph_id} "
            "(architect.writes_to=design, engineer.reads_from=[spec,design])"
        )

        run_id = client.post("/api/runs", json={"team_graph_id": team_graph_id}).json()["run_id"]
        print(f"[docs-chain-e2e] started run_id={run_id}; polling…")

        deadline = time.time() + POLL_TIMEOUT_S
        final = None
        while time.time() < deadline:
            body = client.get(f"/api/runs/{run_id}").json()
            wf = body["workflow_status"]
            run_status = (body.get("run") or {}).get("status")
            print(f"  workflow={wf}  run={run_status}")
            if wf in _TERMINAL_WF or run_status in {"completed", "failed", "rejected"}:
                final = body
                break
            time.sleep(4)
        if final is None:
            print(
                f"[docs-chain-e2e] FAILED: run did not finish within {POLL_TIMEOUT_S}s",
                file=sys.stderr,
            )
            return 1

        # PROOF 1 — TWO distinct documents (spec + design), off the NEW run-documents endpoint.
        docs = client.get(f"/api/runs/{run_id}/documents").json()["documents"]
        by_name = {d.get("name"): d for d in docs}
        names = set(by_name)
        two_docs = {"spec", "design"} <= names

        # PROOF 2 — the Architect's compiled context contained the PM's PRD: its trajectory manifest
        # has a "spec" part (built ONLY from the live PRD). Deterministic, not an LLM-echo check.
        rows = client.get(f"/api/runs/{run_id}/trajectory").json().get("rows", [])
        arch_parts: list[str] = []
        pm_parts: list[str] = []
        for row in rows:
            manifest = row.get("context_manifest") or {}
            part_names = [p.get("name") for p in manifest.get("parts", [])]
            if row.get("role_name") == "architect":
                arch_parts += part_names
            if row.get("role_name") == "pm":
                pm_parts += part_names
        architect_read_prd = "spec" in arch_parts and "spec" not in pm_parts

        print("\n================= M-DOCS JOURNEY RESULT =================")
        print(f"run_id            = {run_id}")
        print(f"run.status        = {(final.get('run') or {}).get('status')}")
        print(f"documents         = {sorted(n for n in names if n)}")
        print(f"architect parts   = {arch_parts}")
        print(f"pm parts          = {pm_parts}")
        print("\nchecks:")
        print(f"  TWO documents (spec + design)   : {two_docs} ({sorted(n for n in names if n)})")
        print(
            f"  Architect context contained the PRD    : {architect_read_prd} "
            f"(architect has a 'spec' part; PM does not)"
        )
        print("========================================================")
        return 0 if (two_docs and architect_read_prd) else 1


if __name__ == "__main__":
    raise SystemExit(main())
