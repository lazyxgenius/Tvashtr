"""M-wsgc — the per-run agent workspace is reclaimed (run-end delete + reconcile sweep).

REPRODUCE-FIRST (two bugs, in sequence).

**The leak.** ``make_local_workspace`` creates ``.tvashtr_workspaces/<run_id>`` for EVERY run —
greenfield (the throwaway build dir) and brownfield (the ``git worktree`` of the user's real repo) —
and, before this milestone, NOTHING ever removed it. Every run leaked a directory onto the backend's
disk, forever: the registered PROJECTPLAN §15 item, and the same unbounded-growth shape the hosted
clone GC already closed one substrate over.
:func:`test_run_end_teardown_deletes_a_terminal_brownfield_workspace` is that bug: on the pre-change
code it failed with ``AssertionError: a terminal brownfield worktree was left on disk``.

**The over-reap the first fix introduced.** Mirroring ``clone_reaper``'s status-only rule reaped
EVERY terminal workspace — including greenfield ones, whose directory is the run's only artifact
(``idempotent_ship`` commits + tags inside it; there is no remote) and the source
``run_diff._greenfield_files`` serves the run view's "Changes" tab from. That is the opposite of
disk hygiene: it destroys the deliverable.
:func:`test_run_end_teardown_never_reclaims_a_greenfield_workspace`,
:func:`test_the_sweep_never_reclaims_a_greenfield_workspace` and
:func:`test_a_terminal_greenfield_runs_changes_tab_still_works_after_a_sweep` are THAT bug — twelve
failures against the status-only reaper, all of the shape "a completed GREENFIELD run's deliverable
was destroyed".

These tests are MUTATION-REAL, exactly like ``test_clone_gc.py``. Every one of them creates actual
directories with actual files under a tmp workspace root and actual ``runs`` rows in the database,
then asserts on what is left on disk afterwards. Nothing here asserts that a mock was called: the
reaper's whole contract is "which directories still exist", so that is what is measured.
"""

import os
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from conftest import auth_user_id

from tvashtr.config import get_settings
from tvashtr.control_plane import team_run, workspace_reaper
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import Run

TERMINAL_STATUSES = ("completed", "failed", "rejected", "cancelled", "over_budget")


def _use_tmp_workspace_root(monkeypatch, tmp_path) -> Path:
    """Point the workspace root at a tmp dir so these tests mutate REAL directories, never the
    repo's own ``.tvashtr_workspaces``.

    ``team_run`` reads the root through the ``workspace_reaper`` module object rather than importing
    the constant by value, so this single patch redirects BOTH reclaim paths."""
    root = tmp_path / ".tvashtr_workspaces"
    root.mkdir()
    monkeypatch.setattr(workspace_reaper, "WORKSPACE_ROOT", root)
    return root


def _make_run(status: str, repo_path: str | None = "/tmp/some-real-repo") -> str:
    """A REAL ``runs`` row. The reap decision is read from this row, so it IS the fixture.

    ``repo_path`` is the DELIVERABLE-AWARENESS axis and defaults to BROWNFIELD here, because
    brownfield is the only run type whose workspace is reclaimable at all: its deliverable is the
    ``tvashtr/<run_id>`` branch in the user's REAL repo, so the worktree under
    ``.tvashtr_workspaces`` is a disposable checkout. Pass ``repo_path=None`` for a GREENFIELD run,
    whose workspace *is* the deliverable and must therefore never be reaped."""
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=auth_user_id(),
                idea="m-wsgc fixture",
                workflow_id=run_id,
                status=status,
                repo_path=repo_path,
            )
        )
    return run_id


def _seed_workspace(root: Path, run_id: str) -> Path:
    """A workspace dir with real nested content, so a delete has to actually recurse. Shaped like a
    real greenfield workspace: the shipped source tree plus the ``.git`` the ship step inits."""
    workspace = root / run_id
    (workspace / ".git").mkdir(parents=True)
    (workspace / ".git" / "config").write_text("[core]\n")
    (workspace / "src").mkdir()
    (workspace / "src" / "main.py").write_text("print('shipped')\n")
    return workspace


