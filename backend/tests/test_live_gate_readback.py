"""Tvashtr-80 — the live gates' SHIP READBACK survives the workspace reap.

THE BUG THIS PINS. Since M-wsgc S1 (persist-then-reap) ``ship_step`` snapshots a greenfield run's
whole ``compute_run_diff`` result into ``run_artifacts`` and ``_run_end_teardown`` then calls
``workspace_reaper.delete_run_workspace``. That teardown rides ``run_team``'s ``finally``, so the
real ordering is::

    ship_step()            -> commit + tag IN the workspace, and persist the run_artifacts row
    finalize_run_step()    -> runs.status = 'completed'
    distill + ingest       -> (slow)
    run_team returns       -> `finally` -> delete_run_workspace()      <-- THE REAP
    workflow_status        -> SUCCESS                                   <-- only now

Every live gate asserted the run's shipped result by shelling out to ``git -C
backend/.tvashtr_workspaces/<run_id> …`` AFTER the run went terminal. A gate that waits for the
DBOS workflow to report SUCCESS therefore reads a directory that has already been deleted, and a
gate that breaks its poll on ``runs.status`` merely RACES the reap on the distill+ingest margin.
Either way the workspace is the wrong source of truth once the run is over.

``scripts/_ship_readback.py`` is the durable replacement, shared by all five gates, and this module
is the one offline regression that covers it. It is MUTATION-REAL in the style of
``test_workspace_gc.py``: a real ``runs`` row, a real git repo under a real (tmp) workspace root, a
real ``idempotent_ship``, the product's own ``_persist_greenfield_artifact``, and then the real
reaper — after which the assertions are made against what is genuinely left.

The teeth are in :func:`test_the_old_workspace_read_is_dead_after_the_reap`: it asserts the ORIGINAL
``git -C <workspace> show <tag>:<file>`` now fails, so this file would have caught the bug on the
pre-fix gates rather than merely describing it.
"""

import importlib.util
import subprocess
import uuid
from pathlib import Path

import pytest
from conftest import auth_user_id
from sqlalchemy import func, select

from tvashtr.control_plane import run_diff, team_run, workspace_reaper
from tvashtr.control_plane.shipping import idempotent_ship, init_workspace_repo
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import Run, RunArtifact

# The gates' own constants, so a drift in either would surface here.
TARGET_FILE = "greeting.txt"
REQUIRED_LINE = "Shipped by the Tvashtr PM->Engineer team"

_READBACK_PATH = Path(__file__).resolve().parents[2] / "scripts" / "_ship_readback.py"


def _load_readback():
    """``scripts/`` is not a package, so the shared helper is loaded BY FILE PATH — the
    ``test_model_bench.py`` pattern. That is what keeps this regression wired to the very module
    the five live gates import, with no ``sys.path`` or conftest plumbing to rot."""
    spec = importlib.util.spec_from_file_location("ship_readback_under_test", _READBACK_PATH)
    assert spec and spec.loader, f"could not create a spec for {_READBACK_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


readback = _load_readback()


# ---------------------------------------------------------------------------------------------
# Fixture: a REAL greenfield run that shipped, persisted, and was then reaped.
# ---------------------------------------------------------------------------------------------


def _use_tmp_workspace_root(monkeypatch, tmp_path) -> Path:
    """Redirect BOTH modules that resolve the workspace root at the same tmp dir, so these tests
    mutate real directories but never the repo's own ``.tvashtr_workspaces``.

    ``workspace_reaper.WORKSPACE_ROOT`` and ``run_diff._WORKSPACE_ROOT`` are REPLICATED constants
    (``run_diff`` may not import the openhands-owned canonical one, invariant #1), so both are
    patched — and :func:`test_the_two_workspace_roots_agree` guards the replication itself."""
    root = tmp_path / ".tvashtr_workspaces"
    root.mkdir()
    monkeypatch.setattr(workspace_reaper, "WORKSPACE_ROOT", root)
    monkeypatch.setattr(run_diff, "_WORKSPACE_ROOT", root)
    return root


