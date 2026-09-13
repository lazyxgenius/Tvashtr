"""M-hostedfix — a recovered run must RE-MATERIALIZE its machine-local workspace.

THE DEFECT THIS GUARDS — root cause, evidenced off prod run
``1c4b4033-895f-4900-bc23-d3c43144490d``:

``clone_github_repo_step`` and ``engineer_setup_step`` are ``@DBOS.step()``s whose real product is a
**filesystem side effect** — a clone under ``.tvashtr_clones/<run_id>`` and a ``git worktree`` under
``.tvashtr_workspaces/<run_id>``. DBOS checkpoints a step's RETURN VALUE and **skips its body on
replay**. The deployed app runs TWO Fly machines with no shared volume, both registering DBOS under
the same ``executor_id``, so a workflow started on machine A can be recovered onto machine B — where
neither directory ever existed. On B the recorded path replays, nothing re-creates the worktree, and
the adapters' ``os.makedirs(host_dir, exist_ok=True)`` manufactures a bare, non-git directory
exactly where the worktree should be. The brownfield seed enumeration then dies with the
prod traceback::

    git -C <workspace> ls-files -c -o --exclude-standard -z  -> returned non-zero exit status 128

Both steps decided "already done" from DATABASE state (``runs.repo_path`` non-NULL, a checkpointed
step output) rather than from the DISK they actually produced. ``add_worktree``'s and
``clone_github_repo_step``'s docstrings both claim idempotency "on resume" — unreachable, because
replay never runs the body.

These tests reproduce that by DELETING the clone and the workspace, which is exactly how a machine
that never had them presents, and then re-entering the materialization path.
"""

import os
import shutil
import subprocess
import uuid

import pytest
from conftest import auth_user_id
from sqlalchemy import select

from tvashtr.control_plane import github_app
from tvashtr.control_plane.team_run import clone_github_repo_step, engineer_setup_step
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.docker_runtime import enumerate_push_files_git
from tvashtr.models import Run

_REPO = "operator/fixture_repo"


