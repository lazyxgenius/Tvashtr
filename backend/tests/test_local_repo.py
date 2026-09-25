"""Revamp P10 — Desktop local-folder runs: the source-bundle upload, the ``local_repo`` launch, the
clone-from-bundle step, and the result bundle Ship stores for Desktop to fetch back.

Real ``git`` in temp dirs throughout; the executor test is hermetic (a fake engine adapter, gates
auto-approved), like ``test_brownfield_executor.py``.
"""

import shutil
import subprocess
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from conftest import auth_user_id, maybe_write_entry_report
from dbos import DBOS, SetWorkflowID
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from tvashtr import routers
from tvashtr.config import get_settings
from tvashtr.control_plane import clone_reaper, team_run
from tvashtr.control_plane.team_run import clone_local_snapshot_step
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult
from tvashtr.main import app
from tvashtr.models import RepoSnapshot, Run, RunWarning

_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / ".tvashtr_workspaces"
_UPLOAD = "/api/desktop/repo-snapshots"


# ---------------------------------------------------------------------------- helpers


def _git(cwd, *args) -> str:
    return subprocess.run(
        ["git", *args], cwd=str(cwd), check=True, capture_output=True, text=True
    ).stdout.strip()


def _make_repo(path: Path) -> Path:
    """A repo with ``main`` (calculator.py + pkg/) and a ``dev`` branch one commit ahead."""
    path.mkdir(parents=True)
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "t@t.local")
    _git(path, "config", "user.name", "tester")
    (path / "calculator.py").write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
    (path / "pkg").mkdir()
    (path / "pkg" / "mod.py").write_text("X = 1\n", encoding="utf-8")
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "init")
    _git(path, "checkout", "-q", "-b", "dev")
    (path / "dev.txt").write_text("dev work\n", encoding="utf-8")
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "dev")
    _git(path, "checkout", "-q", "main")
    return path


def _bundle(repo: Path, *refs: str) -> bytes:
    out = repo.parent / f"{uuid.uuid4().hex}.bundle"
    _git(repo, "bundle", "create", "-q", str(out), *refs)
    return out.read_bytes()


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"local-repo-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "local-repo-pass"})
    assert resp.status_code == 200, resp.text
    return c


def _upload(c: TestClient, data: bytes, base_ref: str | None = "main", label="~/code/demo"):
    form = {}
    if base_ref is not None:
        form["base_ref"] = base_ref
    if label is not None:
        form["label"] = label
    return c.post(
        _UPLOAD, files={"bundle": ("repo.bundle", data, "application/octet-stream")}, data=form
    )


def _snapshot(sid: str) -> RepoSnapshot:
    with session_scope() as s:
        row = s.get(RepoSnapshot, uuid.UUID(sid))
        s.expunge(row)
        return row


@pytest.fixture
def repo(tmp_path):
    return _make_repo(tmp_path / "repo")


@pytest.fixture
def no_workflow(monkeypatch):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)


@pytest.fixture
def clone_root(tmp_path, monkeypatch):
    root = tmp_path / "clones"
    monkeypatch.setattr(clone_reaper, "CLONE_ROOT", root)
    return root


# ---------------------------------------------------------------------------- upload


def test_upload_stores_a_source_snapshot(client, repo):
    data = _bundle(repo, "main")
    resp = _upload(client, data, base_ref="refs/heads/main")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["size_bytes"] == len(data)
    assert body["base_ref"] == "main" and body["label"] == "~/code/demo"
    assert body["head_sha"] == _git(repo, "rev-parse", "main")
    row = _snapshot(body["snapshot_id"])
    assert row.kind == "source" and row.owner_id == auth_user_id()
    assert bytes(row.data) == data and row.consumed_at is None and row.run_id is None


def test_upload_refuses_an_oversized_bundle(client, repo, monkeypatch):
    monkeypatch.setattr(get_settings(), "local_repo_bundle_max_bytes", 100)
    # Declared length within the multipart slack: refused while the body is read.
    resp = _upload(client, _bundle(repo, "main"))
    assert resp.status_code == 413, resp.text
    assert resp.json()["detail"]["code"] == "bundle_too_large"
    # Declared length far over the cap: refused from the header alone.
    resp = _upload(client, b"x" * (200 * 1024))
    assert resp.status_code == 413
    assert "too big" in resp.json()["detail"]["message"]


