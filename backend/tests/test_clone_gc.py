"""M-clonegc — the per-run hosted-GitHub clone is reclaimed (run-end delete + reconcile sweep).

REPRODUCE-FIRST: ``clone_github_repo_step`` creates ``.tvashtr_clones/<run_id>`` and, before this
milestone, NOTHING ever removed it — every hosted run leaked a full working copy of the user's repo
onto the backend's disk. :func:`test_run_end_teardown_deletes_a_terminal_runs_clone` is that bug: on
the pre-change code it failed with ``AssertionError: a terminal run's clone was left on disk``.

These tests are MUTATION-REAL. Every one of them creates actual directories with actual files under
a tmp clone root and actual ``runs`` rows in the database, then asserts on what is left on disk
afterwards. Nothing here asserts that a mock was called: the reaper's whole contract is "which
directories still exist", so that is what is measured.
"""

import os
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from conftest import auth_user_id

from tvashtr.config import get_settings
from tvashtr.control_plane import clone_reaper, team_run
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import Run

TERMINAL_STATUSES = ("completed", "failed", "rejected", "cancelled", "over_budget")


def _use_tmp_clone_root(monkeypatch, tmp_path) -> Path:
    """Point the clone root at a tmp dir so these tests mutate REAL directories, never the repo's.

    ``team_run`` reads the root through the ``clone_reaper`` module object rather than importing the
    constant by value, so this single patch redirects BOTH reclaim paths."""
    root = tmp_path / ".tvashtr_clones"
    root.mkdir()
    monkeypatch.setattr(clone_reaper, "CLONE_ROOT", root)
    return root


def _make_run(status: str) -> str:
    """A REAL ``runs`` row in the given status. Liveness is read from this table, so the row IS the
    fixture that decides keep-vs-reap."""
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=auth_user_id(),
                idea="m-clonegc fixture",
                workflow_id=run_id,
                status=status,
            )
        )
    return run_id


def _seed_clone(root: Path, run_id: str) -> Path:
    """A clone dir with real nested content, so a delete has to actually recurse."""
    clone = root / run_id
    (clone / ".git").mkdir(parents=True)
    (clone / ".git" / "config").write_text("[core]\n")
    (clone / "README.md").write_text("hello\n")
    return clone


# ---------------------------------------------------------------------------------------------
# RECLAIM PATH 1 — the run-end delete (rides ``_run_end_teardown``, every terminal path).
# ---------------------------------------------------------------------------------------------


def test_run_end_teardown_deletes_a_terminal_runs_clone(client, monkeypatch, tmp_path):
    """THE BUG: a completed run's clone sat on disk forever. Run-end teardown must reclaim it."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    run_id = _make_run("completed")
    clone = _seed_clone(root, run_id)
    assert clone.exists()

    team_run._run_end_teardown(run_id)

    assert not clone.exists(), "a terminal run's clone was left on disk"


@pytest.mark.parametrize("status", TERMINAL_STATUSES)
def test_run_end_teardown_reclaims_every_terminal_status(client, monkeypatch, tmp_path, status):
    """All five terminals reclaim — not just the happy one."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    run_id = _make_run(status)
    clone = _seed_clone(root, run_id)

    team_run._run_end_teardown(run_id)

    assert not clone.exists(), f"a {status} run's clone was left on disk"


@pytest.mark.parametrize("status", ["pending", "running", "awaiting_human"])
def test_run_end_teardown_spares_a_live_runs_clone(client, monkeypatch, tmp_path, status):
    """THE RESUME-SAFETY INVARIANT. ``_run_end_teardown`` rides a ``finally``, which also fires on
    paths where the run is NOT finished — a step raising mid-walk unwinds through it while the row
    still reads ``running``, and DBOS may then RECOVER that workflow. Since
    ``clone_github_repo_step`` short-circuits on *``repo_path`` already set*, deleting here would
    resume the run onto a missing directory. ``awaiting_human`` is the starkest case: a run parked
    at an approval gate, possibly overnight."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    run_id = _make_run(status)
    clone = _seed_clone(root, run_id)

    team_run._run_end_teardown(run_id)

    assert clone.is_dir(), f"a {status} run's clone was destroyed — a resume would find nothing"
    assert (clone / ".git" / "config").exists(), "the clone was partially destroyed"


def test_run_end_teardown_is_a_no_op_without_a_clone(client, monkeypatch, tmp_path):
    """Self-hosted brownfield / greenfield runs have no clone dir — byte-identical to before."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    run_id = _make_run("completed")

    team_run._run_end_teardown(run_id)  # must not raise

    assert list(root.iterdir()) == [], "the no-clone path touched the clone root"


