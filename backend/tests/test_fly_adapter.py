"""M-h2a: the Fly engine adapter — the two-level cache, the fences, and teardown.

Both the Fly API AND the OpenHands workspace/Conversation are faked, so nothing here opens a socket
or spends a cent (invariant §5.5 — the operator's live ``TVASHTR_FLY_API_TOKEN`` is ambient in every
``make test`` process). ``test_docker_adapter.py`` is the shape this mirrors.

Note that ``_push_workspace`` / ``_pull_workspace`` are deliberately left UNPATCHED and run for
real against the mocked workspace: that is what proves the brief's "REUSE, do not copy-then-diverge"
requirement actually holds — if the Fly adapter had forked its own copies, these tests would still
pass while the real sync silently drifted from the docker path's.
"""

from unittest.mock import MagicMock, patch

import pytest

from tvashtr.engines import openhands_fly_adapter as mod
from tvashtr.engines import sandbox_cache
from tvashtr.engines.base import AgentTask
from tvashtr.engines.fly_machines import derive_session_key as real_derive_session_key

RUN_ID = "aa9d8a2b-d54d-49e2-9cc0-ab20b60a1098"


@pytest.fixture(autouse=True)
def _clean_caches():
    mod._RUNS.clear()
    sandbox_cache.clear()
    yield
    mod._RUNS.clear()
    sandbox_cache.clear()


def _fake_workspace() -> MagicMock:
    ws = MagicMock()
    ws.working_dir = "/workspace/node-a"
    ws.execute_command.return_value = MagicMock(stdout="out.txt\n", exit_code=0)

    def fake_download(src, dest):
        with open(dest, "w") as f:
            f.write("hi")
        return MagicMock(success=True)

    ws.file_download.side_effect = fake_download
    return ws


def _fake_conversation() -> MagicMock:
    convo = MagicMock()
    metrics = MagicMock(accumulated_cost=0.0023)
    metrics.accumulated_token_usage = MagicMock(prompt_tokens=7, completion_tokens=11)
    convo.conversation_stats.get_combined_metrics.return_value = metrics
    return convo


def _fake_machine(app_name: str = f"tv-run-{RUN_ID}") -> MagicMock:
    machine = MagicMock()
    machine.app_name = app_name
    machine.machine_id = "m1"
    machine.private_ip = "fdaa:9e:cf46:a7b:513:5988:b76c:2"
    machine.flycast_host = f"http://{app_name}.flycast:8000"
    machine.boot_seconds = 83.7
    machine.ready_seconds = 99.3
    return machine


class _Ctx:
    """Everything patched for a fly ``run()``, with the fakes exposed for assertions."""

    def __init__(self):
        self.fly = MagicMock()
        self.fly.start_run_sandbox.return_value = _fake_machine()
        # M-h2b: the default posture is "no app exists on Fly yet" ⇒ ``_ensure_run_sandbox`` takes
        # its FRESH-BOOT arm, which is what every M-h2a test here was written against. A test that
        # wants the RECONSTRUCT arm sets this to a ``FlyMachineInfo`` explicitly. Without this the
        # bare MagicMock would return a truthy machine and silently divert every test into the
        # reconnect path.
        self.fly.get_run_machine.return_value = None
        # Same honesty for the husk check: no app exists yet, so there is nothing to clear. A bare
        # MagicMock returns a truthy sentinel here, which would fake a leftover app into existence
        # and fire ``delete_app`` on every fresh boot.
        self.fly.app_exists.return_value = False
        self.workspaces: list[MagicMock] = []
        self.ws_kwargs: list[dict] = []
        self.convos: list[MagicMock] = []

    def _make_workspace(self, **kwargs):
        self.ws_kwargs.append(kwargs)
        ws = _fake_workspace()
        ws.working_dir = kwargs.get("working_dir", "/workspace/x")
        self.workspaces.append(ws)
        return ws

    def _make_conversation(self, **kwargs):
        convo = _fake_conversation()
        self.convos.append(convo)
        return convo

    def __enter__(self):
        self._patches = [
            patch.object(mod, "FlyMachines", return_value=self.fly),
            patch.object(mod, "derive_session_key", return_value="per-run-secret-key"),
            patch.object(mod, "_resolve_owner_id", return_value="owner-1"),
            patch.object(mod, "RemoteWorkspace", side_effect=self._make_workspace),
            patch.object(mod, "Conversation", side_effect=self._make_conversation),
            patch.object(mod, "LLM"),
            patch.object(mod, "Agent"),
            patch.object(mod, "LLMSummarizingCondenser"),
            patch.object(mod, "Tool"),
            patch.object(mod, "TerminalTool"),
            patch.object(mod, "FileEditorTool"),
        ]
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in self._patches:
            p.stop()
        return False