# ---------------------------------------------------------------------------------------------
# RECLAIM PATH 1 — the run-end delete (rides ``_run_end_teardown``, every terminal path).
# ---------------------------------------------------------------------------------------------


def test_run_end_teardown_deletes_a_terminal_brownfield_workspace(client, monkeypatch, tmp_path):
    """THE BUG: every completed run's workspace sat on disk forever. Teardown reclaims the ones it
    safely can — a brownfield worktree, whose deliverable is the branch in the user's real repo."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = _make_run("completed")
    workspace = _seed_workspace(root, run_id)
    assert workspace.exists()

    team_run._run_end_teardown(run_id)

    assert not workspace.exists(), "a terminal brownfield worktree was left on disk"


@pytest.mark.parametrize("status", TERMINAL_STATUSES)
def test_run_end_teardown_reclaims_every_terminal_status(client, monkeypatch, tmp_path, status):
    """All five terminals reclaim a BROWNFIELD worktree — not just the happy one."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = _make_run(status)
    workspace = _seed_workspace(root, run_id)

    team_run._run_end_teardown(run_id)

    assert not workspace.exists(), f"a {status} brownfield worktree was left on disk"


@pytest.mark.parametrize("status", ["pending", "running", "awaiting_human"])
def test_run_end_teardown_spares_a_live_runs_workspace(client, monkeypatch, tmp_path, status):
    """THE RESUME-SAFETY INVARIANT — the exact reason ``clone_reaper`` spares a live clone, and it
    binds harder here. ``_run_end_teardown`` rides a ``finally``, which ALSO fires where the
    run is NOT finished: a step raising mid-walk unwinds through it while the row still reads
    ``running``, and DBOS may then RECOVER that workflow. ``make_local_workspace`` is
    ``mkdir(exist_ok=True)`` and ``add_worktree`` short-circuits on *``.git`` already present*, so a
    resumed run whose workspace we deleted would resume onto an EMPTY directory — every file the
    agent already produced silently gone, and for a brownfield run its ``git worktree`` registration
    dangling. ``awaiting_human`` is the starkest case: a run parked at an approval gate, possibly
    overnight, whose work-in-progress is sitting in that directory."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = _make_run(status)
    workspace = _seed_workspace(root, run_id)

    team_run._run_end_teardown(run_id)

    assert workspace.is_dir(), f"a {status} run's workspace was destroyed — a resume finds none"
    assert (workspace / "src" / "main.py").exists(), "the workspace was partially destroyed"


def test_run_end_teardown_is_a_no_op_without_a_workspace(client, monkeypatch, tmp_path):
    """A run that failed before its first agent step never made a workspace — byte-identical."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = _make_run("completed")

    team_run._run_end_teardown(run_id)  # must not raise

    assert list(root.iterdir()) == [], "the no-workspace path touched the workspace root"


def test_the_run_end_delete_cannot_escape_the_workspace_root(monkeypatch, tmp_path):
    """FENCE 1. A run id that is not UUID-shaped can never name a path, so no traversal reaches
    outside the root — the delete refuses rather than resolving it."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    precious = tmp_path / "precious"
    precious.mkdir()
    (precious / "irreplaceable.txt").write_text("the operator's real repo\n")

    for hostile in ("../precious", "../../precious", "/etc", "", "..", "not-a-uuid"):
        assert workspace_reaper.delete_run_workspace(hostile) is False

    assert (precious / "irreplaceable.txt").exists(), "the delete escaped the workspace root"
    assert root.is_dir()


def test_the_run_end_delete_never_raises_when_the_database_is_unreachable(monkeypatch, tmp_path):
    """Teardown must never mask the run's real terminal, which keeps unwinding out of the caller's
    ``finally``. A database that is down is the realistic way this could throw."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = str(uuid.uuid4())
    workspace = _seed_workspace(root, run_id)

    with patch.object(workspace_reaper, "_spared_run_ids", side_effect=RuntimeError("db is down")):
        assert workspace_reaper.delete_run_workspace(run_id) is False  # no exception

    assert workspace.is_dir(), "an unknown-liveness workspace was deleted — it must be spared"