@pytest.mark.parametrize("data", [b"", b"not a bundle at all\n"])
def test_upload_refuses_a_file_that_is_not_a_bundle(client, data):
    resp = _upload(client, data)
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == {
        "code": "bundle_invalid",
        "message": "That file isn't a git bundle.",
    }


def test_upload_refuses_a_bundle_without_its_base_ref(client, repo):
    resp = _upload(client, _bundle(repo, "main"), base_ref="dev")
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["code"] == "base_ref_not_in_bundle" and detail["branches"] == ["main"]
    assert detail["message"] == "The bundle doesn't contain the branch dev."


def test_upload_refuses_a_thin_bundle(client, repo):
    resp = _upload(client, _bundle(repo, "main..dev"), base_ref="dev")
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "bundle_incomplete"


def test_upload_needs_the_bundle_and_base_ref_fields(client, repo):
    resp = client.post(_UPLOAD, data={"base_ref": "main"})
    assert resp.status_code == 422 and resp.json()["detail"]["code"] == "bundle_missing"
    resp = _upload(client, _bundle(repo, "main"), base_ref=None)
    assert resp.status_code == 422 and resp.json()["detail"]["code"] == "base_ref_missing"


def test_upload_requires_a_session(unauth_client, repo):
    assert _upload(unauth_client, _bundle(repo, "main")).status_code == 401


def test_upload_purges_the_owners_stale_unused_snapshots(client, repo):
    other = _fresh()
    data = _bundle(repo, "main")
    stale = _upload(client, data).json()["snapshot_id"]
    fresh = _upload(client, data).json()["snapshot_id"]
    foreign = _upload(other, data).json()["snapshot_id"]
    old = datetime.now(UTC) - timedelta(hours=25)
    with session_scope() as s:
        s.execute(
            update(RepoSnapshot)
            .where(RepoSnapshot.id.in_([uuid.UUID(stale), uuid.UUID(foreign)]))
            .values(created_at=old)
        )
    assert _upload(client, data).status_code == 201
    with session_scope() as s:
        left = set(s.execute(select(RepoSnapshot.id)).scalars())
    assert uuid.UUID(stale) not in left
    assert {uuid.UUID(fresh), uuid.UUID(foreign)} <= left


# ---------------------------------------------------------------------------- launch


def _launch(c: TestClient, snapshot_id: str, **extra):
    body = {"idea": "add subtract", "desktop_target": True}
    body["local_repo"] = {"snapshot_id": snapshot_id, "label": "~/code/demo", **extra.pop("lr", {})}
    body.update(extra)
    return c.post("/api/runs", json=body)


def test_launch_on_a_folder_records_it_and_claims_the_snapshot(client, repo, no_workflow):
    sid = _upload(client, _bundle(repo, "main", "dev"), base_ref="dev").json()["snapshot_id"]
    resp = _launch(client, sid, lr={"base_ref": "dev", "subpath": "/pkg/"})
    assert resp.status_code == 200, resp.text
    run_id = resp.json()["run_id"]
    with session_scope() as s:
        run = s.get(Run, uuid.UUID(run_id))
        assert run.local_repo_label == "~/code/demo"
        assert run.local_snapshot_id == uuid.UUID(sid)
        assert (run.base_ref, run.subpath, run.repo_path) == ("dev", "pkg", None)
        assert run.desktop_target is True and run.github_repo is None
    assert _snapshot(sid).run_id == uuid.UUID(run_id)
    got = client.get(f"/api/runs/{run_id}").json()["run"]
    assert got["local_repo_label"] == "~/code/demo"
    assert got["target"] == {
        "kind": "desktop_folder",
        "label": "~/code/demo",
        "base_ref": "dev",
        "subpath": "pkg",
    }


def test_launch_on_a_folder_needs_desktop_target(client, repo, no_workflow):
    sid = _upload(client, _bundle(repo, "main")).json()["snapshot_id"]
    resp = _launch(client, sid, desktop_target=False)
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "local_repo_needs_desktop"