def _task(
    tmp_path, node_id: str | None, instruction: str = "do it", run_id: str = RUN_ID
) -> AgentTask:
    return AgentTask(
        instruction=instruction,
        workspace_dir=str(tmp_path),
        model="m",
        llm_api_key="byok-key",
        session_key=None if node_id is None else f"{run_id}::{node_id}",
    )


# ---- the engine-neutral contract is unchanged ----


def test_registry_resolves_fly_adapter():
    from tvashtr.engines.registry import resolve_adapter

    adapter = resolve_adapter("openhands-fly")
    assert type(adapter).__name__ == "OpenHandsFlyAdapter"
    assert adapter.name == "openhands-fly"


def test_run_returns_the_same_result_shape_as_the_other_adapters(tmp_path):
    with _Ctx() as ctx:
        result = mod.OpenHandsFlyAdapter().run(_task(tmp_path, "node-a"))
    assert result.status == "completed"
    assert result.files_changed == ["out.txt"]  # the REUSED _pull_workspace did this
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (7, 11, 18)
    assert result.cost_usd == 0.0023
    assert (tmp_path / "out.txt").read_text() == "hi"
    ctx.convos[0].send_message.assert_called_once_with("do it")
    ctx.convos[0].run.assert_called_once()


# ---- D1: ONE microVM per RUN, shared across the run's nodes ----


def test_one_machine_serves_every_node_of_a_run(tmp_path):
    with _Ctx() as ctx:
        adapter = mod.OpenHandsFlyAdapter()
        adapter.run(_task(tmp_path, "node-a"))
        adapter.run(_task(tmp_path, "node-b"))
    # D1: the machine booted ONCE — node B reused node A's microVM.
    assert ctx.fly.start_run_sandbox.call_count == 1
    # ...and it was created for THIS run, on the owner's network.
    assert ctx.fly.start_run_sandbox.call_args.kwargs["run_id"] == RUN_ID
    assert ctx.fly.start_run_sandbox.call_args.kwargs["owner_id"] == "owner-1"
    # No teardown mid-run: the machine stays warm for the next node.
    ctx.fly.delete_app.assert_not_called()


# ---- D4: one working dir per NODE, and a fresh conversation per node ----


def test_each_node_gets_its_own_working_dir_and_conversation(tmp_path):
    with _Ctx() as ctx:
        adapter = mod.OpenHandsFlyAdapter()
        adapter.run(_task(tmp_path, "node-a"))
        adapter.run(_task(tmp_path, "node-b"))
    dirs = [kw["working_dir"] for kw in ctx.ws_kwargs]
    assert dirs == ["/workspace/node-a", "/workspace/node-b"]
    # Two distinct conversations — node B must NOT inherit node A's transcript or leftovers.
    assert len(ctx.convos) == 2
    assert ctx.convos[0] is not ctx.convos[1]


def test_a_nodes_repeated_goals_reuse_its_conversation(tmp_path):
    """Within ONE node's own rounds (the Engineer/Reviewer loop) the conversation continues, so the
    agent remembers prior rounds — exactly as the docker adapter reuses across rounds."""
    with _Ctx() as ctx:
        adapter = mod.OpenHandsFlyAdapter()
        adapter.run(_task(tmp_path, "node-a", "round one"))
        adapter.run(_task(tmp_path, "node-a", "round two"))
    assert len(ctx.convos) == 1  # same conversation, not a fresh one
    assert len(ctx.ws_kwargs) == 1  # and the same workspace/working dir
    sent = [c.args[0] for c in ctx.convos[0].send_message.call_args_list]
    assert sent == ["round one", "round two"]
    assert ctx.convos[0].run.call_count == 2


# ---- D2b: the per-run session key is ON and threaded to every node ----


def test_every_node_workspace_carries_the_per_run_session_key(tmp_path):
    """The Fly agent server is NOT passwordless (unlike the docker path, which nulls its api_key):
    the workspace must carry the key, which the SDK sends as the X-Session-API-Key header."""
    with _Ctx() as ctx:
        adapter = mod.OpenHandsFlyAdapter()
        adapter.run(_task(tmp_path, "node-a"))
        adapter.run(_task(tmp_path, "node-b"))
    keys = [kw["api_key"] for kw in ctx.ws_kwargs]
    assert keys == ["per-run-secret-key", "per-run-secret-key"]  # same key, whole run
    assert all(k for k in keys)  # never None — that would be the docker path's posture
    # The SAME key was handed to the machine, so the server actually demands it.
    assert ctx.fly.start_run_sandbox.call_args.kwargs["session_api_key"] == "per-run-secret-key"