def _git(*args: str, cwd: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _origin_repo(tmp_path) -> str:
    """A real git repo standing in for the user's GitHub repo (tracked dotfile included)."""
    origin = str(tmp_path / "origin")
    os.makedirs(origin)
    _git("init", "-b", "main", cwd=origin)
    _git("config", "user.email", "fixture@tvashtr.local", cwd=origin)
    _git("config", "user.name", "fixture", cwd=origin)
    with open(os.path.join(origin, "calc.py"), "w") as fh:
        fh.write("def add(a, b):\n    return a + b\n")
    os.makedirs(os.path.join(origin, ".github"))
    with open(os.path.join(origin, ".github", "ci.yml"), "w") as fh:
        fh.write("on: push\n")
    _git("add", "-A", cwd=origin)
    _git("commit", "-m", "init", cwd=origin)
    return origin


def _hosted_run(github_repo: str | None = _REPO, repo_path: str | None = None) -> uuid.UUID:
    team = build_two_node_team()
    rid = uuid.uuid4()
    with session_scope() as s:
        s.add(
            Run(
                id=rid,
                team_graph_id=uuid.UUID(team),
                owner_id=auth_user_id(),
                idea="add a docstring",
                workflow_id=str(rid),
                status="running",
                github_repo=github_repo,
                repo_path=repo_path,
                base_ref="main",
            )
        )
    return rid


def _fake_clone_from(origin: str, monkeypatch) -> None:
    """Clone the LOCAL origin instead of GitHub — a real clone, no network."""

    def fake_clone(installation_id, full_name, dest):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        subprocess.run(["git", "clone", origin, dest], check=True, capture_output=True, text=True)

    monkeypatch.setattr(github_app, "clone_repo", fake_clone)
    monkeypatch.setattr(
        github_app,
        "find_repo_in_installations",
        lambda _ids, _full: (12345, {"full_name": _REPO, "default_branch": "main"}),
    )


def _repo_path_of(rid: uuid.UUID) -> str:
    with session_scope() as s:
        return s.execute(select(Run).where(Run.id == rid)).scalar_one().repo_path


@pytest.fixture
def hosted_brownfield_run(client, tmp_path, monkeypatch):
    """A hosted run set up EXACTLY as prod does it, then torn down off the real roots."""
    origin = _origin_repo(tmp_path)
    _fake_clone_from(origin, monkeypatch)
    rid = _hosted_run()
    clone_github_repo_step(str(rid))
    workspace = engineer_setup_step(str(rid))
    yield rid, _repo_path_of(rid), workspace
    shutil.rmtree(workspace, ignore_errors=True)
    shutil.rmtree(_repo_path_of(rid) or "/nonexistent", ignore_errors=True)


def test_setup_produces_a_worktree_the_brownfield_seed_can_enumerate(hosted_brownfield_run):
    """PRECONDITION (green on main): the first attempt really does build a valid worktree."""
    _rid, repo_path, workspace = hosted_brownfield_run
    assert os.path.isdir(os.path.join(repo_path, ".git"))
    assert os.path.isfile(os.path.join(workspace, ".git"))  # a worktree gitdir POINTER
    assert enumerate_push_files_git(workspace) == [".github/ci.yml", "calc.py"]


def test_a_recovered_run_rematerializes_its_workspace(hosted_brownfield_run):
    """THE REGRESSION. Recovery onto a machine that never held the disk: both directories are
    gone, and the recorded ``repo_path`` still points at the vanished clone. Re-entering the
    setup path must REBUILD both, so the brownfield seed enumeration works again.

    On pre-fix code ``engineer_setup_step`` trusts ``repo_path`` (a database column) and calls
    ``add_worktree`` against a directory that no longer exists -> ``git -C <gone> rev-parse``
    -> exit status 128, the prod failure mode.
    """
    rid, repo_path, workspace = hosted_brownfield_run
    shutil.rmtree(workspace)
    shutil.rmtree(repo_path)  # the other machine never had the clone either
    assert _repo_path_of(rid) == repo_path  # the DB still claims it is cloned

    rebuilt = engineer_setup_step(str(rid))

    assert os.path.isfile(os.path.join(rebuilt, ".git")), "the worktree was not re-materialized"
    assert enumerate_push_files_git(rebuilt) == [".github/ci.yml", "calc.py"]


def test_a_recovered_run_whose_clone_survived_keeps_it(hosted_brownfield_run):
    """Only the WORKSPACE vanished (the clone is still on this machine): rebuild the worktree
    from the clone that is already there — never re-clone what the disk still holds."""
    rid, repo_path, workspace = hosted_brownfield_run
    head_before = subprocess.run(
        ["git", "-C", repo_path, "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout
    shutil.rmtree(workspace)

    rebuilt = engineer_setup_step(str(rid))

    assert enumerate_push_files_git(rebuilt) == [".github/ci.yml", "calc.py"]
    head_after = subprocess.run(
        ["git", "-C", repo_path, "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout
    assert head_after == head_before  # same clone, not a fresh one


def test_a_recovered_greenfield_run_rematerializes_its_workspace(client):
    """The same defect on the greenfield path, where it fails SILENTLY rather than loudly: the
    agent would simply resume into an empty, un-git-inited directory and the ship would have no
    repo to commit into."""
    rid = _hosted_run(github_repo=None)
    workspace = engineer_setup_step(str(rid))
    assert os.path.isdir(os.path.join(workspace, ".git"))
    shutil.rmtree(workspace)

    rebuilt = engineer_setup_step(str(rid))

    try:
        assert os.path.isdir(os.path.join(rebuilt, ".git")), "the git-init was not re-materialized"
    finally:
        shutil.rmtree(rebuilt, ignore_errors=True)
