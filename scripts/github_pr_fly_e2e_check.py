#!/usr/bin/env python
"""M-h2a LIVE gate: a HOSTED run whose agent executes inside a REAL Fly microVM opens a REAL PR.

This is the milestone's capstone. It drives the SAME hosted clone → run → push → PR chain the
``github-pr-e2e`` gate proves, but with ``TVASHTR_AGENT_SANDBOX=fly`` — so the agent's work happens
inside a throwaway Firecracker microVM on the run owner's own private network, behind a one-way
Flycast door and a fresh-per-run ``X-Session-API-Key``. It pushes a REAL branch and opens a REAL PR
on ``lazyxgenius/trade_mcp`` (the operator consented in advance).

It asserts FOUR things and prints each so they can be read straight out of the transcript:

  1. ``run.status == 'completed'``, a TERMINAL DBOS workflow status, and a non-empty ``pr_url``.
  2. **THE NETWORK FENCE** — the run machine's ``private_ip`` does NOT carry the operator's default
     network id. Every Fly private address is ``fdaa:<network-id>:…``, so this is read straight off
     the address Fly minted: proof the sandbox is on ``u<owner>-net`` and NOT on the network the
     backend and Postgres share. It is evidence, not a config flag we set and then trust.
  3. **THE KEY FENCE** — an UNKEYED request to the sandbox is REJECTED (401/403). Asserted against
     the live door, not claimed.
  4. **NO LEAKED APP** — after teardown the ``tv-run-<run_id>`` app is gone. The #1 way to burn
     money on Fly is a machine that outlives its job.

...and MEASURES three things (§6's tuning levers — measured, never guessed): the image's real pull
size, the cold-boot seconds, and the peak guest memory.

Skips cleanly (exit 0, "not a failure") without ``TVASHTR_FLY_API_TOKEN``, ``GITHUB_APP_*``, or the
model's provider key. An ACTIVE WireGuard tunnel to the Fly org is an operator prerequisite: if the
token is present but Flycast is unreachable that is an infra stop, NOT a silent skip.

Run ``make seed`` first. Re-runnable: teardown is in a ``finally`` and the PR create is idempotent.
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
POLL_TIMEOUT_S = int(os.environ.get("TVASHTR_PR_FLY_E2E_TIMEOUT_S", "2400"))

# The operator's DEFAULT Fly network id. Every Fly private address is ``fdaa:<network-id>:…``, so a
# run machine carrying THIS id would be sitting on the same network as the backend and Postgres —
# exactly the isolation failure M-h2a exists to prevent.
_DEFAULT_NETWORK_ID = os.environ.get("TVASHTR_FLY_DEFAULT_NETWORK_ID", "75:f644")

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
_TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}

# Deliberately trivial: this gate proves the Fly SUBSTRATE + the fences, not the agent loop (rung 2
# and github-pr-e2e already proved that). A big idea would only add ways to fail for other reasons.
_IDEA = (
    "Pick one Python source file in this repository that is missing a module-level docstring "
    "and add a short, accurate one-line module docstring at the very top of that file. Change "
    "nothing else and keep every existing test passing."
)

# What the probe observes from INSIDE the live run (the machine is destroyed at run-end, so these
# must be captured while it exists).
OBSERVED: dict = {}


def _load_dotenv() -> None:
    """Defensively load the repo-root ``.env`` — a plain shell ``source`` breaks on the
    ``x-api-key=`` line (not a valid shell name), so parse it and skip invalid names."""
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


def _unkeyed_probe(flycast_host: str) -> object:
    """Fence 3: dial a PROTECTED endpoint with NO ``X-Session-API-Key`` and report what came back.

    ``/api/*`` is uniformly key-protected once the server has ``session_api_keys`` (``/health`` is
    deliberately not, which is why this targets ``/api/conversations``). A 401/403 is the proof the
    door is locked."""
    import httpx

    try:
        return httpx.get(f"{flycast_host}/api/conversations", timeout=30.0).status_code
    except httpx.HTTPError as exc:
        return f"transport-error({type(exc).__name__})"


def _read_peak_memory(sandbox) -> str:
    """Read the guest's peak memory from inside the microVM, trying the most accurate source first
    and degrading to an instantaneous working-set reading."""
    from openhands.sdk.workspace import RemoteWorkspace

    ws = RemoteWorkspace(
        host=sandbox.machine.flycast_host,
        working_dir="/workspace",
        api_key=sandbox.session_api_key,
    )
    probes = (
        ("cat /sys/fs/cgroup/memory.peak", "cgroup v2 memory.peak"),
        ("cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes", "cgroup v1 max_usage"),
        (
            "awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{print (t-a)*1024}' /proc/meminfo",
            "/proc/meminfo working set",
        ),
    )
    for cmd, label in probes:
        try:
            res = ws.execute_command(cmd, cwd="/tmp", timeout=30.0)
            for token in (res.stdout or "").split():
                if token.isdigit() and int(token) > 0:
                    return f"{int(token) / (1024 * 1024):.0f} MB ({label})"
        except Exception:
            continue
    return "unreadable"


def _measure_image_pull_size(image_ref: str) -> str:
    """The bytes a cold Fly host actually downloads: the sum of the linux/amd64 layer sizes
    (compressed) for the pinned digest, read from the registry.

    This is THE cost lever (§6): on a laptop the image is pulled once; on Fly it is paid on every
    cold host, as the operator's bandwidth and as the user's stare at 'Starting sandbox…'."""
    import httpx

    try:
        repo, ref = image_ref.split("@") if "@" in image_ref else image_ref.rsplit(":", 1)
        registry, path = repo.split("/", 1)
        token = httpx.get(
            f"https://{registry}/token",
            params={"scope": f"repository:{path}:pull", "service": registry},
            timeout=30.0,
        ).json()["token"]
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": (
                "application/vnd.oci.image.index.v1+json,"
                "application/vnd.docker.distribution.manifest.list.v2+json,"
                "application/vnd.oci.image.manifest.v1+json,"
                "application/vnd.docker.distribution.manifest.v2+json"
            ),
        }
        base = f"https://{registry}/v2/{path}/manifests"
        doc = httpx.get(f"{base}/{ref}", headers=headers, timeout=60.0).json()
        if "manifests" in doc:  # an index: pick the platform Fly runs
            amd64 = next(
                m
                for m in doc["manifests"]
                if m.get("platform", {}).get("architecture") == "amd64"
                and m.get("platform", {}).get("os") == "linux"
            )
            doc = httpx.get(f"{base}/{amd64['digest']}", headers=headers, timeout=60.0).json()
        total = sum(layer.get("size", 0) for layer in doc.get("layers", []))
        layers = len(doc.get("layers", []))
        return f"{total / (1024**3):.2f} GB compressed (linux/amd64, {layers} layers)"
    except Exception as exc:
        return f"unreadable ({type(exc).__name__})"


def _install_probe() -> None:
    """Wrap the Fly adapter's sandbox create/teardown so the gate can observe the live machine.

    The machine is destroyed at run-end, so ``private_ip`` / boot timings / the key fence / peak
    memory must all be captured WHILE it exists. Both wrappers delegate to the real functions
    unchanged — the run itself is not altered by being watched."""
    from tvashtr.engines import openhands_fly_adapter as fly_mod

    real_create = fly_mod._get_or_create_run_sandbox
    real_close = fly_mod.close_run_machine

    def probing_create(run_id):
        sandbox, created = real_create(run_id)
        if created and "private_ip" not in OBSERVED:
            m = sandbox.machine
            OBSERVED.update(
                app_name=m.app_name,
                machine_id=m.machine_id,
                private_ip=m.private_ip,
                boot_s=m.boot_seconds,
                ready_s=m.ready_seconds,
                flycast_host=m.flycast_host,
            )
            print(f"[fly-pr-e2e] microVM up: app={m.app_name} private_ip={m.private_ip}")
            OBSERVED["unkeyed_status"] = _unkeyed_probe(m.flycast_host)
            print(f"[fly-pr-e2e] UNKEYED probe -> {OBSERVED['unkeyed_status']} (expect 401/403)")
        return sandbox, created

    def probing_close(run_id):
        sandbox = fly_mod._RUNS.get(run_id)
        if sandbox is not None and "peak_mem" not in OBSERVED:
            OBSERVED["peak_mem"] = _read_peak_memory(sandbox)
            print(f"[fly-pr-e2e] peak guest memory: {OBSERVED['peak_mem']}")
        real_close(run_id)

    fly_mod._get_or_create_run_sandbox = probing_create
    fly_mod.close_run_machine = probing_close


def _seed_operator_installation(owner_id: uuid.UUID) -> None:
    """Record the operator's GitHub App installation (the OAuth callback creates this in the browser
    flow; the gate seeds it directly). Re-owns an existing row so the gate is re-runnable."""
    from sqlalchemy import select

    from tvashtr.db import session_scope
    from tvashtr.models import GithubInstallation

    with session_scope() as session:
        row = session.execute(
            select(GithubInstallation).where(GithubInstallation.installation_id == _INSTALLATION_ID)
        ).scalar_one_or_none()
        if row is None:
            session.add(GithubInstallation(owner_id=owner_id, installation_id=_INSTALLATION_ID))
        else:
            row.owner_id = owner_id


def main() -> int:
    _load_dotenv()

    if not os.environ.get("TVASHTR_FLY_API_TOKEN"):
        print("[fly-pr-e2e] TVASHTR_FLY_API_TOKEN not set — skipping. (Not a failure.)")
        return 0
    model = os.environ.get("TVASHTR_AGENT_MODEL") or _DEFAULT_MODEL
    provider = model.split("/", 1)[0]
    key_names = _PROVIDER_ENV_KEYS.get(provider)
    if key_names and not any(os.environ.get(n) for n in key_names):
        print(
            f"[fly-pr-e2e] no {provider!r} key ({'/'.join(key_names)}) in .env — skipping live "
            "run. Set it + run `make seed`. (Not a failure.)"
        )
        return 0
    if not all(os.environ.get(n) for n in _GITHUB_APP_ENV):
        print("[fly-pr-e2e] GITHUB_APP_* not fully set in .env — skipping. (Not a failure.)")
        return 0

    # THE posture under test. Everything else mirrors github-pr-e2e so the ONLY moving part vs the
    # proven docker/local chain is the sandbox substrate.
    os.environ.setdefault("TVASHTR_HOSTED_MODE", "true")
    os.environ["TVASHTR_AGENT_SANDBOX"] = "fly"
    os.environ.setdefault("TVASHTR_AUTO_APPROVE_GATES", "1")
    os.environ.setdefault("TVASHTR_FORCE_REVISIONS", "0")

    from tvashtr.config import get_settings

    settings = get_settings()
    print(f"[fly-pr-e2e] model={model} repo={_REPO} sandbox=fly")
    print(f"[fly-pr-e2e] image={settings.fly_agent_image}")
    print(f"[fly-pr-e2e] org={settings.fly_org} region={settings.fly_region}")

    _install_probe()
    image_size = _measure_image_pull_size(settings.fly_agent_image)
    print(f"[fly-pr-e2e] image pull size: {image_size}")

    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.main import app

    run_id = ""
    final = None
    try:
        with TestClient(app) as client:
            login_operator(client)
            me = client.get("/api/auth/me")
            assert me.status_code == 200, me.text
            _seed_operator_installation(uuid.UUID(me.json()["id"]))

            resp = client.post("/api/runs", json={"idea": _IDEA, "github_repo": _REPO})
            assert resp.status_code == 200, f"create_run failed: {resp.status_code} {resp.text}"
            run_id = resp.json()["run_id"]
            print(f"[fly-pr-e2e] started HOSTED run_id={run_id} (github_repo={_REPO})")
            print(f"[fly-pr-e2e] polling up to {POLL_TIMEOUT_S}s (clone -> Fly agent -> push+PR)…")

            deadline = time.time() + POLL_TIMEOUT_S
            while time.time() < deadline:
                body = client.get(f"/api/runs/{run_id}").json()
                wf = body.get("workflow_status")
                run_status = (body.get("run") or {}).get("status")
                print(f"  workflow={wf}  run={run_status}")
                # A terminal WORKFLOW status only — run.status flips while the same run_team
                # workflow is still pushing/PR-ing/tearing down, and breaking on it would wedge it.
                if wf in _TERMINAL_WF:
                    final = body
                    break
                time.sleep(10)
            assert final is not None, f"run did not finish within {POLL_TIMEOUT_S}s"
    finally:
        # Never leave a microVM billing, whatever happened above.
        from tvashtr.engines.openhands_fly_adapter import _RUNS, close_run_machine

        for stray in list(_RUNS):
            print(f"[fly-pr-e2e] tearing down stray sandbox for run {stray}")
            close_run_machine(stray)

    run = final.get("run") or {}
    pr_url = run.get("pr_url")
    private_ip = OBSERVED.get("private_ip", "")
    app_name = OBSERVED.get("app_name", "")

    # Fence 4: the app must be GONE. Checked with a fresh client against the real API.
    from tvashtr.engines.fly_machines import FlyMachines

    fly = FlyMachines(
        token=settings.fly_api_token, org=settings.fly_org, image=settings.fly_agent_image
    )
    try:
        app_still_exists = fly.app_exists(app_name) if app_name else None
    finally:
        fly.close()

    unkeyed = OBSERVED.get("unkeyed_status")
    fence_network_ok = bool(private_ip) and _DEFAULT_NETWORK_ID not in private_ip
    fence_key_ok = unkeyed in (401, 403)

    print("\n============== GITHUB-PR-FLY-E2E RESULT (M-h2a) ==============")
    print(f"run_id             = {run_id}")
    print(f"run.status         = {run.get('status')}   (expected completed)")
    print(f"workflow_status    = {final.get('workflow_status')}   (expected SUCCESS)")
    print(f"run.github_repo    = {run.get('github_repo')}   (expected {_REPO})")
    print(f"run.pr_url         = {pr_url}")
    print("-------------------------- FENCES ---------------------------")
    print(f"machine private_ip = {private_ip}")
    print(
        f"  network fence    = {'PASS' if fence_network_ok else 'FAIL'} "
        f"(must NOT contain the default network id {_DEFAULT_NETWORK_ID!r})"
    )
    print(f"unkeyed request    = {unkeyed}")
    print(f"  key fence        = {'PASS' if fence_key_ok else 'FAIL'} (expected 401/403)")
    print(f"fly app {app_name}")
    print(
        f"  still exists?    = {app_still_exists}   "
        f"(expected False — no leaked app, no orphan bill)"
    )
    print("----------------------- MEASUREMENTS ------------------------")
    print(f"agent image        = {settings.fly_agent_image}")
    print(f"image pull size    = {image_size}")
    print(f"cold boot (start)  = {OBSERVED.get('boot_s', 0):.1f}s")
    print(f"ready (serving)    = {OBSERVED.get('ready_s', 0):.1f}s")
    print(f"peak guest memory  = {OBSERVED.get('peak_mem', 'unmeasured')}")
    print("=============================================================")

    ok = bool(
        run.get("status") == "completed"
        and final.get("workflow_status") == "SUCCESS"
        and run.get("github_repo") == _REPO
        and pr_url
        and fence_network_ok
        and fence_key_ok
        and app_still_exists is False
    )
    if ok:
        print(f"[fly-pr-e2e] PASS — agent ran INSIDE a Fly microVM; opened PR: {pr_url}")
        print("[fly-pr-e2e] (open + close it on GitHub; the gate is re-runnable.)")
        return 0
    print("[fly-pr-e2e] FINDING — the hosted Fly run -> PR chain did not complete cleanly")
    return 1


if __name__ == "__main__":
    sys.exit(main())