def test_launch_on_a_folder_is_exclusive_with_other_sources(client, repo, no_workflow, monkeypatch):
    sid = _upload(client, _bundle(repo, "main")).json()["snapshot_id"]
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    resp = _launch(client, sid, repo_path=str(repo))
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "local_repo_exclusive"
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    resp = _launch(client, sid, github_repo="o/r")
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "local_repo_exclusive"
    assert _snapshot(sid).run_id is None  # nothing claimed it


def test_launch_refuses_someone_elses_or_an_unknown_snapshot(client, repo, no_workflow):
    foreign = _upload(_fresh(), _bundle(repo, "main")).json()["snapshot_id"]
    for sid in (foreign, str(uuid.uuid4()), "not-a-uuid"):
        resp = _launch(client, sid)
        assert resp.status_code == 404, sid
        assert resp.json()["detail"]["code"] == "snapshot_not_found"


def test_launch_refuses_a_used_snapshot_and_a_different_branch(client, repo, no_workflow):
    sid = _upload(client, _bundle(repo, "main")).json()["snapshot_id"]
    wrong = _launch(client, sid, lr={"base_ref": "dev"})
    assert wrong.status_code == 422
    assert wrong.json()["detail"]["code"] == "base_ref_mismatch"
    assert _launch(client, sid).status_code == 200
    again = _launch(client, sid)
    assert again.status_code == 422
    assert again.json()["detail"]["code"] == "snapshot_used"
    with session_scope() as s:
        s.execute(
            update(RepoSnapshot)
            .where(RepoSnapshot.id == uuid.UUID(sid))
            .values(run_id=None, consumed_at=datetime.now(UTC))
        )
    assert _launch(client, sid).json()["detail"]["code"] == "snapshot_used"


# ---------------------------------------------------------------------------- clone step


def _folder_run(data: bytes, base_ref: str, subpath: str | None = None) -> tuple[str, str]:
    """A folder run + its claimed source snapshot, inserted directly (as ``create_run`` would)."""
    rid = uuid.uuid4()
    with session_scope() as s:
        snap = RepoSnapshot(
            owner_id=auth_user_id(),
            kind="source",
            label="~/code/demo",
            base_ref=base_ref,
            size_bytes=len(data),
            data=data,
        )
        s.add(snap)
        s.flush()
        s.add(
            Run(
                id=rid,
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=auth_user_id(),
                idea="Add a subtract(a, b) function to calculator.py.",
                workflow_id=str(rid),
                status="running",
                base_ref=base_ref,
                subpath=subpath,
                desktop_target=True,
                local_repo_label="~/code/demo",
                local_snapshot_id=snap.id,
            )
        )
        s.flush()
        snap.run_id = rid
        return str(rid), str(snap.id)


def test_clone_step_clones_the_bundle_at_base_ref(client, repo, clone_root):
    rid, sid = _folder_run(_bundle(repo, "main", "dev"), "dev", subpath="pkg")
    result = clone_local_snapshot_step(rid)
    dest = clone_root / rid
    assert result == {"ok": True, "repo_path": str(dest)}
    assert _git(dest, "rev-parse", "HEAD") == _git(repo, "rev-parse", "dev")
    assert _git(dest, "symbolic-ref", "--short", "HEAD") == "dev"
    assert _git(dest, "remote") == ""  # the temp bundle "origin" is gone
    with session_scope() as s:
        run = s.get(Run, uuid.UUID(rid))
        assert (run.repo_path, run.subpath) == (str(dest), "pkg")
    snap = _snapshot(sid)
    assert snap.consumed_at is not None and bytes(snap.data) == b""
    # Idempotent: the clone is here, so a replayed body keeps it.
    assert clone_local_snapshot_step(rid) == {"ok": True, "repo_path": str(dest)}


def test_clone_step_drops_a_scope_missing_on_base_ref(client, repo, clone_root):
    rid, _ = _folder_run(_bundle(repo, "main"), "main", subpath="nope")
    assert clone_local_snapshot_step(rid)["ok"] is True
    with session_scope() as s:
        assert s.get(Run, uuid.UUID(rid)).subpath is None
        reasons = list(
            s.execute(
                select(RunWarning.reason).where(RunWarning.run_id == uuid.UUID(rid))
            ).scalars()
        )
    assert any("isn't a folder on main" in r for r in reasons)


