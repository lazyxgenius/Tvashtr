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