# ---------------------------------------------------------------------------------------------
# THE DELIVERABLE RULE — where this reaper deliberately DIVERGES from ``clone_reaper``.
#
# A clone is a COPY of something the user already has (their GitHub repo), so reclaiming it loses
# nothing. A GREENFIELD workspace is the OPPOSITE: ``idempotent_ship`` commits and tags INSIDE
# it and
# there is no remote, so that directory is the run's one and only artifact — and
# ``run_diff._greenfield_files`` serves the run view's "Changes" tab straight out of it. Reaping a
# terminal greenfield workspace does not reclaim disk, it DESTROYS THE DELIVERABLE.
#
# So liveness alone is not a sufficient rule here. Both reclaim paths read ``repo_path`` too:
#   REAP  iff the run row is ABSENT, or (terminal AND brownfield/hosted).
#   SPARE any live run (any type) AND every greenfield run (any status, forever).
# ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize("status", TERMINAL_STATUSES)
def test_run_end_teardown_never_reclaims_a_greenfield_workspace(
    client, monkeypatch, tmp_path, status
):
    """THE CORRECTION. A greenfield run's workspace is its ONLY deliverable — the shipped commit +
    tag live in that directory's own git repo and nowhere else. Reclaiming it at run-end would
    delete the very thing the run produced, for every terminal status."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = _make_run(status, repo_path=None)
    workspace = _seed_workspace(root, run_id)

    team_run._run_end_teardown(run_id)

    assert workspace.is_dir(), f"a {status} GREENFIELD run's deliverable was destroyed"
    assert (workspace / "src" / "main.py").exists(), "the deliverable was partially destroyed"


@pytest.mark.parametrize("status", TERMINAL_STATUSES)
def test_the_sweep_never_reclaims_a_greenfield_workspace(client, monkeypatch, tmp_path, status):
    """And the sweep must apply the SAME rule — otherwise the run-end spare would merely DELAY the
    deletion to the next boot, which is the whole point of routing this through ``repo_path``
    rather than through the teardown call site."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    workspace = _seed_workspace(root, _make_run(status, repo_path=None))

    assert workspace_reaper.sweep_orphaned_workspaces() == 0

    assert (workspace / "src" / "main.py").exists(), (
        f"the sweep destroyed a {status} GREENFIELD run's deliverable"
    )


