#!/usr/bin/env python
"""Opt-in *live* memory write-control gate (M-memory S4 — acceptance).

Proves the four S4 capabilities end-to-end on a REAL LOCAL-sandbox ``deepseek`` stack (real agent,
real distiller LLM, real ``text-embedding-3-small`` embeds, real DB, real endpoints):

  (a) AGENT-REMEMBER — a real Engineer, with the capture protocol injected
      (``TVASHTR_MEMORY_REMEMBER_ENABLED=1``), appends a sentinel lesson to
      ``TVASHTR_REMEMBER.jsonl``; the run-end ingest lands it ``active`` at the REPO tier (the
      FALLBACK channel — the PRIMARY live-MCP channel was infeasible: no MCP-hosting infra + the
      in-process gate binds no port).
  (b) REVIEW MODE ON — with the owner's ``memory_review_mode`` ON, a shipped run's distilled fact
      lands ``pending_review`` (not ``active``).
  (c) PROMOTE — a promote through ``POST /api/memories/{id}/promote`` activates a quarantined fact
      AND (the contradicting case) supersedes/retires the contradicted active fact — via the REAL
      Consolidate over REAL embeddings.
  (d) REJECT — ``POST /api/memories/{id}/reject`` tombstones a fact, and a re-proposal of the SAME
      same-sign fact through the shared Consolidate is DROPPED (suppressed re-proposal).

Each step echoes the resulting DB state. Needs ``DEEPSEEK_API_KEY`` (the agent) + ``OPENAI_API_KEY``
(the distiller + embeds) in ``.env``; skips cleanly (exit 0) without them. Run via
``make memory-review-gate``. NOT in ``make test``; LOCAL, no docker.
"""

import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

# LOCAL sandbox + auto-approve the PRD gate + forced reviewer-approve (so the loop ships) + the
# agent-remember capture protocol ON — all set before app import.
os.environ.setdefault("TVASHTR_AGENT_SANDBOX", "local")
os.environ.setdefault("TVASHTR_AUTO_APPROVE_GATES", "1")
os.environ.setdefault("TVASHTR_FORCE_REVISIONS", "1")
os.environ.setdefault("TVASHTR_MEMORY_REMEMBER_ENABLED", "1")

POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_MEMORY_REVIEW_TIMEOUT_S", "1200"))
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
_TERMINAL_RUN = {"completed", "failed", "over_budget", "rejected", "cancelled"}

_REMEMBER_TOKEN = f"MEMSENTINEL-REMEMBER-{uuid.uuid4().hex[:8]}"
_REMEMBER_LINE = (
    f'{{"content": "{_REMEMBER_TOKEN}: pin dependency versions in this repo", '
    f'"polarity": "prefer"}}'
)
_IDEA = (
    "Add a function `bulk_discount(price, quantity)` to the shop/discounts.py module: it returns "
    "`price` reduced by 10 percent when `quantity` is 10 or more, else `price` unchanged, money "
    "rounded to 2 decimals; keep the existing functions and tests passing. "
    "ADDITIONALLY (important, do this too): using your file editor, "
    "APPEND exactly this single line "
    "to the file `TVASHTR_REMEMBER.jsonl` at the workspace root:\n"
    f"{_REMEMBER_LINE}"
)

_FILES = {
    "shop/__init__.py": '"""A tiny shop pricing package."""\n',
    "shop/discounts.py": (
        '"""Discount rules for the shop (pure money math; round to 2 decimals)."""\n\n\n'
        "def percentage_off(price, pct):\n"
        '    """Return ``price`` reduced by ``pct`` percent, rounded to 2 decimals."""\n'
        "    return round(price * (1 - pct / 100.0), 2)\n"
    ),
    "test_discounts.py": (
        "import unittest\n\n"
        "from shop.discounts import percentage_off\n\n\n"
        "class TestDiscounts(unittest.TestCase):\n"
        "    def test_percentage_off(self):\n"
        "        self.assertEqual(percentage_off(100.0, 10), 90.0)\n"
    ),
    "pyproject.toml": '[project]\nname = "shop"\nversion = "0.1.0"\n',
}


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _git(repo, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=check, capture_output=True, text=True
    )


def _make_fixture(root: str) -> Path:
    repo = Path(root) / "shop_repo"
    repo.mkdir(parents=True)
    for rel, content in _FILES.items():
        f = repo / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content, encoding="utf-8")
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "fixture@tvashtr.local")
    _git(repo, "config", "user.name", "Fixture User")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "init shop package")
    return repo


def _poll(client, run_id: str, *, wait_workflow: bool) -> dict | None:
    """Poll GET /api/runs/{id}. When ``wait_workflow`` (a step needing the post-finalize distill/
    ingest to have run), wait for the WORKFLOW terminal (SUCCESS); else the run row terminal is
    enough."""
    deadline = time.time() + POLL_TIMEOUT_S
    while time.time() < deadline:
        body = client.get(f"/api/runs/{run_id}").json()
        wf = body["workflow_status"]
        rs = (body.get("run") or {}).get("status")
        print(f"  workflow={wf}  run={rs}")
        if wf in _TERMINAL_WF:
            return body
        if not wait_workflow and rs in _TERMINAL_RUN:
            return body
        time.sleep(6)
    return None