def _make_greenfield_run() -> str:
    """A REAL ``runs`` row: greenfield (``repo_path`` NULL) and terminal, i.e. exactly the shape
    whose workspace S1 licensed the reaper to reclaim once its diff is durable."""
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=auth_user_id(),
                idea="tvashtr-80 readback fixture",
                workflow_id=run_id,
                status="completed",
                repo_path=None,
            )
        )
    return run_id


def _ship_into(root: Path, run_id: str, files: dict[str, str]) -> dict:
    """Build the run's workspace as a REAL git repo and ship it through the product's own
    ``idempotent_ship`` — the same commit + ``ship-{run_id}`` tag a live run produces."""
    workspace = root / run_id
    workspace.mkdir(parents=True)
    init_workspace_repo(str(workspace))
    for rel, content in files.items():
        path = workspace / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    ship = idempotent_ship(str(workspace), run_id)
    with session_scope() as session:
        session.execute(
            Run.__table__.update()
            .where(Run.id == uuid.UUID(run_id))
            .values(ship_commit_sha=ship["sha"], ship_tag=ship["tag"])
        )
    return ship


@pytest.fixture
def shipped_and_reaped(client, monkeypatch, tmp_path):
    """The whole S1 sequence, for real: ship -> persist -> REAP. Yields the facts the gates need.

    ``_persist_greenfield_artifact`` is the PRODUCT's writer, deliberately called here rather than
    hand-rolling a row: that is what makes this a regression on the real persist/readback contract
    instead of on a fixture's idea of one."""
    root = _use_tmp_workspace_root(monkeypatch, tmp_path)
    run_id = _make_greenfield_run()
    ship = _ship_into(
        root,
        run_id,
        {
            TARGET_FILE: f"{REQUIRED_LINE}\n",
            "notes/multi.txt": "alpha\nbeta\ngamma\n",
        },
    )
    workspace = root / run_id

    # The workspace is genuinely readable BEFORE the reap — so "[] afterwards" means the reap, not
    # a fixture that never worked.
    assert run_diff._greenfield_files(run_id), "fixture produced no greenfield diff before the reap"

    team_run._persist_greenfield_artifact(run_id)
    reaped = workspace_reaper.delete_run_workspace(run_id)

    yield {"run_id": run_id, "workspace": workspace, "ship": ship, "reaped": reaped}

    key = uuid.UUID(run_id)
    with session_scope() as session:
        session.execute(RunArtifact.__table__.delete().where(RunArtifact.run_id == key))
        session.execute(Run.__table__.delete().where(Run.id == key))


# ---------------------------------------------------------------------------------------------
# The bug: the old read-site is dead once the run is over.
# ---------------------------------------------------------------------------------------------


def test_the_reap_really_happened(shipped_and_reaped):
    """The precondition for everything below: a PERSISTED terminal greenfield workspace is gone."""
    assert shipped_and_reaped["reaped"] is True, "delete_run_workspace declined to reap"
    assert not shipped_and_reaped["workspace"].exists()


def test_the_old_workspace_read_is_dead_after_the_reap(shipped_and_reaped):
    """THE TEETH — the exact command every gate used to run, post-terminal, now fails.

    ``git show <ship_tag>:<file>`` and ``git tag --list`` both die on the missing directory, which
    is precisely the RED the five gates hit. Any 'fix' that leaves a gate reading the workspace
    would still be broken, and this asserts the source it can no longer use."""
    workspace = shipped_and_reaped["workspace"]
    tag = shipped_and_reaped["ship"]["tag"]

    show = subprocess.run(
        ["git", "-C", str(workspace), "show", f"{tag}:{TARGET_FILE}"],
        capture_output=True,
        text=True,
    )
    assert show.returncode != 0, "the workspace read unexpectedly succeeded — was it really reaped?"
    assert "No such file or directory" in show.stderr

    tags = subprocess.run(
        ["git", "-C", str(workspace), "tag", "--list", tag], capture_output=True, text=True
    )
    assert tags.returncode != 0
    assert tags.stdout.split() == [], "a reaped workspace cannot list the ship tag"


