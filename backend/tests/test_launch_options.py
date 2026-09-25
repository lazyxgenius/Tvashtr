"""Revamp P6 / P8 / P11 — ``POST /api/runs`` launch options (budget range, ``retry_of_run_id``,
``library_team_id``, a hosted run's chosen base branch and scope), the GitHub branches / subpaths
endpoints, and the executor cutting a hosted worktree from ``origin/<base_ref>``.

GitHub HTTP is faked at ``github_app._http`` (the repo convention: no network in the suite)."""

import subprocess
import uuid
from urllib.parse import unquote, urlparse

import pytest
from conftest import auth_user_id
from home_fixtures import fresh_account, library_team, make_run
from sqlalchemy import select

from tvashtr import routers
from tvashtr.config import get_settings
from tvashtr.control_plane import github_app
from tvashtr.control_plane.worktree import add_worktree, resolve_start_point
from tvashtr.db import session_scope
from tvashtr.models import GithubInstallation, Run

_REPO = "lazyxgenius/trade_mcp"


def _run_row(run_id: str) -> Run:
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        session.expunge(run)
        return run


# ---------------------------------------------------------------- budget


@pytest.mark.parametrize(
    ("cap", "detail"),
    [
        (0, "budget must be above $0"),
        (-5, "budget must be above $0"),
        (500.01, "budget can't be more than $500"),
    ],
)
def test_budget_out_of_range_is_refused(client, cap, detail):
    resp = client.post("/api/runs", json={"idea": "x", "budget_cap_usd": cap})
    assert resp.status_code == 422
    assert resp.json()["detail"] == detail


# ---------------------------------------------------------------- retry + library team


def test_launching_a_library_team_records_it_and_a_retry_link(client, monkeypatch):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    team = library_team(client, name="Bugfix squad")
    failed, _ = make_run(auth_user_id(), team, status="failed")

    resp = client.post(
        "/api/runs",
        json={
            "idea": "Fix the flaky login test",
            "team_graph_id": team,
            "retry_of_run_id": failed,
            "budget_cap_usd": 5,
        },
    )
    assert resp.status_code == 200, resp.text
    run = _run_row(resp.json()["run_id"])
    assert str(run.library_team_id) == team
    assert str(run.retry_of_run_id) == failed
    assert str(run.team_graph_id) != team  # the run still executes a private clone

    listed = client.get(f"/api/runs/{resp.json()['run_id']}").json()["run"]
    assert listed["retry_of_run_id"] == failed and listed["library_team_id"] == team


def test_a_legacy_team_shape_launch_has_no_library_team(client, monkeypatch):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    resp = client.post("/api/runs", json={"idea": "x"})
    assert resp.status_code == 200, resp.text
    assert _run_row(resp.json()["run_id"]).library_team_id is None


def test_retry_of_must_be_one_of_your_finished_runs(client, monkeypatch):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    running, _ = make_run(auth_user_id(), None, status="running")
    other, other_owner = fresh_account()
    foreign, _ = make_run(other_owner, library_team(other), status="failed")
    cases = [
        ("not-a-uuid", "retry_of_run_id is not one of your runs"),
        (str(uuid.uuid4()), "retry_of_run_id is not one of your runs"),
        (foreign, "retry_of_run_id is not one of your runs"),
        (running, "retry_of_run_id must be a run that has finished"),
    ]
    for value, detail in cases:
        resp = client.post("/api/runs", json={"idea": "x", "retry_of_run_id": value})
        assert resp.status_code == 422, value
        assert resp.json()["detail"] == detail


# ---------------------------------------------------------------- hosted GitHub target


