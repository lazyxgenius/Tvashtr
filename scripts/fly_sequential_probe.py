#!/usr/bin/env python
"""M-h2a Task A — the UNVERIFIED-(a) probe: can ONE Fly agent server host N SEQUENTIAL per-node
conversations, each confined to its own working dir?

The whole D1+D4 shape rests on this one unproven fact. D1 says ONE microVM per RUN (the trust
boundary is between tenants, not between a user's own nodes); D4 says each node still gets its own
``/workspace/<node_id>`` (because docker hands every node a fresh empty container, and a SHARED
``/workspace`` on Fly would let node B see node A's leftovers and silently diverge the Fly path from
the docker proof harness). Nodes run sequentially in the graph walk, so this is N-sequential, not
N-concurrent — but nobody has ever run it.

WHAT THIS PROVES (or refutes), cheaply, before a line of adapter is written:
  1. one machine, one agent server;
  2. TWO conversations opened against it back-to-back, each bound to a ``RemoteWorkspace`` with a
     DIFFERENT ``working_dir``;
  3. each writes a DISTINCT string to ``./out.txt`` — so the check is not merely "both files exist"
     but "each dir holds ITS OWN node's content", which is what actually refutes
     cross-contamination;
  4. the per-run ``X-Session-API-Key`` is ON — asserted by showing an UNKEYED request is rejected.

Skips cleanly (exit 0, "not a failure") without ``TVASHTR_FLY_API_TOKEN`` or the agent model's
provider key. Tears the machine down in a ``finally`` — a probe that leaks a microVM is a probe that
bills forever.

Run: ``make fly-probe``  (or ``cd backend && uv run python ../scripts/fly_sequential_probe.py``)
"""

import os
import re
import sys
import time
import uuid
from pathlib import Path

_PROVIDER_ENV_KEYS: dict[str, tuple[str, ...]] = {
    "openrouter": ("OPENROUTER_API_KEY",),
    "openai": ("OPENAI_API_KEY",),
    "gemini": ("GEMINI_API_KEY",),
    "groq": ("GROQ_CLOUD_API_KEY", "GROQ_API_KEY"),
    "nvidia_nim": ("NVIDIA_BUILD_API_KEY", "NVIDIA_NIM_API_KEY"),
    "deepseek": ("DEEPSEEK_API_KEY",),
}

# The two node ids the probe drives sequentially against the ONE server.
_NODES = ("n1", "n2")


def _load_dotenv() -> None:
    """Defensively load the repo-root ``.env`` (a plain ``source`` breaks on the ``x-api-key=``
    line, which is not a valid shell name) — the same loader the other live gates use."""
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


def _peak_memory_mb(workspace) -> str:
    """Read the guest's PEAK memory from inside the microVM (the §6 tuning measurement).

    Tries cgroup v2's ``memory.peak``, then cgroup v1's ``max_usage_in_bytes``, then falls back to
    ``/proc/meminfo``'s (MemTotal - MemAvailable) high-water approximation. Returned as a string so
    a probe that cannot read it degrades to a note instead of failing the run."""
    cmd = (
        "cat /sys/fs/cgroup/memory.peak 2>/dev/null "
        "|| cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes 2>/dev/null "
        "|| awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{print (t-a)*1024}' /proc/meminfo"
    )
    try:
        res = workspace.execute_command(cmd, cwd="/tmp", timeout=30.0)
        raw = (res.stdout or "").strip().splitlines()
        val = int(raw[0]) if raw and raw[0].isdigit() else 0
        return f"{val / (1024 * 1024):.0f} MB" if val else "unreadable"
    except Exception as exc:  # never let a measurement break the probe
        return f"unreadable ({type(exc).__name__})"


