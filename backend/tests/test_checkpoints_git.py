"""M3 (R8): a run's workspace captured as a checkpoint and rebuilt from it — real git in tmp repos.

A checkpoint is the workspace's change against the commit its branch started from (the base the
ship also counts from); rebuilding a fresh workspace cut from that base and applying it must give
back exactly the same files: edits, new files, binary files, deletions, renames, the agent's own
commits, with Tvashtr's own working files left out.
"""

import subprocess
from pathlib import Path

import pytest

from tvashtr.control_plane import checkpoints
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.worktree import add_worktree


def _git(ws, *args):
    return subprocess.run(["git", "-C", str(ws), *args], check=True, capture_output=True, text=True)


def _init_repo(path, files, branch="main"):
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "-q", "-b", branch)
    _git(path, "config", "user.email", "t@t.local")
    _git(path, "config", "user.name", "tester")
    for rel, content in files.items():
        f = path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(content if isinstance(content, bytes) else content.encode())
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "init")
    return path


def _tree(ws: Path) -> dict[str, bytes]:
    """Every file under the workspace except git's own, by relative path."""
    return {
        str(p.relative_to(ws)): p.read_bytes()
        for p in sorted(ws.rglob("*"))
        if p.is_file() and ".git" not in p.relative_to(ws).parts
    }


def _greenfield(path: Path) -> Path:
    path.mkdir(parents=True)
    init_workspace_repo(str(path))
    # what the executor writes into a greenfield workspace (team_run._write_workspace_gitignore)
    (path / ".gitignore").write_text("REPORT.md\nREVIEW_VERDICT.json\nSPEC.md\n")
    return path


PNG = bytes(range(256)) * 4


def test_greenfield_round_trip(tmp_path):
    ws = _greenfield(tmp_path / "old")
    (ws / "core").mkdir()
    (ws / "core" / "rsi.py").write_text("def rsi():\n    return 1\n")
    (ws / "logo.png").write_bytes(PNG)
    (ws / "REPORT.md").write_text("the spec")  # Tvashtr's own file: never part of a checkpoint
    (ws / "TVASHTR_REMEMBER.jsonl").write_text("{}\n")

    cp = checkpoints.capture(str(ws))
    assert cp["diff"] and cp["base_sha"]

    new = _greenfield(tmp_path / "new")
    checkpoints.apply(str(new), cp["diff"], marker="cp-1")
    # REPORT.md is a step's own file (its content lives on as a document); the agents'
    # remember captures ride along so a resumed run that ships still ingests them.
    expected = {k: v for k, v in _tree(ws).items() if k != "REPORT.md"}
    assert _tree(new) == expected
    assert (new / "TVASHTR_REMEMBER.jsonl").read_text() == "{}\n"


def test_brownfield_round_trip_with_agent_commits_deletions_and_renames(tmp_path):
    repo = _init_repo(
        tmp_path / "repo",
        {"README.md": "# r\n", "old_name.py": "x = 1\n", "gone.py": "y\n", "img.bin": PNG},
    )
    base = _git(repo, "rev-parse", "HEAD").stdout.strip()
    ws = tmp_path / "ws-old"
    add_worktree(str(repo), str(ws), "run-old", "main")
    # the agent commits part of its work and leaves the rest uncommitted
    (ws / "feature.py").write_text("def f():\n    pass\n")
    _git(ws, "add", "feature.py")
    _git(ws, "commit", "-qm", "agent commit")
    _git(ws, "mv", "old_name.py", "new_name.py")
    (ws / "gone.py").unlink()
    (ws / "img.bin").write_bytes(PNG[::-1])
    (ws / "README.md").write_text("# r\nmore\n")
    # the base branch moves on meanwhile: the checkpoint is still against the branch's start
    (repo / "later.py").write_text("later\n")
    _git(repo, "add", "later.py")
    _git(repo, "commit", "-qm", "later on main")

    cp = checkpoints.capture(str(ws))
    assert cp["base_sha"] == base

    new = tmp_path / "ws-new"
    add_worktree(str(repo), str(new), "run-new", cp["base_sha"])
    checkpoints.apply(str(new), cp["diff"], marker="cp-2")
    assert _tree(new) == _tree(ws)
    assert not (new / "later.py").exists()


def test_apply_is_once_per_marker(tmp_path):
    ws = _greenfield(tmp_path / "old")
    (ws / "a.txt").write_text("a\n")
    cp = checkpoints.capture(str(ws))
    new = _greenfield(tmp_path / "new")
    checkpoints.apply(str(new), cp["diff"], marker="cp-3")
    (new / "a.txt").write_text("the next agent changed it\n")
    checkpoints.apply(str(new), cp["diff"], marker="cp-3")  # a replay: already applied
    assert (new / "a.txt").read_text() == "the next agent changed it\n"