def test_the_run_end_delete_cannot_escape_the_clone_root(monkeypatch, tmp_path):
    """FENCE 1. A run id that is not UUID-shaped can never name a path, so no traversal reaches
    outside the root — the delete refuses rather than resolving it."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    precious = tmp_path / "precious"
    precious.mkdir()
    (precious / "irreplaceable.txt").write_text("the operator's real repo\n")

    for hostile in ("../precious", "../../precious", "/etc", "", "..", "not-a-uuid"):
        assert clone_reaper.delete_run_clone(hostile) is False

    assert (precious / "irreplaceable.txt").exists(), "the delete escaped the clone root"
    assert root.is_dir()


def test_the_run_end_delete_never_raises_when_the_database_is_unreachable(monkeypatch, tmp_path):
    """Teardown must never mask the run's real terminal, which keeps unwinding out of the caller's
    ``finally``. A database that is down is the realistic way this could throw."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    run_id = str(uuid.uuid4())
    clone = _seed_clone(root, run_id)

    with patch.object(clone_reaper, "_live_run_ids", side_effect=RuntimeError("db is down")):
        assert clone_reaper.delete_run_clone(run_id) is False  # no exception

    assert clone.is_dir(), "an unknown-liveness clone was deleted — it must be spared"


# ---------------------------------------------------------------------------------------------
# RECLAIM PATH 2 — the boot + periodic reconcile sweep.
# ---------------------------------------------------------------------------------------------


def test_the_sweep_reaps_a_terminal_runs_clone(client, monkeypatch, tmp_path):
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    clone = _seed_clone(root, _make_run("completed"))

    assert clone_reaper.sweep_orphaned_clones() == 1

    assert not clone.exists()


def test_the_sweep_reaps_a_clone_whose_run_is_gone(monkeypatch, tmp_path):
    """No Run row at all — a deleted run, or a directory that never had one. ABSENT ⇒ reapable."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    clone = _seed_clone(root, str(uuid.uuid4()))

    assert clone_reaper.sweep_orphaned_clones() == 1

    assert not clone.exists()


@pytest.mark.parametrize("status", ["pending", "running", "awaiting_human"])
def test_the_sweep_spares_a_live_runs_clone(client, monkeypatch, tmp_path, status):
    """The resume-safety invariant again, on the sweep side — an in-flight or parked run's clone
    must survive a boot sweep — precisely the moment its workflow is about to be RECOVERED."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    clone = _seed_clone(root, _make_run(status))

    assert clone_reaper.sweep_orphaned_clones() == 0

    assert (clone / ".git" / "config").exists()


def test_the_sweep_reaps_orphans_and_spares_the_live_one_together(client, monkeypatch, tmp_path):
    """The real-world mix, in one sweep: reconciliation is per-directory, not all-or-nothing."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    terminal = _seed_clone(root, _make_run("failed"))
    absent = _seed_clone(root, str(uuid.uuid4()))
    live = _seed_clone(root, _make_run("awaiting_human"))

    assert clone_reaper.sweep_orphaned_clones() == 2

    assert not terminal.exists()
    assert not absent.exists()
    assert live.is_dir()


def test_the_sweep_never_touches_anything_outside_the_clone_root(client, monkeypatch, tmp_path):
    """THE NEVER-TOUCH RULE. Only direct children of the root are ever candidates: a sibling
    directory next to the root, and a loose file inside it, both survive."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    precious = tmp_path / "precious"
    (precious / "src").mkdir(parents=True)
    (precious / "src" / "main.py").write_text("real work\n")
    loose = root / "notes.txt"
    loose.write_text("not a directory\n")
    _seed_clone(root, _make_run("completed"))

    assert clone_reaper.sweep_orphaned_clones() == 1

    assert (precious / "src" / "main.py").read_text() == "real work\n"
    assert loose.read_text() == "not a directory\n"


