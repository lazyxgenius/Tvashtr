#!/usr/bin/env python
"""M-h2b LIVE gate helper — the assertions for ``fly_suspend_restart_e2e.sh``.

Driven in THREE phases by the shell script, because the middle of this proof is a real ``kill -9``
of the backend process and only a shell can do that:

  ``phase1 <run_id_file>``  — create a HOSTED fly-sandbox run, approve the PRD gate (not the
                              target) while LOWERING the budget cap mid-run, and wait until the run
                              parks at the BUDGET gate. Then assert the machine is genuinely
                              SUSPENDED on Fly and record the app name. Leaves the run parked.
  ``phase2 <run_id_file>``  — run AFTER the backend was killed and restarted. Assert the app is the
                              SAME one (no new ``tv-run-*`` was created — reconstruct, not
                              re-create) and that the machine is STILL suspended across the restart.
  ``phase3 <run_id_file>``  — approve the budget gate through the REAL resolve API, then poll to the
                              workflow terminal and assert: ``run.status == completed``, a non-empty
                              ``pr_url``, and the app DELETED afterwards.

WHY THE BUDGET GATE IS THE TARGET. It is the only gate that is (a) genuinely blocking, (b)
deterministic to trigger — see the mid-run cap drop in ``phase1``; note the budget hook fires after
EVERY spend-bearing node INCLUDING the PM, so a cap set at create would park the run before any
microVM existed and prove nothing — and (c) followed by ANOTHER AGENT NODE. The team is
``pm → prd_gate → engineer ⇄ reviewer → ship``: the Engineer boots the microVM, the budget gate
parks it, and the Reviewer after the gate is what forces the reconstruct path to run. A gate
followed by a terminal would prove suspend but never exercise reconstruction, because shipping is
host-side work that never touches the machine.

Skips cleanly (exit 0, "not a failure") without the token / GitHub App / model key. Spends real
money. Needs an ACTIVE WireGuard tunnel. NOT in ``make test``.
"""

import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

_REPO = os.environ.get("TVASHTR_PR_E2E_REPO", "lazyxgenius/trade_mcp")
_INSTALLATION_ID = int(os.environ.get("TVASHTR_PR_E2E_INSTALLATION_ID", "147133756"))
_DEFAULT_MODEL = "deepseek/deepseek-chat"
_IDEA = os.environ.get(
    "TVASHTR_SUSPEND_E2E_IDEA",
    "Add a short CONTRIBUTING.md explaining how to run the test suite.",
)
# The cap is applied MID-RUN, not at create — see phase1. Any value below the PM's already-recorded
# spend makes the next budget check a certain breach, so the target gate is reached
# deterministically rather than by guessing what an agent run will cost.
_BUDGET_CAP = os.environ.get("TVASHTR_SUSPEND_E2E_CAP", "0.0001")
_PARK_TIMEOUT_S = int(os.environ.get("TVASHTR_SUSPEND_E2E_PARK_TIMEOUT_S", "1800"))
_FINISH_TIMEOUT_S = int(os.environ.get("TVASHTR_SUSPEND_E2E_FINISH_TIMEOUT_S", "2400"))

# The live backend the phases drive. CRITICALLY this is real HTTP against the uvicorn process the
# shell script starts and kills — NOT an in-process ``TestClient``. A TestClient would open its own
# FastAPI lifespan, which launches a SECOND DBOS instance against the same database; that instance
# would race the real one for workflow recovery and could resume the very run we are trying to prove
# survives a restart. The whole point is that the workflow lives in a process we can ``kill -9``.
BASE = os.environ.get("TVASHTR_SUSPEND_E2E_BASE", "http://127.0.0.1:8000")

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


def _load_dotenv() -> None:
    """Parse ``.env`` by hand — a plain shell ``source`` breaks on lines like ``x-api-key=…`` whose
    key is not a valid shell identifier."""
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
            continue
        os.environ.setdefault(key, val.strip())


def _skip_reason() -> str | None:
    if not os.environ.get("TVASHTR_FLY_API_TOKEN"):
        return "TVASHTR_FLY_API_TOKEN not set"
    model = os.environ.get("TVASHTR_AGENT_MODEL") or _DEFAULT_MODEL
    keys = _PROVIDER_ENV_KEYS.get(model.split("/", 1)[0])
    if keys and not any(os.environ.get(n) for n in keys):
        return f"no {model.split('/', 1)[0]!r} key ({'/'.join(keys)}) in .env"
    if not all(os.environ.get(n) for n in _GITHUB_APP_ENV):
        return "GITHUB_APP_* not fully set in .env"
    return None


