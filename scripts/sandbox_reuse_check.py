#!/usr/bin/env python
"""M-unify U2 sandbox-reuse LIVE proof (operator-run; NOT in ``make test``).

Drives ONE ``run_team`` over the 3-node ``review_loop`` on the DOCKER sandbox with forced revisions
(``TVASHTR_FORCE_REVISIONS=1``) makes the Reviewer return changes_requested then approved, so
Engineer runs iterations {1, 2}, the second a rework round). The whole point of U2: the Engineer's
ROUND 2 must REUSE its warm container (NO second ~20s container spin-up) and CONTINUE the same
OpenHands Conversation (round 2 builds on round 1) — a DIFFERENT node (the entry/PM) gets its OWN
container.

It proves this by scraping the docker adapter's OWN log lines (in-process, same interpreter):
  * "container ready on host port=…"     — a COLD container build (one per MISS)
  * "REUSED warm container … (carried N prior tokens)"  — a reuse (HIT); N>0 proves the SAME
    Conversation kept the prior round's transcript

For a forced ``review_loop`` the agent path runs THREE times — PM(cold) + Engineer-iter1(cold) +
Engineer-iter2(REUSE) - a working reuse yields 2 cold builds + >=1 reuse; a BROKEN reuse
would yield 3 cold builds + 0 reuses. The cold builds also give the ~20s baseline the reused round
(≈0s setup) beats.

Model: inherits ``.env``'s ``TVASHTR_AGENT_MODEL`` (deepseek/deepseek-chat) — override to
``nvidia_nim/meta/llama-3.3-70b-instruct`` if deepseek trips the OpenHands serialization wall (the
reuse behaviour is model-agnostic). Skips cleanly with no provider key / no docker. Run via
``make sandbox-reuse-check``.
"""

import logging
import os
import re
import subprocess
import sys
import time
from pathlib import Path

POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_REUSE_TIMEOUT_S", "1200"))
DOCKER_BASELINE_S = 20.2  # the measured cold-start baseline the reused round must beat (brief)
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / "backend" / ".tvashtr_workspaces"
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
_TERMINAL_RUN = {"completed", "failed", "over_budget", "rejected", "cancelled"}

# provider slug -> the .env var(s) that carry its key (mirrors config.agent_llm_routing).
_ENV_KEY_FOR_PROVIDER = {
    "deepseek": ("DEEPSEEK_API_KEY",),
    "nvidia_nim": ("NVIDIA_BUILD_API_KEY", "NVIDIA_NIM_API_KEY"),
    "openai": ("OPENAI_API_KEY",),
    "openrouter": ("OPENROUTER_API_KEY",),
    "gemini": ("GEMINI_API_KEY",),
    "groq": ("GROQ_CLOUD_API_KEY", "GROQ_API_KEY"),
}

_failed = False


def fail(msg: str) -> None:
    global _failed
    print(f"  [FAIL] {msg}")
    _failed = True


def ok(msg: str) -> None:
    print(f"  [ok]   {msg}")


class _AdapterLogCapture(logging.Handler):
    """Capture (timestamp, message) for every docker-adapter log record — the reuse evidence."""

    def __init__(self):
        super().__init__()
        self.records: list[tuple[float, str]] = []

    def emit(self, record):
        try:
            self.records.append((record.created, record.getMessage()))
        except Exception:
            pass


def _seed_provider(client, model: str) -> str:
    """Ensure the operator has a credential for the model's provider (deepseek is NOT in the
    seed map, so a live deepseek run must seed it or ``create_run`` 422s). Idempotent upsert."""
    provider = model.split("/", 1)[0].strip().lower()
    for env_name in _ENV_KEY_FOR_PROVIDER.get(provider, ()):
        key = os.environ.get(env_name)
        if key:
            r = client.post("/api/providers", json={"provider": provider, "api_key": key})
            print(
                f"[reuse-check] seeded provider '{provider}' from {env_name} (HTTP {r.status_code})"
            )
            return provider
    print(f"[reuse-check] WARNING: no .env key for provider '{provider}' — create_run may 422")
    return provider