def test_the_sweep_reaps_brownfield_and_absent_but_spares_greenfield_and_live(
    client, monkeypatch, tmp_path
):
    """THE WHOLE RULE IN ONE SWEEP — all four cases together, since the decision is per-directory.

    Reaped: the terminal BROWNFIELD run (its deliverable is the branch in the user's real repo, so
    the worktree checkout is disposable) and the ABSENT run (nothing will ever come back for it).
    Spared: the terminal GREENFIELD run (its workspace IS the deliverable) and the LIVE run (a
    resume needs the directory)."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    brownfield = _seed_workspace(root, _make_run("completed", repo_path="/tmp/real-repo"))
    absent = _seed_workspace(root, str(uuid.uuid4()))
    greenfield = _seed_workspace(root, _make_run("completed", repo_path=None))
    live = _seed_workspace(root, _make_run("awaiting_human", repo_path=None))

    assert workspace_reaper.sweep_orphaned_workspaces() == 2

    assert not brownfield.exists(), "a terminal brownfield worktree was not reclaimed"
    assert not absent.exists(), "an orphaned workspace was not reclaimed"
    assert greenfield.is_dir(), "a terminal GREENFIELD run's deliverable was destroyed"
    assert live.is_dir(), "a LIVE run's workspace was reaped — a resume would find nothing"


def test_a_terminal_greenfield_runs_changes_tab_still_works_after_a_sweep(client, monkeypatch):
    """THE PRODUCT-LEVEL PROOF, end to end and against the REAL root (no monkeypatched path).

    This is the inverse of the assertion this file carried before the correction: back then it
    proved a GC'd greenfield diff degraded to ``[]``/200 rather than 500-ing. The ruling is that it
    must not be GC'd at all — so ship a real greenfield run, sweep, and assert the run view's
    "Changes" tab STILL SERVES ITS FILES."""
    from tvashtr.control_plane.shipping import idempotent_ship, init_workspace_repo

    run_id = str(uuid.uuid4())
    workspace = Path(workspace_reaper.workspace_dir_for_run(run_id))
    workspace.mkdir(parents=True, exist_ok=True)
    try:
        init_workspace_repo(str(workspace))
        (workspace / "greeting.txt").write_text("hello\nworld\n", encoding="utf-8")
        ship = idempotent_ship(str(workspace), run_id)
        with session_scope() as session:
            session.add(
                Run(
                    id=uuid.UUID(run_id),
                    team_graph_id=uuid.UUID(build_two_node_team()),
                    owner_id=auth_user_id(),
                    idea="m-wsgc greenfield deliverable",
                    workflow_id=run_id,
                    status="completed",
                    repo_path=None,  # GREENFIELD — the workspace is the deliverable
                    ship_commit_sha=ship["sha"],
                    ship_tag=ship["tag"],
                )
            )

        before = client.get(f"/api/runs/{run_id}/diff")
        assert before.status_code == 200 and before.json()["total"] == 1, before.text

        assert workspace_reaper.delete_run_workspace(run_id) is False  # run-end spares it
        workspace_reaper.sweep_orphaned_workspaces()  # and so does the sweep

        assert workspace.is_dir(), "the greenfield deliverable was reclaimed"
        after = client.get(f"/api/runs/{run_id}/diff")
        assert after.status_code == 200, after.text
        assert after.json()["total"] == 1, "the Changes tab lost the run's files"
        assert after.json()["files"][0]["path"] == "greeting.txt"
    finally:
        import shutil

        shutil.rmtree(workspace, ignore_errors=True)


# ---------------------------------------------------------------------------------------------
# RECLAIM PATH 2 — the boot + periodic reconcile sweep.
# ---------------------------------------------------------------------------------------------


def test_the_sweep_reaps_a_terminal_runs_workspace(client, monkeypatch, tmp_path):
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    workspace = _seed_workspace(root, _make_run("completed"))

    assert workspace_reaper.sweep_orphaned_workspaces() == 1

    assert not workspace.exists()


def test_the_sweep_reaps_a_workspace_whose_run_is_gone(monkeypatch, tmp_path):
    """No Run row at all — a deleted run (``delete_library_team_and_runs`` removes the row but has
    never touched the disk), or a directory that never had one. ABSENT ⇒ reapable."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    workspace = _seed_workspace(root, str(uuid.uuid4()))

    assert workspace_reaper.sweep_orphaned_workspaces() == 1

    assert not workspace.exists()


@pytest.mark.parametrize("status", ["pending", "running", "awaiting_human"])
def test_the_sweep_spares_a_live_runs_workspace(client, monkeypatch, tmp_path, status):
    """The resume-safety invariant again, on the sweep side — an in-flight or parked run's workspace
    must survive a boot sweep, precisely the moment its workflow is about to be RECOVERED."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    workspace = _seed_workspace(root, _make_run(status))

    assert workspace_reaper.sweep_orphaned_workspaces() == 0

    assert (workspace / "src" / "main.py").exists()


def test_the_sweep_reaps_orphans_and_spares_the_live_one_together(client, monkeypatch, tmp_path):
    """A LIVE run, a TERMINAL BROWNFIELD run and an ABSENT run seeded together,
    one sweep — the live one is spared and the other two reaped. Reconciliation is per-directory,
    not all-or-nothing."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    terminal = _seed_workspace(root, _make_run("failed"))
    absent = _seed_workspace(root, str(uuid.uuid4()))
    live = _seed_workspace(root, _make_run("awaiting_human"))

    assert workspace_reaper.sweep_orphaned_workspaces() == 2

    assert not terminal.exists(), "the terminal run's workspace survived the sweep"
    assert not absent.exists(), "the absent run's workspace survived the sweep"
    assert live.is_dir(), "the LIVE run's workspace was reaped — a resume would find nothing"
    assert (live / "src" / "main.py").exists(), "the live workspace was partially destroyed"