def test_a_worktree_with_no_changes_captures_an_empty_diff(tmp_path):
    repo = _init_repo(tmp_path / "repo", {"README.md": "# r\n"})
    ws = tmp_path / "ws"
    add_worktree(str(repo), str(ws), "run-x", "main")
    cp = checkpoints.capture(str(ws))
    assert cp["diff"] == b"" and cp["base_sha"] == _git(repo, "rev-parse", "HEAD").stdout.strip()
    new = tmp_path / "ws-new"
    add_worktree(str(repo), str(new), "run-y", cp["base_sha"])
    assert checkpoints.apply(str(new), cp["diff"], marker="cp-4") is False  # nothing to change
    assert _tree(new) == _tree(ws)


def test_a_fresh_greenfield_workspace_round_trips(tmp_path):
    ws = _greenfield(tmp_path / "old")  # only the setup's own .gitignore
    cp = checkpoints.capture(str(ws))
    new = _greenfield(tmp_path / "new")
    checkpoints.apply(str(new), cp["diff"], marker="cp-5")
    assert _tree(new) == _tree(ws)


def test_a_diff_over_the_cap_is_not_kept(tmp_path, monkeypatch):
    monkeypatch.setattr(checkpoints, "MAX_DIFF_BYTES", 100)
    ws = _greenfield(tmp_path / "old")
    (ws / "big.txt").write_text("x" * 1000)
    cp = checkpoints.capture(str(ws))
    assert cp["diff"] is None and cp["too_large"] is True


def test_capture_leaves_the_workspace_index_alone(tmp_path):
    ws = _greenfield(tmp_path / "old")
    (ws / "a.txt").write_text("a\n")
    checkpoints.capture(str(ws))
    assert _git(ws, "diff", "--cached", "--name-only").stdout == ""
    assert "a.txt" in _git(ws, "status", "--porcelain").stdout


def test_capture_of_a_missing_workspace_raises(tmp_path):
    with pytest.raises(checkpoints.CheckpointError):
        checkpoints.capture(str(tmp_path / "nope"))


def test_a_committed_file_the_gitignore_ignores_is_kept(tmp_path):
    repo = _init_repo(tmp_path / "repo", {"README.md": "# r\n", ".gitignore": "build/\n"})
    ws = tmp_path / "ws"
    add_worktree(str(repo), str(ws), "run-ign", "main")
    (ws / "build").mkdir()
    (ws / "build" / "out.js").write_text("compiled\n")
    _git(ws, "add", "-f", "build/out.js")
    _git(ws, "commit", "-qm", "agent force-adds a build output")
    cp = checkpoints.capture(str(ws))
    new = tmp_path / "ws-new"
    add_worktree(str(repo), str(new), "run-ign2", cp["base_sha"])
    checkpoints.apply(str(new), cp["diff"], marker="cp-6")
    assert (new / "build" / "out.js").read_text() == "compiled\n"
    # ...and stays tracked, so the next checkpoint and the ship keep it.
    assert _git(new, "ls-files", "build/out.js").stdout.strip() == "build/out.js"
    assert b"build/out.js" in checkpoints.capture(str(new))["diff"]


def test_apply_after_a_crash_between_the_patch_and_its_stamp_is_a_no_op(tmp_path):
    ws = _greenfield(tmp_path / "old")
    (ws / "a.txt").write_text("a\n")
    (ws / ".gitignore").unlink()
    cp = checkpoints.capture(str(ws))
    new = tmp_path / "new"
    new.mkdir()
    init_workspace_repo(str(new))
    patch = tmp_path / "p.patch"
    patch.write_bytes(cp["diff"])
    _git(new, "apply", "--binary", str(patch))  # applied, then the process died before the stamp
    assert checkpoints.apply(str(new), cp["diff"], marker="cp-7") is False
    assert (new / "a.txt").read_text() == "a\n"


def test_the_remember_sidecar_is_carried_but_never_staged(tmp_path):
    ws = _greenfield(tmp_path / "old")
    (ws / "TVASHTR_REMEMBER.jsonl").write_text("{}\n")
    (ws / "a.txt").write_text("a\n")
    cp = checkpoints.capture(str(ws))
    new = _greenfield(tmp_path / "new")
    checkpoints.apply(str(new), cp["diff"], marker="cp-8")
    assert (new / "TVASHTR_REMEMBER.jsonl").read_text() == "{}\n"
    assert "TVASHTR_REMEMBER.jsonl" not in _git(new, "diff", "--cached", "--name-only").stdout