def test_clone_step_reports_a_missing_snapshot(client, repo, clone_root):
    rid, sid = _folder_run(_bundle(repo, "main"), "main")
    with session_scope() as s:
        s.execute(update(RepoSnapshot).where(RepoSnapshot.id == uuid.UUID(sid)).values(data=b""))
    result = clone_local_snapshot_step(rid)
    assert result["ok"] is False and "no longer on the server" in result["reason"]


def test_a_folder_run_whose_snapshot_is_gone_fails_readably(client, repo, clone_root):
    rid, sid = _folder_run(_bundle(repo, "main"), "main")
    with session_scope() as s:
        s.execute(
            update(RepoSnapshot)
            .where(RepoSnapshot.id == uuid.UUID(sid))
            .values(consumed_at=datetime.now(UTC), data=b"")
        )
    with SetWorkflowID(rid):
        result = DBOS.start_workflow(team_run.run_team, "x").get_result()
    assert result["status"] == "failed"
    with session_scope() as s:
        run = s.get(Run, uuid.UUID(rid))
        assert (run.status, run.failure_code) == ("failed", "folder_clone")
        assert "Start the run again from Tvashtr Desktop" in run.failure_message


# ---------------------------------------------------------------------------- ship bundle


class _FakeAdapter:
    """Edit calculator.py the way an agent would and report success — no LLM, no container."""

    name = "openhands-docker"

    def run(self, task, on_event=None):
        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        calc = Path(task.workspace_dir) / "calculator.py"
        calc.write_text(calc.read_text() + "\n\ndef subtract(a, b):\n    return a - b\n")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["calculator.py"]
        )


def test_folder_run_ships_a_bundle_desktop_can_fetch(
    client, repo, clone_root, monkeypatch, tmp_path
):
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _FakeAdapter())
    rid, _ = _folder_run(_bundle(repo, "main"), "main")
    branch = f"tvashtr/{rid}"
    before = client.get(f"/api/runs/{rid}/ship-bundle")
    assert before.status_code == 404 and before.json()["detail"]["code"] == "not_shipped"
    try:
        with SetWorkflowID(rid):
            result = DBOS.start_workflow(team_run.run_team, "add subtract").get_result()
        assert result["status"] == "completed", result
        assert result["ship_branch"] == branch and result["pr_url"] is None

        resp = client.get(f"/api/runs/{rid}/ship-bundle")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/x-git-bundle"
        assert resp.headers["x-tvashtr-branch"] == branch
        bundle = tmp_path / "result.bundle"
        bundle.write_bytes(resp.content)

        # What Desktop's bringBackBranch does, in a fresh clone of the user's repo.
        fresh = tmp_path / "fresh"
        _git(tmp_path, "clone", "-q", str(repo), str(fresh))
        _git(fresh, "fetch", "-q", str(bundle), f"{branch}:{branch}")
        assert "def subtract" in _git(fresh, "show", f"{branch}:calculator.py")
        assert _git(fresh, "rev-parse", f"{branch}~1") == _git(repo, "rev-parse", "main")
        assert _git(fresh, "status", "--porcelain") == ""  # the working tree is untouched
        assert _git(fresh, "symbolic-ref", "--short", "HEAD") == "main"

        # Owner-only, and only for folder runs.
        assert _fresh().get(f"/api/runs/{rid}/ship-bundle").status_code == 404
        with session_scope() as s:
            kinds = list(
                s.execute(
                    select(RepoSnapshot.kind).where(RepoSnapshot.run_id == uuid.UUID(rid))
                ).scalars()
            )
        assert sorted(kinds) == ["result", "source"]
    finally:
        shutil.rmtree(_WORKSPACE_ROOT / rid, ignore_errors=True)


def test_ship_bundle_404s_for_a_run_that_is_not_a_folder_run(client):
    rid = uuid.uuid4()
    with session_scope() as s:
        s.add(
            Run(
                id=rid,
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=auth_user_id(),
                idea="x",
                workflow_id=str(rid),
                status="completed",
            )
        )
    resp = client.get(f"/api/runs/{rid}/ship-bundle")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "not_a_folder_run"
    assert client.get(f"/api/runs/{uuid.uuid4()}/ship-bundle").status_code == 404