def test_greenfield_files_returns_empty_once_the_workspace_is_gone(shipped_and_reaped):
    """The old logic's own source, ``run_diff._greenfield_files``, is now empty for this run —
    the durable snapshot in ``run_artifacts`` is the ONLY surviving copy."""
    assert run_diff._greenfield_files(shipped_and_reaped["run_id"]) == []


# ---------------------------------------------------------------------------------------------
# The fix: the shared readback answers every assertion the gates make, from durable state.
# ---------------------------------------------------------------------------------------------


def test_shipped_diff_returns_the_persisted_snapshot(shipped_and_reaped):
    """``shipped_diff`` hands back the whole stored ``compute_run_diff`` dict, verbatim."""
    run_id = shipped_and_reaped["run_id"]
    diff = readback.shipped_diff(run_id)

    assert diff["run_id"] == run_id
    assert diff["total"] == len(diff["files"]) == 2  # exactly the two files the fixture shipped
    paths = sorted(f["path"] for f in diff["files"])
    assert paths == [TARGET_FILE, "notes/multi.txt"]
    assert all(f["status"] == "added" for f in diff["files"]), (
        "every greenfield file must report as added"
    )


def test_added_file_recovers_the_shipped_content_byte_exactly(shipped_and_reaped):
    """The byte-exact assertion (skeleton_run / check_skeleton_crash) survives the reap: the added
    content is reconstructed from the patch's ``+`` hunk lines, and equals what was shipped."""
    diff = readback.shipped_diff(shipped_and_reaped["run_id"])

    content = readback.added_file(diff, TARGET_FILE)
    assert content == REQUIRED_LINE, f"expected the shipped line verbatim, got {content!r}"
    # ...and the substring form the loop gates use (which tolerates a cosmetic revision edit).
    assert REQUIRED_LINE in content


def test_added_file_reconstructs_a_multi_line_file_and_skips_the_patch_header(shipped_and_reaped):
    """``+++ b/<path>`` is a header line, not content — a naive "lines starting with +" would
    smuggle it into the file body. Multi-line content proves the join, not a lucky one-liner."""
    diff = readback.shipped_diff(shipped_and_reaped["run_id"])

    assert readback.added_file(diff, "notes/multi.txt") == "alpha\nbeta\ngamma"


def test_added_file_is_none_for_a_path_that_was_not_shipped(shipped_and_reaped):
    """A miss is None, never a silent empty string — a gate must be able to FAIL on absence."""
    diff = readback.shipped_diff(shipped_and_reaped["run_id"])

    assert readback.added_file(diff, "never-shipped.txt") is None


@pytest.mark.parametrize("status", ["modified", "deleted"])
def test_added_file_refuses_an_entry_that_is_not_added(status):
    """``added_file`` reconstructs content from ``+`` lines, which is only the WHOLE file for an
    ``added`` entry — for a modified one those lines are just the added hunk, and returning them
    would silently hand a gate a fragment while looking like a full-content match. Greenfield ships
    are always ``added``, so anything else means the caller is off the path it was built for and
    must fail loudly. (This case is why the ``status`` check is load-bearing, not decoration.)"""
    diff = {
        "files": [
            {
                "path": TARGET_FILE,
                "status": status,
                "additions": 1,
                "deletions": 1,
                "patch": (
                    f"--- a/{TARGET_FILE}\n+++ b/{TARGET_FILE}\n"
                    f"@@ -1 +1 @@\n-old\n+{REQUIRED_LINE}\n"
                ),
            }
        ],
        "total": 1,
    }

    assert readback.added_file(diff, TARGET_FILE) is None


