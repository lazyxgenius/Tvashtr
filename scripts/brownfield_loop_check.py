#!/usr/bin/env python
"""Opt-in *live* brownfield REVIEW-LOOP run (M-brownfield Slice 3): the exit-bar proof.

Drives a real docker+NIM ``review_loop`` team (PM → prd_gate → Engineer ⇄ Reviewer → ship) against a
**rung-1, real-shaped** repo the driver builds, and asserts the M-brownfield exit-bar contract ON
DISK: a composed team ships a **correct, reviewer-APPROVED** change into the user's real repo, on an
isolated branch, with the user's tree untouched.

**Rung-1 repo (built by this driver) — a tiny but genuinely real-shaped Python package** (materially
harder than the Slice-1 calculator):
  * a real package ``shop/`` (``__init__.py`` + two INTERDEPENDENT modules: ``pricing`` imports
    ``discounts``);
  * a ``pyproject.toml`` + an ``AGENTS.md`` conventions file;
  * an EXISTING test suite as ``unittest.TestCase`` subclasses (discoverable by BOTH ``pytest`` and
    the ``python -B -m unittest`` fallback) that **covers ``discounts`` — the module the feature
    edits — so a botched edit actually FAILS the Reviewer's gate (the review is real, not theatre).

**The scoped feature (a modification to an EXISTING module):** add
``bulk_discount(price, quantity)`` to ``shop/discounts.py`` — 10% off when ``quantity >= 10``, else
the price unchanged. Small + clearly pointing at one module (so the proven NIM 70b can locate it
from the idea + the grounding's structure outline), verifiable by the existing tests staying green +
the new behavior working.

Modeled on ``brownfield_check.py`` (repo mount + on-disk contract + cleanup + clean-skip without
``NVIDIA_BUILD_API_KEY``) ⊕ ``loop_run.py``'s feature mode (review_loop launch + verdict harvest).
Run via ``make brownfield-loop-check``. Skips cleanly (exit 0) without the key.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_BROWNFIELD_LOOP_TIMEOUT_S", "1800"))
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
_TERMINAL_RUN = {"completed", "failed", "over_budget", "rejected"}

# The run's worktree lands here (backend/.tvashtr_workspaces/<run_id>).
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / "backend" / ".tvashtr_workspaces"

# The scoped feature — clearly points at ONE existing module (shop/discounts.py).
_IDEA = (
    "Add a function `bulk_discount(price, quantity)` to the shop/discounts.py module. It returns "
    "`price` reduced by 10 percent when `quantity` is 10 or more, and returns `price` unchanged "
    "otherwise. Round money to 2 decimals like the other functions in that module. Keep the "
    "existing functions and the existing tests passing."
)

# ---- the rung-1 fixture files (a real-shaped `shop` package) -------------------------------------
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
        "        # 2*100 + 1*50 = 250; 5% off = 237.5\n"
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


def _reviewer_outcomes(client, run_id: str) -> list[str]:
    """The reviewer node's per-round outcomes from the run graph (ascending by iteration)."""
    body = client.get(f"/api/runs/{run_id}/graph").json()
    for node in body.get("nodes", []):
        if node.get("role_name") == "reviewer":
            return [inv.get("outcome") for inv in node.get("invocations", [])]
    return []


