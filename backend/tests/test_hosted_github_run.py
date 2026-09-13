"""M-h1b — HOSTED GitHub run mode: schema (migration 0030), the create_run source postures + the
POST /api/repo/inspect fence, the durable clone step, and the push+PR Ship terminal.

The offline suite runs at the SELF-HOSTED default (hosted_mode False); hosted-posture tests flip it
per-test with monkeypatch (mirroring test_github_endpoints._configure_hosted). Outbound GitHub HTTP
+ git are faked at the github_app seam — the repo convention (no respx/MockTransport).
"""

import inspect
import os
import subprocess
import uuid
from pathlib import Path

import pytest
from conftest import auth_user_id
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane import github_app
from tvashtr.control_plane.team_run import clone_github_repo_step, push_and_open_pr_step
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import GithubInstallation, Run
from tvashtr.routers import _run_to_dict

_REPO = "lazyxgenius/trade_mcp"


# ---------------------------------------------------------------- helpers


def _uniq_inst() -> int:
    """A globally-unique installation id (the column is UNIQUE + this suite shares one DB)."""
    return uuid.uuid4().int % 2_000_000_000


def _seed_installation(owner_id, installation_id: int) -> None:
    with session_scope() as s:
        s.add(GithubInstallation(owner_id=owner_id, installation_id=installation_id))


def _mock_repos(monkeypatch, repos: list[dict]) -> None:
    """Fake the owner's accessible repos (bypasses real GitHub) for find_repo_in_installations."""
    monkeypatch.setattr(github_app, "list_installation_repositories", lambda _inst: repos)


def _make_hosted_run(github_repo: str | None = _REPO, base_ref: str | None = "main") -> uuid.UUID:
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
                base_ref=base_ref,
            )
        )
    return rid


# ---------------------------------------------------------------- migration 0030 (schema)


def test_run_to_dict_surfaces_github_repo_and_pr_url(client):
    """Migration 0030: the hosted-GitHub columns round-trip through the run serializer — the
    owner/name + PR url when set, and NULL for a local/greenfield run (every existing row)."""
    team_graph_id = build_two_node_team()
    hosted_id, plain_id = uuid.uuid4(), uuid.uuid4()
    with session_scope() as s:
        s.add(
            Run(
                id=hosted_id,
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="x",
                workflow_id=str(hosted_id),
                status="completed",
                github_repo=_REPO,
                pr_url="https://github.com/lazyxgenius/trade_mcp/pull/1",
            )
        )
        s.add(
            Run(
                id=plain_id,
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="x",
                workflow_id=str(plain_id),
                status="completed",
            )
        )
    with session_scope() as s:
        hosted = s.execute(select(Run).where(Run.id == hosted_id)).scalar_one()
        plain = s.execute(select(Run).where(Run.id == plain_id)).scalar_one()
        hosted_d, plain_d = _run_to_dict(hosted), _run_to_dict(plain)
    assert hosted_d["github_repo"] == _REPO
    assert hosted_d["pr_url"] == "https://github.com/lazyxgenius/trade_mcp/pull/1"
    assert plain_d["github_repo"] is None and plain_d["pr_url"] is None


# ---------------------------------------------------------------- Task 4a: create_run postures


def test_create_run_hosted_fences_repo_path(client, monkeypatch):
    """The fence (§3): in hosted mode the free-text server-path door is CLOSED (422)."""
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    resp = client.post("/api/runs", json={"idea": "x", "repo_path": "/etc"})
    assert resp.status_code == 422
    assert "hosted" in str(resp.json()).lower()


def test_repo_inspect_fenced_in_hosted_mode(client, monkeypatch):
    """The reconnaissance half of the path door is fenced too (422) — it leaks branch names."""
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    resp = client.post("/api/repo/inspect", json={"path": "/etc"})
    assert resp.status_code == 422


def test_repo_inspect_unchanged_when_self_hosted(client, monkeypatch, tmp_path):
    """Byte-unchanged self-hosted: /api/repo/inspect still discriminates a path (non-git -> 200)."""
    monkeypatch.setattr(get_settings(), "hosted_mode", False)  # pin: never rely on ambient .env
    resp = client.post("/api/repo/inspect", json={"path": str(tmp_path)})
    assert resp.status_code == 200
    assert resp.json()["is_git"] is False  # a plain dir is a renderable result, not an error


