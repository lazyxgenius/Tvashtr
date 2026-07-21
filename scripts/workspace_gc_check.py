#!/usr/bin/env python
"""M-wsgc gate: the orphaned agent-workspace reaper, proven against the REAL filesystem.

This is ``clone_gc_check.py`` one directory over — and the reason it exists is the same. The unit
tests prove the reaper's logic under a monkeypatched workspace root; this proves the thing that
patch cannot: **that the root the reaper actually sweeps at runtime is the root the EXECUTOR
actually writes runs into.** A reaper pointed at the wrong directory passes every unit test in the
suite and reclaims nothing, forever. Because ``.tvashtr_workspaces``' canonical definition lives in
``openhands_adapter`` (which the reaper may not import — it would drag the agent SDK into app
startup), that agreement is a REPLICATED constant, and a replicated constant is exactly the kind of
thing that drifts silently. So this gate seeds through the executor's own ``make_local_workspace``
rather than re-deriving the path, and fails loudly if the two ever diverge.

FIVE FIXTURES, one sweep, six assertions — under the REAL ``WORKSPACE_ROOT``, seeded at the very
paths ``make_local_workspace`` hands to the agent step. Three must go, two must stay:

  1. ``<terminal BROWNFIELD run>`` — ``completed``, ``repo_path`` SET.
     MUST BE REAPED. Its workspace is a ``git worktree`` CHECKOUT; the deliverable is the
     ``tvashtr/<run_id>`` branch in the user's real repo and is untouched by removing the checkout.
  2. ``<absent run>``   — a workspace with NO Run row at all (a deleted run, or a directory that
     never had one: ``delete_library_team_and_runs`` removes rows and has never touched the disk).
     MUST BE REAPED.
  3. ``<UN-PERSISTED terminal GREENFIELD run>`` — ``completed``, ``repo_path`` NULL, and NO
     ``run_artifacts`` row.
     MUST SURVIVE. **This is the deliverable-awareness assertion**, and the one thing this gate
     tests that ``clone_gc_check`` has no analogue for: such a workspace holds the run's shipped
     commit + tag, there is no remote, and its diff is durable nowhere else — so it IS the artifact.
     A reaper that treats it like a clone destroys the user's work while reporting healthy disk
     hygiene. This is the live proof of the HARD INVARIANT: **never reap a greenfield workspace
     before its diff is durably saved.**
  4. ``<PERSISTED terminal GREENFIELD run>`` — ``completed``, ``repo_path`` NULL, WITH a
     ``run_artifacts`` row.
     MUST BE REAPED (M-wsgc S1). ``ship_step`` snapshots a greenfield run's whole diff into the
     database at ship time and ``/diff`` serves it from there, so once that row exists the directory
     is a redundant copy and the growth item finally closes. Seeded beside fixture 3 deliberately:
     the two differ ONLY by that row, so the sweep's opposite verdicts on them isolate the persist
     gate from every other axis.
  5. ``<live run>``     — a workspace for a run whose Run row is ``awaiting_human``.
     MUST SURVIVE. That is a run legitimately parked at an approval gate, and
     ``make_local_workspace`` is ``mkdir(exist_ok=True)`` while ``add_worktree`` short-circuits on
     *``.git`` already present*, so reaping it would resume the run onto an EMPTY directory — every
     file the agent already produced silently gone. The reaper and durable resume would quietly
     cancel each other out.
  6. Anything ELSE already under the root is reported, and any pre-existing directory that the sweep
     removed is named — so this gate can never quietly destroy a developer's live workspace.

CREDENTIAL-FREE and DOCKER-FREE: pure local filesystem + Postgres. No Fly token, no GitHub App, no
model provider key, no container — it never runs an agent, it only creates directories. Every
fixture is removed in a ``finally`` regardless of outcome.
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


def _seed_workspace(path: Path) -> None:
    """A workspace with real nested content, so the reap has to actually recurse. Shaped like a real
    greenfield workspace: the shipped source tree plus the ``.git`` the ship step inits."""
    (path / ".git").mkdir(parents=True, exist_ok=True)
    (path / ".git" / "config").write_text("[core]\n\trepositoryformatversion = 0\n")
    (path / "src").mkdir(parents=True, exist_ok=True)
    (path / "src" / "main.py").write_text("print('m-wsgc fixture')\n")


def main() -> int:
    _load_dotenv()

    from fastapi.testclient import TestClient
    from operator_session import login_operator

    # The EXECUTOR's own workspace helper — deliberately imported (it pulls the openhands SDK, which
    # is fine here: this gate is docker-free, not openhands-free) so the path assertion below is
    # against what runs really use, not against a re-derivation that could drift with it.
    from tvashtr.control_plane.teams import build_two_node_team
    from tvashtr.control_plane.workspace_reaper import WORKSPACE_ROOT, sweep_orphaned_workspaces
    from tvashtr.db import session_scope
    from tvashtr.engines.openhands_adapter import make_local_workspace
    from tvashtr.main import app
    from tvashtr.models import Run, RunArtifact

    brownfield_run = str(uuid.uuid4())
    absent_run = str(uuid.uuid4())
    greenfield_run = str(uuid.uuid4())
    persisted_run = str(uuid.uuid4())
    live_run = str(uuid.uuid4())

    ok = False
    created: list[Path] = []
    try:
        # The TestClient's lifespan runs the BOOT sweep on __enter__ — so seed the fixtures after it
        # is up, or the boot sweep would reap them before the sweep under test ever runs.
        with TestClient(app) as client:
            login_operator(client)
            me = client.get("/api/auth/me")
            assert me.status_code == 200, me.text
            owner_id = uuid.UUID(me.json()["id"])

            # --- THE ROOT-AGREEMENT ASSERTION (the thing the unit tests structurally cannot make).
            brownfield_dir = Path(make_local_workspace(brownfield_run))
            absent_dir = Path(make_local_workspace(absent_run))
            greenfield_dir = Path(make_local_workspace(greenfield_run))
            persisted_dir = Path(make_local_workspace(persisted_run))
            live_dir = Path(make_local_workspace(live_run))
            created = [brownfield_dir, absent_dir, greenfield_dir, persisted_dir, live_dir]
            fixture_ids = {brownfield_run, absent_run, greenfield_run, persisted_run, live_run}
            print(f"[workspace-gc] WORKSPACE_ROOT             : {WORKSPACE_ROOT}")
            print(f"[workspace-gc] executor's workspace path  : {brownfield_dir.parent}")
            assert brownfield_dir.parent == WORKSPACE_ROOT, (
                f"the executor writes workspaces into {brownfield_dir.parent} but the "
                f"reaper sweeps "
                f"{WORKSPACE_ROOT} — the reaper would reclaim nothing, forever"
            )

            pre_existing = sorted(
                p.name for p in WORKSPACE_ROOT.iterdir() if p.is_dir() and p.name not in fixture_ids
            )
            print(f"[workspace-gc] pre-existing workspaces    : {pre_existing or 'none'}")

            # --- fixtures: three Run rows (the fourth run deliberately has NO row at all).
            # ``repo_path`` is the axis under test: NON-NULL = brownfield (a disposable worktree
            # checkout), NULL = greenfield (the workspace IS the run's deliverable).
            team_graph_id = uuid.UUID(build_two_node_team())
            with session_scope() as session:
                for rid, status, repo_path in (
                    (brownfield_run, "completed", "/tmp/m-wsgc-gate-fake-repo"),
                    (greenfield_run, "completed", None),
                    (persisted_run, "completed", None),
                    (live_run, "awaiting_human", None),
                ):
                    session.add(
                        Run(
                            id=uuid.UUID(rid),
                            team_graph_id=team_graph_id,
                            owner_id=owner_id,
                            idea="m-wsgc reaper gate",
                            workflow_id=rid,
                            status=status,
                            repo_path=repo_path,
                        )
                    )
                # S1: the ONLY difference between the two greenfield fixtures — the durable diff
                # snapshot ``ship_step`` writes, which is what licenses the reap.
                session.add(
                    RunArtifact(
                        run_id=uuid.UUID(persisted_run),
                        files={
                            "run_id": persisted_run,
                            "base_ref": None,
                            "ship_branch": None,
                            "files": [
                                {
                                    "path": "src/main.py",
                                    "status": "added",
                                    "additions": 1,
                                    "deletions": 0,
                                    "patch": "+print('m-wsgc fixture')\n",
                                }
                            ],
                            "total": 1,
                        },
                    )
                )
            print(f"[workspace-gc] terminal BROWNFIELD run    : {brownfield_run}")
            print(f"[workspace-gc] GREENFIELD, NO artifact    : {greenfield_run}")
            print(f"[workspace-gc] GREENFIELD, PERSISTED      : {persisted_run}")
            print(f"[workspace-gc] live (awaiting_human) run  : {live_run}")
            print(f"[workspace-gc] no run row (absent)        : {absent_run}")

            # --- fixtures: four REAL directory trees at the executor's own workspace paths.
            for path in created:
                _seed_workspace(path)
            assert all(p.is_dir() for p in created)
            print(f"[workspace-gc] seeded real workspace dirs : {len(created)}")

            # --- THE SWEEP.
            reaped = sweep_orphaned_workspaces()
            print(f"[workspace-gc] sweep reaped {reaped} workspace(s)")

            brownfield_gone = not brownfield_dir.exists()
            absent_gone = not absent_dir.exists()
            greenfield_survived = (greenfield_dir / "src" / "main.py").exists()
            persisted_gone = not persisted_dir.exists()
            live_survived = (live_dir / "src" / "main.py").exists()
            collateral = [n for n in pre_existing if not (WORKSPACE_ROOT / n).exists()]

            print(f"[workspace-gc] brownfield ws REAPED       : {brownfield_gone}   (worktree)")
            print(f"[workspace-gc] absent-run  ws REAPED      : {absent_gone}   (orphan)")
            print(
                f"[workspace-gc] GREENFIELD  ws SURVIVED    : {greenfield_survived}   (DELIVERABLE,"
                " not yet persisted)"
            )
            print(
                f"[workspace-gc] PERSISTED   ws REAPED      : {persisted_gone}   (diff is durable "
                "in run_artifacts)"
            )
            print(f"[workspace-gc] parked-run  ws SURVIVED    : {live_survived}   (resumable)")
            print(f"[workspace-gc] pre-existing dirs removed  : {collateral or 'none'}")
            if collateral:
                print(
                    "[workspace-gc] NOTE: the above were orphans by the same rule (absent row, or "
                    "terminal AND brownfield) — the reaper working, not a fault of this gate."
                )
            ok = (
                brownfield_gone
                and absent_gone
                and greenfield_survived
                and persisted_gone
                and live_survived
            )
    finally:
        # Every fixture goes, whatever happened. A directory this gate created and left behind is
        # exactly the kind of thing the milestone exists to prevent.
        for path in created:
            try:
                shutil.rmtree(path)
            except FileNotFoundError:
                pass
            except Exception as exc:  # noqa: BLE001
                print(f"[workspace-gc] WARNING: fixture teardown failed for {path}: {exc}")

    print(f"[workspace-gc] {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
