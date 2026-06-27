"""Pure git helpers for the brownfield run mode — real local git in a tmp repo, no network.

Covers ``repo_inspect`` (discriminated), ``add_worktree`` (create + resume no-op), and
``build_repo_grounding`` (D6 conventions pick + priority + truncation + structure summary +
transparency line). These are the openhands-free substrate the brownfield executor threads.
"""

import subprocess

from tvashtr.control_plane.worktree import (
    WORKER_PROTOCOL,
    add_worktree,
    branch_name_for,
    build_repo_grounding,
    repo_inspect,
)


def _git(ws, *args):
    return subprocess.run(["git", "-C", str(ws), *args], check=True, capture_output=True, text=True)


def _init_repo(path, *, files=None, branch="main"):
    """A throwaway git repo with repo-local identity on a known branch and an initial commit."""
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "-q", "-b", branch)
    _git(path, "config", "user.email", "t@t.local")
    _git(path, "config", "user.name", "tester")
    for rel, content in (files or {"README.md": "# repo\n"}).items():
        f = path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content, encoding="utf-8")
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "init")
    return path


# ---- repo_inspect -------------------------------------------------------------------------------


def test_repo_inspect_on_real_repo(tmp_path):
    repo = _init_repo(tmp_path / "repo", files={"a.py": "x\n", "pkg/b.py": "y\n"}, branch="main")
    info = repo_inspect(str(repo))
    assert info["is_git"] is True
    assert info["current_branch"] == "main"
    assert "main" in info["branches"]
    assert info["tracked_file_count"] == 2


def test_repo_inspect_on_non_git_dir(tmp_path):
    plain = tmp_path / "plain"
    plain.mkdir()
    info = repo_inspect(str(plain))
    assert info["is_git"] is False
    assert "error" in info


def test_repo_inspect_on_missing_path(tmp_path):
    info = repo_inspect(str(tmp_path / "nope"))
    assert info["is_git"] is False
    assert "error" in info


# ---- add_worktree -------------------------------------------------------------------------------


def test_add_worktree_creates_branch_without_touching_working_tree(tmp_path):
    repo = _init_repo(
        tmp_path / "repo", files={"calculator.py": "def add(a, b):\n    return a + b\n"}
    )
    head_before = _git(repo, "rev-parse", "HEAD").stdout.strip()
    ws = tmp_path / "ws"
    ws.mkdir()  # mirror make_local_workspace pre-creating an empty dir

    branch = add_worktree(str(repo), str(ws), "run-xyz", "main")

    assert branch == "tvashtr/run-xyz" == branch_name_for("run-xyz")
    # The branch exists in the user's REAL repo (worktree shares the object store).
    listed = _git(repo, "branch", "--format=%(refname:short)").stdout.split()
    assert "tvashtr/run-xyz" in listed
    # The worktree carries the repo's files + a .git pointer; HEAD is the new branch.
    assert (ws / "calculator.py").read_text() == "def add(a, b):\n    return a + b\n"
    assert (ws / ".git").exists()
    assert _git(ws, "symbolic-ref", "--short", "HEAD").stdout.strip() == "tvashtr/run-xyz"
    # The user's working tree / current branch is UNTOUCHED.
    assert _git(repo, "symbolic-ref", "--short", "HEAD").stdout.strip() == "main"
    assert _git(repo, "rev-parse", "HEAD").stdout.strip() == head_before


def test_add_worktree_resume_is_a_noop(tmp_path):
    repo = _init_repo(
        tmp_path / "repo", files={"calculator.py": "def add(a, b):\n    return a + b\n"}
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    first = add_worktree(str(repo), str(ws), "run-xyz", "main")
    # Simulate a crash-resume re-entry: the .git pointer exists -> no-op, same branch, no raise.
    second = add_worktree(str(repo), str(ws), "run-xyz", "main")
    assert first == second == "tvashtr/run-xyz"
    # Exactly one worktree was added for this branch (no duplicate / no error).
    worktrees = _git(repo, "worktree", "list").stdout
    assert worktrees.count("tvashtr/run-xyz") == 1


# ---- build_repo_grounding (D6) ------------------------------------------------------------------


def test_build_repo_grounding_picks_conventions_structure_and_transparency(tmp_path):
    repo = _init_repo(
        tmp_path / "repo",
        files={
            "CLAUDE.md": "Always run the tests before committing.\n",
            "pyproject.toml": "[project]\nname='x'\n",
            "src/app/main.py": "print('hi')\n",
            "tests/test_main.py": "def test_x():\n    pass\n",
        },
    )
    grounding = build_repo_grounding(str(repo), "repo")

    # Transparency line names the repo basename + the conventions file found.
    assert "--- REPO GROUNDING (repo; conventions: CLAUDE.md found) ---" in grounding
    # Manifest surfaced by NAME (no contents beyond the name).
    assert "pyproject.toml" in grounding
    # Depth-capped structure outline includes nested dirs.
    assert "src/" in grounding
    assert "src/app/" in grounding
    assert "tests/" in grounding
    # The conventions file CONTENT is embedded.
    assert "Always run the tests before committing." in grounding
    # Slice 3 worker-gating split: ORIENTATION carries a neutral situational line (safe for a
    # reviewer too) — NO implement/edit verb.
    assert "existing repository named `repo`" in grounding
    assert "ALREADY PRESENT" in grounding
    # The ACTION directives now live ONLY in WORKER_PROTOCOL — they must NOT leak into orientation
    # (else a reviewer node would be told to implement the change).
    assert "str_replace" not in grounding
    assert "RUN the repository's existing tests" not in grounding
    assert "`create`" not in grounding


def test_worker_protocol_carries_the_action_directives(tmp_path):
    # The worker-only protocol (appended to non-emitting workers in agent_run_step) carries the
    # implement-the-change directives that drove the Slice-1 correctness fix.
    assert "str_replace" in WORKER_PROTOCOL
    assert "do NOT" in WORKER_PROTOCOL
    assert "real source MODULE" in WORKER_PROTOCOL
    assert "RUN" in WORKER_PROTOCOL
    assert "smallest change" in WORKER_PROTOCOL


def test_build_repo_grounding_conventions_priority(tmp_path):
    # AGENTS.md outranks CLAUDE.md (first in the priority list).
    repo = _init_repo(
        tmp_path / "repo",
        files={"AGENTS.md": "agents-rules\n", "CLAUDE.md": "claude-rules\n"},
    )
    grounding = build_repo_grounding(str(repo), "repo")
    assert "conventions: AGENTS.md found" in grounding
    assert "agents-rules" in grounding
    assert "claude-rules" not in grounding


def test_build_repo_grounding_truncates_large_conventions(tmp_path):
    big = "x" * 9000
    repo = _init_repo(tmp_path / "repo", files={"CONTRIBUTING.md": big + "\n"})
    grounding = build_repo_grounding(str(repo), "repo")
    assert "conventions: CONTRIBUTING.md found" in grounding
    assert "…(truncated)…" in grounding
    # The embedded conventions content is bounded well under the raw 9000 chars.
    assert grounding.count("x") < 9000


def test_build_repo_grounding_no_conventions_file(tmp_path):
    repo = _init_repo(tmp_path / "repo", files={"main.py": "print('x')\n"})
    grounding = build_repo_grounding(str(repo), "repo")
    assert "conventions: none" in grounding
