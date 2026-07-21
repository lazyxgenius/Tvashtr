"""M-wsgc — the per-run agent workspace is reclaimed (run-end delete + reconcile sweep).

REPRODUCE-FIRST (two bugs, then the ruling that closed the gap they left).

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

**The half-closed item that spare left behind (S1, migration ``0031``).** Sparing greenfield FOREVER
was right only because the diff lived nowhere but that directory. ``ship_step`` now snapshots it
into ``run_artifacts`` at ship time and ``/diff`` serves the snapshot once the directory is gone, so
the spare narrows to "until the artifact is persisted". The PERSIST-THEN-REAP section below is that
change — sixteen failures on the pre-change code, of the shape "a persisted greenfield workspace was
still spared" and "the Changes tab lost the run's files once the dir was reaped". Both halves are
asserted together, because the HARD INVARIANT running through all of it is that a greenfield
workspace is never reaped before its diff is durable.

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
from tvashtr.models import Run, RunArtifact

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
    whose workspace is the deliverable until its diff is persisted (S1) — with no ``run_artifacts``
    row, as here, it must never be reaped."""
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
    "Changes" tab STILL SERVES ITS FILES.

    S1 REVISION: this run is shipped by hand and therefore has NO ``run_artifacts`` row, so it is
    still spared for exactly the original reason — the directory is the only copy of the
    deliverable. What changed is that "forever" became "until the snapshot is durable"; see
    :func:`test_a_persisted_greenfield_runs_changes_tab_survives_the_reap` for the other half."""
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
# PERSIST-THEN-REAP (S1) — the deliverable rule, revised.
#
# The rule above was "SPARE greenfield forever, because the directory IS the deliverable". True,
# but only because the deliverable lived NOWHERE ELSE: the run view's "Changes" tab was read
# straight off the disk, so reaping the directory emptied the tab for good. That made the
# unbounded-growth item permanently half-closed — greenfield workspaces accumulate without limit.
#
# ``run_artifacts`` removes the premise. ``ship_step`` snapshots the greenfield diff into the
# database while the workspace still exists, so once the row is there the directory is a redundant
# COPY of something durable — exactly the position a brownfield worktree has always been in. The
# spare therefore narrows from "forever" to "until the artifact is persisted":
#
#   SPARE  a run that is LIVE (any type), or GREENFIELD WITH NO ``run_artifacts`` ROW.
#   REAP   the run row is ABSENT, or it is terminal AND (brownfield/hosted OR persisted-greenfield).
#
# THE HARD INVARIANT, and the only thing here that must never bend: a greenfield workspace is NEVER
# reaped before its diff is durably saved. Absence of a row is the SAFE state — a run that never
# shipped, or whose snapshot failed to write, keeps its directory exactly as before this table
# existed. Every test below is written so that a regression toward reaping-the-unpersisted fails.
# ---------------------------------------------------------------------------------------------


def _persist_artifact(run_id: str, path: str = "src/main.py") -> dict:
    """The durable snapshot ``ship_step`` writes — the row that LICENSES the reap. Shaped exactly
    like a ``compute_run_diff`` result, because that is what is stored (and served back
    verbatim)."""
    snapshot = {
        "run_id": run_id,
        "base_ref": None,
        "ship_branch": None,
        "files": [
            {
                "path": path,
                "status": "added",
                "additions": 1,
                "deletions": 0,
                "patch": f"+++ b/{path}\n+print('shipped')\n",
            }
        ],
        "total": 1,
    }
    with session_scope() as session:
        session.add(RunArtifact(run_id=uuid.UUID(run_id), files=snapshot))
    return snapshot


@pytest.mark.parametrize("status", TERMINAL_STATUSES)
def test_a_greenfield_workspace_is_spared_until_its_artifact_is_persisted(
    client, monkeypatch, tmp_path, status
):
    """THE WHOLE REVISED RULE ON ONE FIXTURE — the same directory, before and after the snapshot.

    The BEFORE half is the hard invariant (an un-persisted deliverable is untouchable) and the AFTER
    half is the milestone. Asserting both against one run is what makes the pair meaningful: a
    reaper that spares everything passes the first assertion, a reaper that reaps every terminal
    greenfield passes the second, and only the persist-gated rule passes both."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = _make_run(status, repo_path=None)
    workspace = _seed_workspace(root, run_id)

    assert workspace_reaper.delete_run_workspace(run_id) is False
    assert workspace.is_dir(), "an UNPERSISTED greenfield deliverable was destroyed"

    _persist_artifact(run_id)

    assert workspace_reaper.delete_run_workspace(run_id) is True, (
        f"a {status} greenfield workspace was still spared after its diff was persisted"
    )
    assert not workspace.exists()