def test_the_sweep_never_touches_anything_outside_the_workspace_root(client, monkeypatch, tmp_path):
    """THE NEVER-TOUCH RULE. Only direct children of the root are ever candidates: a sibling
    directory next to the root, and a loose file inside it, both survive."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    precious = tmp_path / "precious"
    (precious / "src").mkdir(parents=True)
    (precious / "src" / "main.py").write_text("real work\n")
    loose = root / "notes.txt"
    loose.write_text("not a directory\n")
    _seed_workspace(root, _make_run("completed"))

    assert workspace_reaper.sweep_orphaned_workspaces() == 1

    assert (precious / "src" / "main.py").read_text() == "real work\n"
    assert loose.read_text() == "not a directory\n"


def test_the_sweep_does_not_follow_a_symlink_out_of_the_workspace_root(monkeypatch, tmp_path):
    """FENCE 2. A symlink planted under the root is skipped, not followed — ``scandir`` classifies
    with ``follow_symlinks=False``, so its target is never even a candidate.

    The outcome assertions below cannot prove the fence on their own: ``shutil.rmtree`` refuses a
    symlink independently, so the target would survive even without ``follow_symlinks=False``. So
    this also asserts the link is never HANDED to the remover — the part only the fence provides,
    and the part that keeps the guarantee from resting on a ``shutil`` implementation detail."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    outside = tmp_path / "outside_target"
    outside.mkdir()
    (outside / "irreplaceable.txt").write_text("must survive\n")
    link = root / str(uuid.uuid4())
    link.symlink_to(outside, target_is_directory=True)

    considered: list[Path] = []
    real_rmtree = workspace_reaper._rmtree

    def spy(path):
        considered.append(path)
        return real_rmtree(path)

    with patch.object(workspace_reaper, "_rmtree", side_effect=spy):
        assert workspace_reaper.sweep_orphaned_workspaces() == 0

    assert considered == [], "the symlink was handed to the remover — the fence did not hold"
    assert (outside / "irreplaceable.txt").exists(), "the sweep followed a symlink out of the root"
    assert link.is_symlink(), "the sweep removed the link itself"


def test_the_sweep_refuses_a_symlinked_workspace_root(monkeypatch, tmp_path):
    """If the root itself is a symlink, enumerating it would reach whatever it points at."""
    real = tmp_path / "somewhere_else"
    (real / "irreplaceable").mkdir(parents=True)
    link_root = tmp_path / ".tvashtr_workspaces"
    link_root.symlink_to(real, target_is_directory=True)
    monkeypatch.setattr(workspace_reaper, "WORKSPACE_ROOT", link_root)

    assert workspace_reaper.sweep_orphaned_workspaces() == 0

    assert (real / "irreplaceable").is_dir()


def test_the_sweep_returns_zero_on_a_missing_root(monkeypatch, tmp_path):
    """A backend that never ran an agent has no root. No exception, no disk access."""
    monkeypatch.setattr(workspace_reaper, "WORKSPACE_ROOT", tmp_path / "never_created")

    assert workspace_reaper.sweep_orphaned_workspaces() == 0


def test_the_sweep_returns_zero_on_an_empty_root(monkeypatch, tmp_path):
    _use_tmp_workspace_root(monkeypatch, tmp_path)

    assert workspace_reaper.sweep_orphaned_workspaces() == 0


@pytest.mark.skipif(os.geteuid() == 0, reason="root can delete through a read-only directory")
def test_one_unremovable_workspace_does_not_abort_the_sweep(client, monkeypatch, tmp_path):
    """A REAL permission error (chmod 0o500 ⇒ entries inside cannot be unlinked), not a mock. The
    stubborn directory is logged and skipped; the sweep still reclaims the others."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    stubborn = _seed_workspace(root, _make_run("completed"))
    reapable = _seed_workspace(root, _make_run("completed"))
    stubborn.chmod(0o500)
    try:
        assert workspace_reaper.sweep_orphaned_workspaces() == 1  # no exception
        assert stubborn.is_dir(), "the permission error should have left it in place"
        assert not reapable.exists(), "one stubborn dir aborted the rest of the sweep"
    finally:
        stubborn.chmod(0o700)  # so pytest can clean tmp_path up


def test_the_sweep_never_raises_when_the_database_is_unreachable(monkeypatch, tmp_path):
    """A boot sweep that threw would take down the whole backend over disk hygiene."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    workspace = _seed_workspace(root, str(uuid.uuid4()))

    with patch.object(workspace_reaper, "_spared_run_ids", side_effect=RuntimeError("db is down")):
        assert workspace_reaper.sweep_orphaned_workspaces() == 0  # no exception

    assert workspace.is_dir(), "workspaces were reaped without knowing which runs are live"


