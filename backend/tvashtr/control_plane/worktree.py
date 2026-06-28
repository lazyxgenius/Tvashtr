"""Pure git helpers for the brownfield run mode (M-brownfield Slice 1).

**openhands-free, stdlib + ``subprocess`` only** — so ``team_run`` can import them without
breaking the openhands-free-at-import invariant (CLI-RULES §3.1), and they stay trivially
unit-testable against a throwaway temp repo (no DBOS, no DB). They mirror ``shipping.py``'s
subprocess-to-``git`` discipline.

Three helpers, all gated behind ``runs.repo_path IS NOT NULL`` (greenfield never calls them):

* :func:`repo_inspect` — a *discriminated* read of a candidate repo (``{is_git: True, …}`` or
  ``{is_git: False, error}``), used by ``POST /api/repo/inspect`` and the ``create_run``
  brownfield validation. Defensive: never raises on a non-repo / missing path / absent git.
* :func:`add_worktree` — create (idempotently, resume-safe) an isolated ``git worktree`` of the
  user's real repo on a fresh branch ``tvashtr/<run_id>``. The worktree SHARES the repo's object
  store, so the branch lands directly in the user's real repo; the user's working tree is never
  touched (D1/D2).
* :func:`build_repo_grounding` — D6: the invisible repo-grounding context block (a conventions
  file + a depth-capped structure summary + a one-line transparency note) appended to a brownfield
  agent's instruction the same way the idea + PRD are. Greenfield appends nothing.
"""

import subprocess
from pathlib import Path

# Bound every git call so a wedged repo can't hang a run (mirrors docker_runtime's timeout).
_GIT_TIMEOUT_S = 30


