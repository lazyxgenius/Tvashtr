#!/usr/bin/env python
"""Opt-in *live* memory-injection gate (M-memory S3 — acceptance #3).

Drives a REAL LOCAL-sandbox ``deepseek`` ``review_loop`` on a rung-1 brownfield fixture repo, having
seeded the run owner's memories FIRST — a **pinned** account fact (HOT), a **repo** fact (COLD), and
a **node-tier** fact keyed to the review_loop's Engineer ORIGIN node — then asserts ON DISK that the
executed Engineer node's ``context_manifest`` carries a ``memory`` part listing the injected ids
(incl. pinned + node-tier), AND a cost row ``workflow_id == run_id`` exists for the query embed
(metered ON the run).

Node-tier works because the team is created FIRST (so we learn the Engineer's authored id), the
node-tier memory is keyed to it, and ``POST /api/runs {team_graph_id}`` clone-on-launches the team —
so the run's Engineer clone's ``cloned_from_node_id`` is that authored id, which is exactly what
``retrieve_memory_step`` scopes the node tier on.

Needs ``DEEPSEEK_API_KEY`` (the agent) + ``OPENAI_API_KEY`` (the embed) in ``.env``; skips cleanly
(exit 0) without them. Run via ``make memory-injection-check``. NOT in ``make test``; LOCAL, no
docker. The reviewer is forced-approved (``TVASHTR_FORCE_REVISIONS=0`` → it short-circuits, no LLM)
so only PM + Engineer make real calls; even a wrong build still persists the Engineer's manifest.
"""

import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

# LOCAL sandbox + auto-approve the PRD gate + forced reviewer-approve — set before app import.
os.environ.setdefault("TVASHTR_AGENT_SANDBOX", "local")
os.environ.setdefault("TVASHTR_AUTO_APPROVE_GATES", "1")
os.environ.setdefault("TVASHTR_FORCE_REVISIONS", "0")

POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_MEMORY_INJECTION_TIMEOUT_S", "900"))
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
_TERMINAL_RUN = {"completed", "failed", "over_budget", "rejected"}
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / "backend" / ".tvashtr_workspaces"

_IDEA = (
    "Add a function `bulk_discount(price, quantity)` to the shop/discounts.py module. It returns "
    "`price` reduced by 10 percent when `quantity` is 10 or more, and `price` unchanged otherwise. "
    "Round money to 2 decimals. Keep the existing functions and tests passing."
)

# Distinctive sentinels so the injected content is unmistakable in the manifest.
_PIN = "MEMSENTINEL-PIN: always keep the shop functions small and pure."
_REPO = "MEMSENTINEL-REPO: money is always rounded to 2 decimals in this repo."
_NODE = "MEMSENTINEL-NODE: this engineer adds a matching unittest for every new function."

# The rung-1 fixture (a real-shaped `shop` package) — same shape as brownfield_loop_check.
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