def main() -> int:
    if not os.environ.get("NVIDIA_BUILD_API_KEY"):
        print(
            "[brownfield-loop-check] NVIDIA_BUILD_API_KEY not set — skipping live run.\n"
            "              Set it in .env to drive a real docker+NIM review_loop. (Not a failure.)"
        )
        return 0

    from fastapi.testclient import TestClient

    from tvashtr.main import app

    tmp = tempfile.mkdtemp(prefix="tvashtr-brownfield-loop-")
    verify_dir = Path(tmp) / "verify"
    workspace: Path | None = None
    repo: Path | None = None
    branch = ""
    try:
        repo = _make_fixture(tmp)
        original_head = _git(repo, "rev-parse", "HEAD").stdout.strip()
        current_branch = _git(repo, "symbolic-ref", "--short", "HEAD").stdout.strip()
        print(f"[brownfield-loop-check] rung-1 shop repo at {repo} on '{current_branch}'")

        with TestClient(app) as client:
            insp = client.post("/api/repo/inspect", json={"path": str(repo)})
            assert insp.status_code == 200, insp.text
            info = insp.json()
            print(f"[brownfield-loop-check] inspect -> {info}")
            assert info["is_git"] is True, info
            assert info["current_branch"] == current_branch, info
            assert info["tracked_file_count"] >= 6, info  # the real-shaped package

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
            print(f"[brownfield-loop-check] started review_loop run_id={run_id} -> branch {branch}")
            print("[brownfield-loop-check] polling (PM, Engineer ⇄ Reviewer, real docker+NIM)…")

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
            reviewer_outcomes = _reviewer_outcomes(client, run_id)

        # ---- the exit-bar contract ON DISK ----
        branches = _git(repo, "branch", "--format=%(refname:short)").stdout.split()
        tip_disc = _git(repo, "show", f"{branch}:shop/discounts.py", check=False).stdout

        # tests GREEN on a DETACHED checkout of the branch tip (pytest finds the unittest tests).
        _git(repo, "worktree", "add", "--detach", str(verify_dir), branch, check=False)
        pytest_proc = subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            cwd=str(verify_dir),
            capture_output=True,
            text=True,
        )
        # the new behavior WORKS (import + call on the checkout) — robust to float rounding.
        behav = subprocess.run(
            [
                sys.executable,
                "-c",
                "from shop.discounts import bulk_discount as b; "
                "assert abs(b(100.0, 10) - 90.0) < 0.01, b(100.0, 10); "
                "assert abs(b(100.0, 5) - 100.0) < 0.01, b(100.0, 5); "
                "print('behavior OK')",
            ],
            cwd=str(verify_dir),
            capture_output=True,
            text=True,
        )
        main_head_after = _git(repo, "rev-parse", current_branch).stdout.strip()

        completed = run.get("status") == "completed"
        branch_exists = branch in branches
        has_feature = "def bulk_discount" in tip_disc
        pytest_green = pytest_proc.returncode == 0
        behavior_ok = behav.returncode == 0
        head_unchanged = main_head_after == original_head
        on_base_branch = (
            _git(repo, "symbolic-ref", "--short", "HEAD").stdout.strip() == current_branch
        )
        row_ok = (
            run.get("repo_path") == str(repo)
            and run.get("base_ref") == current_branch
            and run.get("ship_branch") == branch
        )
        # A REVIEWER-APPROVED ship (not an escalation-gate auto-approve of an unreviewed build): the
        # reviewer's FINAL per-round outcome is "approved".
        reviewer_approved = bool(reviewer_outcomes) and reviewer_outcomes[-1] == "approved"

        print("\n================= BROWNFIELD REVIEW-LOOP RESULT =================")
        print(f"run_id            = {run_id}")
        print(f"run.status        = {run.get('status')}")
        print(f"ship_branch       = {run.get('ship_branch')}")
        print(f"reviewer outcomes = {reviewer_outcomes}")
        print(f"feature present   = {has_feature}")
        print(f"pytest on branch  = exit {pytest_proc.returncode}")
        print((pytest_proc.stdout or pytest_proc.stderr or "")[-500:])
        print(f"behavior check    = exit {behav.returncode} {behav.stdout.strip()}")
        print(f"orig HEAD         = {original_head[:10]}  HEAD now = {main_head_after[:10]}")
        print("\nchecks:")
        print(f"  run completed                  : {completed}")
        print(f"  branch {branch} exists         : {branch_exists}")
        print(f"  shop/discounts.py has feature  : {has_feature}")
        print(f"  feature behaves correctly      : {behavior_ok}")
        print(f"  repo tests GREEN on branch     : {pytest_green}")
        print(f"  original HEAD unchanged    : {head_unchanged} (on base: {on_base_branch})")
        print(f"  Run row repo/base/ship set     : {row_ok}")
        print(f"  REVIEWER-approved ship         : {reviewer_approved} (final outcome)")
        ok = (
            completed
            and branch_exists
            and has_feature
            and behavior_ok
            and pytest_green
            and head_unchanged
            and on_base_branch
            and row_ok
            and reviewer_approved
        )
        print("================================================================")
        print(f"[brownfield-loop-check] {'PASS' if ok else 'FAIL'}")
        return 0 if ok else 1
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