def test_create_run_github_repo_requires_hosted_mode(client, monkeypatch):
    """github_repo outside hosted mode -> 422 (keeps the two postures crisp)."""
    monkeypatch.setattr(get_settings(), "hosted_mode", False)  # pin: never rely on ambient .env
    resp = client.post("/api/runs", json={"idea": "x", "github_repo": _REPO})
    assert resp.status_code == 422
    assert "hosted" in str(resp.json()).lower()


def test_create_run_rejects_both_repo_path_and_github_repo(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    resp = client.post("/api/runs", json={"idea": "x", "repo_path": "/tmp/x", "github_repo": _REPO})
    assert resp.status_code == 422


def test_create_run_hosted_rejects_a_repo_not_in_the_owners_installations(client, monkeypatch):
    """Authorization: a user can POST any full_name — one they don't control is refused (422)."""
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    _seed_installation(auth_user_id(), _uniq_inst())
    _mock_repos(monkeypatch, [{"full_name": "someoneelse/other", "default_branch": "main"}])
    resp = client.post("/api/runs", json={"idea": "x", "github_repo": _REPO})
    assert resp.status_code == 422
    assert _REPO in str(resp.json())


def test_create_run_hosted_accepts_owned_repo_and_records_it(client, monkeypatch):
    """Happy path: an owned repo is accepted; base_ref comes from default_branch; repo_path stays
    NULL (the clone step sets it later); subpath is None (no hosted scope picker)."""
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    _seed_installation(auth_user_id(), _uniq_inst())
    _mock_repos(monkeypatch, [{"full_name": _REPO, "default_branch": "trunk", "private": True}])
    # Do not actually start the durable workflow (it would clone real GitHub in the background).
    monkeypatch.setattr("tvashtr.routers.DBOS.start_workflow", lambda *a, **k: None)
    resp = client.post("/api/runs", json={"idea": "x", "github_repo": _REPO})
    assert resp.status_code == 200, resp.text
    run_id = resp.json()["run_id"]
    with session_scope() as s:
        run = s.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        assert run.github_repo == _REPO
        assert run.base_ref == "trunk"  # from the repo's default_branch, not a picker
        assert run.repo_path is None  # the durable clone step sets it before load_graph_step
        assert run.subpath is None


# ---------------------------------------------------------------- Task 4b: the durable clone step


def test_clone_step_is_a_noop_for_a_non_hosted_run(client):
    """A local-brownfield / greenfield run (no github_repo) is a clean no-op (repo_path kept)."""
    team = build_two_node_team()
    rid = uuid.uuid4()
    with session_scope() as s:
        s.add(
            Run(
                id=rid,
                team_graph_id=uuid.UUID(team),
                owner_id=auth_user_id(),
                idea="x",
                workflow_id=str(rid),
                status="running",
                repo_path="/local/repo",
            )
        )
    clone_github_repo_step(str(rid))
    with session_scope() as s:
        run = s.execute(select(Run).where(Run.id == rid)).scalar_one()
        assert run.repo_path == "/local/repo"  # untouched


def test_clone_step_clones_and_sets_repo_path_before_load(client, monkeypatch):
    """For a hosted run the step clones + SETS repo_path (what load_graph_step then snapshots)."""
    _seed_installation(auth_user_id(), _uniq_inst())
    _mock_repos(monkeypatch, [{"full_name": _REPO, "default_branch": "main"}])
    captured = {}

    def fake_clone(installation_id, full_name, dest):
        captured["full_name"] = full_name
        os.makedirs(os.path.join(dest, ".git"), exist_ok=True)  # stand in for a real clone

    monkeypatch.setattr(github_app, "clone_repo", fake_clone)
    rid = _make_hosted_run(base_ref="main")
    clone_github_repo_step(str(rid))
    with session_scope() as s:
        run = s.execute(select(Run).where(Run.id == rid)).scalar_one()
        assert run.repo_path is not None and run.repo_path.endswith(str(rid))
        assert run.github_repo == _REPO
    assert captured["full_name"] == _REPO


def test_clone_step_is_idempotent_when_the_clone_is_on_disk(client, monkeypatch, tmp_path):
    """A resume where the clone already ran AND is still on this machine must NOT re-clone."""
    called = {"n": 0}
    monkeypatch.setattr(
        github_app, "clone_repo", lambda *a, **k: called.__setitem__("n", called["n"] + 1)
    )
    clone = tmp_path / "clone"
    clone.mkdir()
    subprocess.run(["git", "init", "-q", str(clone)], check=True)
    rid = _make_hosted_run()
    with session_scope() as s:
        run = s.execute(select(Run).where(Run.id == rid)).scalar_one()
        run.repo_path = str(clone)
    clone_github_repo_step(str(rid))
    assert called["n"] == 0  # the clone is genuinely here -> no-op


def test_clone_step_reclones_when_repo_path_is_set_but_the_clone_is_gone(client, monkeypatch):
    """M-hostedfix: ``repo_path`` is a DATABASE column; the clone is MACHINE-LOCAL disk. A run
    recovered onto a machine that never held the clone must re-clone, not trust the column.

    This is the prod defect: the old gate returned early on ``repo_path`` alone, so the worktree
    was cut from a directory that was not there and every later git call exited 128."""
    _seed_installation(auth_user_id(), _uniq_inst())
    _mock_repos(monkeypatch, [{"full_name": _REPO, "default_branch": "main"}])
    called = {"n": 0}

    def fake_clone(installation_id, full_name, dest):
        called["n"] += 1
        os.makedirs(os.path.join(dest, ".git"), exist_ok=True)

    monkeypatch.setattr(github_app, "clone_repo", fake_clone)
    rid = _make_hosted_run()
    with session_scope() as s:
        run = s.execute(select(Run).where(Run.id == rid)).scalar_one()
        run.repo_path = "/gone/with/the/other/machine"
    clone_github_repo_step(str(rid))
    assert called["n"] == 1  # the disk, not the column, decides
    with session_scope() as s:
        assert s.execute(select(Run).where(Run.id == rid)).scalar_one().repo_path.endswith(str(rid))


# ---------------------------------------------------------------- Task 4c: push + PR Ship terminal


def test_delivery_step_is_a_noop_for_a_non_hosted_run(client):
    """A local/greenfield ship is unchanged: the delivery step returns None, pr_url stays NULL."""
    team = build_two_node_team()
    rid = uuid.uuid4()
    with session_scope() as s:
        s.add(
            Run(
                id=rid,
                team_graph_id=uuid.UUID(team),
                owner_id=auth_user_id(),
                idea="x",
                workflow_id=str(rid),
                status="running",
            )
        )
    assert push_and_open_pr_step(str(rid), "/ws", "tvashtr/x") is None
    with session_scope() as s:
        assert s.execute(select(Run).where(Run.id == rid)).scalar_one().pr_url is None


def test_delivery_step_pushes_and_records_pr_url_for_a_hosted_run(client, monkeypatch):
    _seed_installation(auth_user_id(), _uniq_inst())
    _mock_repos(monkeypatch, [{"full_name": _REPO, "default_branch": "main"}])
    pushed = {}
    monkeypatch.setattr(
        github_app,
        "push_branch",
        lambda inst, full, repo_dir, branch: pushed.update(full=full, branch=branch),
    )
    monkeypatch.setattr(
        github_app,
        "open_pull_request_idempotent",
        lambda *a, **k: "https://github.com/lazyxgenius/trade_mcp/pull/5",
    )
    rid = _make_hosted_run(base_ref="main")
    pr = push_and_open_pr_step(str(rid), "/ws", f"tvashtr/{rid}")
    assert pr == "https://github.com/lazyxgenius/trade_mcp/pull/5"
    assert pushed == {"full": _REPO, "branch": f"tvashtr/{rid}"}
    with session_scope() as s:
        assert s.execute(select(Run).where(Run.id == rid)).scalar_one().pr_url == pr


def test_open_pr_idempotent_reuses_an_existing_open_pr(monkeypatch):
    """Idempotency: list open PRs for the head FIRST; do NOT create when one already exists."""
    monkeypatch.setattr(github_app, "get_installation_token", lambda _inst: "TOK")

    def fake_http(method, url, *, token=None, body=None, accept="application/vnd.github+json"):
        assert method == "GET", "create must NOT be called when an open PR already exists"
        return [{"html_url": "https://github.com/o/r/pull/7"}]

    monkeypatch.setattr(github_app, "_http", fake_http)
    url = github_app.open_pull_request_idempotent(
        1, "o/r", head="tvashtr/x", base="main", title="t", body="b"
    )
    assert url == "https://github.com/o/r/pull/7"


def test_open_pr_idempotent_creates_when_none_open(monkeypatch):
    monkeypatch.setattr(github_app, "get_installation_token", lambda _inst: "TOK")

    def fake_http(method, url, *, token=None, body=None, accept="application/vnd.github+json"):
        if method == "GET":
            return []  # none open
        assert method == "POST"
        return {"html_url": "https://github.com/o/r/pull/9", "number": 9}

    monkeypatch.setattr(github_app, "_http", fake_http)
    url = github_app.open_pull_request_idempotent(
        1, "o/r", head="tvashtr/x", base="main", title="t", body="b"
    )
    assert url == "https://github.com/o/r/pull/9"


# ---------------------------------------------------------------- Task 4d: secrets discipline


def test_clone_and_scrub_leaves_a_tokenless_remote(tmp_path):
    """INVARIANT (§5.5): after a clone, .git/config carries the TOKENLESS remote — the token that
    was in the clone URL is scrubbed off disk. Proven against a real LOCAL clone (no network)."""
    src = tmp_path / "src.git"
    subprocess.run(["git", "init", "--bare", "-q", str(src)], check=True)
    dest = str(tmp_path / "clone")
    # ``str(src)`` stands in for the tokenised source URL; the tokenless url is the scrub target.
    github_app._clone_and_scrub(str(src), "https://github.com/o/r.git", dest)
    config = (Path(dest) / ".git" / "config").read_text()
    assert "https://github.com/o/r.git" in config  # remote scrubbed to the tokenless url
    assert str(src) not in config  # the original (tokenised) source is gone from disk


def test_clone_repo_builds_a_tokenized_url_then_delegates_the_scrub(monkeypatch):
    """clone_repo mints a token, builds the x-access-token URL, and hands both URLs to the scrub."""
    monkeypatch.setattr(github_app, "get_installation_token", lambda _inst: "TOK")
    seen = {}
    monkeypatch.setattr(
        github_app,
        "_clone_and_scrub",
        lambda tok_url, plain_url, dest: seen.update(tok=tok_url, plain=plain_url, dest=dest),
    )
    github_app.clone_repo(99, "o/r", "/dest")
    assert seen["tok"] == "https://x-access-token:TOK@github.com/o/r.git"
    assert seen["plain"] == "https://github.com/o/r.git"
    assert seen["dest"] == "/dest"


def test_git_error_never_leaks_the_argv_or_token(tmp_path):
    """A failed git command names ONLY the subcommand + exit code — never the argv (which in
    production carries the tokenised URL) or stderr (git echoes that URL back)."""
    secret = "x-access-token:ghs_SECRET_leak_me"
    with pytest.raises(github_app.GithubAppError) as exc:
        github_app._git("clone", f"/nonexistent/{secret}/repo.git", str(tmp_path / "d"))
    assert "ghs_SECRET_leak_me" not in str(exc.value)
    assert "git clone failed" in str(exc.value)


def test_git_timeout_never_leaks_the_token(monkeypatch):
    """§5.5 / C8 on the TIMEOUT path (the sibling above covers only the exit-code path). A git that
    blocks past the deadline makes ``subprocess.run(timeout=…)`` raise ``TimeoutExpired`` BEFORE the
    returncode check, and ``TimeoutExpired.__str__`` renders the FULL argv — which for clone/push
    carries ``https://x-access-token:<token>@…``. Uncaught, that token reaches the ship arm's
    ``reason`` (a DB row + a log) and the clone path's persisted workflow error. ``_git`` must catch
    it and re-raise a token-free ``GithubAppError`` naming ONLY the subcommand."""
    token = "ghs_SECRET_timeout_leak"  # noqa: S105 — a fake token, asserted ABSENT from the error
    tokenized = f"https://x-access-token:{token}@github.com/o/r.git"

    def fake_run(cmd, **kwargs):
        # git blocks past the deadline; subprocess raises TimeoutExpired, whose str() renders `cmd`.
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=github_app._GIT_TIMEOUT_SECONDS)

    monkeypatch.setattr(github_app.subprocess, "run", fake_run)

    with pytest.raises((github_app.GithubAppError, subprocess.TimeoutExpired)) as exc:
        github_app._git("clone", tokenized, "/dest")
    assert token not in str(exc.value)  # RED pre-fix: the raw TimeoutExpired str carries the token
    assert isinstance(exc.value, github_app.GithubAppError)  # a wrapped, token-free error
    assert "clone" in str(exc.value)


def test_github_app_imports_no_logging_and_no_httpx():
    """The C8 secrets invariant: github_app.py has NO logging + NO httpx import (kept that way)."""
    src = inspect.getsource(github_app)
    assert "import logging" not in src
    assert "import httpx" not in src
