#!/usr/bin/env python
"""Opt-in *live* brownfield REVIEW-LOOP run on the REAL ``trade_mcp`` repo (M-brownfield rung 2).

Models ``scripts/brownfield_loop_check.py`` (the rung-1 driver) but raises the bar from a
driver-built fixture to the user's REAL ``trade_mcp`` technical-indicator repo: it git-clones the
real repo into a throwaway tempdir (the operator's repo is NEVER touched), runs the already-proven
docker+NIM ``review_loop`` (PM -> prd_gate -> Engineer <-> Reviewer -> ship) with the LOCKED DEMA
idea, then gates SUCCESS on an INDEPENDENT *numeric* correctness check THE DRIVER runs itself — NOT
the 70b Reviewer's approval (D4 confirmed a same-tier reviewer rubber-stamps tests-green).

Two valid outcomes (the brief §C), both COMPLETE results:
  * PASS    — the loop shipped a CORRECT DEMA: ``def dema`` present, and
              ``compute("dema", df, length=L)`` matches the reference ``2*EMA - EMA(EMA)``
              (``ewm(span=L, adjust=False)``) within ~1e-8 on a NON-CONSTANT series for >=2
              lengths, ``"dema"`` registered, the indicator suite GREEN on the branch (forcing
              the 28->29 count-test bump), clone HEAD/tree untouched.  -> exit 0.
  * FINDING — the harness is provably correct but the loop shipped a wrong/incomplete DEMA,
              could not run the repo's tests in the container (the dep/env story), or ERRORed
              on machinery. A complete rung-2 RESULT, not a bug to grind on (the harness still
              merges). -> exit 1.

The Reviewer's per-round outcome is RECORDED as an OBSERVATION (the D4 data point), never a gate.

CALIBRATION (evidence-bound, the brief's "do not assume shapes"): the brief's "existing suite green"
gate is scoped to ``tests/test_indicators.py`` rather than the whole ``pytest -q``. On a PRISTINE
clone the whole suite is already RED offline — ``servers/kline_cache/tests/`` fail collection with
``No module named 'fastapi'`` (``fastapi`` is NOT a declared ``trade_mcp`` dependency) and
``tests/test_engine_facts_pinning.py::test_kline_cache_constants`` fails for the same reason — all
PRE-EXISTING and unrelated to DEMA. ``tests/test_indicators.py`` is green at baseline (127 passed)
and carries the entire DEMA signal: the ``TestRegistry`` count tripwire (exactly-28 -> must become
29) plus every indicator's sanity/edge/registry test. The whole ``pytest -q`` is still RUN and
RECORDED as an OBSERVATION so the pre-existing condition is visible. (A whole-suite gate would
FINDING on every run regardless of DEMA correctness — a miscalibration.)

All ``tvashtr``/app imports are LAZY inside ``main()`` so the offline collector never imports this
(exactly like the rung-1 driver). Run via ``make brownfield-rung2``; skips cleanly (exit 0) without
``NVIDIA_BUILD_API_KEY`` or the repo.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# The rung-2 target repo (env-overridable; default the operator's real trade_mcp). Absent -> skip.
# Baking the default in keeps the committed target a no-op in CI / on other machines.
_REPO_PATH = os.environ.get("TVASHTR_RUNG2_REPO", "/Users/adimac/Desktop/trade_mcp")


# scoped-mount Slice 1: the optional sub-path the brownfield agent's context map + FOCUS scope to.
# Default ``core`` — the DEMA target package — so the Engineer's surface is core/'s handful of files
# (NOT the 264-file monorepo that overflowed the model at rung 2). The INDEPENDENT numeric gate is
# UNCHANGED: it runs host-side from a verify venv at the repo ROOT (installs .[dev], runs
# tests/test_indicators.py, computes DEMA), so scoping the AGENT does not affect the gate.
def _resolve_subpath(env=None) -> str:
    """The agent's mount sub-path, resolved from ``TVASHTR_RUNG2_SUBPATH``.

    UNSET -> ``core`` (the proven scoped default — must NOT change). Explicitly BLANK
    (``TVASHTR_RUNG2_SUBPATH=``) -> ``""`` -> whole-repo mount, mirroring the FE
    (``LaunchPanel.tsx``: ``if (scope) opts.subpath = scope`` omits an empty scope).
    """
    return (os.environ if env is None else env).get("TVASHTR_RUNG2_SUBPATH", "core")


_SUBPATH = _resolve_subpath()

# A real review loop on a real repo (container dep-install + possible rework rounds) is slow.
POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_RUNG2_TIMEOUT_S", "2400"))
# Exit the poll loop only on a TERMINAL DBOS *workflow* status (NOT the run's own status): a fast
# run sets ``runs.status="completed"`` while the same ``run_team`` workflow is still running
# distill/ingest/teardown — breaking on that tore DBOS down mid-workflow and left a PENDING
# ``run_team`` that wedged the next boot (mirrors ``docs_chain_check``'s teardown-race fix).
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}

# Each provider slug -> the ``.env`` var(s) whose key ``make seed`` imports for it (mirrors
# ``seed.ENV_PROVIDER_MAP`` and ``docs_chain_check._PROVIDER_ENV_KEYS``). The gate honors the
# CONFIGURED model and skips cleanly when that provider has no key — a no-op off-box.
_PROVIDER_ENV_KEYS: dict[str, tuple[str, ...]] = {
    "openrouter": ("OPENROUTER_API_KEY",),
    "openai": ("OPENAI_API_KEY",),
    "gemini": ("GEMINI_API_KEY",),
    "groq": ("GROQ_CLOUD_API_KEY", "GROQ_API_KEY"),
    "nvidia_nim": ("NVIDIA_BUILD_API_KEY", "NVIDIA_NIM_API_KEY"),
    "deepseek": ("DEEPSEEK_API_KEY",),
}
_DEFAULT_MODEL = "deepseek/deepseek-chat"

# The run's worktree lands here (backend/.tvashtr_workspaces/<run_id>).
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / "backend" / ".tvashtr_workspaces"

# Lengths the independent numeric check exercises (>=2 per the brief) + the tight tolerance.
_DEMA_LENGTHS = (10, 20)
_DEMA_ATOL = 1e-8

# The DEMA-signal-bearing test target, scoped per the CALIBRATION note above (proven green at
# baseline; carries the count tripwire + every indicator test). Relative to the branch checkout.
_GATE_PYTEST_TARGET = "tests/test_indicators.py"

# The LOCKED DEMA idea — VERBATIM from the brief §B (do NOT expand it with registry/test mechanics;
# the agent DISCOVERING the registry + the count tripwire IS the test).
_IDEA = (
    "Add a DEMA (Double Exponential Moving Average) indicator to the "
    "technical-indicator library in core/indicators.py. DEMA is the standard "
    "double-smoothed average: 2 * EMA(length) - EMA(EMA(length)), with a "
    "configurable `length` parameter. Make it work like the library's other "
    "indicators — the same calling convention, callable through the same compute "
    "path the others use — and add tests for it, following the conventions already "
    "in the codebase. Keep all the existing indicators and their tests passing."
)

# The INDEPENDENT numeric check runs in the host-side verify venv against the SHIPPED checkout.
# Emits ONE machine-readable line (``RUNG2_NUMERIC_JSON={...}``) the driver parses — defensive: any
# import/compute failure is captured into the JSON (never a crash), so a wrong DEMA is a clean
# FINDING with observed-vs-reference numbers. ``_LENGTHS`` / ``_ATOL`` are injected by the driver so
# the constants have a single source of truth.
_NUMERIC_BODY = """
import json