def test_a_second_run_derives_a_different_key(tmp_path):
    """PER RUN still — a key that outlived its run would be a standing credential.

    M-h2b swapped the random mint for an HMAC derivation, so this now asserts the property the
    derivation must preserve rather than the mechanism it replaced: two DIFFERENT runs get unrelated
    keys. The REAL :func:`derive_session_key` runs here (only the secret is pinned) — patching it
    would test the mock instead of the guarantee."""
    other_run = "bb1c7d3e-0000-4444-8888-ab20b60a1098"
    with _Ctx() as ctx:
        with patch.object(
            mod,
            "derive_session_key",
            side_effect=lambda rid, secret=None: real_derive_session_key(rid, "pinned-test-secret"),
        ):
            adapter = mod.OpenHandsFlyAdapter()
            adapter.run(_task(tmp_path, "node-a"))
            mod._RUNS.clear()  # a genuinely different run, in a fresh process
            adapter.run(_task(tmp_path, "node-a", run_id=other_run))
        seen = [kw["api_key"] for kw in ctx.ws_kwargs]
    assert len(seen) == 2
    assert seen[0] != seen[1], "distinct runs must never share a session key"
    assert all(len(k) >= 32 for k in seen)


def test_the_same_run_re_derives_the_identical_key_in_a_fresh_process(tmp_path):
    """M-h2b Piece 3, the property the whole durable handle rests on: a RESTARTED backend re-cuts
    the byte-identical key from the run_id alone, having stored nothing.

    ``mod._RUNS.clear()`` is the stand-in for "the process died" — the in-process handle is gone, as
    it would be after a ``kill -9``. If this ever fails, a restarted backend can no longer talk to
    its own surviving microVM."""
    with _Ctx() as ctx:
        with patch.object(
            mod,
            "derive_session_key",
            side_effect=lambda rid, secret=None: real_derive_session_key(rid, "pinned-test-secret"),
        ):
            adapter = mod.OpenHandsFlyAdapter()
            adapter.run(_task(tmp_path, "node-a"))
            mod._RUNS.clear()  # the backend died here
            adapter.run(_task(tmp_path, "node-b"))  # a fresh process, same run
        seen = [kw["api_key"] for kw in ctx.ws_kwargs]
    assert seen[0] == seen[1], "a restarted backend must re-derive the SAME per-run key"


def test_the_session_key_is_not_leaked_into_the_result(tmp_path):
    """C8: the per-run key is never persisted, logged, or serialized into a response."""
    with _Ctx():
        result = mod.OpenHandsFlyAdapter().run(_task(tmp_path, "node-a"))
    assert "per-run-secret-key" not in repr(result)
    assert "per-run-secret-key" not in (result.summary or "")


# ---- teardown: no leaked app, ever ----


def test_run_end_teardown_deletes_the_whole_app(tmp_path):
    """The Control Plane's existing ``close_run_sandboxes(run_id)`` hook must destroy the microVM —
    that is what keeps a finished run from billing forever."""
    with _Ctx() as ctx:
        adapter = mod.OpenHandsFlyAdapter()
        adapter.run(_task(tmp_path, "node-a"))
        adapter.run(_task(tmp_path, "node-b"))
        ctx.fly.delete_app.assert_not_called()
        sandbox_cache.close_run_sandboxes(RUN_ID)  # what team_run calls at run-end
    ctx.fly.delete_app.assert_called_once_with(f"tv-run-{RUN_ID}")
    assert RUN_ID not in mod._RUNS


def test_teardown_registration_is_invisible_to_the_docker_reaper(tmp_path):
    """The fly entry rides the shared cache, so it must contribute NO container id — otherwise it
    would pollute the docker reaper's keep-set."""
    with _Ctx():
        mod.OpenHandsFlyAdapter().run(_task(tmp_path, "node-a"))
    assert sandbox_cache.live_container_ids() == frozenset()


def test_a_keyless_call_tears_down_its_own_machine(tmp_path):
    """No session_key (older/test call sites) ⇒ nothing will ever call close_run_sandboxes for it,
    so the adapter owns teardown in its own finally."""
    with _Ctx() as ctx:
        mod.OpenHandsFlyAdapter().run(_task(tmp_path, None))
    ctx.fly.delete_app.assert_called_once()
    assert mod._RUNS == {}


