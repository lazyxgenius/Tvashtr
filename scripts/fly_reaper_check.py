#!/usr/bin/env python
"""M-h2b LIVE gate: the orphaned-``tv-run-*`` Fly app reaper, proven against the REAL Fly API.

The unit tests prove the reaper's LOGIC against a mocked app list. This proves the thing a mock
cannot: that ``list_apps`` really parses the operator's real org, that ``delete_app`` really
deletes, and — the assertion that actually matters — that the operator's genuine, unrelated
``cryptoground-data`` app is **still there afterwards**. A reaper that gets the prefix filter
wrong destroys real infrastructure, and no amount of mocking would have told us.

THREE FIXTURES, one sweep, three assertions:

  1. ``tv-run-<terminal run>`` — a real Fly app for a run whose Run row is ``completed``.
     MUST BE REAPED (it would bill forever otherwise; nothing will ever come back for it).
  2. ``tv-run-<parked run>``   — a real Fly app for a run whose Run row is ``awaiting_human``.
     MUST SURVIVE. This is the load-bearing one: that is a run legitimately parked (and SUSPENDED)
     at an approval gate, possibly overnight. Reaping it would destroy exactly the durability M-h2b
     exists to provide — the reaper and suspend-on-gate would silently cancel each other out.
  3. ``cryptoground-data``     — the operator's real app. MUST BE UNTOUCHED, asserted BY NAME.

CHEAP BY CONSTRUCTION: the fixtures are apps with NO machines. A Fly app with no machine costs
nothing, so this gate exercises the whole reap path without booting a single microVM or spending a
cent on compute. Both fixtures are deleted in a ``finally`` regardless of outcome.

Skips cleanly (exit 0, "not a failure") without ``TVASHTR_FLY_API_TOKEN``. Needs an ACTIVE
WireGuard tunnel only insofar as the Machines REST API must be reachable. NOT in ``make test``.
"""

import os
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _load_dotenv() -> None:
    """Parse ``.env`` by hand. A plain shell ``source`` breaks on lines like ``x-api-key=…`` whose
    key is not a valid shell identifier, so every script in this repo parses it this way."""
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


# The operator's real, unrelated app. The whole point of the prefix rule is that this survives.
PROTECTED_APP = os.environ.get("TVASHTR_FLY_PROTECTED_APP", "cryptoground-data")


def main() -> int:
    _load_dotenv()
    if not os.environ.get("TVASHTR_FLY_API_TOKEN"):
        print("[fly-reaper] TVASHTR_FLY_API_TOKEN not set — skipping. (Not a failure.)")
        return 0

    # Pin the posture BEFORE the settings cache is populated: the sweep is fly-mode-gated.
    os.environ["TVASHTR_AGENT_SANDBOX"] = "fly"

    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.config import get_settings
    from tvashtr.control_plane.fly_reaper import sweep_orphaned_fly_apps
    from tvashtr.control_plane.teams import build_two_node_team
    from tvashtr.db import session_scope
    from tvashtr.engines.fly_machines import FlyMachines, app_name_for_run, network_name_for_owner
    from tvashtr.main import app
    from tvashtr.models import Run

    settings = get_settings()
    terminal_run = str(uuid.uuid4())
    parked_run = str(uuid.uuid4())
    terminal_app = app_name_for_run(terminal_run)
    parked_app = app_name_for_run(parked_run)

    fly = FlyMachines(
        token=settings.fly_api_token.get_secret_value(),
        org=settings.fly_org,
        image=settings.fly_agent_image,
    )
    ok = False
    try:
        with TestClient(app) as client:
            login_operator(client)
            me = client.get("/api/auth/me")
            assert me.status_code == 200, me.text
            owner_id = uuid.UUID(me.json()["id"])

            # --- fixtures: two Run rows, one terminal and one parked at a gate.
            team_graph_id = uuid.UUID(build_two_node_team())
            with session_scope() as session:
                for rid, status in ((terminal_run, "completed"), (parked_run, "awaiting_human")):
                    session.add(
                        Run(
                            id=uuid.UUID(rid),
                            team_graph_id=team_graph_id,
                            owner_id=owner_id,
                            idea="m-h2b reaper live gate",
                            workflow_id=rid,
                            status=status,
                        )
                    )
            print(f"[fly-reaper] run rows: terminal={terminal_run} parked={parked_run}")

            # --- fixtures: two REAL Fly apps (no machines ⇒ no compute cost).
            network = network_name_for_owner(owner_id)
            fly.create_app(terminal_app, network)
            fly.create_app(parked_app, network)
            print(f"[fly-reaper] created real apps: {terminal_app}, {parked_app}")

            before = fly.list_apps()
            assert PROTECTED_APP in before, (
                f"{PROTECTED_APP} is not in the org before the sweep — this gate's central "
                f"assertion would be vacuous. Saw: {before}"
            )
            print(f"[fly-reaper] org before sweep ({len(before)} apps): {sorted(before)}")

            # --- THE SWEEP.
            reaped = sweep_orphaned_fly_apps()
            print(f"[fly-reaper] sweep reaped {reaped} app(s)")

            after = fly.list_apps()
            print(f"[fly-reaper] org after sweep  ({len(after)} apps): {sorted(after)}")

            terminal_gone = terminal_app not in after
            parked_survived = parked_app in after
            protected_untouched = PROTECTED_APP in after

            print(f"[fly-reaper] terminal-run app REAPED     : {terminal_gone}   ({terminal_app})")
            print(f"[fly-reaper] parked-run app SURVIVED     : {parked_survived}   ({parked_app})")
            print(
                f"[fly-reaper] {PROTECTED_APP} UNTOUCHED : "
                f"{protected_untouched}   (never matched by the tv-run- prefix)"
            )
            ok = terminal_gone and parked_survived and protected_untouched
    finally:
        # Both fixtures go, whatever happened. An app we created and left behind is exactly the
        # kind of thing this gate exists to prevent.
        for name in (terminal_app, parked_app):
            try:
                fly.delete_app(name)
            except Exception as exc:  # noqa: BLE001
                print(f"[fly-reaper] WARNING: fixture teardown failed for {name}: {exc}")
        fly.close()

    print(f"[fly-reaper] {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