out = {"import_ok": False, "dema_in_registry": False, "registry_count": None,
       "lengths": {}, "error": None}
try:
    import numpy as np
    import pandas as pd
    from core.indicators import compute, list_indicators

    out["import_ok"] = True
    specs = list_indicators()
    names = {e.get("name") for e in specs}
    out["registry_count"] = len(specs)
    out["dema_in_registry"] = "dema" in names

    # A NON-CONSTANT close series (trend + noise, 200 bars). A CONSTANT series cannot distinguish
    # DEMA from a plain EMA, so it MUST vary (the whole point of the numeric gate).
    rng = np.random.default_rng(20240626)
    n = 200
    close = 100.0 + np.linspace(0.0, 25.0, n) + np.cumsum(rng.standard_normal(n) * 0.5)
    df = pd.DataFrame({
        "open": close, "high": close + 1.0, "low": close - 1.0,
        "close": close, "volume": np.full(n, 1000.0),
    })
    for length in _LENGTHS:
        rec = {"ok": False, "overlap": 0, "max_abs_diff": None, "error": None}
        try:
            ema1 = pd.Series(close).ewm(span=length, adjust=False).mean()
            ema2 = ema1.ewm(span=length, adjust=False).mean()
            ref = (2.0 * ema1 - ema2).reset_index(drop=True)
            got = compute("dema", df, length=length)
            if getattr(got, "ndim", 1) != 1:
                raise TypeError("compute('dema') did not return a 1-D Series")
            got = pd.Series(np.asarray(got, dtype=float)).reset_index(drop=True)
            mask = ~(got.isna() | ref.isna())
            overlap = int(mask.sum())
            rec["overlap"] = overlap
            if overlap > 0:
                mad = float(np.max(np.abs(got[mask].to_numpy() - ref[mask].to_numpy())))
                rec["max_abs_diff"] = mad
                rec["ok"] = bool(mad < _ATOL and overlap >= 50)
        except Exception as exc:  # noqa: BLE001 — any failure is a clean per-length FINDING
            rec["error"] = repr(exc)
        out["lengths"][str(length)] = rec