def _pin_posture() -> None:
    """Set the posture BEFORE the settings cache is first populated.

    ``TVASHTR_AUTO_APPROVE_GATES=0`` is the load-bearing one: the whole point is a gate that really
    blocks. Auto-approval would resolve the target gate instantly and the run would never park, so
    the proof would silently become a no-op."""
    os.environ.setdefault("TVASHTR_HOSTED_MODE", "true")
    os.environ["TVASHTR_AGENT_SANDBOX"] = "fly"
    os.environ["TVASHTR_AUTO_APPROVE_GATES"] = "0"
    os.environ.setdefault("TVASHTR_FORCE_REVISIONS", "0")


def _fly_client():
    from tvashtr.config import get_settings
    from tvashtr.engines.fly_machines import FlyMachines

    s = get_settings()
    return FlyMachines(
        token=s.fly_api_token.get_secret_value(),
        org=s.fly_org,
        region=s.fly_region,
        image=s.fly_agent_image,
    )


def _state_path(run_file: str) -> Path:
    return Path(run_file)


def _read_state(run_file: str) -> dict:
    return json.loads(_state_path(run_file).read_text())


def _write_state(run_file: str, **kw) -> None:
    path = _state_path(run_file)
    state = json.loads(path.read_text()) if path.exists() else {}
    state.update(kw)
    path.write_text(json.dumps(state))


def _tv_run_apps(fly) -> list[str]:
    return sorted(n for n in fly.list_apps() if n.startswith("tv-run-"))


def _seed_operator_installation(owner_id: uuid.UUID) -> None:
    """Record the operator's GitHub App installation (the OAuth callback creates this in a browser
    flow; a headless gate seeds it directly). Re-owns an existing row so this is re-runnable."""
    from sqlalchemy import select

    from tvashtr.db import session_scope
    from tvashtr.models import GithubInstallation

    with session_scope() as session:
        row = session.execute(
            select(GithubInstallation).where(GithubInstallation.installation_id == _INSTALLATION_ID)
        ).scalar_one_or_none()
        if row is None:
            session.add(
                GithubInstallation(
                    owner_id=owner_id,
                    installation_id=_INSTALLATION_ID,
                    account_login=_REPO.split("/", 1)[0],
                )
            )
        else:
            row.owner_id = owner_id


def _set_budget_cap(run_id: str, cap: str) -> None:
    """Lower the run's cap mid-flight, while it is parked at the PRD gate.

    ``budget_check_step`` re-reads the cap from the database on every check, so this takes effect on
    the very next one."""
    from decimal import Decimal

    from sqlalchemy import update

    from tvashtr.db import session_scope
    from tvashtr.models import Run

    with session_scope() as session:
        session.execute(
            update(Run).where(Run.workflow_id == run_id).values(budget_cap_usd=Decimal(cap))
        )


def _workflow_status(run_id: str) -> str:
    """The DBOS workflow's own status (``PENDING`` / ``SUCCESS`` / ``ERROR`` / …).

    Read straight from the system table rather than through the DBOS API, because this process
    deliberately never launches a DBOS instance — that is what keeps it from racing the backend it
    is observing for workflow recovery."""
    from sqlalchemy import text

    from tvashtr.db import session_scope

    with session_scope() as session:
        row = session.execute(
            text("select status from dbos.workflow_status where workflow_uuid = :wid"),
            {"wid": run_id},
        ).first()
    return row[0] if row else ""


def _run_row(run_id: str) -> dict:
    from sqlalchemy import select

    from tvashtr.db import session_scope
    from tvashtr.models import Run

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        if run is None:
            return {}
        return {"status": run.status, "pr_url": run.pr_url, "id": str(run.id)}


def _wait_for(predicate, timeout_s: int, what: str):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        got = predicate()
        if got:
            return got
        time.sleep(3.0)
    raise AssertionError(f"timed out after {timeout_s}s waiting for {what}")


def _pending_task(client, run_id: str, kind: str) -> dict | None:
    resp = client.get(f"/api/runs/{run_id}/tasks")
    if resp.status_code != 200:
        return None
    for t in resp.json()["tasks"]:
        if t["status"] == "pending" and t["kind"] == kind:
            return t
    return None


# ---------------------------------------------------------------------------------------------
# PHASE 1 — park the run at a genuinely-blocking gate with the machine suspended
# ---------------------------------------------------------------------------------------------