def main() -> int:
    _load_dotenv()
    missing = [k for k in ("DEEPSEEK_API_KEY", "OPENAI_API_KEY") if not os.environ.get(k)]
    if missing:
        print(
            f"[memory-injection-check] skipping — missing {missing} in .env/env "
            "(needs DEEPSEEK_API_KEY for the agent + OPENAI_API_KEY for the embed). Not a failure."
        )
        return 0

    from fastapi.testclient import TestClient
    from sqlalchemy import select

    from tvashtr.config import get_settings
    from tvashtr.db import session_scope
    from tvashtr.main import app
    from tvashtr.models import AgentInvocation, AgentNode, CostRecord, Run

    embedding_model = get_settings().embedding_model
    tmp = tempfile.mkdtemp(prefix="tvashtr-mem-inject-")
    workspace: Path | None = None
    repo: Path | None = None
    try:
        repo = _make_fixture(tmp)
        repo_key = str(repo)
        base_branch = _git(repo, "symbolic-ref", "--short", "HEAD").stdout.strip()
        print(f"[memory-injection-check] fixture shop repo at {repo} on '{base_branch}'")
        print(
            f"[memory-injection-check] embedding_model={embedding_model!r}, agent=deepseek (LOCAL)"
        )

        with TestClient(app) as client:
            email = f"mem-inject-{uuid.uuid4().hex}@tvashtr.local"
            reg = client.post("/api/auth/register", json={"email": email, "password": "pw-123456"})
            assert reg.status_code == 200, reg.text
            for provider, key in (
                ("deepseek", os.environ["DEEPSEEK_API_KEY"]),
                ("openai", os.environ["OPENAI_API_KEY"]),
            ):
                pr = client.post("/api/providers", json={"provider": provider, "api_key": key})
                assert pr.status_code == 200, pr.text

            # Create the review_loop team FIRST → learn the Engineer's authored (origin) node id.
            tm = client.post("/api/teams", json={"template": "review_loop", "name": "mem-inject"})
            assert tm.status_code == 200, tm.text
            team_graph_id = tm.json()["team_graph_id"]
            graph = client.get(f"/api/teams/{team_graph_id}/graph").json()
            engineer = next(n for n in graph["nodes"] if n.get("role_name") == "engineer")
            engineer_origin_id = engineer["id"]
            print(
                f"[memory-injection-check] review_loop team {team_graph_id}, engineer origin "
                f"{engineer_origin_id}"
            )

            # Seed the owner's memories: pinned account (HOT), repo-tier (COLD), node-tier (COLD).
            def _seed(payload) -> str:
                r = client.post("/api/memories", json=payload)
                assert r.status_code == 200, r.text
                return r.json()["id"]

            id_pin = _seed({"content": _PIN, "pinned": True, "polarity": "require"})
            id_repo = _seed({"content": _REPO, "repo_key": repo_key, "polarity": "prefer"})
            id_node = _seed(
                {
                    "content": _NODE,
                    "repo_key": repo_key,
                    "node_id": engineer_origin_id,
                    "polarity": "context",
                }
            )
            print(f"[mem-inject] seeded pin={id_pin} repo={id_repo} node={id_node}")

            # Launch on a CLONE of that team (so the run's engineer clone -> engineer_origin_id).
            run = client.post(
                "/api/runs",
                json={
                    "team_graph_id": team_graph_id,
                    "idea": _IDEA,
                    "repo_path": repo_key,
                    "base_ref": base_branch,
                },
            )
            assert run.status_code == 200, run.text
            run_id = run.json()["run_id"]
            workspace = _WORKSPACE_ROOT / run_id
            print(
                f"[memory-injection-check] started review_loop run_id={run_id}; polling (real "
                "deepseek PM+Engineer, forced-approve reviewer)…"
            )

            deadline = time.time() + POLL_TIMEOUT_S
            final = None
            while time.time() < deadline:
                body = client.get(f"/api/runs/{run_id}").json()
                wf = body["workflow_status"]
                rs = (body.get("run") or {}).get("status")
                print(f"  workflow={wf}  run={rs}")
                if wf in _TERMINAL_WF or rs in _TERMINAL_RUN:
                    final = body
                    break
                time.sleep(6)
            assert final is not None, f"run did not finish within {POLL_TIMEOUT_S}s"

        # ---- read the Engineer's invocation manifest(s) + the embed cost rows from the DB ----
        with session_scope() as session:
            run_row = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
            # The run's Engineer CLONE = the run-graph node whose origin is the authored one.
            engineer_clone_ids = list(
                session.execute(
                    select(AgentNode.id).where(
                        AgentNode.team_graph_id == run_row.team_graph_id,
                        AgentNode.cloned_from_node_id == uuid.UUID(engineer_origin_id),
                    )
                ).scalars()
            )
            eng_manifests = [
                m
                for m in session.execute(
                    select(AgentInvocation.context_manifest).where(
                        AgentInvocation.run_id == run_id,
                        AgentInvocation.node_id.in_(engineer_clone_ids),
                    )
                ).scalars()
                if m
            ]
            embed_cost_rows = list(
                session.execute(
                    select(CostRecord).where(
                        CostRecord.workflow_id == run_id,
                        CostRecord.model_requested == embedding_model,
                    )
                ).scalars()
            )

        eng_mem_manifests = [m for m in eng_manifests if "memory" in m]
        injected = {e["id"] for m in eng_mem_manifests for e in m["memory"]}
        has_memory_part = any(
            any(p["name"] == "memory" for p in m["parts"]) for m in eng_mem_manifests
        )
        pin_ok = id_pin in injected
        node_ok = id_node in injected
        repo_ok = id_repo in injected
        cost_ok = len(embed_cost_rows) > 0

        print("\n================= MEMORY-INJECTION RESULT =================")
        print(f"run_id                         = {run_id}")
        print(f"engineer clone ids             = {[str(i) for i in engineer_clone_ids]}")
        print(f"engineer manifests w/ memory   = {len(eng_mem_manifests)}")
        for m in eng_mem_manifests:
            print(f"  manifest.memory              = {m.get('memory')}")
            print(f"  manifest.parts names         = {[p['name'] for p in m['parts']]}")
        print(f"embed cost rows (wf=run_id)    = {len(embed_cost_rows)} (model={embedding_model})")
        print("\nchecks:")
        print(f"  engineer manifest has memory part   : {has_memory_part}")
        print(f"  pinned (HOT) id injected            : {pin_ok}  ({id_pin})")
        print(f"  node-tier id injected               : {node_ok}  ({id_node})")
        print(f"  repo-tier (COLD) id injected        : {repo_ok}  ({id_repo})")
        print(f"  on-run embed cost row present       : {cost_ok}")
        ok = has_memory_part and pin_ok and node_ok and repo_ok and cost_ok
        print("==========================================================")
        print(f"[memory-injection-check] {'PASS' if ok else 'FAIL'}")
        return 0 if ok else 1
    finally:
        if repo is not None and workspace is not None:
            _git(repo, "worktree", "remove", "--force", str(workspace), check=False)
        shutil.rmtree(tmp, ignore_errors=True)
        if workspace is not None:
            shutil.rmtree(workspace, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
