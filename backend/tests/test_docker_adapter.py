"""OpenHandsDockerAdapter — orchestration with the container fully mocked.

No Docker, no agent, no network: ``DockerWorkspace`` + ``Conversation`` are patched,
so these tests pin the engine-neutral wiring — reap-before-start ordering, the
DQ1 pull-at-end file copy, the usage read, and the identical ``AgentRunResult``
shape — entirely offline.
"""

from unittest.mock import MagicMock, patch

import pytest

from tvashtr.engines import openhands_docker_adapter as mod
from tvashtr.engines.base import AgentTask


def test_detect_platform_maps_arch():
    with patch.object(mod.platform, "machine", return_value="arm64"):
        assert mod._detect_platform() == "linux/arm64"
    with patch.object(mod.platform, "machine", return_value="aarch64"):
        assert mod._detect_platform() == "linux/arm64"
    with patch.object(mod.platform, "machine", return_value="x86_64"):
        assert mod._detect_platform() == "linux/amd64"


def test_pull_workspace_downloads_each_nonhidden_file(tmp_path):
    ws = MagicMock()
    ws.working_dir = "/workspace"
    ws.execute_command.return_value = MagicMock(
        stdout="./greeting.txt\n./sub/data.txt\n", exit_code=0
    )

    def fake_download(src, dest):
        with open(dest, "w") as f:  # _pull_workspace makes the parent dir first
            f.write("x")
        return MagicMock(success=True)

    ws.file_download.side_effect = fake_download
    pulled = mod._pull_workspace(ws, str(tmp_path))

    assert pulled == ["greeting.txt", "sub/data.txt"]
    assert ws.execute_command.call_args.kwargs.get("cwd") == "/workspace"
    assert (tmp_path / "greeting.txt").exists()
    assert (tmp_path / "sub" / "data.txt").exists()
    # downloaded with the container-absolute source path
    srcs = {c.args[0] for c in ws.file_download.call_args_list}
    assert "/workspace/greeting.txt" in srcs
    assert "/workspace/sub/data.txt" in srcs


def test_pull_workspace_excludes_server_scaffolding(tmp_path):
    # The agent server persists bash_events/ + conversations/ under the working dir
    # (confirmed live in P1.3a). Those are scaffolding, not the deliverable, and must
    # not be pulled/shipped — the in-process local adapter never creates them.
    ws = MagicMock()
    ws.working_dir = "/workspace"
    ws.execute_command.return_value = MagicMock(
        stdout=(
            "./greeting.txt\n"
            "./bash_events/20260616_BashCommand_abc\n"
            "./bash_events/20260616_BashOutput_abc\n"
            "./conversations/sess-1/events.jsonl\n"
        ),
        exit_code=0,
    )

    def fake_download(src, dest):
        with open(dest, "w") as f:  # _pull_workspace makes the parent dir first
            f.write("x")
        return MagicMock(success=True)

    ws.file_download.side_effect = fake_download
    pulled = mod._pull_workspace(ws, str(tmp_path))

    assert pulled == ["greeting.txt"]
    assert (tmp_path / "greeting.txt").exists()
    assert not (tmp_path / "bash_events").exists()
    assert not (tmp_path / "conversations").exists()
    # only the deliverable was downloaded — the scaffolding never reached file_download
    assert ws.file_download.call_count == 1


def test_pull_workspace_skips_failed_download(tmp_path):
    ws = MagicMock()
    ws.working_dir = "/workspace"
    ws.execute_command.return_value = MagicMock(stdout="ok.txt\nbad.txt\n", exit_code=0)
    ws.file_download.side_effect = lambda src, dest: MagicMock(
        success=src.endswith("ok.txt"), error="nope"
    )
    pulled = mod._pull_workspace(ws, str(tmp_path))
    assert pulled == ["ok.txt"]