def phase1(run_file: str) -> int:
    import httpx
    from operator_session import login_operator

    from tvashtr.engines.fly_machines import app_name_for_run

    with httpx.Client(base_url=BASE, timeout=60.0) as client:
        login_operator(client)
        me = client.get("/api/auth/me")
        assert me.status_code == 200, me.text
        _seed_operator_installation(uuid.UUID(me.json()["id"]))

        # pm -> prd_gate -> engineer <-> reviewer -> ship. The REVIEWER after the gate is what
        # makes this a reconstruction proof and not merely a suspend proof: an agent node has to
        # run AFTER the restart for _ensure_run_sandbox's reconstruct arm to be exercised at all.
        # ``team_shape`` (not ``team_graph_id``) is the right door — the router builds the graph
        # server-side, whereas a client-built graph is unowned and rejected 404 by the
        # M-accounts ownership guard.
        # NO cap at create. The budget hook runs after EVERY spend-bearing node — including the PM
        # completion node — so a cap set here would park the run before any microVM existed and the
        # proof would be vacuous (measured: the PM alone spends ~$0.0017).
        resp = client.post(
            "/api/runs",
            json={"idea": _IDEA, "github_repo": _REPO, "team_shape": "review_loop"},
        )
        assert resp.status_code == 200, f"create_run failed: {resp.status_code} {resp.text}"
        run_id = resp.json()["run_id"]
        app_name = app_name_for_run(run_id)
        _write_state(run_file, run_id=run_id, app_name=app_name)
        print(f"[suspend-e2e] run_id={run_id} app={app_name} (no cap yet — see below)")

        # The PRD gate blocks first (auto-approve is OFF). It is NOT the target — approve it and
        # let the run reach the Engineer, which is what boots the microVM.
        prd = _wait_for(
            lambda: _pending_task(client, run_id, "prd_approval"), 600, "the PRD gate to open"
        )
        # THE TRICK that makes the target gate deterministic. With the run safely parked at the PRD
        # gate, drop the cap BELOW the spend the PM has already recorded. The next budget check —
        # the one after the Engineer, the first node that boots a microVM — is then a CERTAIN
        # breach, with no guessing about what an agent run happens to cost.
        _set_budget_cap(run_id, _BUDGET_CAP)
        print(f"[suspend-e2e] cap lowered to ${_BUDGET_CAP} mid-run — next check is a sure breach")
        client.post(f"/api/runs/{run_id}/tasks/{prd['id']}/resolve", json={"decision": "approve"})
        print("[suspend-e2e] PRD gate approved (not the target gate) — Engineer starts")

        # THE TARGET GATE: the Engineer spends past the cap, so the budget hook parks the run.
        task = _wait_for(
            lambda: _pending_task(client, run_id, "budget_approval"),
            _PARK_TIMEOUT_S,
            "the run to park at the budget gate",
        )
        _write_state(run_file, task_id=task["id"])
        status = _run_row(run_id).get("status")
        print(f"[suspend-e2e] PARKED at the budget gate: run.status={status} task={task['id']}")
        assert status == "awaiting_human", f"expected awaiting_human, got {status!r}"

    # The machine must be genuinely SUSPENDED on Fly — read off the API, not inferred.
    fly = _fly_client()
    try:
        info = _wait_for(
            lambda: (m := fly.get_run_machine(app_name)) and m.is_suspended and m,
            180,
            "the machine to report state=suspended",
        )
        print(f"[suspend-e2e] machine {info.machine_id} state={info.state} (STORAGE-ONLY billing)")
        print(f"[suspend-e2e] tv-run apps before the kill: {_tv_run_apps(fly)}")
        _write_state(run_file, machine_id=info.machine_id, apps_before=_tv_run_apps(fly))
    finally:
        fly.close()
    print("[suspend-e2e] phase1 OK — parked + suspended. Ready for kill -9.")
    return 0


# ---------------------------------------------------------------------------------------------
# PHASE 2 — after the kill + restart: same app, still suspended, nothing new created
# ---------------------------------------------------------------------------------------------


def phase2(run_file: str) -> int:
    state = _read_state(run_file)
    app_name = state["app_name"]
    fly = _fly_client()
    try:
        apps_now = _tv_run_apps(fly)
        print(f"[suspend-e2e] tv-run apps after the restart: {apps_now}")
        same = apps_now == state["apps_before"]
        exists = app_name in apps_now
        info = fly.get_run_machine(app_name)
        still_suspended = info is not None and info.is_suspended
        same_machine = info is not None and info.machine_id == state["machine_id"]
        print(f"[suspend-e2e] the run's app SURVIVED the restart      : {exists}")
        print(f"[suspend-e2e] NO new tv-run-* app was created         : {same}")
        print(f"[suspend-e2e] SAME machine id ({state['machine_id']}) : {same_machine}")
        print(f"[suspend-e2e] machine STILL suspended while parked    : {still_suspended}")
        ok = exists and same and same_machine and still_suspended
    finally:
        fly.close()
    print(f"[suspend-e2e] phase2 {'OK' if ok else 'FAILED'}")
    return 0 if ok else 1


