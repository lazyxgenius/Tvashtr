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
    subpath_is_tracked_dir,
    worker_focus_directive,
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
    # The rung-2 dependency-install directive is a WORKER action too — it must stay out of the
    # orientation block (both-ways split: present in WORKER_PROTOCOL, absent here).
    assert "pip install" not in grounding
    assert "ModuleNotFoundError" not in grounding


def test_worker_protocol_carries_the_action_directives(tmp_path):
    # The worker-only protocol (appended to non-emitting workers in agent_run_step) carries the
    # implement-the-change directives that drove the Slice-1 correctness fix.
    assert "str_replace" in WORKER_PROTOCOL
    assert "do NOT" in WORKER_PROTOCOL
    assert "real source MODULE" in WORKER_PROTOCOL
    assert "RUN" in WORKER_PROTOCOL
    assert "smallest change" in WORKER_PROTOCOL
    # Rung-2 prep: a CONDITIONAL dependency-install directive — fire an install only when a declared
    # dependency is not importable (a `ModuleNotFoundError`) before concluding the tests fail, so a
    # real repo with real third-party deps (pandas/numpy/mcp) can be tested. Worker-only; its
    # absence from the orientation block is asserted below — the both-ways split.
    assert "pip install" in WORKER_PROTOCOL
    assert "ModuleNotFoundError" in WORKER_PROTOCOL


def test_worker_protocol_carries_conditional_dependency_install_orientation_does_not(tmp_path):
    """Rung-2 prep (real repos with real third-party deps like pandas/numpy/mcp): the WORKER gets a
    CONDITIONAL dependency-install directive — install the project's declared deps and re-run ONLY
    when a declared dependency fails to import (a ``ModuleNotFoundError``), before concluding the
    tests fail. The both-ways split: it lives in ``WORKER_PROTOCOL`` (a worker action) and NEVER in
    the orientation block ``build_repo_grounding`` feeds every node (a reviewer must gate, never
    install/build)."""
    # Present in the worker protocol, CONDITIONAL (gated on an un-importable dependency, NOT an
    # always-install), with the Python install commands as the concrete repo-agnostic example.
    assert "pip install" in WORKER_PROTOCOL
    assert "ModuleNotFoundError" in WORKER_PROTOCOL  # the trigger — not "always install"
    assert "pip install -e ." in WORKER_PROTOCOL
    assert "requirements.txt" in WORKER_PROTOCOL

    # Absent from the orientation block: a dependency-free repo's grounding is unaffected, and a
    # reviewer node — which only ever receives orientation — is never told to install/build.
    repo = _init_repo(tmp_path / "repo", files={"pyproject.toml": "[project]\nname='x'\n"})
    grounding = build_repo_grounding(str(repo), "repo")
    assert "pip install" not in grounding
    assert "ModuleNotFoundError" not in grounding


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


# ---- scoped-mount Slice 1: build_repo_grounding(subpath=...) ------------------------------------