def test_run_orchestration_reaps_starts_runs_pulls(tmp_path):
    ws = MagicMock()
    ws.working_dir = "/workspace"
    ws.execute_command.return_value = MagicMock(stdout="greeting.txt\n", exit_code=0)

    def fake_download(src, dest):
        with open(dest, "w") as f:
            f.write("hi")
        return MagicMock(success=True)

    ws.file_download.side_effect = fake_download

    dw_cm = MagicMock()
    dw_cm.__enter__.return_value = ws
    dw_cm.__exit__.return_value = None

    convo = MagicMock()
    metrics = MagicMock(accumulated_cost=0.0023)
    metrics.accumulated_token_usage = MagicMock(prompt_tokens=7, completion_tokens=11)
    convo.conversation_stats.get_combined_metrics.return_value = metrics

    order: list[str] = []

    with (
        patch.object(
            mod, "reap_agent_containers", side_effect=lambda *a, **k: order.append("reap")
        ) as reap,
        patch.object(
            mod, "DockerWorkspace", side_effect=lambda **k: order.append("start") or dw_cm
        ) as dw,
        patch.object(mod, "Conversation", return_value=convo) as conv,
        patch.object(mod, "LLM"),
        patch.object(mod, "Agent"),
        patch.object(mod, "Tool"),
        patch.object(mod, "TerminalTool"),
        patch.object(mod, "FileEditorTool"),
    ):
        task = AgentTask(instruction="do it", workspace_dir=str(tmp_path), model="m")
        result = mod.OpenHandsDockerAdapter().run(task)

    # Identical AgentRunResult shape as the local path.
    assert result.status == "completed"
    assert result.files_changed == ["greeting.txt"]
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (7, 11, 18)
    assert result.cost_usd == 0.0023
    # reap-before-start: reaped, THEN started the container.
    assert order[:2] == ["reap", "start"]
    reap.assert_called_once()
    convo.send_message.assert_called_once_with("do it")
    convo.run.assert_called_once()
    # Container built with the P1.3a knobs; conversation wired to the workspace + a callback.
    assert dw.call_args.kwargs["extra_ports"] is False
    assert dw.call_args.kwargs["platform"] in ("linux/arm64", "linux/amd64")
    # P1.3b: host_port=None is passed through -> the SDK picks a fresh free port per
    # container (ephemeral), so crash recovery never races the ~30s host-port release.
    assert dw.call_args.kwargs["host_port"] is None
    assert conv.call_args.kwargs["workspace"] is ws
    assert len(conv.call_args.kwargs["callbacks"]) == 1
    assert (tmp_path / "greeting.txt").read_text() == "hi"


def test_run_failure_is_caught_and_reported(tmp_path):
    """A container/agent error becomes status='failed' with the error, not a raise."""
    with (
        patch.object(mod, "reap_agent_containers"),
        patch.object(mod, "DockerWorkspace", side_effect=RuntimeError("container bring-up failed")),
        patch.object(mod, "LLM"),
        patch.object(mod, "Agent"),
        patch.object(mod, "Tool"),
        patch.object(mod, "TerminalTool"),
        patch.object(mod, "FileEditorTool"),
    ):
        task = AgentTask(instruction="x", workspace_dir=str(tmp_path), model="m")
        result = mod.OpenHandsDockerAdapter().run(task)

    assert result.status == "failed"
    assert "container bring-up failed" in (result.error or "")
    assert result.files_changed == []


def test_pull_workspace_raises_on_find_failure(tmp_path):
    # A non-zero `find` exit surfaces here (caught by run() -> status=failed),
    # not silently as an empty pull that dies later at "nothing to ship".
    ws = MagicMock()
    ws.working_dir = "/workspace"
    ws.execute_command.return_value = MagicMock(stdout="", exit_code=1, stderr="find: error")
    with pytest.raises(RuntimeError, match="enumeration failed"):
        mod._pull_workspace(ws, str(tmp_path))


def test_push_workspace_brownfield_uses_git_enumeration(tmp_path):
    # Brownfield seeding pushes the repo's git-tracked + untracked-not-ignored files (incl. a
    # tracked dotfile) — NOT the greenfield non-hidden walk. Assert the mode selects the git
    # enumeration and the dotfile is uploaded into the container.
    ws = MagicMock()
    ws.working_dir = "/workspace"
    ws.file_upload.return_value = MagicMock(success=True)
    with (
        patch.object(mod, "enumerate_push_files_git", return_value=[".eslintrc", "src/a.py"]) as g,
        patch.object(mod, "enumerate_push_files") as green,
    ):
        pushed = mod._push_workspace(ws, str(tmp_path), "brownfield")
    g.assert_called_once_with(str(tmp_path))
    green.assert_not_called()  # the greenfield walk is bypassed
    assert pushed == [".eslintrc", "src/a.py"]
    dests = {c.args[1] for c in ws.file_upload.call_args_list}
    assert "/workspace/.eslintrc" in dests  # the tracked dotfile reaches the container