class _FakeGithub:
    """A tiny GitHub: ``trunk`` (default), ``dev`` and ``main``; folders ``packages/indicators``
    and ``web`` plus a top-level README. Records every request path."""

    def __init__(self, *, branches=("trunk", "dev", "main"), down=False):
        self.branches = list(branches)
        self.down = down
        self.paths: list[str] = []

    def __call__(self, method, url, *, token=None, body=None, accept=None):
        parsed = urlparse(url)
        path, query = unquote(parsed.path), parsed.query
        self.paths.append(path)
        if self.down:
            raise github_app.GithubAppError("GitHub GET -> HTTP 503", status=503)
        prefix = f"/repos/{_REPO}"
        if path == f"{prefix}/branches":
            page = int(dict(p.split("=") for p in query.split("&"))["page"])
            chunk = self.branches[(page - 1) * 100 : page * 100]
            return [{"name": b, "commit": {"sha": f"sha-{b}"}} for b in chunk]
        if path.startswith(f"{prefix}/branches/"):
            name = path[len(f"{prefix}/branches/") :]
            if name not in self.branches:
                raise github_app.GithubAppError("GitHub GET -> HTTP 404", status=404)
            return {"name": name, "commit": {"sha": f"sha-{name}"}}
        if path.startswith(f"{prefix}/git/trees/"):
            return {
                "truncated": False,
                "tree": [
                    {"path": "README.md", "type": "blob"},
                    {"path": "packages", "type": "tree"},
                    {"path": "packages/indicators/rsi.py", "type": "blob"},
                    {"path": "packages/indicators/test_rsi.py", "type": "blob"},
                    {"path": "web/index.html", "type": "blob"},
                ],
            }
        if path.startswith(f"{prefix}/contents/"):
            target = path[len(f"{prefix}/contents/") :]
            if target in ("packages", "packages/indicators", "web"):
                return [{"name": "x"}]
            if target == "README.md":
                return {"name": "README.md", "type": "file"}
            raise github_app.GithubAppError("GitHub GET -> HTTP 404", status=404)
        raise AssertionError(f"unexpected GitHub call {method} {url}")


def _hosted(monkeypatch, owner_id, fake: _FakeGithub) -> None:
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    with session_scope() as session:
        session.add(
            GithubInstallation(owner_id=owner_id, installation_id=uuid.uuid4().int % 2_000_000_000)
        )
    monkeypatch.setattr(
        github_app,
        "list_installation_repositories",
        lambda _inst: [{"full_name": _REPO, "default_branch": "trunk", "private": True}],
    )
    monkeypatch.setattr(github_app, "get_installation_token", lambda _inst: "TOK")
    monkeypatch.setattr(github_app, "_http", fake)
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)


def test_hosted_run_keeps_the_chosen_branch_and_scope(client, monkeypatch):
    fake = _FakeGithub()
    _hosted(monkeypatch, auth_user_id(), fake)
    resp = client.post(
        "/api/runs",
        json={
            "idea": "x",
            "github_repo": _REPO,
            "base_ref": "dev",
            "subpath": "/packages/indicators/",
        },
    )
    assert resp.status_code == 200, resp.text
    run = _run_row(resp.json()["run_id"])
    assert run.base_ref == "dev"
    assert run.subpath == "packages/indicators"
    assert f"/repos/{_REPO}/contents/packages/indicators" in fake.paths


def test_hosted_run_defaults_to_the_default_branch_without_asking_github(client, monkeypatch):
    fake = _FakeGithub()
    _hosted(monkeypatch, auth_user_id(), fake)
    resp = client.post("/api/runs", json={"idea": "x", "github_repo": _REPO})
    assert resp.status_code == 200, resp.text
    run = _run_row(resp.json()["run_id"])
    assert run.base_ref == "trunk" and run.subpath is None
    assert fake.paths == []