def test_a_failed_keyless_run_still_tears_down(tmp_path):
    with _Ctx() as ctx:
        ctx.convos_error = True
        with patch.object(mod, "Conversation", side_effect=RuntimeError("boom")):
            result = mod.OpenHandsFlyAdapter().run(_task(tmp_path, None))
    assert result.status == "failed"
    assert "boom" in (result.error or "")
    ctx.fly.delete_app.assert_called_once()  # a mid-run failure never leaks the app


def test_run_failure_is_caught_and_reported_not_raised(tmp_path):
    with _Ctx():
        with patch.object(mod, "Conversation", side_effect=RuntimeError("agent exploded")):
            result = mod.OpenHandsFlyAdapter().run(_task(tmp_path, "node-a"))
    assert result.status == "failed"
    assert "agent exploded" in (result.error or "")
    assert result.files_changed == []


def test_boot_failure_does_not_cache_a_dead_run(tmp_path):
    """If the microVM never comes up, the run must fail cleanly and leave no cache entry behind for
    the next node to reuse."""
    with _Ctx() as ctx:
        ctx.fly.start_run_sandbox.side_effect = RuntimeError("fly boot failed")
        result = mod.OpenHandsFlyAdapter().run(_task(tmp_path, "node-a"))
    assert result.status == "failed"
    assert "fly boot failed" in (result.error or "")
    assert mod._RUNS == {}


# ---- M-fail: a FAILED node keeps its WORK and its MONEY (fly mirror of the docker case) ----


def test_failure_after_conversation_run_keeps_work_and_money(tmp_path):
    """M-fail (run 6fd2c911): when ``conversation.run()`` raises AFTER the agent produced files,
    the microVM path must still pull the work (``files_changed`` non-empty, via a best-effort pull
    in the except block, BEFORE the finally can tear the machine down) and still meter the partial
    spend (the usage read runs for any non-completed status). Contrast ``..._not_raised`` above,
    where the Conversation CONSTRUCTOR fails: no conversation existed, so nothing is pulled."""
    convo = MagicMock()
    metrics = MagicMock(accumulated_cost=0.0104)
    metrics.accumulated_token_usage = MagicMock(prompt_tokens=900, completion_tokens=129)
    convo.conversation_stats.get_combined_metrics.return_value = metrics
    convo.run.side_effect = RuntimeError("MaxIterationsReached: agent hit its iteration cap")

    with _Ctx():
        with patch.object(mod, "Conversation", return_value=convo):
            result = mod.OpenHandsFlyAdapter().run(_task(tmp_path, "node-a"))

    assert result.status == "failed"
    assert "MaxIterationsReached" in (result.error or "")
    # WORK kept: the REUSED _pull_workspace recovered the node's file on the failure path too.
    assert result.files_changed == ["out.txt"]
    assert (tmp_path / "out.txt").read_text() == "hi"
    # MONEY metered on the failed run, not dropped to $0.
    assert result.cost_usd == 0.0104
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (900, 129, 1029)


def test_failure_pull_is_scoped_for_an_emitting_node(tmp_path):
    """M-fail + Slice-4 anti-clobber (fly mirror): a FAILED emitting node's best-effort pull carries
    ONLY its verdict sidecar (``pull_paths`` passed UNCHANGED) — the new failure path preserves the
    same workspace-read-only scoping the success path already had."""
    convo = MagicMock()
    metrics = MagicMock(accumulated_cost=0.0)
    metrics.accumulated_token_usage = MagicMock(prompt_tokens=0, completion_tokens=0)
    convo.conversation_stats.get_combined_metrics.return_value = metrics
    convo.run.side_effect = RuntimeError("boom mid-verify")

    task = AgentTask(
        instruction="review",
        workspace_dir=str(tmp_path),
        model="m",
        llm_api_key="byok-key",
        session_key=f"{RUN_ID}::node-a",
        pull_paths=("REVIEW_VERDICT.json",),
    )
    with _Ctx() as ctx:
        with patch.object(mod, "Conversation", return_value=convo):
            result = mod.OpenHandsFlyAdapter().run(task)

    assert result.status == "failed"
    # ONLY the verdict sidecar came home — the node's other edits never reached the worktree.
    assert result.files_changed == ["REVIEW_VERDICT.json"]
    srcs = {c.args[0] for c in ctx.workspaces[0].file_download.call_args_list}
    assert srcs == {"/workspace/node-a/REVIEW_VERDICT.json"}