# ---------------------------------------------------------------------------------------------
# PHASE 3 — approve for real, then reconstruct + resume + ship a real PR
# ---------------------------------------------------------------------------------------------


def phase3(run_file: str) -> int:
    import httpx
    from operator_session import login_operator

    state = _read_state(run_file)
    run_id, app_name = state["run_id"], state["app_name"]

    with httpx.Client(base_url=BASE, timeout=60.0) as client:
        login_operator(client)
        # The gate survived the restart as a durable DBOS recv; re-read it rather than trusting the
        # id we saw before the crash.
        task = _wait_for(
            lambda: _pending_task(client, run_id, "budget_approval"),
            300,
            "the budget gate to be re-offered after recovery",
        )
        resp = client.post(
            f"/api/runs/{run_id}/tasks/{task['id']}/resolve",
            json={"decision": "approve", "note": "m-h2b: resume against the existing microVM"},
        )
        assert resp.status_code == 200, f"resolve failed: {resp.status_code} {resp.text}"
        print("[suspend-e2e] budget gate APPROVED via the real API — the run should now resume")

        # THE RECONSTRUCTION PROOF, watched directly rather than inferred. The next node (the
        # Reviewer, an agent node) must boot through ``_ensure_run_sandbox``, find no in-process
        # handle, re-attach to THIS app and START the suspended machine. Watching the machine leave
        # ``suspended`` is the one observation that distinguishes "reconstructed and resumed" from
        # "quietly did something else" — the adapter's own log lines are swallowed by uvicorn's
        # --log-level, so they cannot be the evidence.
        fly_watch = _fly_client()
        try:
            resumed = _wait_for(
                lambda: (m := fly_watch.get_run_machine(app_name)) and not m.is_suspended and m,
                900,
                "the suspended machine to be RESUMED by the next node",
            )
            print(
                f"[suspend-e2e] RESUMED: machine {resumed.machine_id} left suspended -> "
                f"state={resumed.state} (reconstruct + start, no new app)"
            )
            assert resumed.machine_id == state["machine_id"], (
                f"resumed a DIFFERENT machine: {resumed.machine_id} != {state['machine_id']}"
            )
        finally:
            fly_watch.close()

        # Poll to the DBOS **WORKFLOW** terminal, NOT ``run.status``. This is a known trap in this
        # repo and the first live attempt fell into it: ``finalize_run_step`` sets
        # ``run.status='completed'`` and the in-workflow teardown runs AFTER it, so a driver that
        # stops at ``run.status`` checks for a deleted app while the delete is still in flight and
        # reports a leak that is not one.
        _wait_for(
            lambda: _workflow_status(run_id) in {"SUCCESS", "ERROR", "CANCELLED"},
            _FINISH_TIMEOUT_S,
            "the DBOS workflow to reach a terminal status",
        )
        final = _run_row(run_id)
        wf = _workflow_status(run_id)

    print(
        f"[suspend-e2e] workflow={wf} final run.status={final['status']} "
        f"pr_url={final.get('pr_url')!r}"
    )
    fly = _fly_client()
    try:
        leftover = _tv_run_apps(fly)
        app_deleted = app_name not in leftover
        print(f"[suspend-e2e] tv-run apps after the run: {leftover}")
    finally:
        fly.close()

    completed = final["status"] == "completed"
    has_pr = bool(final.get("pr_url"))
    print(f"[suspend-e2e] run completed        : {completed}")
    print(f"[suspend-e2e] REAL PR opened       : {has_pr}  {final.get('pr_url') or ''}")
    print(f"[suspend-e2e] app deleted after    : {app_deleted}  ({app_name})")
    ok = completed and has_pr and app_deleted and wf == "SUCCESS"
    print(f"[suspend-e2e] phase3 {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


def main() -> int:
    _load_dotenv()
    reason = _skip_reason()
    if reason:
        print(f"[suspend-e2e] {reason} — skipping. (Not a failure.)")
        return 0
    _pin_posture()
    phase, run_file = sys.argv[1], sys.argv[2]
    return {"phase1": phase1, "phase2": phase2, "phase3": phase3}[phase](run_file)


if __name__ == "__main__":
    sys.exit(main())