def test_hosted_run_refuses_an_unknown_branch_or_folder(client, monkeypatch):
    _hosted(monkeypatch, auth_user_id(), _FakeGithub())
    resp = client.post("/api/runs", json={"idea": "x", "github_repo": _REPO, "base_ref": "nope"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == {
        "code": "unknown_base_ref",
        "message": f"base_ref is not a branch of {_REPO}",
        "base_ref": "nope",
        "branches": ["trunk", "dev", "main"],
    }
    for bad in ("missing", "README.md"):
        resp = client.post("/api/runs", json={"idea": "x", "github_repo": _REPO, "subpath": bad})
        assert resp.status_code == 422, bad
        assert resp.json()["detail"]["code"] == "unknown_subpath"
        assert resp.json()["detail"]["message"] == f"subpath is not a folder of {_REPO} on trunk"


def test_hosted_run_reports_a_github_outage_as_502(client, monkeypatch):
    _hosted(monkeypatch, auth_user_id(), _FakeGithub(down=True))
    resp = client.post("/api/runs", json={"idea": "x", "github_repo": _REPO, "base_ref": "dev"})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Couldn't reach GitHub. Try again in a moment."


# ---------------------------------------------------------------- branches / subpaths endpoints


def test_branches_endpoint_lists_the_default_first(client, monkeypatch):
    c, owner = fresh_account()
    _hosted(monkeypatch, owner, _FakeGithub())
    resp = c.get(f"/api/github/repos/{_REPO}/branches")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "default_branch": "trunk",
        "branches": ["trunk", "dev", "main"],
        "truncated": False,
    }


def test_branches_endpoint_caps_at_three_hundred(client, monkeypatch):
    c, owner = fresh_account()
    many = ["trunk"] + [f"b{i:03d}" for i in range(349)]
    _hosted(monkeypatch, owner, _FakeGithub(branches=many))
    body = c.get(f"/api/github/repos/{_REPO}/branches").json()
    assert len(body["branches"]) == 300 and body["truncated"] is True
    # A branch past the cap is still found directly when launching.
    assert github_app.get_branch_sha(1, _REPO, "b340") == "sha-b340"
    assert github_app.get_branch_sha(1, _REPO, "nope") is None


def test_subpaths_endpoint_counts_files_per_top_level_folder(client, monkeypatch):
    c, owner = fresh_account()
    _hosted(monkeypatch, owner, _FakeGithub())
    resp = c.get(f"/api/github/repos/{_REPO}/subpaths?ref=dev")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "ref": "dev",
        "subpaths": [
            {"path": "packages", "file_count": 2},
            {"path": "web", "file_count": 1},
        ],
        "truncated": False,
    }
    assert c.get(f"/api/github/repos/{_REPO}/subpaths").json()["ref"] == "trunk"
    resp = c.get(f"/api/github/repos/{_REPO}/subpaths?ref=nope")
    assert resp.status_code == 422 and resp.json()["detail"]["code"] == "unknown_ref"


def test_github_endpoints_are_owner_scoped(client, monkeypatch):
    c, owner = fresh_account()
    _hosted(monkeypatch, owner, _FakeGithub())
    stranger, _ = fresh_account()  # no installation of their own
    assert stranger.get(f"/api/github/repos/{_REPO}/branches").status_code == 404
    assert stranger.get(f"/api/github/repos/{_REPO}/subpaths").status_code == 404
    assert c.get("/api/github/repos/someone/else/branches").status_code == 404


# ---------------------------------------------------------------- the executor's start point


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def test_a_clone_worktree_is_cut_from_origin_of_a_non_default_branch(tmp_path):
    origin = tmp_path / "origin"
    origin.mkdir()
    _git(origin, "init", "-q", "-b", "main")
    _git(
        origin,
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "a",
    )
    _git(origin, "checkout", "-q", "-b", "dev")
    (origin / "dev.txt").write_text("dev\n")
    _git(origin, "add", "dev.txt")
    _git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "dev")
    _git(origin, "checkout", "-q", "main")
    clone = tmp_path / "clone"
    _git(tmp_path, "clone", "-q", str(origin), str(clone))

    assert resolve_start_point(str(clone), "main") == "main"
    assert resolve_start_point(str(clone), "dev") == "origin/dev"
    assert resolve_start_point(str(clone), "v9") == "v9"
    assert resolve_start_point(str(clone), None) is None

    workspace = tmp_path / "ws"
    workspace.mkdir()
    branch = add_worktree(
        str(clone), str(workspace), "run-1", resolve_start_point(str(clone), "dev")
    )
    assert branch == "tvashtr/run-1"
    assert (workspace / "dev.txt").read_text() == "dev\n"
