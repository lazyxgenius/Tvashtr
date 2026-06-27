#!/usr/bin/env python
"""Opt-in *live* brownfield run (M-brownfield Slice 1): the real-repo proof, end to end.

Creates a throwaway fixture git repo (``calculator.py`` with ``add`` + a passing
``test_calculator.py``), inspects it via ``POST /api/repo/inspect``, launches a ``two_node`` run
against it (the docker sandbox + the proven NIM agent) with ``repo_path``/``base_ref``, polls to
terminal, then asserts the whole brownfield contract ON DISK:

  (a) a real branch ``tvashtr/<run_id>`` exists in the fixture repo;
  (b) its tip's ``calculator.py`` gained ``subtract``;
  (c) checking out that branch and running the fixture's OWN ``pytest`` is GREEN (correctness + no
      regression of ``add``);
  (d) the fixture's ORIGINAL branch HEAD is UNCHANGED (the user's working tree was never touched);
  (e) the ``Run`` row carries ``repo_path`` / ``base_ref`` / ``ship_branch``.

``two_node`` (PM → prd_gate → Engineer → ship) keeps the gate fast/robust for the hands-off loop;
a review_loop brownfield run (the Reviewer gating the real diff) is the SAME machinery on this mount
as greenfield M1 — a manual follow-up, NOT this automated gate. The agent model is the proven
``nvidia_nim/meta/llama-3.3-70b-instruct`` (from ``.env``); gates auto-approve
(``TVASHTR_AUTO_APPROVE_GATES=1``). Skips cleanly without ``NVIDIA_BUILD_API_KEY``. Cleans up the
temp fixture + the run's worktree in a ``finally``. Run via ``make brownfield-check``.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_BROWNFIELD_TIMEOUT_S", "900"))
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
_TERMINAL_RUN = {"completed", "failed", "over_budget", "rejected"}

_CALCULATOR = "def add(a, b):\n    return a + b\n"
_TEST = "from calculator import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n"
# The run's workspace root (backend/.tvashtr_workspaces) — where the run's worktree is created.
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / "backend" / ".tvashtr_workspaces"


def _git(repo, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=check, capture_output=True, text=True
    )


def _make_fixture(root: str) -> Path:
    repo = Path(root) / "fixture_repo"
    repo.mkdir(parents=True)
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "fixture@tvashtr.local")
    _git(repo, "config", "user.name", "Fixture User")
    (repo / "calculator.py").write_text(_CALCULATOR, encoding="utf-8")
    (repo / "test_calculator.py").write_text(_TEST, encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "init calculator")
    return repo


def main() -> int:
    if not os.environ.get("NVIDIA_BUILD_API_KEY"):
        print(
            "[brownfield-check] NVIDIA_BUILD_API_KEY not set — skipping live run.\n"
            "              Set it in .env to drive a real docker+NIM run. (Not a failure.)"
        )
        return 0

    from fastapi.testclient import TestClient

    from tvashtr.main import app

    tmp = tempfile.mkdtemp(prefix="tvashtr-brownfield-")
    verify_dir = Path(tmp) / "verify"
    workspace: Path | None = None
    repo: Path | None = None
    branch = ""
    try:
        repo = _make_fixture(tmp)
        original_head = _git(repo, "rev-parse", "HEAD").stdout.strip()
        current_branch = _git(repo, "symbolic-ref", "--short", "HEAD").stdout.strip()
        print(
            f"[brownfield-check] fixture at {repo} on '{current_branch}' HEAD={original_head[:10]}"
        )

        with TestClient(app) as client:
            # 1. Inspect the fixture (the discriminated read the Slice-2 UI will use).
            insp = client.post("/api/repo/inspect", json={"path": str(repo)})
            assert insp.status_code == 200, insp.text
            info = insp.json()
            print(f"[brownfield-check] inspect -> {info}")
            assert info["is_git"] is True, info
            assert info["current_branch"] == current_branch, info
            assert info["tracked_file_count"] >= 2, info

            # 2. Launch the brownfield run (two_node, docker sandbox via the Make target's env).
            resp = client.post(
                "/api/runs",
                json={
                    "idea": (
                        "Add a subtract(a, b) function to calculator.py and a unit test for it."
                    ),
                    "team_shape": "two_node",
                    "repo_path": str(repo),
                    "base_ref": current_branch,
                },
            )
            assert resp.status_code == 200, resp.text
            run_id = resp.json()["run_id"]
            workspace = _WORKSPACE_ROOT / run_id
            branch = f"tvashtr/{run_id}"
            print(f"[brownfield-check] started run_id={run_id} -> expecting branch {branch}")
            print("[brownfield-check] polling (PM completion, then a live docker+NIM agent build)…")

            # 3. Poll to terminal.
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
                time.sleep(5)
            assert final is not None, f"run did not finish within {POLL_TIMEOUT_S}s"
            run = final.get("run") or {}

        # 4. Assert the brownfield contract ON DISK.
        branches = _git(repo, "branch", "--format=%(refname:short)").stdout.split()
        tip_calc = _git(repo, "show", f"{branch}:calculator.py", check=False).stdout
        # (c) the fixture's own pytest, on a DETACHED checkout of the branch tip (a detached
        # worktree avoids colliding with the run's own checkout of the same branch).
        _git(repo, "worktree", "add", "--detach", str(verify_dir), branch, check=False)
        pytest_proc = subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            cwd=str(verify_dir),
            capture_output=True,
            text=True,
        )
        main_head_after = _git(repo, "rev-parse", current_branch).stdout.strip()

        completed = run.get("status") == "completed"
        branch_exists = branch in branches
        has_subtract = "def subtract" in tip_calc
        pytest_green = pytest_proc.returncode == 0
        head_unchanged = main_head_after == original_head
        row_ok = (
            run.get("repo_path") == str(repo)
            and run.get("base_ref") == current_branch
            and run.get("ship_branch") == branch
        )

        print("\n================= BROWNFIELD RUN RESULT =================")
        print(f"run_id           = {run_id}")
        print(f"run.status       = {run.get('status')}")
        print(f"ship_branch      = {run.get('ship_branch')}")
        print(f"repo_path        = {run.get('repo_path')}")
        print(f"base_ref         = {run.get('base_ref')}")
        print(f"branches in repo = {branches}")
        print(f"subtract present = {has_subtract}")
        print(f"fixture pytest   = exit {pytest_proc.returncode}")
        print((pytest_proc.stdout or pytest_proc.stderr or "")[-600:])
        print(f"orig HEAD        = {original_head[:10]}  HEAD now = {main_head_after[:10]}")
        print("\nchecks:")
        print(f"  run completed                  : {completed}")
        print(f"  branch {branch} exists         : {branch_exists}")
        print(f"  calculator.py gained subtract  : {has_subtract}")
        print(f"  fixture pytest GREEN on branch  : {pytest_green}")
        print(f"  original HEAD unchanged        : {head_unchanged}")
        print(f"  Run row repo/base/ship set     : {row_ok}")
        ok = (
            completed
            and branch_exists
            and has_subtract
            and pytest_green
            and head_unchanged
            and row_ok
        )
        print("========================================================")
        print(f"[brownfield-check] {'PASS' if ok else 'FAIL'}")
        return 0 if ok else 1
    finally:
        # Best-effort cleanup BEFORE the temp fixture is removed (worktrees reference it).
        if repo is not None:
            _git(repo, "worktree", "remove", "--force", str(verify_dir), check=False)
            if workspace is not None:
                _git(repo, "worktree", "remove", "--force", str(workspace), check=False)
        shutil.rmtree(tmp, ignore_errors=True)
        if workspace is not None:
            shutil.rmtree(workspace, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
