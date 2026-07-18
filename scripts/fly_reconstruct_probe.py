#!/usr/bin/env python
"""M-h2b probe: exercise the RECONSTRUCT path against the REAL Fly API, with no LLM and no run.

The full ``fly-suspend-restart-e2e`` gate proves the story end to end but costs ~10 minutes and real
model spend per attempt, which makes it a terrible instrument for debugging the one step that is
actually uncertain. This isolates that step:

  1. Boot a real per-run microVM (the ordinary fresh-boot arm).
  2. SUSPEND it, exactly as the gate step does when a run parks.
  3. Wipe ``_RUNS`` — the stand-in for "the backend process died".
  4. Call ``_ensure_run_sandbox`` again and assert it RECONSTRUCTS: no new app, the same machine,
     resumed out of ``suspended``, and the re-derived key actually opens the door (a real
     authenticated request through Flycast).
  5. Tear the app down in a ``finally``.

No agent, no model call — so it is minutes and cents rather than tens of minutes and dollars.

Skips cleanly without ``TVASHTR_FLY_API_TOKEN``. Needs an ACTIVE WireGuard tunnel. NOT in
``make test``.
"""

import os
import re
import sys
import traceback
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _load_dotenv() -> None:
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


def main() -> int:
    _load_dotenv()
    if not os.environ.get("TVASHTR_FLY_API_TOKEN"):
        print("[reconstruct-probe] TVASHTR_FLY_API_TOKEN not set — skipping. (Not a failure.)")
        return 0
    os.environ["TVASHTR_AGENT_SANDBOX"] = "fly"

    from tvashtr.engines import openhands_fly_adapter as mod
    from tvashtr.engines.fly_machines import app_name_for_run

    run_id = str(uuid.uuid4())
    app_name = app_name_for_run(run_id)
    ok = False
    try:
        print(f"[reconstruct-probe] run_id={run_id} app={app_name}")
        print("[reconstruct-probe] STEP 1 — fresh boot…")
        sandbox, is_new = mod._ensure_run_sandbox(run_id)
        assert is_new, "expected a fresh boot"
        machine_id = sandbox.machine.machine_id
        key_before = sandbox.session_api_key
        print(f"[reconstruct-probe]   booted machine={machine_id} ip={sandbox.machine.private_ip}")

        print("[reconstruct-probe] STEP 2 — suspend (what the gate step does)…")
        assert mod.suspend_run_machine(run_id) is True, "suspend did not report success"
        info = sandbox.fly.get_run_machine(app_name)
        print(f"[reconstruct-probe]   machine state={info.state}")
        assert info.is_suspended, f"expected suspended, got {info.state!r}"

        print("[reconstruct-probe] STEP 3 — wipe _RUNS (the backend just died)…")
        with mod._LOCK:
            mod._RUNS.clear()

        print("[reconstruct-probe] STEP 4 — RECONSTRUCT…")
        rebuilt, is_new2 = mod._ensure_run_sandbox(run_id)
        print(f"[reconstruct-probe]   machine={rebuilt.machine.machine_id} (was {machine_id})")
        same_key = rebuilt.session_api_key == key_before
        print(f"[reconstruct-probe]   key re-derived identically: {same_key}")
        print(f"[reconstruct-probe]   nodes dict empty (fresh convos): {rebuilt.nodes == {}}")
        after = rebuilt.fly.get_run_machine(app_name)
        print(f"[reconstruct-probe]   machine state after reconstruct: {after.state}")

        # The re-derived key must actually OPEN THE DOOR — the whole point of deriving it.
        import httpx

        health = httpx.get(f"{rebuilt.machine.flycast_host}/health", timeout=30.0)
        keyed = httpx.get(
            f"{rebuilt.machine.flycast_host}/api/conversations",
            headers={"X-Session-API-Key": rebuilt.session_api_key},
            timeout=30.0,
        )
        unkeyed = httpx.get(f"{rebuilt.machine.flycast_host}/api/conversations", timeout=30.0)
        # The KEYED request must get PAST auth — it need not be 2xx. A bare GET on this endpoint
        # answers 422 (missing required query params), which is the agent server's *validation*
        # talking, i.e. proof the key was accepted. The discriminator is 401/403, which is exactly
        # what the unkeyed request gets: same URL, same instant, only the header differs.
        keyed_accepted = keyed.status_code not in (401, 403)
        unkeyed_rejected = unkeyed.status_code in (401, 403)
        print(f"[reconstruct-probe]   /health after resume            : {health.status_code}")
        print(
            f"[reconstruct-probe]   KEYED /api/* accepted (not 401) : "
            f"{keyed_accepted} (HTTP {keyed.status_code})"
        )
        print(
            f"[reconstruct-probe]   UNKEYED /api/* rejected         : "
            f"{unkeyed_rejected} (HTTP {unkeyed.status_code})"
        )

        ok = (
            rebuilt.machine.machine_id == machine_id
            and rebuilt.session_api_key == key_before
            and rebuilt.nodes == {}
            and not after.is_suspended
            and 200 <= health.status_code < 300
            and keyed_accepted
            and unkeyed_rejected
        )
    except Exception:
        print("[reconstruct-probe] EXCEPTION — this is the failure the e2e was hiding:")
        traceback.print_exc()
    finally:
        try:
            mod.close_run_machine(run_id)
            print(f"[reconstruct-probe] torn down {app_name}")
        except Exception:
            print(f"[reconstruct-probe] WARNING: teardown failed for {app_name}")

    print(f"[reconstruct-probe] {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
