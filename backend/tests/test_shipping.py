"""Idempotent ship logic — no network, real local git in a tmp repo.

This is the durability guarantee P0.4b's crash test relies on: re-running the
agent (and thus the ship) must produce **exactly one** tagged commit. Also
proves commits work with **repo-local** git identity (no global git config).
"""

import subprocess

import pytest

from tvashtr.control_plane.shipping import idempotent_ship, init_workspace_repo


def _tags(ws) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(ws), "tag", "--list", "ship-*"], capture_output=True, text=True
    ).stdout
    return out.split()


def _show(ws, tag, path) -> str:
    return subprocess.run(
        ["git", "-C", str(ws), "show", f"{tag}:{path}"], capture_output=True, text=True
    ).stdout


def test_idempotent_ship_commits_once_and_dedups_by_tag(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    (ws / "greeting.txt").write_text("Shipped by the team\n")

    first = idempotent_ship(str(ws), "run-abc")
    assert first["created"] is True
    assert first["tag"] == "ship-run-abc"
    assert first["sha"]

    # Re-run (simulating a crash-retry of the agent step): no new commit.
    second = idempotent_ship(str(ws), "run-abc")
    assert second["created"] is False
    assert second["sha"] == first["sha"]

    assert _tags(ws) == ["ship-run-abc"]
    assert _show(ws, "ship-run-abc", "greeting.txt") == "Shipped by the team\n"


def test_ship_with_no_changes_raises(tmp_path):
    ws = tmp_path / "ws-empty"
    ws.mkdir()
    init_workspace_repo(str(ws))
    with pytest.raises(RuntimeError):
        idempotent_ship(str(ws), "run-empty")


def test_init_workspace_repo_is_idempotent(tmp_path):
    ws = tmp_path / "ws-init"
    ws.mkdir()
    init_workspace_repo(str(ws))
    init_workspace_repo(str(ws))  # second call is a no-op, no error
    assert (ws / ".git").is_dir()