except Exception as exc:  # noqa: BLE001 — import/registry failure is a clean FINDING
    out["error"] = repr(exc)
print("RUNG2_NUMERIC_JSON=" + json.dumps(out))
"""

_NUMERIC_MARKER = "RUNG2_NUMERIC_JSON="


def _git(repo, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=check, capture_output=True, text=True
    )


def _reviewer_outcomes(client, run_id: str) -> list:
    """The reviewer node's per-round outcomes from the run graph (ascending by iteration)."""
    body = client.get(f"/api/runs/{run_id}/graph").json()
    for node in body.get("nodes", []):
        if node.get("role_name") == "reviewer":
            return [inv.get("outcome") for inv in node.get("invocations", [])]
    return []


def _numeric_snippet() -> str:
    """The numeric-check body with the driver's lengths/tolerance injected (single source)."""
    lengths = ", ".join(str(length) for length in _DEMA_LENGTHS)
    preamble = f"_LENGTHS = ({lengths},)\n_ATOL = {_DEMA_ATOL!r}\n"
    return preamble + _NUMERIC_BODY


def _parse_numeric(stdout: str, stderr: str) -> dict:
    """Parse the ``RUNG2_NUMERIC_JSON=`` line the snippet prints; defensive on any garble."""
    for line in reversed((stdout or "").splitlines()):
        if line.startswith(_NUMERIC_MARKER):
            try:
                return json.loads(line[len(_NUMERIC_MARKER) :])
            except (json.JSONDecodeError, ValueError):
                break
    tail = (stderr or stdout or "")[-500:]
    return {
        "import_ok": False,
        "dema_in_registry": False,
        "registry_count": None,
        "lengths": {},
        "error": f"numeric snippet produced no parseable result; output tail: {tail}",
    }


def _summary_line(pytest_output: str) -> str:
    """The single most informative pytest line (the ``N passed`` / ``N failed`` / error summary)."""
    keep = ("passed", "failed", "error", "deselected", "no tests ran")
    for line in reversed((pytest_output or "").splitlines()):
        low = line.lower()
        if any(k in low for k in keep):
            return line.strip()
    return "(no pytest summary line)"