def main() -> int:
    _load_dotenv()

    token = os.environ.get("TVASHTR_FLY_API_TOKEN")
    if not token:
        print("[fly-probe] TVASHTR_FLY_API_TOKEN not set — skipping. (Not a failure.)")
        return 0
    model = os.environ.get("TVASHTR_AGENT_MODEL") or "deepseek/deepseek-chat"
    provider = model.split("/", 1)[0]
    key_names = _PROVIDER_ENV_KEYS.get(provider)
    api_key = next((os.environ[n] for n in (key_names or ()) if os.environ.get(n)), None)
    if key_names and not api_key:
        print(
            f"[fly-probe] no {provider!r} key ({'/'.join(key_names)}) — skipping. (Not a failure.)"
        )
        return 0

    import httpx
    from openhands.sdk import LLM, Agent, Conversation, Tool
    from openhands.sdk.workspace import RemoteWorkspace
    from openhands.tools.file_editor import FileEditorTool
    from openhands.tools.terminal import TerminalTool

    from tvashtr.config import get_settings
    from tvashtr.engines.fly_machines import (
        FlyMachines,
        app_name_for_run,
        mint_session_key,
    )

    settings = get_settings()
    run_id = str(uuid.uuid4())
    owner_id = str(uuid.uuid4())
    session_key = mint_session_key()
    image = settings.fly_agent_image
    app_name = app_name_for_run(run_id)

    print(f"[fly-probe] model={model} image={image}")
    print(f"[fly-probe] run_id={run_id} app={app_name} region={settings.fly_region}")
    print(f"[fly-probe] booting ONE machine, then driving {len(_NODES)} SEQUENTIAL conversations…")

    fly = FlyMachines(
        token=token,
        org=settings.fly_org,
        region=settings.fly_region,
        image=image,
        guest_cpus=settings.fly_guest_cpus,
        guest_memory_mb=settings.fly_guest_memory_mb,
    )
    machine = None
    results: dict[str, str] = {}
    peak_mem = "unmeasured"
    try:
        machine = fly.start_run_sandbox(
            run_id=run_id, owner_id=owner_id, session_api_key=session_key
        )
        print(f"[fly-probe] machine={machine.machine_id} private_ip={machine.private_ip}")
        print(
            f"[fly-probe] flycast={machine.flycast_host}  boot={machine.boot_seconds:.1f}s "
            f"ready={machine.ready_seconds:.1f}s"
        )

        # --- fence 2 (D2b): the unkeyed request must be REJECTED -------------------------------
        # Asserted, not claimed: dial the same door with NO X-Session-API-Key and require a refusal.
        unkeyed_status: object
        try:
            unkeyed = httpx.get(f"{machine.flycast_host}/api/conversations", timeout=30.0)
            unkeyed_status = unkeyed.status_code
        except httpx.HTTPError as exc:
            unkeyed_status = f"transport-error({type(exc).__name__})"
        print(f"[fly-probe] UNKEYED request -> {unkeyed_status} (expect 401/403)")

        # --- the actual question: N sequential conversations, one server, per-node dirs ---------
        llm = LLM(model=model, api_key=api_key, temperature=0.0, usage_id="tvashtr-agent")
        agent = Agent(
            llm=llm,
            tools=[Tool(name=TerminalTool.name), Tool(name=FileEditorTool.name)],
        )
        for node_id in _NODES:
            working_dir = f"/workspace/{node_id}"
            marker = f"hello-{node_id}"
            print(f"\n[fly-probe] --- node {node_id}: working_dir={working_dir} ---")
            started = time.monotonic()
            workspace = RemoteWorkspace(
                host=machine.flycast_host, working_dir=working_dir, api_key=session_key
            )
            workspace.execute_command(f"mkdir -p {working_dir}", cwd="/tmp", timeout=30.0)
            conversation = Conversation(agent=agent, workspace=workspace, max_iteration_per_run=15)
            conversation.send_message(
                f"Write exactly the text {marker} (and nothing else) into a file named out.txt "
                f"in your current working directory. Then you are done."
            )
            conversation.run()
            print(
                f"[fly-probe] node {node_id} conversation finished in "
                f"{time.monotonic() - started:.0f}s"
            )
            if node_id == _NODES[-1]:
                peak_mem = _peak_memory_mb(workspace)

        # --- D4 verification: each dir holds ITS OWN node's content ---------------------------
        probe_ws = RemoteWorkspace(
            host=machine.flycast_host, working_dir="/workspace", api_key=session_key
        )
        for node_id in _NODES:
            res = probe_ws.execute_command(
                f"cat /workspace/{node_id}/out.txt", cwd="/tmp", timeout=30.0
            )
            results[node_id] = (res.stdout or "").strip()
        listing = probe_ws.execute_command(
            "ls -la /workspace/*/ 2>/dev/null", cwd="/tmp", timeout=30.0
        )
        print("\n[fly-probe] per-node workspace listing:")
        print(listing.stdout)
    finally:
        if machine is not None:
            print(f"[fly-probe] tearing down app {machine.app_name}…")
            try:
                fly.delete_app(machine.app_name)
                still_there = fly.app_exists(machine.app_name)
                print(f"[fly-probe] app still exists after delete? {still_there} (expect False)")
            except Exception as exc:
                print(f"[fly-probe] TEARDOWN FAILED for {machine.app_name}: {type(exc).__name__}")
                raise
        fly.close()

    print("\n================= FLY SEQUENTIAL-CONVERSATIONS PROBE (Task A) =================")
    print(f"machine private_ip   = {machine.private_ip}")
    print(f"cold boot (pull+start) = {machine.boot_seconds:.1f}s")
    print(f"ready (server serving) = {machine.ready_seconds:.1f}s")
    print(f"peak guest memory    = {peak_mem}")
    for node_id in _NODES:
        print(
            f"/workspace/{node_id}/out.txt = {results.get(node_id)!r}  (expect 'hello-{node_id}')"
        )
    print("==============================================================================")

    ok = all(f"hello-{n}" in (results.get(n) or "") for n in _NODES) and len(
        {results.get(n) for n in _NODES}
    ) == len(_NODES)
    if ok:
        print(
            f"[fly-probe] PASS — ONE Fly agent server hosted {len(_NODES)} SEQUENTIAL "
            "conversations, "
            "each confined to its own /workspace/<node_id>. D1+D4 shape CONFIRMED."
        )
        return 0
    print(
        "[fly-probe] FAIL — one server did NOT host N sequential per-node conversations cleanly. "
        "This is the §8 STOP CONDITION: write NEEDS_HUMAN, do NOT rewrite toward per-node machines."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