def _git(repo_path: str, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    """``git -C <repo_path> <args>``, capturing output. ``check=True`` raises on failure (the
    caller wants the run to fail loudly); ``check=False`` lets the caller inspect ``returncode``."""
    return subprocess.run(
        ["git", "-C", str(repo_path), *args],
        check=check,
        capture_output=True,
        text=True,
        timeout=_GIT_TIMEOUT_S,
    )


def repo_inspect(path: str) -> dict:
    """A defensive, discriminated read of a candidate brownfield target repo.

    Returns ``{"is_git": True, "current_branch", "branches", "tracked_file_count"}`` for a real
    git work tree, else ``{"is_git": False, "error": <reason>}`` — a *result*, never an exception,
    so ``POST /api/repo/inspect`` can hand the FE an inline-renderable discriminator and
    ``create_run`` can turn a bad ``repo_path`` into a clean 422. ``current_branch`` is ``None`` on
    a detached HEAD (still a usable base for a worktree by sha, but not a branch name)."""
    p = Path(path)
    if not p.exists() or not p.is_dir():
        return {"is_git": False, "error": f"path does not exist or is not a directory: {path}"}
    try:
        inside = _git(p, "rev-parse", "--is-inside-work-tree", check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return {"is_git": False, "error": f"git unavailable for {path}: {exc}"}
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return {"is_git": False, "error": f"not a git work tree: {path}"}
    head = _git(p, "symbolic-ref", "--short", "HEAD", check=False)
    current_branch = head.stdout.strip() if head.returncode == 0 else None
    branches_proc = _git(p, "branch", "--format=%(refname:short)", check=False)
    branches = [b.strip() for b in branches_proc.stdout.splitlines() if b.strip()]
    tracked = _git(p, "ls-files", check=False)
    tracked_count = sum(1 for line in tracked.stdout.splitlines() if line.strip())
    return {
        "is_git": True,
        "current_branch": current_branch,
        "branches": branches,
        "tracked_file_count": tracked_count,
    }


def branch_name_for(run_id: str) -> str:
    """The deterministic ship branch a brownfield run lands on. Factored so the executor, the
    worktree creation, and the tests share one source of truth (no nicer name than this — §15)."""
    return f"tvashtr/{run_id}"


def add_worktree(repo_path: str, workspace: str, run_id: str, base_ref: str | None) -> str:
    """Add an isolated ``git worktree`` of ``repo_path`` at ``workspace`` on branch
    ``tvashtr/<run_id>``, cut from ``base_ref``. Returns the branch name. **Idempotent on resume**
    (mirrors ``init_workspace_repo``'s no-op-if-``.git``-exists): a worktree already set up here
    leaves a ``.git`` *file* (the worktree gitdir pointer), so a crash-resume re-entry of
    ``engineer_setup_step`` is a clean no-op.

    ``git worktree add`` accepts the pre-created empty ``workspace`` dir (``make_local_workspace``
    leaves one) — verified on git 2.50. The branch may already exist from a prior crashed-then-
    pruned attempt → reuse it (``add <ws> <branch>``) instead of ``-b`` (which would fail
    'already exists'); else create it from ``base_ref`` (``add -b <branch> <ws> <base_ref>``)."""
    branch = branch_name_for(run_id)
    ws = Path(workspace)
    if (ws / ".git").exists():
        return branch
    exists = _git(
        repo_path, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", check=False
    )
    if exists.returncode == 0:
        _git(repo_path, "worktree", "add", str(ws), branch)
    else:
        # base_ref is validated/defaulted at create_run; fall back to HEAD if somehow absent.
        _git(repo_path, "worktree", "add", "-b", branch, str(ws), base_ref or "HEAD")
    return branch


# ---- D6: repo grounding (the invisible appended context, NOT an authored node) -----------------

# Conventions file, in priority order — the FIRST present wins (D6).
_CONVENTIONS_FILES = ("AGENTS.md", "CLAUDE.md", ".cursorrules", "CONTRIBUTING.md")
# Truncation budget for the conventions file (~6 KB, D6) — enough to ground without bloating the
# instruction (and the agent reads the real file in the workspace if it needs more).
_CONVENTIONS_BUDGET = 6144
# Top-level manifest names we surface by NAME only (NO contents, D6) — a cheap, high-signal hint at
# the repo's language/build system.
_MANIFEST_FILES = frozenset(
    {
        "package.json",
        "pyproject.toml",
        "go.mod",
        "Cargo.toml",
        "requirements.txt",
        "pom.xml",
        "build.gradle",
        "Gemfile",
        "composer.json",
        "setup.py",
        "Makefile",
    }
)
# Depth cap + entry cap for the folded structure outline (bounds the block size on a huge repo).
_STRUCTURE_DEPTH = 2
_STRUCTURE_MAX_ENTRIES = 80


def _structure_outline(files: list[str]) -> str:
    """A depth-capped directory outline folded from ``git ls-files`` (paths only — NO contents).
    Lists every directory prefix up to :data:`_STRUCTURE_DEPTH` deep, then the top-level files;
    sorted + deterministic + capped so a giant repo can't balloon the instruction."""
    dirs: set[str] = set()
    top_files: set[str] = set()
    for f in files:
        parts = f.split("/")
        if len(parts) == 1:
            top_files.add(parts[0])
            continue
        for depth in range(1, min(len(parts) - 1, _STRUCTURE_DEPTH) + 1):
            dirs.add("/".join(parts[:depth]) + "/")
    entries = sorted(dirs) + sorted(top_files)
    if len(entries) > _STRUCTURE_MAX_ENTRIES:
        hidden = len(entries) - _STRUCTURE_MAX_ENTRIES
        entries = entries[:_STRUCTURE_MAX_ENTRIES] + [f"… (+{hidden} more)"]
    return "\n".join(entries)


# M-brownfield Slice 3 — the §15 worker-gating split. The brownfield repo-grounding is now TWO
# blocks: an always-safe ORIENTATION block (this builder — conventions + structure + transparency,
# appended to EVERY brownfield agent node) and the worker-only WORKER_PROTOCOL below (the action
# directives, appended by ``agent_run_step`` ONLY to a non-emitting WORKER node). The split is
# a Reviewer-style node (which must GATE, not implement) is never handed implement-the-change
# instructions — the correctness prerequisite for the brownfield review_loop. A plain module-level
# string (no openhands import), so ``team_run`` can import it and stay openhands-free at import.
WORKER_PROTOCOL = (
    "--- HOW TO MAKE THE CHANGE ---\n"
    "Implement the request by EDITING the relevant existing source file(s) IN PLACE — first `view` "
    "a file to see its EXACT current contents, then apply a precise `str_replace` or `insert`; do "
    "NOT use `create` on a file that already exists. Put the requested code in the real source "
    "MODULE (the implementation itself), not only in a test, and keep every file COMPLETE and "
    "runnable (include ALL needed imports — never leave a file in a broken/partial state). After "
    "editing, RUN the repository's existing tests (e.g. `python -m pytest -q`, or `python -m "
    "unittest`) and FIX any failure you introduced before you finish. If running those tests "
    "fails because the project's OWN declared dependencies are not importable (e.g. a "
    "`ModuleNotFoundError` for a third-party package the project depends on), INSTALL the "
    "project's declared dependencies FIRST and THEN re-run the tests before concluding they fail "
    "— for a Python project, e.g. `pip install -e .` (or `pip install -e '.[dev]'` when a "
    "`pyproject.toml`/`setup.py` declares a dev/test extra, or `pip install -r requirements.txt`). "
    "Do this ONLY when a declared dependency genuinely fails to import; a repository with no "
    "third-party dependencies needs no install step. Make the smallest "
    "change that satisfies the request, match the repo's existing conventions, and do not "
    "restructure unrelated code."
)


def build_repo_grounding(workspace: str, repo_basename: str) -> str:
    """D6: build the brownfield repo-grounding ORIENTATION block appended to EVERY brownfield agent
    node (worker AND reviewer). Slice 3 split: this is orientation ONLY — the action directives now
    live in :data:`WORKER_PROTOCOL`, appended separately to workers only.

    (1) a neutral situational line (no implement/edit verb — safe for a reviewer); (2) the repo's
    conventions file if present (first of ``AGENTS.md`` / ``CLAUDE.md`` / ``.cursorrules`` /
    ``CONTRIBUTING.md``, truncated to ~6 KB); (3) a depth-capped directory outline folded from
    ``git ls-files`` + the names of any top-level manifest files (NO other file contents); and the
    transparency header. Pure (stdlib + git), openhands-free, unit-tested. ``workspace`` is the
    worktree (a real work tree, so ``git ls-files`` resolves)."""
    ws = Path(workspace)

    conventions_name: str | None = None
    conventions_text = ""
    for name in _CONVENTIONS_FILES:
        f = ws / name
        if f.is_file():
            conventions_name = name
            try:
                conventions_text = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                conventions_text = ""
            if len(conventions_text) > _CONVENTIONS_BUDGET:
                conventions_text = conventions_text[:_CONVENTIONS_BUDGET] + "\n…(truncated)…"
            break

    tracked = _git(ws, "ls-files", check=False)
    files = [line.strip() for line in tracked.stdout.splitlines() if line.strip()]
    outline = _structure_outline(files)
    manifests = sorted({f for f in files if "/" not in f and f in _MANIFEST_FILES})

    conv_note = f"{conventions_name} found" if conventions_name else "none"
    lines = [
        f"--- REPO GROUNDING ({repo_basename}; conventions: {conv_note}) ---",
        # Slice 3: ORIENTATION ONLY — a neutral situational line with NO implement/edit verb, so it
        # is safe for a reviewer node too. The action directives (edit-in-place / run-tests-and-fix)
        # moved to ``WORKER_PROTOCOL``, which ``agent_run_step`` appends to workers ONLY.
        (
            f"You are working in an existing repository named `{repo_basename}`; its files are "
            "ALREADY PRESENT in your working directory."
        ),
    ]
    if manifests:
        lines.append(f"Top-level manifests: {', '.join(manifests)}")
    if outline:
        lines.append("Repository structure (depth-capped):")
        lines.append(outline)
    if conventions_name:
        lines.append(f"--- {conventions_name} (repo conventions) ---")
        lines.append(conventions_text.rstrip())
    return "\n".join(lines)
