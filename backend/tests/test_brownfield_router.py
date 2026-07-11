"""The brownfield router surface (M-brownfield Slice 1): ``POST /api/repo/inspect`` + the
``create_run`` brownfield validation/recording. Offline — ``DBOS.start_workflow`` is stubbed (the
``test_ab_pair`` shape) so the happy-path launch records the Run row WITHOUT running any team / LLM
/ worktree. The 422 paths short-circuit before launch. Greenfield (no ``repo_path``) is unaffected.
"""

import subprocess
import uuid

from sqlalchemy import select

from tvashtr import routers
from tvashtr.db import session_scope
from tvashtr.models import Run


def _stub_launch(monkeypatch):
    def _fake_start_workflow(fn, *args, **kwargs):
        return None

    monkeypatch.setattr(routers.DBOS, "start_workflow", _fake_start_workflow)


def _init_repo(path, branch="main"):
    path.mkdir(parents=True, exist_ok=True)
    for a in (
        ["init", "-q", "-b", branch],
        ["config", "user.email", "t@t.local"],
        ["config", "user.name", "t"],
    ):
        subprocess.run(["git", "-C", str(path), *a], check=True, capture_output=True)
    (path / "calculator.py").write_text("def add(a, b):\n    return a + b\n")
    (path / "test_calculator.py").write_text("from calculator import add\n")
    for a in (["add", "-A"], ["commit", "-qm", "init"]):
        subprocess.run(["git", "-C", str(path), *a], check=True, capture_output=True)
    return path


# ---- POST /api/repo/inspect ---------------------------------------------------------------------


