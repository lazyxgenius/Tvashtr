#!/usr/bin/env python
"""M-clonegc gate: the orphaned hosted-GitHub clone reaper, proven against the REAL filesystem.

This is ``fly_reaper_check.py`` one substrate down. The unit tests prove the reaper's logic under a
monkeypatched clone root; this proves the thing that patch cannot: that the root the reaper actually
sweeps at runtime is the root the executor actually clones into, and that ``shutil.rmtree`` on a
real directory tree really removes it. A reaper pointed at the wrong directory passes every unit
test in the suite and reclaims nothing forever.

TWO FIXTURES, one sweep, three assertions — under the REAL ``CLONE_ROOT``, seeded at the very path
``_hosted_clone_dir`` hands to ``clone_github_repo_step``:

  1. ``<terminal run>`` — a clone dir for a run whose Run row is ``completed``.
     MUST BE REAPED (nothing will ever come back for it; it leaks the user's whole repo otherwise).
  2. ``<live run>``     — a clone dir for a run whose Run row is ``awaiting_human``.
     MUST SURVIVE. This is the load-bearing one: that is a run legitimately parked at an approval
     gate, and ``clone_github_repo_step`` short-circuits on *``repo_path`` already set*, so reaping
     it would resume the run onto a missing directory — the reaper and durable resume would
     silently cancel each other out.
  3. Anything ELSE already under the root is reported, and any pre-existing directory that the
     sweep removed is named — so this gate can never quietly destroy a developer's live clone.

CREDENTIAL-FREE: pure local filesystem + Postgres. No Fly token, no GitHub App, no model provider
key — it never clones anything, it only creates directories. Both fixtures are removed in a
``finally`` regardless of outcome.
"""

import os
import re
import shutil
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


def _seed_clone(path: Path) -> None:
    """A clone dir with real nested content, so the reap has to actually recurse."""
    (path / ".git").mkdir(parents=True, exist_ok=True)
    (path / ".git" / "config").write_text("[core]\n\trepositoryformatversion = 0\n")
    (path / "README.md").write_text("m-clonegc fixture\n")


def main() -> int:
    _load_dotenv()

    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.control_plane.clone_reaper import CLONE_ROOT, sweep_orphaned_clones
    from tvashtr.control_plane.team_run import _hosted_clone_dir
    from tvashtr.control_plane.teams import build_two_node_team
    from tvashtr.db import session_scope
    from tvashtr.main import app
    from tvashtr.models import Run

    terminal_run = str(uuid.uuid4())
    live_run = str(uuid.uuid4())
    # Deliberately via the EXECUTOR's path helper, not by re-deriving it here: if the reaper ever
    # swept a different root than the one clones land in, this gate must fail rather than pass.
    terminal_dir = Path(_hosted_clone_dir(terminal_run))
    live_dir = Path(_hosted_clone_dir(live_run))
    print(f"[clone-gc] CLONE_ROOT              : {CLONE_ROOT}")
    print(f"[clone-gc] executor's clone path   : {terminal_dir.parent}")
    assert terminal_dir.parent == CLONE_ROOT, (
        f"the executor clones into {terminal_dir.parent} but the reaper sweeps {CLONE_ROOT} — "
        "the reaper would reclaim nothing, forever"
    )

    ok = False
    try:
        # The TestClient's lifespan runs the BOOT sweep on __enter__ — so seed the fixtures after
        # it is up, or the boot sweep would reap them before the sweep under test ever runs.
        with TestClient(app) as client:
            login_operator(client)
            me = client.get("/api/auth/me")
            assert me.status_code == 200, me.text
            owner_id = uuid.UUID(me.json()["id"])

            CLONE_ROOT.mkdir(parents=True, exist_ok=True)
            pre_existing = sorted(p.name for p in CLONE_ROOT.iterdir() if p.is_dir())
            print(f"[clone-gc] pre-existing clones     : {pre_existing or 'none'}")

            # --- fixtures: two Run rows, one terminal and one parked at a gate.
            team_graph_id = uuid.UUID(build_two_node_team())
            with session_scope() as session:
                for rid, status in ((terminal_run, "completed"), (live_run, "awaiting_human")):
                    session.add(
                        Run(
                            id=uuid.UUID(rid),
                            team_graph_id=team_graph_id,
                            owner_id=owner_id,
                            idea="m-clonegc reaper gate",
                            workflow_id=rid,
                            status=status,
                        )
                    )
            print(f"[clone-gc] run rows: terminal={terminal_run} live={live_run}")

            # --- fixtures: two REAL directory trees at the executor's own clone paths.
            _seed_clone(terminal_dir)
            _seed_clone(live_dir)
            assert terminal_dir.is_dir() and live_dir.is_dir()
            print(f"[clone-gc] seeded real clone dirs  : {terminal_dir.name}, {live_dir.name}")

            # --- THE SWEEP.
            reaped = sweep_orphaned_clones()
            print(f"[clone-gc] sweep reaped {reaped} clone(s)")

            terminal_gone = not terminal_dir.exists()
            live_survived = (live_dir / ".git" / "config").exists()
            collateral = [n for n in pre_existing if not (CLONE_ROOT / n).exists()]

            print(f"[clone-gc] terminal-run clone REAPED  : {terminal_gone}   ({terminal_dir.name})")
            print(f"[clone-gc] parked-run clone SURVIVED  : {live_survived}   ({live_dir.name})")
            print(f"[clone-gc] pre-existing dirs removed  : {collateral or 'none'}")
            if collateral:
                print(
                    "[clone-gc] NOTE: the above were orphans by the same rule (terminal or absent "
                    "run) — reclaiming them is the reaper working, not a fault of this gate."
                )
            ok = terminal_gone and live_survived
    finally:
        # Both fixtures go, whatever happened. A directory this gate created and left behind is
        # exactly the kind of thing the milestone exists to prevent.
        for path in (terminal_dir, live_dir):
            try:
                shutil.rmtree(path)
            except FileNotFoundError:
                pass
            except Exception as exc:  # noqa: BLE001
                print(f"[clone-gc] WARNING: fixture teardown failed for {path}: {exc}")

    print(f"[clone-gc] {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