def test_build_repo_grounding_scoped_roots_outline_at_subpath_keeps_manifest_root(tmp_path):
    """The scoped grounding (A4): given ``subpath``, the structure outline is ROOTED at that package
    (its own tree — a handful of entries, the trade_mcp ``core/`` shape) and EXCLUDES the unrelated
    top-level dirs that overflowed the model at rung 2; the framing names the focus; the top-level
    MANIFEST line stays repo-ROOT (deps install from the root, not from the sub-path)."""
    repo = _init_repo(
        tmp_path / "repo",
        files={
            "pyproject.toml": "[project]\nname='x'\n",  # root manifest — must stay repo-ROOT
            "pkg/__init__.py": "\n",
            "pkg/indicators.py": "def x():\n    pass\n",
            "pkg/sub/helper.py": "y = 1\n",
            "web/app/page.tsx": "export default 1\n",  # unrelated top-level dir (the overflow)
            "servers/cache/main.py": "z = 2\n",  # another unrelated top-level dir
            "CLAUDE.md": "conventions.\n",
        },
    )
    grounding = build_repo_grounding(str(repo), "repo", subpath="pkg")

    # The framing line NAMES the focus directory (still no implement/edit verb — reviewer-safe).
    assert "focused on its `pkg` directory" in grounding
    assert "ALREADY PRESENT" in grounding
    # The outline is ROOTED at pkg/ — it shows pkg's OWN tree (its files + its sub-dir), prefixed.
    assert "pkg/indicators.py" in grounding
    assert "pkg/__init__.py" in grounding
    assert "pkg/sub/" in grounding
    # ...and NOT the unrelated top-level dirs (this is the whole point — bound the agent's surface).
    assert "web/" not in grounding
    assert "servers/" not in grounding
    # The top-level manifest line stays repo-ROOT (the build system the agent installs deps from).
    assert "Top-level manifests: pyproject.toml" in grounding
    # Conventions are still read from the repo root.
    assert "conventions: CLAUDE.md found" in grounding


def test_build_repo_grounding_subpath_none_is_byte_for_byte_whole_repo(tmp_path):
    """The invariant (D): ``subpath=None`` is byte-for-byte the 2-arg whole-repo grounding — the
    greenfield/whole-repo path appends NO new text."""
    repo = _init_repo(
        tmp_path / "repo",
        files={
            "pyproject.toml": "[project]\nname='x'\n",
            "pkg/indicators.py": "def x():\n    pass\n",
            "web/app/page.tsx": "1\n",
            "AGENTS.md": "rules\n",
        },
    )
    assert build_repo_grounding(str(repo), "repo", subpath=None) == build_repo_grounding(
        str(repo), "repo"
    )
    # And the whole-repo outline DOES list the top-level dirs the scoped one excludes (contrast).
    whole = build_repo_grounding(str(repo), "repo")
    assert "web/" in whole and "pkg/" in whole
    assert "focused on its" not in whole  # the whole-repo framing names no focus


def test_worker_focus_directive_names_subpath_and_permits_root_tests():
    """The per-run worker FOCUS block (A5): names the focus, forbids recursing outside it, but STILL
    permits root-level dependency-install + test commands (trade_mcp's tests + pyproject are at the
    ROOT, not inside the sub-path)."""
    block = worker_focus_directive("core")
    assert "--- FOCUS: core ---" in block
    assert "belongs in the `core` directory" in block
    assert "do NOT recursively" in block
    # The escape hatch: root-level deps/tests are explicitly allowed (so the worker can run them).
    assert "from the repository ROOT" in block
    assert "pip install -e '.[dev]'" in block
    assert "python -m pytest -q" in block


def test_subpath_is_tracked_dir_discriminates_dir_file_and_missing(tmp_path):
    """The create_run validation (A2): a tracked DIRECTORY (≥1 file strictly under it) → True; a
    single tracked FILE, a non-existent path, or a non-git path → False (never raises)."""
    repo = _init_repo(
        tmp_path / "repo",
        files={"pkg/a.py": "x\n", "pkg/sub/b.py": "y\n", "top.py": "z\n"},
    )
    assert subpath_is_tracked_dir(str(repo), "pkg") is True
    assert subpath_is_tracked_dir(str(repo), "pkg/sub") is True
    assert subpath_is_tracked_dir(str(repo), "pkg/") is True  # trailing slash normalized
    # A tracked FILE is NOT a directory; a non-existent path is not tracked.
    assert subpath_is_tracked_dir(str(repo), "pkg/a.py") is False
    assert subpath_is_tracked_dir(str(repo), "top.py") is False
    assert subpath_is_tracked_dir(str(repo), "nope") is False
    assert subpath_is_tracked_dir(str(repo), "") is False
    # A non-git / missing path → False (defensive, like repo_inspect — never raises).
    assert subpath_is_tracked_dir(str(tmp_path / "missing"), "pkg") is False