def main() -> int:
    _load_dotenv()
    missing = [k for k in ("DEEPSEEK_API_KEY", "OPENAI_API_KEY") if not os.environ.get(k)]
    if missing:
        print(
            f"[review-gate] skipping — missing {missing} in .env/env "
            "(needs DEEPSEEK_API_KEY for the agent + OPENAI_API_KEY for the distiller/embeds). "
            "Not a failure."
        )
        return 0

    from fastapi.testclient import TestClient
    from sqlalchemy import select, update

    from tvashtr.control_plane import memory_distill
    from tvashtr.db import session_scope
    from tvashtr.main import app
    from tvashtr.models import NodeMemory, User

    print("[review-gate] LOCAL sandbox | agent=deepseek/deepseek-chat | remember=ON | review S4")
    tmp = tempfile.mkdtemp(prefix="review-gate-")
    failed = False
    try:
        repo = _make_fixture(tmp)
        repo_key = str(repo)
        base_branch = _git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()

        with TestClient(app) as client:
            email = f"review-gate-{uuid.uuid4().hex}@tvashtr.local"
            reg = client.post(
                "/api/auth/register", json={"email": email, "password": "review-pw-123456"}
            )
            reg.raise_for_status()
            owner_id = uuid.UUID(reg.json()["id"])
            print(f"[review-gate] registered fresh account {email} (owner={owner_id})")
            for provider, env_name in (
                ("deepseek", "DEEPSEEK_API_KEY"),
                ("openai", "OPENAI_API_KEY"),
            ):
                r = client.post(
                    "/api/providers", json={"provider": provider, "api_key": os.environ[env_name]}
                )
                print(f"[review-gate] seeded '{provider}' (HTTP {r.status_code})")

            # ---- (a) AGENT-REMEMBER: a real Engineer writes
            # TVASHTR_REMEMBER.jsonl -> active/repo.
            print("\n=== (a) agent-remember (review mode OFF) ===")
            tm = client.post("/api/teams", json={"template": "review_loop", "name": "review-gate"})
            tm.raise_for_status()
            team_graph_id = tm.json()["team_graph_id"]
            run = client.post(
                "/api/runs",
                json={
                    "team_graph_id": team_graph_id,
                    "idea": _IDEA,
                    "repo_path": repo_key,
                    "base_ref": base_branch,
                },
            )
            run.raise_for_status()
            run_a = run.json()["run_id"]
            print(
                f"[review-gate] (a) run_id={run_a}; polling to "
                "WORKFLOW terminal (needs the ingest)…"
            )
            if _poll(client, run_a, wait_workflow=True) is None:
                print("  [FAIL] (a) run did not finish in time")
                return 1
            with session_scope() as session:
                remembered = (
                    session.execute(
                        select(NodeMemory).where(
                            NodeMemory.owner_id == owner_id,
                            NodeMemory.content.like(f"%{_REMEMBER_TOKEN}%"),
                        )
                    )
                    .scalars()
                    .all()
                )
            print(f"  DB: {len(remembered)} row(s) matching the remember sentinel:")
            for m in remembered:
                print(
                    f"    - [{m.status}/{m.polarity}] repo_key={m.repo_key} "
                    f"node_id={m.node_id} :: {m.content[:80]}"
                )
            a_ok = any(m.status == "active" and m.repo_key == repo_key for m in remembered)
            print(
                f"  (a) {'PASS' if a_ok else 'FAIL'} — agent-remember landed "
                "active/repo via the FALLBACK channel"
            )
            failed = failed or not a_ok

            # ---- (b) REVIEW MODE ON: a distilled fact lands pending_review.
            print("\n=== (b) review mode ON -> distilled fact pending_review ===")
            with session_scope() as session:
                session.execute(
                    update(User).where(User.id == owner_id).values(memory_review_mode=True)
                )
            print("  set owner.memory_review_mode = True")
            run = client.post("/api/runs", json={"team_shape": "review_loop"})
            run.raise_for_status()
            run_b = run.json()["run_id"]
            print(
                f"[review-gate] (b) run_id={run_b}; polling to "
                "WORKFLOW terminal (needs the distill)…"
            )
            if _poll(client, run_b, wait_workflow=True) is None:
                print("  [FAIL] (b) run did not finish in time")
                return 1
            mems_b = client.get(f"/api/runs/{run_b}/memories").json()["memories"]
            print(f"  DB: {len(mems_b)} taught fact(s):")
            for m in mems_b:
                print(f"    - [{m['status']}/{m['polarity']}/{m['tier']}] {m['content'][:80]}")
            b_ok = any(m["status"] == "pending_review" for m in mems_b)
            print(
                f"  (b) {'PASS' if b_ok else 'FAIL'} — a distilled fact was "
                "quarantined pending_review under review mode"
            )
            failed = failed or not b_ok

            # ---- (c) PROMOTE (incl. the contradicting-supersede case), REAL endpoints + embeds.
            print("\n=== (c) promote -> active (+ contradiction retires the old active fact) ===")
            crepo = f"/repo/review-gate-c-{uuid.uuid4().hex[:6]}"
            active = client.post(
                "/api/memories",
                json={
                    "content": "GATE-C: avoid the legacy pricing path",
                    "repo_key": crepo,
                    "polarity": "avoid",
                },
            ).json()
            pend = client.post(
                "/api/memories",
                json={
                    "content": "GATE-C: prefer the legacy pricing path",
                    "repo_key": crepo,
                    "polarity": "prefer",
                },
            ).json()
            with (
                session_scope() as session
            ):  # quarantine the contradicting fact so promote resurrects it
                session.execute(
                    update(NodeMemory)
                    .where(NodeMemory.id == uuid.UUID(pend["id"]))
                    .values(status="pending_review")
                )
            promoted = client.post(f"/api/memories/{pend['id']}/promote")
            print(f"  promote HTTP {promoted.status_code} -> {promoted.json()}")
            with session_scope() as session:
                a_row = session.get(NodeMemory, uuid.UUID(active["id"]))
                p_row = session.get(NodeMemory, uuid.UUID(pend["id"]))
            print(
                f"  DB: promoted(prefer)={p_row.status}  "
                f"contradicted(avoid)={a_row.status} superseded_by={a_row.superseded_by}"
            )
            c_ok = (
                promoted.status_code == 200
                and p_row.status == "active"
                and a_row.status == "superseded"
                and str(a_row.superseded_by) == pend["id"]
            )
            print(
                f"  (c) {'PASS' if c_ok else 'FAIL'} — promote consolidated: "
                "activated the fact + retired the contradicted active one"
            )
            failed = failed or not c_ok

            # ---- (d) REJECT -> tombstone, and a re-proposal of the SAME fact is DROPPED.
            print("\n=== (d) reject -> tombstone + re-proposal suppressed ===")
            drepo = f"/repo/review-gate-d-{uuid.uuid4().hex[:6]}"
            fact = client.post(
                "/api/memories",
                json={
                    "content": "GATE-D: avoid the deprecated retry loop",
                    "repo_key": drepo,
                    "polarity": "avoid",
                },
            ).json()
            rej = client.post(f"/api/memories/{fact['id']}/reject")
            print(f"  reject HTTP {rej.status_code} -> status={rej.json().get('status')}")
            # Re-propose the SAME same-sign fact through the shared Consolidate
            # (real embed) — must drop.
            re_run = str(uuid.uuid4())
            written = memory_distill.remember_facts(
                re_run,
                [{"content": "GATE-D: avoid the deprecated retry loop", "polarity": "avoid"}],
                owner_id=owner_id,
                repo_key=drepo,
                review_mode=False,
                owner_key=os.environ["OPENAI_API_KEY"],
                embed_model="openai/text-embedding-3-small",
            )
            with session_scope() as session:
                d_row = session.get(NodeMemory, uuid.UUID(fact["id"]))
                active_on_drepo = (
                    session.execute(
                        select(NodeMemory).where(
                            NodeMemory.repo_key == drepo, NodeMemory.status == "active"
                        )
                    )
                    .scalars()
                    .all()
                )
            print(
                f"  DB: rejected fact status={d_row.status} "
                f"invalid_at={'set' if d_row.invalid_at else 'null'}; "
                f"re-proposal wrote {len(written)} "
                f"row(s); active on scope={len(active_on_drepo)}"
            )
            d_ok = (
                rej.status_code == 200
                and d_row.status == "rejected"
                and d_row.invalid_at is not None
                and written == []
                and len(active_on_drepo) == 0
            )
            print(
                f"  (d) {'PASS' if d_ok else 'FAIL'} — reject tombstoned the fact "
                "and suppressed the re-proposal"
            )
            failed = failed or not d_ok

        print("\n================================================================")
        if failed:
            print("M-MEMORY S4 WRITE-CONTROL GATE FAILED")
            return 1
        print(
            "ALL M-MEMORY S4 WRITE-CONTROL GATE ASSERTIONS PASSED\n"
            "  (a) agent-remember -> active/repo via the FALLBACK "
            "(TVASHTR_REMEMBER.jsonl) channel\n"
            "  (b) review mode ON -> a distilled fact quarantined pending_review\n"
            "  (c) promote -> active + the contradicted active fact retired (superseded)\n"
            "  (d) reject -> tombstone + re-proposal of the same fact suppressed\n"
            "CHANNEL USED: FALLBACK (workspace file TVASHTR_REMEMBER.jsonl)"
        )
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
