#!/usr/bin/env python
"""M-h1b LIVE gate: a HOSTED run clones a REAL GitHub repo, runs, and opens a REAL Pull Request.

Drives ``POST /api/runs`` with ``github_repo=lazyxgenius/trade_mcp`` in HOSTED mode (LOCAL sandbox,
forced reviewer-approve, a TRIVIAL docstring idea). It proves the NEW seams — clone-from-GitHub, a
cloned ``repo_path`` reaching ``load_graph_step``, push, and a real PR — NOT the agent loop (rung 2
already did that). It pushes a REAL branch + opens a REAL PR on ``trade_mcp`` (the operator
consented). Re-runnable: the push + PR are idempotent (list-open-first), so a re-run reuses them.

Skips cleanly (exit 0, "not a failure") without ``GITHUB_APP_*`` or the model's provider key —
mirrors ``github_app_e2e_check`` / ``docs_chain_check``. Run ``make seed`` first so the operator's
model provider credential is in the DB. NO docker, NO browser. NOT in ``make test``.

Poll to a TERMINAL DBOS *workflow* status (NOT ``run.status``): a fast run sets
``runs.status='completed'`` while the same ``run_team`` workflow is still doing the in-workflow
push/PR/teardown, so breaking on ``run.status`` (the rung-2 ``or run_status in _TERMINAL_RUN`` bug)
would tear the TestClient down mid-workflow and wedge a PENDING ``run_team``.
"""

import os
import re
import sys
import time
import uuid
from pathlib import Path

_REPO = os.environ.get("TVASHTR_PR_E2E_REPO", "lazyxgenius/trade_mcp")
_INSTALLATION_ID = int(os.environ.get("TVASHTR_PR_E2E_INSTALLATION_ID", "147133756"))
_DEFAULT_MODEL = "deepseek/deepseek-chat"
POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_PR_E2E_TIMEOUT_S", "1200"))

# Each provider slug -> the ``.env`` var(s) whose key ``make seed`` imports.
_PROVIDER_ENV_KEYS: dict[str, tuple[str, ...]] = {
    "openrouter": ("OPENROUTER_API_KEY",),
    "openai": ("OPENAI_API_KEY",),
    "gemini": ("GEMINI_API_KEY",),
    "groq": ("GROQ_CLOUD_API_KEY", "GROQ_API_KEY"),
    "nvidia_nim": ("NVIDIA_BUILD_API_KEY", "NVIDIA_NIM_API_KEY"),
    "deepseek": ("DEEPSEEK_API_KEY",),
}
_GITHUB_APP_ENV = (
    "GITHUB_APP_ID",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_PRIVATE_KEY_B64",
)
# Terminal DBOS WORKFLOW statuses — NOT run.status (see the docstring / the `or`-bug warning).
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}

_IDEA = (
    "Pick one Python source file in this repository that is missing a module-level docstring "
    "and add a short, accurate one-line module docstring at the very top of that file. Change "
    "nothing else and keep every existing test passing."
)


def _load_dotenv() -> None:
    """Defensively load the repo-root ``.env`` into ``os.environ`` — a plain shell ``source`` breaks
    on the ``x-api-key=`` line (not a valid shell name), so parse it ourselves and SKIP any key
    that is not a valid env-var name; an already-set env var wins (the Makefile's exports)."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue  # e.g. ``x-api-key`` — skip, never crash
        os.environ.setdefault(key, val.strip())


def _seed_operator_installation(owner_id: uuid.UUID) -> None:
    """Record the operator's GitHub App installation (the OAuth callback creates this in the browser
    flow; the gate seeds it directly). Re-owns an existing row so the gate is re-runnable.

    The body now lives in ``scripts/github_fixture.py`` so the M-proof browser harness can share it
    instead of reaching into this module's private namespace. Behaviour is unchanged."""
    from github_fixture import seed_operator_installation

    seed_operator_installation(owner_id, _INSTALLATION_ID)


