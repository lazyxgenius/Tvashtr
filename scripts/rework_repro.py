#!/usr/bin/env python
"""Opt-in *live* Item-B repro (M-brownfield Slice 4): does the engineer's REWORK round drop work?

Runs a real docker+NIM brownfield ``review_loop`` with ``TVASHTR_FORCE_REVISIONS=1`` — which forces
the reviewer to return ``changes_requested`` on round 1 then ``approved`` on round 2, short-
circuiting before the adapter (``_forced_review_outcome``). So the ONLY thing running the real
docker+NIM adapter on the rework round is the ENGINEER. This isolates Item B: now that Item A stops
the reviewer-clobber, does the engineer ITSELF, on a rework, preserve its prior edit (revise-in-
place) or regenerate from scratch and forget it?

Flow (forced):
  PM → prd_gate → Engineer(round 1: real NIM, adds bulk_discount) → Reviewer(forced
  changes_requested, no adapter) → Engineer(round 2 REWORK: real NIM, sees the revision block)
  → Reviewer(forced approved) → ship.

The shipped branch tip therefore IS the post-rework engineer output. We log the pre-state (the base
``discounts.py`` has NO ``bulk_discount``) and the post-rework state (the shipped tip), and decide:
  * feature present + behaves + tests green on the shipped tip  → PRESERVED  (Item B UNNEEDED)
  * feature absent / broken on the shipped tip                  → DROPPED    (implement Item B)

Reuses the ``brownfield_loop_check`` rung-1 ``shop`` fixture. Skips cleanly (exit 0) without
``NVIDIA_BUILD_API_KEY``. A NIM throttle / "stuck" is a retry on a clean roll, NOT a failure.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# Force exactly ONE reviewer changes_requested -> one engineer rework. Set BEFORE the app/config is
# imported (config caches the env) so the run drives the forced harness. The forced reviewer
# short-circuits before the adapter, so only the engineer runs the real docker+NIM adapter.
os.environ["TVASHTR_FORCE_REVISIONS"] = "1"

POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_REWORK_REPRO_TIMEOUT_S", "1800"))
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
_TERMINAL_RUN = {"completed", "failed", "over_budget", "rejected"}

_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / "backend" / ".tvashtr_workspaces"

_IDEA = (
    "Add a function `bulk_discount(price, quantity)` to the shop/discounts.py module. It returns "
    "`price` reduced by 10 percent when `quantity` is 10 or more, and returns `price` unchanged "
    "otherwise. Round money to 2 decimals like the other functions in that module. Keep the "
    "existing functions and the existing tests passing."
)

# The rung-1 `shop` fixture (identical to brownfield_loop_check.py).
_FILES = {
    "shop/__init__.py": '"""A tiny shop pricing package."""\n',
    "shop/discounts.py": (
        '"""Discount rules for the shop (pure money math; round to 2 decimals)."""\n\n\n'
        "def percentage_off(price, pct):\n"
        '    """Return ``price`` reduced by ``pct`` percent, rounded to 2 decimals."""\n'
        "    return round(price * (1 - pct / 100.0), 2)\n"
    ),
    "shop/pricing.py": (
        '"""Cart pricing — composes the rules in :mod:`shop.discounts`."""\n\n'
        "from shop.discounts import percentage_off\n\n\n"
        "def cart_total(items):\n"
        '    """Sum ``items`` (each a ``(price, qty)`` pair); apply 5% loyalty discount."""\n'
        "    subtotal = sum(price * qty for price, qty in items)\n"
        "    return percentage_off(subtotal, 5)\n"
    ),
    "test_discounts.py": (
        "import unittest\n\n"
        "from shop.discounts import percentage_off\n\n\n"
        "class TestDiscounts(unittest.TestCase):\n"
        "    def test_percentage_off(self):\n"
        "        self.assertEqual(percentage_off(100.0, 10), 90.0)\n"
        "        self.assertEqual(percentage_off(50.0, 0), 50.0)\n"
    ),
    "test_pricing.py": (
        "import unittest\n\n"
        "from shop.pricing import cart_total\n\n\n"
        "class TestPricing(unittest.TestCase):\n"
        "    def test_cart_total_applies_loyalty(self):\n"
        "        self.assertEqual(cart_total([(100.0, 2), (50.0, 1)]), 237.5)\n"
    ),
    "pyproject.toml": '[project]\nname = "shop"\nversion = "0.1.0"\n',
    "AGENTS.md": (
        "# Conventions\n\n"
        "- Keep functions small and pure; no side effects.\n"
        "- Money is rounded to 2 decimals (see `shop/discounts.py`).\n"
        "- Every new function in `shop/` gets a matching `unittest.TestCase` test.\n"
    ),
}


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


def _node_invocations(client, run_id: str, role: str) -> list[dict]:
    body = client.get(f"/api/runs/{run_id}/graph").json()
    for node in body.get("nodes", []):
        if node.get("role_name") == role:
            return node.get("invocations", [])
    return []


def main() -> int:
    if not os.environ.get("NVIDIA_BUILD_API_KEY"):
        print("[rework-repro] NVIDIA_BUILD_API_KEY not set — skipping live run. (Not a failure.)")
        return 0

    from fastapi.testclient import TestClient

    from tvashtr.main import app

    tmp = tempfile.mkdtemp(prefix="tvashtr-rework-repro-")
    verify_dir = Path(tmp) / "verify"
    workspace: Path | None = None
    repo: Path | None = None
    branch = ""
    try:
        repo = _make_fixture(tmp)
        original_head = _git(repo, "rev-parse", "HEAD").stdout.strip()
        current_branch = _git(repo, "symbolic-ref", "--short", "HEAD").stdout.strip()
        pre_disc = (repo / "shop" / "discounts.py").read_text(encoding="utf-8")
        print(f"[rework-repro] FORCE_REVISIONS=1; rung-1 shop repo at {repo} on '{current_branch}'")
        print(
            "[rework-repro] PRE-REWORK base shop/discounts.py has bulk_discount: "
            f"{'def bulk_discount' in pre_disc}"
        )

        with TestClient(app) as client:
            resp = client.post(
                "/api/runs",
                json={
                    "team_shape": "review_loop",
                    "idea": _IDEA,
                    "repo_path": str(repo),
                    "base_ref": current_branch,
                },
            )
            assert resp.status_code == 200, resp.text
            run_id = resp.json()["run_id"]
            workspace = _WORKSPACE_ROOT / run_id
            branch = f"tvashtr/{run_id}"
            print(f"[rework-repro] started review_loop run_id={run_id} -> branch {branch}")
            print("[rework-repro] polling (Engineer builds, forced rework, real docker+NIM)…")

            final = None
            deadline = time.time() + POLL_TIMEOUT_S
            while time.time() < deadline:
                body = client.get(f"/api/runs/{run_id}").json()
                wf = body["workflow_status"]
                run_status = (body.get("run") or {}).get("status")
                print(f"  workflow={wf}  run={run_status}")
                if wf in _TERMINAL_WF or run_status in _TERMINAL_RUN:
                    final = body
                    break
                time.sleep(8)
            assert final is not None, f"run did not finish within {POLL_TIMEOUT_S}s"
            run = final.get("run") or {}
            eng_invs = _node_invocations(client, run_id, "engineer")
            rev_invs = _node_invocations(client, run_id, "reviewer")

        # The shipped tip IS the post-rework engineer output (reviewer never ran the adapter).
        post_disc = _git(repo, "show", f"{branch}:shop/discounts.py", check=False).stdout
        _git(repo, "worktree", "add", "--detach", str(verify_dir), branch, check=False)
        pytest_proc = subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            cwd=str(verify_dir),
            capture_output=True,
            text=True,
        )
        behav = subprocess.run(
            [
                sys.executable,
                "-c",
                "from shop.discounts import bulk_discount as b; "
                "assert abs(b(100.0, 10) - 90.0) < 0.01, b(100.0, 10); "
                "assert abs(b(100.0, 5) - 100.0) < 0.01, b(100.0, 5); print('behavior OK')",
            ],
            cwd=str(verify_dir),
            capture_output=True,
            text=True,
        )

        engineer_rounds = len(eng_invs)
        reviewer_outcomes = [i.get("outcome") for i in rev_invs]
        a_rework_happened = engineer_rounds >= 2 and "changes_requested" in reviewer_outcomes
        has_feature = "def bulk_discount" in post_disc
        behavior_ok = behav.returncode == 0
        pytest_green = pytest_proc.returncode == 0
        head_unchanged = _git(repo, "rev-parse", current_branch).stdout.strip() == original_head
        preserved = has_feature and behavior_ok and pytest_green

        print("\n================= ITEM-B REWORK REPRO RESULT =================")
        print(f"run_id              = {run_id}")
        print(f"run.status          = {run.get('status')}")
        print(f"engineer rounds     = {engineer_rounds} (>=2 means a rework round ran)")
        print(f"reviewer outcomes   = {reviewer_outcomes}")
        print(f"a rework happened   = {a_rework_happened}")
        print(f"POST-rework feature = {has_feature} (def bulk_discount on shipped tip)")
        print(f"behavior check      = exit {behav.returncode} {behav.stdout.strip()}")
        print(f"pytest on branch    = exit {pytest_proc.returncode}")
        print((pytest_proc.stdout or pytest_proc.stderr or "")[-400:])
        print(f"HEAD unchanged      = {head_unchanged}")
        verdict = "PRESERVED" if preserved else "DROPPED"
        detail = (
            "revise-in-place reliable; Item B UNNEEDED"
            if preserved
            else "rework dropped/broke the edit; implement Item B"
        )
        print(f"\nITEM-B REPRO: {verdict} ({detail})")
        print("=============================================================")
        # Exit 0 on a clean observation (PRESERVED or DROPPED is informative); non-zero only if the
        # run never produced a reworked ship to observe (throttle/stuck -> retry on a clean roll).
        observed = a_rework_happened and run.get("status") in _TERMINAL_RUN
        return 0 if observed else 2
    finally:
        if repo is not None:
            _git(repo, "worktree", "remove", "--force", str(verify_dir), check=False)
            if workspace is not None:
                _git(repo, "worktree", "remove", "--force", str(workspace), check=False)
        shutil.rmtree(tmp, ignore_errors=True)
        if workspace is not None:
            shutil.rmtree(workspace, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