@pytest.mark.parametrize("status", TERMINAL_STATUSES)
def test_the_sweep_reclaims_a_persisted_greenfield_workspace(client, monkeypatch, tmp_path, status):
    """And the SWEEP applies the same revised rule — which is the whole reason the decision lives in
    the shared :func:`_spared_run_ids` helper rather than at either call site. A run-end delete that
    reaped while the sweep spared would leave every crashed run's persisted workspace on disk
    forever; the reverse would DELAY a destruction the run-end path had refused."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = _make_run(status, repo_path=None)
    workspace = _seed_workspace(root, run_id)
    _persist_artifact(run_id)

    assert workspace_reaper.sweep_orphaned_workspaces() == 1

    assert not workspace.exists(), f"the sweep spared a {status} PERSISTED greenfield workspace"


@pytest.mark.parametrize("status", ["pending", "running", "awaiting_human"])
def test_a_persisted_greenfield_workspace_is_still_spared_while_the_run_is_live(
    client, monkeypatch, tmp_path, status
):
    """LIVENESS OUTRANKS PERSISTENCE, on both paths. A snapshot taken mid-run says nothing about the
    files the agent is STILL producing, and ``make_local_workspace`` is ``mkdir(exist_ok=True)``, so
    a resumed run whose workspace we reaped would continue onto an empty directory. The persist gate
    widens what "terminal and disposable" means; it must never widen it past ``LIVE_STATUSES``."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = _make_run(status, repo_path=None)
    workspace = _seed_workspace(root, run_id)
    _persist_artifact(run_id)

    assert workspace_reaper.delete_run_workspace(run_id) is False
    assert workspace_reaper.sweep_orphaned_workspaces() == 0

    assert (workspace / "src" / "main.py").exists(), (
        f"a {status} run's workspace was reaped because a snapshot existed — a resume finds nothing"
    )


def test_one_sweep_separates_persisted_greenfield_from_every_other_case(
    client, monkeypatch, tmp_path
):
    """ALL FIVE CASES IN ONE SWEEP, since the decision is per-directory.

    Reaped: the terminal BROWNFIELD run, the ABSENT run, and — new — the terminal GREENFIELD run
    whose diff is durably in the database. Spared: the terminal greenfield run with NO snapshot (the
    hard invariant) and the LIVE greenfield run that HAS one (liveness outranks persistence)."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    brownfield = _seed_workspace(root, _make_run("completed", repo_path="/tmp/real-repo"))
    absent = _seed_workspace(root, str(uuid.uuid4()))
    persisted_id = _make_run("completed", repo_path=None)
    persisted = _seed_workspace(root, persisted_id)
    _persist_artifact(persisted_id)
    unpersisted = _seed_workspace(root, _make_run("completed", repo_path=None))
    live_id = _make_run("awaiting_human", repo_path=None)
    live = _seed_workspace(root, live_id)
    _persist_artifact(live_id)

    assert workspace_reaper.sweep_orphaned_workspaces() == 3

    assert not brownfield.exists(), "a terminal brownfield worktree was not reclaimed"
    assert not absent.exists(), "an orphaned workspace was not reclaimed"
    assert not persisted.exists(), "a PERSISTED greenfield workspace was not reclaimed"
    assert unpersisted.is_dir(), "an UNPERSISTED greenfield deliverable was destroyed"
    assert live.is_dir(), "a LIVE run's workspace was reaped — a resume would find nothing"


def test_a_persisted_greenfield_runs_changes_tab_survives_the_reap(client):
    """THE PRODUCT-LEVEL PROOF OF THE WHOLE MILESTONE, end to end against the REAL root: a real
    greenfield ship, the real ``ship_step`` persist, a real reap, and the real endpoint.

    Two failures on the pre-change code, and the pair is the point. The workspace was spared
    (nothing licensed reaping it), and once it IS reaped the "Changes" tab must not degrade to an
    empty list — the durable snapshot has to carry it. Reclaiming disk by silently emptying the run
    view is the bug this milestone exists to avoid, not the feature."""
    import shutil

    from tvashtr.control_plane.shipping import init_workspace_repo

    run_id = str(uuid.uuid4())
    workspace = Path(workspace_reaper.workspace_dir_for_run(run_id))
    workspace.mkdir(parents=True, exist_ok=True)
    try:
        init_workspace_repo(str(workspace))
        (workspace / "greeting.txt").write_text("hello\nworld\n", encoding="utf-8")
        with session_scope() as session:
            session.add(
                Run(
                    id=uuid.UUID(run_id),
                    team_graph_id=uuid.UUID(build_two_node_team()),
                    owner_id=auth_user_id(),
                    idea="s1 persisted greenfield deliverable",
                    workflow_id=run_id,
                    status="completed",
                    repo_path=None,  # GREENFIELD
                )
            )

        team_run.ship_step(run_id, str(workspace))  # ships AND snapshots, in that order

        assert workspace_reaper.delete_run_workspace(run_id) is True, (
            "the workspace was spared even though its diff is durably persisted"
        )
        assert not workspace.exists()

        after = client.get(f"/api/runs/{run_id}/diff")
        assert after.status_code == 200, after.text
        body = after.json()
        assert body["total"] == 1, "the Changes tab lost the run's files once the dir was reaped"
        assert body["files"][0]["path"] == "greeting.txt"
        assert "hello" in body["files"][0]["patch"]
    finally:
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