def main() -> int:
    _load_dotenv()
    model = os.environ.get("TVASHTR_AGENT_MODEL") or _DEFAULT_MODEL
    provider = model.split("/", 1)[0]
    key_names = _PROVIDER_ENV_KEYS.get(provider)
    if key_names and not any(os.environ.get(n) for n in key_names):
        print(
            f"[github-pr-e2e] no {provider!r} key ({'/'.join(key_names)}) in .env — skipping live "
            "run. Set it + run `make seed`. (Not a failure.)"
        )
        return 0
    if not all(os.environ.get(n) for n in _GITHUB_APP_ENV):
        print("[github-pr-e2e] GITHUB_APP_* not fully set in .env — skipping. (Not a failure.)")
        return 0
    # The hosted posture + a hands-off deterministic run (mirrors run_diff_e2e: LOCAL sandbox, auto-
    # approve gates, forced reviewer-approve so only the PM + Engineer call the model — no docker).
    os.environ.setdefault("TVASHTR_HOSTED_MODE", "true")
    os.environ.setdefault("TVASHTR_AGENT_SANDBOX", "local")
    os.environ.setdefault("TVASHTR_AUTO_APPROVE_GATES", "1")
    os.environ.setdefault("TVASHTR_FORCE_REVISIONS", "0")
    print(f"[github-pr-e2e] model={model} repo={_REPO} installation={_INSTALLATION_ID}")

    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.main import app

    run_id = ""
    with TestClient(app) as client:
        login_operator(client)  # own the run as the seeded operator (+ its BYOK model key)
        me = client.get("/api/auth/me")
        assert me.status_code == 200, me.text
        _seed_operator_installation(uuid.UUID(me.json()["id"]))

        resp = client.post("/api/runs", json={"idea": _IDEA, "github_repo": _REPO})
        assert resp.status_code == 200, f"create_run failed: {resp.status_code} {resp.text}"
        run_id = resp.json()["run_id"]
        print(f"[github-pr-e2e] started HOSTED run_id={run_id} (github_repo={_REPO})")
        print(f"[github-pr-e2e] polling up to {POLL_TIMEOUT_S}s (clone -> agent -> push+PR)…")

        final = None
        deadline = time.time() + POLL_TIMEOUT_S
        while time.time() < deadline:
            body = client.get(f"/api/runs/{run_id}").json()
            wf = body.get("workflow_status")
            run_status = (body.get("run") or {}).get("status")
            print(f"  workflow={wf}  run={run_status}")
            if wf in _TERMINAL_WF:  # a terminal WORKFLOW status only — never the run_status arm
                final = body
                break
            time.sleep(8)
        assert final is not None, f"run did not finish within {POLL_TIMEOUT_S}s"
        run = final.get("run") or {}

    repo_path = run.get("repo_path")
    pr_url = run.get("pr_url")
    print("\n================= GITHUB-PR-E2E RESULT =================")
    print(f"run_id          = {run_id}")
    print(f"run.repo_path   = {repo_path}   (expected the per-run clone dir ending in the run_id)")
    print(f"run.github_repo = {run.get('github_repo')}   (expected {_REPO})")
    print(f"run.subpath     = {run.get('subpath')}   (expected None — whole repo)")
    print(f"run.status      = {run.get('status')}   (expected completed)")
    print(f"workflow_status = {final.get('workflow_status')}   (expected SUCCESS)")
    print(f"run.pr_url      = {pr_url}")
    print("=======================================================")

    ok = bool(
        run.get("status") == "completed"
        and run.get("github_repo") == _REPO
        and run.get("subpath") is None
        and repo_path
        and run_id in str(repo_path)
        and pr_url
    )
    if ok:
        print(f"[github-pr-e2e] PASS — opened PR: {pr_url}")
        print("[github-pr-e2e] (open + close it on GitHub; the gate is re-runnable.)")
        return 0
    print("[github-pr-e2e] FINDING — the hosted clone -> push -> PR chain did not complete cleanly")
    return 1


if __name__ == "__main__":
    sys.exit(main())