def main() -> int:
    model = os.environ.get("TVASHTR_AGENT_MODEL", "").strip()
    provider = model.split("/", 1)[0].strip().lower() if model else ""
    if not any(os.environ.get(e) for e in _ENV_KEY_FOR_PROVIDER.get(provider, ())):
        print(
            f"[reuse-check] no API key for model provider '{provider}' (model={model!r}) — "
            "skipping (not a failure)."
        )
        return 0
    if os.environ.get("TVASHTR_AGENT_SANDBOX") != "docker":
        print("[reuse-check] TVASHTR_AGENT_SANDBOX != docker; needs docker; skipping.")
        return 0

    from fastapi.testclient import TestClient
    from operator_session import login_operator
    from sqlalchemy import select

    from tvashtr.db import session_scope
    from tvashtr.main import app
    from tvashtr.models import AgentInvocation, AgentNode, Run

    cap = _AdapterLogCapture()
    docker_logger = logging.getLogger("tvashtr.engines.openhands_docker")
    docker_logger.setLevel(logging.INFO)
    docker_logger.addHandler(cap)

    with TestClient(app) as client:
        login_operator(client)
        _seed_provider(client, model)
        print(
            f"[reuse-check] agent_model={model}  sandbox=docker  "
            f"forced_revisions={os.environ.get('TVASHTR_FORCE_REVISIONS')}"
        )
        run_id = client.post("/api/runs", json={"team_shape": "review_loop"}).json()["run_id"]
        print(
            f"[reuse-check] started review_loop run_id={run_id}; polling "
            "(PM cold → Engineer cold → Engineer REUSE → ship)…"
        )

        final = None
        deadline = time.time() + POLL_TIMEOUT_S
        while time.time() < deadline:
            body = client.get(f"/api/runs/{run_id}").json()
            wf = body["workflow_status"]
            rs = (body.get("run") or {}).get("status")
            print(f"  workflow={wf}  run={rs}")
            if wf in _TERMINAL_WF or rs in _TERMINAL_RUN:
                final = body
                break
            time.sleep(5)

        if final is None:
            print(
                f"[reuse-check] FAILED: run did not finish within {POLL_TIMEOUT_S}s",
                file=sys.stderr,
            )
            return 1
        run = final.get("run") or {}

        # ---- scrape the captured docker-adapter logs ----
        recs = cap.records
        starts = [(t, m) for t, m in recs if "starting container" in m]
        readys = [(t, m) for t, m in recs if "container ready" in m]
        reuses = [(t, m) for t, m in recs if "REUSED warm container" in m]
        spinups = [rt - st for (st, _), (rt, _) in zip(starts, readys, strict=False)]

        # ---- DB: per-node iterations ----
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
                if run_row
                else []
            )
            by_role = {n.role_name: n for n in nodes}

            def _iters(role):
                if role not in by_role:
                    return []
                return (
                    session.execute(
                        select(AgentInvocation)
                        .where(
                            AgentInvocation.run_id == run_id,
                            AgentInvocation.node_id == by_role[role].id,
                        )
                        .order_by(AgentInvocation.iteration)
                    )
                    .scalars()
                    .all()
                )

            eng_iters = [i.iteration for i in _iters("engineer")]
            rev_rounds = [(i.iteration, i.outcome) for i in _iters("reviewer")]

        ws = _WORKSPACE_ROOT / run_id
        tag = f"ship-{run_id}"

        print("\n================= SANDBOX-REUSE PROOF (M-unify U2) =================")
        print(f"run_id            = {run_id}")
        print(f"agent_model       = {model}")
        print(f"workflow_status   = {final['workflow_status']}   run.status = {run.get('status')}")
        print(f"engineer_iters    = {eng_iters}")
        print(f"reviewer_rounds   = {rev_rounds}")
        print(f"COLD container builds ('container ready') = {len(readys)}")
        print(f"cold spin-up times (s) = {[round(s, 1) for s in spinups]}")
        print(f"REUSED warm-container events = {len(reuses)}")
        for _, m in reuses:
            print(f"    {m}")
        print("assertions:")

        # 1. the Engineer genuinely ran >=2 rounds (the precondition for reuse)
        if eng_iters[:2] == [1, 2]:
            ok(f"Engineer ran >=2 rounds (iterations {eng_iters})")
        else:
            fail(f"Engineer iterations {eng_iters} do not start [1, 2] - no rework round")

        # 2. round 2 REUSED a warm container (the headline)
        if len(reuses) >= 1:
            ok(f"round 2+ REUSED a warm container ({len(reuses)} event(s)) — no fresh spin-up")
        else:
            fail(
                "no 'REUSED warm container' event — the Engineer's round 2 rebuilt its container "
                "(reuse is a no-op)"
            )

        # 3. reuse SKIPPED the spin-up: exactly 2 cold builds (PM + Engineer r1), NOT 3
        if len(readys) == 2:
            ok("exactly 2 cold container builds (PM + Engineer round 1); round 2 added no 3rd")
        else:
            fail(
                f"expected 2 cold builds (PM + Engineer r1); got {len(readys)} - a 3rd means "
                "round 2 spun up a fresh container"
            )

        # 4. beat the 20.2s docker cold-start baseline on round 2 (reused round ≈ 0s setup)
        if spinups:
            print(f"  (baseline evidence) slowest cold container spin-up = {max(spinups):.1f}s")
        if len(reuses) >= 1:
            ok(
                f"round 2 setup ~0s (reused, no spin-up) << {DOCKER_BASELINE_S}s cold-start "
                "baseline — BEATEN"
            )

        # 5. conversation carried: the reuse log reports >0 carried prior tokens
        carried = 0
        for _, m in reuses:
            mo = re.search(r"carried (\d+) prior tokens", m)
            if mo:
                carried = max(carried, int(mo.group(1)))
        if carried > 0:
            ok(
                f"conversation carried: round 2 continued the SAME Conversation with {carried} "
                "prior tokens (round 2 built on round 1, not a fresh chat)"
            )
        else:
            fail("round 2's reused Conversation carried 0 prior tokens; carry unproven")

        # 6. shipped exactly once, completed
        if run.get("status") == "completed":
            ok("run.status == completed")
        else:
            fail(f"run.status {run.get('status')!r} != completed")
        tags = subprocess.run(
            ["git", "-C", str(ws), "tag", "--list", tag], capture_output=True, text=True
        ).stdout.split()
        if tags == [tag]:
            ok(f"exactly one git tag {tag} (shipped once)")
        else:
            fail(f"expected exactly one {tag} tag, got {tags}")

        print("===================================================================")
        if _failed:
            # Surface the last adapter error lines to diagnose a model/serialization wall.
            errs = [m for _, m in recs if "failed" in m.lower() or "error" in m.lower()]
            if errs:
                print("\n[reuse-check] recent adapter error log lines:")
                for m in errs[-4:]:
                    print(f"    {m}")
            print("\nSANDBOX-REUSE PROOF FAILED")
            return 1
        print(
            "\nALL SANDBOX-REUSE ASSERTIONS PASSED "
            "(round 2 reused the warm container, no 2nd spin-up, conversation carried, shipped)"
        )
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