def test_inspect_repo_on_real_repo(client, tmp_path):
    repo = _init_repo(tmp_path / "repo")
    resp = client.post("/api/repo/inspect", json={"path": str(repo)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_git"] is True
    assert body["current_branch"] == "main"
    assert "main" in body["branches"]
    assert body["tracked_file_count"] >= 2


def test_inspect_repo_on_non_git_path_is_200_discriminated(client, tmp_path):
    plain = tmp_path / "plain"
    plain.mkdir()
    resp = client.post("/api/repo/inspect", json={"path": str(plain)})
    # A non-repo is a renderable RESULT (200), not an error.
    assert resp.status_code == 200
    assert resp.json()["is_git"] is False
    assert "error" in resp.json()
    # A non-git result carries NO subpaths (nothing to scope) — the picker only shows for a
    # git repo.
    assert "subpaths" not in resp.json()


def _init_multi_package_repo(path):
    """A tmp git repo with two top-level packages (`api`, `core`) + a root file — the shape the
    Scope picker offers."""
    path.mkdir(parents=True, exist_ok=True)
    for a in (
        ["init", "-q", "-b", "main"],
        ["config", "user.email", "t@t.local"],
        ["config", "user.name", "t"],
    ):
        subprocess.run(["git", "-C", str(path), *a], check=True, capture_output=True)
    for rel, content in {
        "README.md": "# multi\n",  # a root file — never a subpath
        "core/indicators.py": "x\n",
        "core/ema.py": "y\n",
        "api/server.py": "z\n",
    }.items():
        f = path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content)
    for a in (["add", "-A"], ["commit", "-qm", "init"]):
        subprocess.run(["git", "-C", str(path), *a], check=True, capture_output=True)
    return path


def test_inspect_repo_returns_subpaths_for_multi_package_repo(client, tmp_path):
    # scoped-mount Slice 2: POST /api/repo/inspect ALSO returns the repo's top-level tracked package
    # dirs + counts (the launch panel's Scope picker source). Fails pre-change (no `subpaths` key).
    repo = _init_multi_package_repo(tmp_path / "multi")
    resp = client.post("/api/repo/inspect", json={"path": str(repo)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_git"] is True
    assert body["subpaths"] == [
        {"path": "api", "file_count": 1},
        {"path": "core", "file_count": 2},
    ]


# ---- POST /api/runs brownfield validation + recording -------------------------------------------


def test_create_run_rejects_non_git_repo_path_422(client, monkeypatch, tmp_path):
    _stub_launch(monkeypatch)
    plain = tmp_path / "plain"
    plain.mkdir()
    resp = client.post("/api/runs", json={"idea": "x", "repo_path": str(plain)})
    assert resp.status_code == 422
    assert "not a git repository" in str(resp.json()["detail"])


def test_create_run_rejects_unknown_base_ref_422(client, monkeypatch, tmp_path):
    _stub_launch(monkeypatch)
    repo = _init_repo(tmp_path / "repo")
    resp = client.post(
        "/api/runs",
        json={"idea": "x", "repo_path": str(repo), "base_ref": "nonexistent-branch"},
    )
    assert resp.status_code == 422
    assert "base_ref" in str(resp.json()["detail"])


def test_create_run_brownfield_defaults_base_ref_and_records_columns(client, monkeypatch, tmp_path):
    _stub_launch(monkeypatch)
    repo = _init_repo(tmp_path / "repo", branch="main")
    resp = client.post("/api/runs", json={"idea": "Add subtract", "repo_path": str(repo)})
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        assert run.repo_path == str(repo)
        assert run.base_ref == "main"  # defaulted to the repo's current branch
        assert run.ship_branch is None  # not set until the worktree is created at run time
        assert run.subpath is None  # scoped-mount Slice 1: no subpath passed → whole-repo (NULL)

    # The status payload additively surfaces the brownfield target (repo_path/base_ref/ship_branch).
    got = client.get(f"/api/runs/{run_id}").json()["run"]
    assert got["repo_path"] == str(repo)
    assert got["base_ref"] == "main"
    assert "ship_branch" in got


def test_create_run_greenfield_records_null_brownfield_columns(client, monkeypatch):
    _stub_launch(monkeypatch)
    resp = client.post("/api/runs", json={"idea": "greenfield idea"})
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        assert run.repo_path is None
        assert run.base_ref is None
        assert run.ship_branch is None
        assert run.subpath is None


# ---- scoped-mount Slice 1: the optional subpath on POST /api/runs --------------------------------


def _init_repo_with_pkg(path, branch="main"):
    """Like ``_init_repo`` but with a tracked ``pkg/`` directory (+ a file under it) — the sub-path
    scoping target. A second commit keeps the helper composable on top of ``_init_repo``."""
    _init_repo(path, branch=branch)
    (path / "pkg").mkdir()
    (path / "pkg" / "mod.py").write_text("def f():\n    return 1\n")
    for a in (["add", "-A"], ["commit", "-qm", "add pkg"]):
        subprocess.run(["git", "-C", str(path), *a], check=True, capture_output=True)
    return path


def test_create_run_brownfield_persists_valid_subpath(client, monkeypatch, tmp_path):
    _stub_launch(monkeypatch)
    repo = _init_repo_with_pkg(tmp_path / "repo")
    resp = client.post(
        "/api/runs", json={"idea": "Add to pkg", "repo_path": str(repo), "subpath": "pkg"}
    )
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        assert run.subpath == "pkg"  # persisted on the run row
        assert run.repo_path == str(repo)
    # Additively surfaced on the run-detail payload (parallel to repo_path/base_ref/ship_branch).
    assert client.get(f"/api/runs/{run_id}").json()["run"]["subpath"] == "pkg"


def test_create_run_rejects_subpath_that_is_not_a_tracked_dir_422(client, monkeypatch, tmp_path):
    _stub_launch(monkeypatch)
    repo = _init_repo_with_pkg(tmp_path / "repo")
    # A tracked FILE is not a directory, and a non-existent path is not tracked → clean 422 each.
    for bad in ("pkg/mod.py", "does-not-exist"):
        resp = client.post("/api/runs", json={"idea": "x", "repo_path": str(repo), "subpath": bad})
        assert resp.status_code == 422, (bad, resp.text)
        assert "subpath is not a tracked directory" in str(resp.json()["detail"])


def test_create_run_greenfield_ignores_subpath(client, monkeypatch):
    _stub_launch(monkeypatch)
    # No repo_path → greenfield → a supplied subpath is IGNORED (stored NULL), never a 422.
    resp = client.post("/api/runs", json={"idea": "greenfield", "subpath": "pkg"})
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        assert run.subpath is None
        assert run.repo_path is None