def _create_run_body(idea: str, repo_path: str, base_ref: str, subpath: str) -> dict[str, str]:
    """The ``POST /api/runs`` body for a rung-2 review_loop run.

    Mirrors the FE (``LaunchPanel.tsx``: ``if (scope) opts.subpath = scope``): a non-empty
    ``subpath`` scopes the agent's context map + FOCUS to it (default ``core`` — the DEMA target
    package, not the 264-file monorepo); a BLANK subpath OMITS the key so the backend mounts the
    WHOLE repo (absent/None => whole-repo). The INDEPENDENT numeric gate is unaffected — it runs
    host-side at the repo ROOT regardless of the agent's mount scope.
    """
    body = {
        "team_shape": "review_loop",
        "idea": idea,
        "repo_path": repo_path,
        "base_ref": base_ref,
    }
    if subpath:
        body["subpath"] = subpath
    return body


def main() -> int:  # noqa: C901 — a linear live-proof harness; readability beats decomposition
    # Honor the CONFIGURED model (``.env`` ``TVASHTR_AGENT_MODEL``, set by the Makefile from
    # ``TVASHTR_RUNG2_MODEL``); else the DeepSeek slug. NOT a hardcode — env wins.
    model = os.environ.get("TVASHTR_AGENT_MODEL") or _DEFAULT_MODEL
    provider = model.split("/", 1)[0]
    key_names = _PROVIDER_ENV_KEYS.get(provider)
    if key_names and not any(os.environ.get(n) for n in key_names):
        print(
            f"[brownfield-rung2] no {provider!r} key ({'/'.join(key_names)}) in .env — "
            "skipping live run. Set it in .env + run `make seed`. (Not a failure.)"
        )
        return 0
    if not (Path(_REPO_PATH) / ".git").exists():
        print(
            f"[brownfield-rung2] rung-2 repo not found at {_REPO_PATH} "
            "(set TVASHTR_RUNG2_REPO). Skipping live run. (Not a failure.)"
        )
        return 0
    print(f"[brownfield-rung2] model={model} (provider={provider})")

    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.main import app

    tmp = tempfile.mkdtemp(prefix="tvashtr-rung2-")
    clone = Path(tmp) / "trade_mcp_clone"
    verify_dir = Path(tmp) / "verify"
    venv_dir = Path(tmp) / "venv"
    workspace: Path | None = None
    run_id = ""
    branch = ""
    try:
        # ---- 1. Fresh clone of the REAL repo (committed history only; operator repo untouched).
        subprocess.run(
            ["git", "clone", "--local", str(_REPO_PATH), str(clone)],
            check=True,
            capture_output=True,
            text=True,
        )
        original_head = _git(clone, "rev-parse", "HEAD").stdout.strip()
        current_branch = _git(clone, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        tracked_count = sum(1 for ln in _git(clone, "ls-files").stdout.splitlines() if ln.strip())
        print(
            f"[brownfield-rung2] cloned trade_mcp -> {clone} on '{current_branch}' "
            f"@ {original_head[:10]} ({tracked_count} tracked files)"
        )

        with TestClient(app) as client:
            login_operator(
                client
            )  # M-accounts: own the run as the seeded operator (+ its BYOK keys)
            insp = client.post("/api/repo/inspect", json={"path": str(clone)})
            assert insp.status_code == 200, insp.text
            info = insp.json()
            print(
                f"[brownfield-rung2] inspect -> is_git={info.get('is_git')} "
                f"branch={info.get('current_branch')} files={info.get('tracked_file_count')}"
            )
            assert info["is_git"] is True, info
            assert info["current_branch"] == current_branch, info
            assert info["tracked_file_count"] == tracked_count, info

            resp = client.post(
                "/api/runs",
                json=_create_run_body(_IDEA, str(clone), current_branch, _SUBPATH),
            )
            assert resp.status_code == 200, resp.text
            run_id = resp.json()["run_id"]
            workspace = _WORKSPACE_ROOT / run_id
            branch = f"tvashtr/{run_id}"
            print(
                f"[brownfield-rung2] started review_loop run_id={run_id} -> branch {branch} "
                f"(agent scope=subpath '{_SUBPATH}')"
            )
            print(
                f"[brownfield-rung2] polling up to {POLL_TIMEOUT_S}s "
                "(PM, Engineer ⇄ Reviewer, real docker+NIM, container dep-install)…"
            )

            final = None
            deadline = time.time() + POLL_TIMEOUT_S
            while time.time() < deadline:
                body = client.get(f"/api/runs/{run_id}").json()
                wf = body.get("workflow_status")
                run_status = (body.get("run") or {}).get("status")
                print(f"  workflow={wf}  run={run_status}")
                if wf in _TERMINAL_WF:
                    final = body
                    break
                time.sleep(10)
            assert final is not None, f"run did not finish within {POLL_TIMEOUT_S}s"
            run = final.get("run") or {}
            reviewer_outcomes = _reviewer_outcomes(client, run_id)

        # ---- 2. Did the loop ship the branch? If not -> FINDING (skip the verify env). ----
        branches = _git(clone, "branch", "--format=%(refname:short)").stdout.split()
        shipped = run.get("status") == "completed" and branch in branches

        # Defaults for the not-shipped path.
        numeric: dict = {
            "import_ok": False,
            "dema_in_registry": False,
            "registry_count": None,
            "lengths": {},
            "error": "run did not ship a branch (skipped verify env)",
        }
        has_dema = False
        pip_rc: int | None = None
        pip_tail = ""
        gate_rc: int | None = None
        gate_summary = "(not run — no branch)"
        whole_rc: int | None = None
        whole_summary = "(not run — no branch)"
        main_head_after = original_head
        head_unchanged: bool | None = None
        on_base_branch: bool | None = None
        tree_clean: bool | None = None
        diff_text = ""
        diff_stat = ""

        if shipped:
            tip_src = _git(clone, "show", f"{branch}:core/indicators.py", check=False).stdout
            has_dema = "def dema" in tip_src
            diff_text = _git(
                clone, "diff", original_head, branch, "--", "core/indicators.py", check=False
            ).stdout
            diff_stat = _git(clone, "diff", "--stat", original_head, branch, check=False).stdout

            # Check out the ship branch into a worktree, then build the isolated verify venv and
            # editable-install FROM the checkout — binds `core` + deps to the SHIPPED branch,
            # avoiding the PEP 660 meta-path-vs-cwd ambiguity that an install from the base
            # clone could introduce.
            _git(clone, "worktree", "add", "--detach", str(verify_dir), branch, check=False)
            subprocess.run(
                [sys.executable, "-m", "venv", str(venv_dir)],
                check=True,
                capture_output=True,
                text=True,
            )
            venv_py = venv_dir / "bin" / "python"
            pip = subprocess.run(
                [str(venv_py), "-m", "pip", "install", "-e", ".[dev]"],
                cwd=str(verify_dir),
                capture_output=True,
                text=True,
            )
            pip_rc = pip.returncode
            pip_tail = ((pip.stdout or "") + (pip.stderr or ""))[-800:]

            if pip_rc == 0:
                num = subprocess.run(
                    [str(venv_py), "-c", _numeric_snippet()],
                    cwd=str(verify_dir),
                    capture_output=True,
                    text=True,
                )
                numeric = _parse_numeric(num.stdout, num.stderr)
                # The calibrated GATE suite (the count tripwire + indicator regression signal).
                gate = subprocess.run(
                    [
                        str(venv_py),
                        "-m",
                        "pytest",
                        _GATE_PYTEST_TARGET,
                        "-q",
                        "-p",
                        "no:cacheprovider",
                    ],
                    cwd=str(verify_dir),
                    capture_output=True,
                    text=True,
                )
                gate_rc = gate.returncode
                gate_summary = _summary_line(gate.stdout or gate.stderr)
                # OBSERVATION ONLY: the whole suite (RED at baseline; pre-existing fastapi).
                whole = subprocess.run(
                    [str(venv_py), "-m", "pytest", "-q", "-p", "no:cacheprovider"],
                    cwd=str(verify_dir),
                    capture_output=True,
                    text=True,
                )
                whole_rc = whole.returncode
                whole_summary = _summary_line(whole.stdout or whole.stderr)
            else:
                numeric = {
                    "import_ok": False,
                    "dema_in_registry": False,
                    "registry_count": None,
                    "lengths": {},
                    "error": f"pip install -e .[dev] failed (rc={pip_rc})",
                }

            main_head_after = _git(clone, "rev-parse", current_branch).stdout.strip()
            head_unchanged = main_head_after == original_head
            on_base_branch = (
                _git(clone, "symbolic-ref", "--short", "HEAD").stdout.strip() == current_branch
            )
            tree_clean = _git(clone, "status", "--porcelain").stdout.strip() == ""

        # ---- 3. The INDEPENDENT correctness gate (the REAL pass condition; NOT the reviewer). ----
        lengths = numeric.get("lengths", {})
        numeric_ok = bool(
            numeric.get("import_ok") and lengths and all(r.get("ok") for r in lengths.values())
        )
        registry_ok = bool(numeric.get("dema_in_registry"))
        gate_green = gate_rc == 0
        ok = bool(
            shipped
            and has_dema
            and numeric_ok
            and registry_ok
            and gate_green
            and head_unchanged
            and on_base_branch
            and tree_clean
        )
        verdict = "PASS" if ok else "FINDING"

        print("\n================= RUNG-2 (trade_mcp DEMA) RESULT =================")
        print(f"run_id              = {run_id}")
        print(f"configured model    = {model}")
        print(f"run.status          = {run.get('status')}")
        print(f"agent scope         = subpath '{_SUBPATH}'   [scoped-mount Slice 1]")
        print(f"run.subpath         = {run.get('subpath')}   (persisted on the run)")
        print(f"ship_branch         = {run.get('ship_branch')}   (expected {branch})")
        print(f"reviewer outcomes   = {reviewer_outcomes}   [OBSERVATION ONLY — not a gate]")
        print("\nINDEPENDENT GATE (the real pass condition):")
        print(f"  shipped a branch              : {shipped}")
        print(f"  def dema present              : {has_dema}")
        print(f"  numeric matches 2*EMA-EMA(EMA): {numeric_ok}")
        for length, rec in lengths.items():
            print(
                f"      length={length}: ok={rec.get('ok')} overlap={rec.get('overlap')} "
                f"max_abs_diff={rec.get('max_abs_diff')} err={rec.get('error')}"
            )
        if numeric.get("error"):
            print(f"      numeric error: {numeric.get('error')}")
        reg = numeric.get("registry_count")
        oh, nh = original_head[:10], main_head_after[:10]
        print(f"  dema in list_indicators()     : {registry_ok} (registry_count={reg})")
        print(f"  indicator suite GREEN ({_GATE_PYTEST_TARGET}) : {gate_green} (rc {gate_rc})")
        print(f"      gate summary: {gate_summary}")
        print(f"  clone HEAD unchanged          : {head_unchanged} ({oh} -> {nh})")
        print(f"  on base branch / tree clean   : {on_base_branch} / {tree_clean}")
        print("\nOBSERVATIONS (not gates):")
        print(f"  whole `pytest -q` (RED at baseline — pre-existing fastapi): rc {whole_rc}")
        print(f"      whole summary: {whole_summary}")
        print(f"  pip install -e .[dev]         : rc {pip_rc}")
        if shipped and pip_rc not in (0, None):
            print("\n--- pip install tail ---")
            print(pip_tail)
        if diff_stat:
            print("\n--- shipped diff --stat (all changed files) ---")
            print(diff_stat.rstrip())
        print("\n--- shipped core/indicators.py diff (the agent's UNAIDED output) ---")
        print(diff_text.rstrip() if diff_text.strip() else "(no diff on core/indicators.py)")
        print("=================================================================")
        print(f"[brownfield-rung2] RUNG-2 {verdict}")
        return 0 if ok else 1
    finally:
        if clone.exists():
            _git(clone, "worktree", "remove", "--force", str(verify_dir), check=False)
            if workspace is not None:
                _git(clone, "worktree", "remove", "--force", str(workspace), check=False)
        shutil.rmtree(tmp, ignore_errors=True)
        if workspace is not None:
            shutil.rmtree(workspace, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