def test_pull_workspace_brownfield_keeps_dotfiles_drops_git_and_scaffolding(tmp_path):
    # Brownfield pull excludes ONLY .git/ (via the find pattern) + the server scaffolding, so an
    # agent-edited dotfile comes home — the greenfield '*/.*' (all-hidden) exclusion would lose it.
    ws = MagicMock()
    ws.working_dir = "/workspace"
    ws.execute_command.return_value = MagicMock(
        stdout="./.eslintrc\n./src/app.py\n./bash_events/x\n./conversations/y\n", exit_code=0
    )

    def fake_download(src, dest):
        import os

        os.makedirs(os.path.dirname(dest) or str(tmp_path), exist_ok=True)
        with open(dest, "w") as f:
            f.write("x")
        return MagicMock(success=True)

    ws.file_download.side_effect = fake_download
    pulled = mod._pull_workspace(ws, str(tmp_path), "brownfield")

    # The brownfield find command was issued (excludes only .git/, keeps dotfiles).
    assert ws.execute_command.call_args.args[0] == "find . -type f -not -path './.git/*'"
    # The dotfile is KEPT; the scaffolding is still dropped.
    assert ".eslintrc" in pulled
    assert "src/app.py" in pulled
    assert "bash_events/x" not in pulled
    assert "conversations/y" not in pulled


def test_pull_workspace_scoped_pull_paths_downloads_only_listed(tmp_path):
    # M-brownfield Slice 4: an outcome-emitting (reviewer) node is workspace-READ-ONLY — its
    # container edits must never mutate the shippable host worktree. agent_run_step passes
    # ``pull_paths=("REVIEW_VERDICT.json",)`` so the adapter pulls ONLY the verdict sidecar and
    # NEVER the container's other files (which would clobber the worker's correct host edit). The
    # adapter learns a SYNC directive (which files), not "reviewer" — the seam stays role-neutral.
    import os

    ws = MagicMock()
    ws.working_dir = "/workspace"

    def fake_download(src, dest):
        os.makedirs(os.path.dirname(dest) or str(tmp_path), exist_ok=True)
        with open(dest, "w") as f:  # _pull_workspace makes the parent dir first
            f.write("x")
        return MagicMock(success=True)

    ws.file_download.side_effect = fake_download
    pulled = mod._pull_workspace(
        ws, str(tmp_path), "brownfield", pull_paths=("REVIEW_VERDICT.json",)
    )

    # ONLY the verdict sidecar came home.
    assert pulled == ["REVIEW_VERDICT.json"]
    assert (tmp_path / "REVIEW_VERDICT.json").exists()
    assert ws.file_download.call_count == 1
    srcs = {c.args[0] for c in ws.file_download.call_args_list}
    assert srcs == {"/workspace/REVIEW_VERDICT.json"}
    # The scoped pull does NOT enumerate the container (no `find`) — the clobber-prevention is
    # structural (pull only the listed files), not a post-hoc filter over an enumeration.
    ws.execute_command.assert_not_called()


def test_pull_workspace_none_pull_paths_is_unchanged_full_pull(tmp_path):
    # The default (pull_paths=None — a worker / greenfield) is byte-for-byte the prior behavior:
    # enumerate via `find` and pull every (mode-appropriate) file. Guards the common path.
    ws = MagicMock()
    ws.working_dir = "/workspace"
    ws.execute_command.return_value = MagicMock(
        stdout="./greeting.txt\n./sub/data.txt\n", exit_code=0
    )

    def fake_download(src, dest):
        with open(dest, "w") as f:
            f.write("x")
        return MagicMock(success=True)

    ws.file_download.side_effect = fake_download
    pulled = mod._pull_workspace(ws, str(tmp_path), "greenfield", pull_paths=None)

    assert pulled == ["greeting.txt", "sub/data.txt"]
    ws.execute_command.assert_called_once()  # the enumeration still runs on the default path


def test_registry_resolves_docker_adapter():
    # Asserted here (not in the openhands-free purity file test_registry.py): only
    # *resolving* pulls openhands, never importing the registry/control plane.
    from tvashtr.engines.registry import resolve_adapter

    adapter = resolve_adapter("openhands-docker")
    assert adapter.name == "openhands-docker"
    assert isinstance(adapter, mod.OpenHandsDockerAdapter)