def test_added_file_handles_a_file_with_no_trailing_newline():
    """The REAL shape observed from a live greenfield ship: git appends a
    ``\\ No newline at end of file`` marker line after the last hunk line. It starts with ``\\``,
    not ``+``, so it must not leak into the content — asserted against the verbatim patch text a
    live ``make skeleton-run`` persisted."""
    diff = {
        "files": [
            {
                "path": TARGET_FILE,
                "status": "added",
                "additions": 1,
                "deletions": 0,
                "patch": (
                    f"diff --git a/{TARGET_FILE} b/{TARGET_FILE}\n"
                    "new file mode 100644\n"
                    "index 0000000..a393248\n"
                    "--- /dev/null\n"
                    f"+++ b/{TARGET_FILE}\n"
                    "@@ -0,0 +1 @@\n"
                    f"+{REQUIRED_LINE}\n"
                    "\\ No newline at end of file\n"
                ),
            }
        ],
        "total": 1,
    }

    assert readback.added_file(diff, TARGET_FILE) == REQUIRED_LINE


def test_shipped_once_reads_the_durable_tag_and_sha(shipped_and_reaped):
    """ "shipped exactly once" (loop_run / sandbox_reuse / both crash checkers) re-points from
    ``git tag --list`` to the two durable columns."""
    run_id = shipped_and_reaped["run_id"]
    run = {"ship_tag": f"ship-{run_id}", "ship_commit_sha": shipped_and_reaped["ship"]["sha"]}

    assert readback.shipped_once(run, run_id) is True


@pytest.mark.parametrize(
    "run",
    [
        {"ship_tag": None, "ship_commit_sha": "abc123"},
        {"ship_tag": "ship-someone-else", "ship_commit_sha": "abc123"},
        {"ship_tag": "PLACEHOLDER", "ship_commit_sha": None},
        {"ship_tag": "PLACEHOLDER", "ship_commit_sha": ""},
        {},
    ],
)
def test_shipped_once_is_false_unless_both_witnesses_are_present_and_match(shipped_and_reaped, run):
    """Mutation-real: each way the witness can be wrong is rejected. Crucially a tag belonging to a
    DIFFERENT run does not count — the assertion is "THIS run shipped", not "some tag exists"."""
    run_id = shipped_and_reaped["run_id"]
    run = {**run}
    if run.get("ship_tag") == "PLACEHOLDER":
        run["ship_tag"] = f"ship-{run_id}"

    assert readback.shipped_once(run, run_id) is False


def test_exactly_one_artifact_row_is_the_single_ship_witness(shipped_and_reaped):
    """The crash checkers' ``git log --all --grep 'Ship: <run_id>'`` count cannot survive the reap
    (the workspace was the only repo that ever held that commit, and there is no remote). Its
    durable replacement is the UNIQUE ``run_artifacts`` row — re-persisting UPSERTs, never
    duplicates — which is asserted here against the real writer being run twice."""
    run_id = shipped_and_reaped["run_id"]
    assert readback.artifact_row_count(run_id) == 1

    # A crash-resume re-runs ``ship_step``; the row must stay singular.
    team_run._persist_greenfield_artifact(run_id)
    assert readback.artifact_row_count(run_id) == 1

    with session_scope() as session:
        rows = session.execute(
            select(func.count())
            .select_from(RunArtifact)
            .where(RunArtifact.run_id == uuid.UUID(run_id))
        ).scalar_one()
    assert rows == 1, "the durable single-ship witness must be exactly one row"


def test_readback_of_an_unknown_run_is_empty_not_an_error(client):
    """A gate that asks about a run which never shipped gets an empty-but-well-formed answer, so it
    fails its own assertion with a clear message instead of exploding in the helper."""
    unknown = str(uuid.uuid4())

    diff = readback.shipped_diff(unknown)

    assert diff["files"] == []
    assert diff["total"] == 0
    assert readback.added_file(diff, TARGET_FILE) is None
    assert readback.artifact_row_count(unknown) == 0


# ---------------------------------------------------------------------------------------------
# The replicated-constant guard.
# ---------------------------------------------------------------------------------------------


def test_the_two_workspace_roots_agree():
    """``run_diff`` and ``workspace_reaper`` each re-derive ``.tvashtr_workspaces`` rather than
    importing the openhands-owned canonical constant (invariant #1). If they ever drift, the reaper
    would delete one directory while the snapshot reader looked in another — and the readback's
    whole premise would quietly rot. Asserted on the REAL constants, un-patched."""
    assert run_diff._WORKSPACE_ROOT == workspace_reaper.WORKSPACE_ROOT