def test_the_sweep_does_not_follow_a_symlink_out_of_the_clone_root(monkeypatch, tmp_path):
    """FENCE 2. A symlink planted under the root is skipped, not followed — ``scandir`` classifies
    with ``follow_symlinks=False``, so its target is never even a candidate.

    The outcome assertions below cannot prove the fence on their own: ``shutil.rmtree`` refuses a
    symlink independently, so the target would survive even without ``follow_symlinks=False`` (a
    mutation check confirmed exactly that). So this also asserts the link is never HANDED to the
    remover — which is the part only the fence provides, and the part that keeps the guarantee from
    resting on a ``shutil`` implementation detail."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    outside = tmp_path / "outside_target"
    outside.mkdir()
    (outside / "irreplaceable.txt").write_text("must survive\n")
    link = root / str(uuid.uuid4())
    link.symlink_to(outside, target_is_directory=True)

    considered: list[Path] = []
    real_rmtree = clone_reaper._rmtree

    def spy(path):
        considered.append(path)
        return real_rmtree(path)

    with patch.object(clone_reaper, "_rmtree", side_effect=spy):
        assert clone_reaper.sweep_orphaned_clones() == 0

    assert considered == [], "the symlink was handed to the remover — the fence did not hold"
    assert (outside / "irreplaceable.txt").exists(), "the sweep followed a symlink out of the root"
    assert link.is_symlink(), "the sweep removed the link itself"


def test_the_sweep_refuses_a_symlinked_clone_root(monkeypatch, tmp_path):
    """If the root itself is a symlink, enumerating it would reach whatever it points at."""
    real = tmp_path / "somewhere_else"
    (real / "irreplaceable").mkdir(parents=True)
    link_root = tmp_path / ".tvashtr_clones"
    link_root.symlink_to(real, target_is_directory=True)
    monkeypatch.setattr(clone_reaper, "CLONE_ROOT", link_root)

    assert clone_reaper.sweep_orphaned_clones() == 0

    assert (real / "irreplaceable").is_dir()


def test_the_sweep_returns_zero_on_a_missing_root(monkeypatch, tmp_path):
    """Self-hosted / greenfield deployments never create the root. No exception, no disk access."""
    monkeypatch.setattr(clone_reaper, "CLONE_ROOT", tmp_path / "never_created")

    assert clone_reaper.sweep_orphaned_clones() == 0


def test_the_sweep_returns_zero_on_an_empty_root(monkeypatch, tmp_path):
    _use_tmp_clone_root(monkeypatch, tmp_path)

    assert clone_reaper.sweep_orphaned_clones() == 0


@pytest.mark.skipif(os.geteuid() == 0, reason="root can delete through a read-only directory")
def test_one_unremovable_clone_does_not_abort_the_rest_of_the_sweep(client, monkeypatch, tmp_path):
    """A REAL permission error (chmod 0o500 ⇒ entries inside cannot be unlinked), not a mock. The
    stubborn directory is logged and skipped; the sweep still reclaims the others."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    stubborn = _seed_clone(root, _make_run("completed"))
    reapable = _seed_clone(root, _make_run("completed"))
    stubborn.chmod(0o500)
    try:
        assert clone_reaper.sweep_orphaned_clones() == 1  # no exception
        assert stubborn.is_dir(), "the permission error should have left it in place"
        assert not reapable.exists(), "one stubborn dir aborted the rest of the sweep"
    finally:
        stubborn.chmod(0o700)  # so pytest can clean tmp_path up


def test_the_sweep_never_raises_when_the_database_is_unreachable(monkeypatch, tmp_path):
    """A boot sweep that threw would take down the whole backend over disk hygiene."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    clone = _seed_clone(root, str(uuid.uuid4()))

    with patch.object(clone_reaper, "_live_run_ids", side_effect=RuntimeError("db is down")):
        assert clone_reaper.sweep_orphaned_clones() == 0  # no exception

    assert clone.is_dir(), "clones were reaped without knowing which runs are live"


# ---------------------------------------------------------------------------------------------
# WIRING — the boot sweep, and the cron-registration gate.
# ---------------------------------------------------------------------------------------------


def test_the_boot_sweep_runs_in_the_lifespan():
    """The sweep is wired into FastAPI startup, before DBOS recovers any PENDING workflow."""
    from tvashtr import main

    assert main.sweep_orphaned_clones is clone_reaper.sweep_orphaned_clones


def test_the_periodic_sweep_is_not_registered_outside_fly_mode():
    """THE CRON GATE. ``DBOS.scheduled`` registers a poller at IMPORT time and ``DBOS.launch()``
    starts it — which ``make test`` does, via conftest's session-scoped ``with TestClient(app)``.
    Registering unconditionally would arm a real 10-minute cron inside the offline suite and
    enqueue genuine workflow rows at random, depending on wall-clock start time. This asserts the
    gate is doing its job in the mode the suite actually runs in."""
    assert get_settings().agent_sandbox_mode != "fly", "this assertion would be vacuous in fly mode"
    assert not hasattr(clone_reaper, "periodic_clone_sweep")


def test_both_reclaim_paths_share_one_definition_of_live():
    """The run-end delete and the sweep must never disagree about what "live" means — a divergence
    would show up as a run resuming onto a directory the other path had deleted."""
    assert clone_reaper.LIVE_STATUSES == frozenset({"pending", "running", "awaiting_human"})


def test_the_executor_and_the_reaper_agree_on_the_clone_directory(monkeypatch, tmp_path):
    """One definition of the path: the reaper can never sweep a root the executor is not writing
    to. ``_hosted_clone_dir`` is what ``clone_github_repo_step`` sets as the run's ``repo_path``."""
    root = _use_tmp_clone_root(monkeypatch, tmp_path)
    run_id = str(uuid.uuid4())

    assert team_run._hosted_clone_dir(run_id) == str(root / run_id)
