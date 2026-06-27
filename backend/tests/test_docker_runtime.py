"""Reaping the OpenHands agent-server Docker containers — the ``docker`` CLI mocked.

No real Docker: every test patches ``subprocess.run``, so it asserts the exact
``docker`` invocations for present/absent containers and that the module degrades
gracefully when the daemon (or the CLI) is missing. The openhands-free-ness of this
startup-path module is covered in ``test_registry``.
"""

import subprocess
from unittest.mock import patch

from tvashtr.engines import docker_runtime
from tvashtr.engines.docker_runtime import enumerate_push_files, enumerate_push_files_git

_RUN = "tvashtr.engines.docker_runtime.subprocess.run"


def _completed(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(
        args=["docker"], returncode=returncode, stdout=stdout, stderr=stderr
    )


def test_list_agent_containers_builds_ancestor_filter():
    image = "ghcr.io/openhands/agent-server:latest-python"
    with patch(_RUN, return_value=_completed(stdout="abc123\n def456 \n\n")) as run:
        ids = docker_runtime.list_agent_containers(image)
    assert ids == ["abc123", "def456"]
    assert run.call_args.args[0] == ["docker", "ps", "-aq", "--filter", f"ancestor={image}"]


def test_reap_force_removes_each_container():
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[:3] == ["docker", "ps", "-aq"]:
            return _completed(stdout="c1\nc2\n")
        return _completed(returncode=0)

    with patch(_RUN, side_effect=fake_run):
        reaped = docker_runtime.reap_agent_containers("img:tag")

    assert reaped == ["c1", "c2"]
    assert ["docker", "rm", "-f", "c1"] in calls
    assert ["docker", "rm", "-f", "c2"] in calls


def test_reap_no_containers_is_noop():
    with patch(_RUN, return_value=_completed(stdout="")) as run:
        reaped = docker_runtime.reap_agent_containers("img:tag")
    assert reaped == []
    assert run.call_count == 1  # only the `ps`; no `rm`


def test_reap_ps_failure_returns_empty_no_rm():
    with patch(_RUN, return_value=_completed(returncode=1, stderr="Cannot connect")) as run:
        reaped = docker_runtime.reap_agent_containers("img:tag")
    assert reaped == []
    assert run.call_count == 1  # ps failed -> no rm attempts


def test_reap_handles_docker_cli_absent():
    with patch(_RUN, side_effect=FileNotFoundError("docker")):
        reaped = docker_runtime.reap_agent_containers("img:tag")
    assert reaped == []


def test_sweep_swallows_unexpected_errors(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(docker_runtime, "reap_agent_containers", _boom)
    # The boot sweep must never propagate (it runs at app startup).
    docker_runtime.sweep_orphaned_agent_containers()


# --- P1.5c: enumerate_push_files (pure host-side walk; no Docker, openhands-free) ---------


def test_enumerate_push_files_skips_hidden_and_scaffolding(tmp_path):
    (tmp_path / "greeting.txt").write_text("hi")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.py").write_text("x")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("[core]")
    (tmp_path / ".hidden").write_text("secret")
    (tmp_path / "bash_events").mkdir()  # top-level server scaffolding
    (tmp_path / "bash_events" / "ev.json").write_text("{}")
    assert enumerate_push_files(str(tmp_path)) == ["greeting.txt", "src/app.py"]


def test_enumerate_push_files_empty_on_git_only(tmp_path):
    # The iteration-1 case: a freshly git-init'd workspace has only .git -> nothing to push.
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "HEAD").write_text("ref: refs/heads/main")
    assert enumerate_push_files(str(tmp_path)) == []


# --- M-brownfield: enumerate_push_files_git (git-aware; tracked dotfiles in, ignored junk out) ----


def _git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    )


def test_enumerate_push_files_git_includes_tracked_dotfiles_excludes_ignored(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t.local")
    _git(repo, "config", "user.name", "t")
    (repo / ".eslintrc").write_text("{}\n")  # a TRACKED dotfile — must reach the container
    (repo / "src").mkdir()
    (repo / "src" / "a.py").write_text("x\n")  # tracked nested
    (repo / ".gitignore").write_text("node_modules/\nbuild/\n")
    (repo / "node_modules").mkdir()
    (repo / "node_modules" / "junk.js").write_text("j\n")  # tracked? no — about to be ignored
    _git(repo, "add", ".eslintrc", "src/a.py", ".gitignore")
    _git(repo, "commit", "-qm", "init")
    (repo / "new.txt").write_text("new\n")  # UNTRACKED, not ignored
    (repo / "build").mkdir()
    (repo / "build" / "out.o").write_text("o\n")  # untracked + ignored

    rels = enumerate_push_files_git(str(repo))

    # tracked (incl. the dotfile) + untracked-not-ignored are present
    assert ".eslintrc" in rels
    assert "src/a.py" in rels
    assert ".gitignore" in rels
    assert "new.txt" in rels
    # ignored dirs (tracked-never, untracked-ignored) + .git are absent
    assert not any(r.startswith("node_modules/") for r in rels)
    assert not any(r.startswith("build/") for r in rels)
    assert not any(r.startswith(".git/") for r in rels)
    # deterministic + deduped
    assert rels == sorted(set(rels))