# ---------------------------------------------------------------------------------------------
# WIRING — the boot sweep, the cron-registration gate, and the one definition of the root.
# ---------------------------------------------------------------------------------------------


def test_the_boot_sweep_actually_runs_during_lifespan_startup():
    """The sweep is CALLED by the lifespan's startup phase — not merely imported into ``main``.

    Asserting the module attribute alone would be vacuous: replacing the call site with a bare
    reference (or mode-gating it, or moving it after ``yield``) keeps such a test green while the
    only path that reclaims the on-disk backlog silently never fires. So this drives the real
    ``_lifespan`` and asserts the call happened BEFORE the yield — which is what puts it ahead of
    DBOS recovery, since DBOS launches on ``lifespan.startup.complete``.

    The three sibling sweeps are patched out rather than left live: the container sweep in
    particular is host-global, and a test must never reap another checkout's running agent."""
    import asyncio

    from tvashtr import main

    calls: list[str] = []
    with (
        patch.object(main, "sweep_orphaned_workspaces", side_effect=lambda: calls.append("ws")),
        patch.object(main, "sweep_orphaned_clones", side_effect=lambda: calls.append("clone")),
        patch.object(main, "sweep_orphaned_agent_containers", side_effect=lambda: None),
        patch.object(main, "sweep_orphaned_fly_apps", side_effect=lambda: None),
    ):

        async def drive() -> list[str]:
            async with main._lifespan(main.app):
                return list(calls)  # what had run by the time startup completed

        at_yield = asyncio.run(drive())

    assert "ws" in at_yield, "the lifespan never ran the workspace sweep during startup"


def test_the_periodic_sweep_is_not_registered_outside_fly_mode():
    """THE CRON GATE. ``DBOS.scheduled`` registers a poller at IMPORT time and ``DBOS.launch()``
    starts it — which ``make test`` does, via conftest's session-scoped ``with TestClient(app)``.
    Registering unconditionally would arm a real 10-minute cron inside the offline suite and enqueue
    genuine workflow rows at random, depending on wall-clock start time — the stale-PENDING wedge
    this repo has been bitten by. This asserts the gate is doing its job in the mode the suite
    actually runs in."""
    assert get_settings().agent_sandbox_mode != "fly", "this assertion would be vacuous in fly mode"
    assert not hasattr(workspace_reaper, "periodic_workspace_sweep")


def test_both_reclaim_paths_share_one_definition_of_live():
    """The run-end delete and the sweep must never disagree about what "live" means — a divergence
    would show up as a run resuming onto a directory the other path had deleted."""
    assert workspace_reaper.LIVE_STATUSES == frozenset({"pending", "running", "awaiting_human"})


def test_the_reaper_sweeps_the_root_the_greenfield_diff_reads():
    """ONE definition of the workspace root, asserted across the two modules that must agree without
    either importing the openhands SDK.

    ``openhands_adapter._WORKSPACE_ROOT`` is canonical but unreachable from an openhands-free
    module,
    so both this reaper and ``run_diff`` re-derive it (``parents[2]`` is ``backend/`` from either).
    A reaper pointed at a different root than the executor writes to would pass every behavioural
    test above and reclaim nothing, forever — so pin the two replicas together here, and let
    ``make workspace-gc-check`` prove the third (the executor's own, live) agrees at runtime."""
    from tvashtr.control_plane import run_diff

    assert workspace_reaper.WORKSPACE_ROOT == run_diff._WORKSPACE_ROOT
    assert workspace_reaper.WORKSPACE_ROOT.name == ".tvashtr_workspaces"


def test_the_reaper_and_the_executor_spell_the_run_directory_the_same_way(monkeypatch, tmp_path):
    """``workspace_dir_for_run`` is the one place the per-run path is spelled — the same helper the
    gate seeds through, so the gate can never drift from what the reaper sweeps."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = str(uuid.uuid4())

    assert workspace_reaper.workspace_dir_for_run(run_id) == str(root / run_id)
