"""M9 — the hidden check of a task set's task (rulings R11, R12; contract
``docs/superpowers/plans/api/task-sets.md`` › The hidden check).

A set compare's run, at its compare terminal (after its last step, before it is finalized and torn
down), runs its task's hidden check command in the run's OWN sandbox: Fly — the run's microVM, in a
fresh ``/workspace/__check__`` pushed from the host workspace; docker — a fresh container; LOCAL
(dev only, never in hosted mode) — the host workspace, with a process-group kill. Ten minutes at
most; pass = exit code 0; the last 12 lines of output kept, masked. Idempotent per run.

R11 is absolute: the command never reaches an agent — asserted here against the REAL ``run_team``
walk with a fake adapter that captures every task handed to an agent."""

import json
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from conftest import auth_user_id, maybe_write_entry_report
from home_fixtures import make_run
from sqlalchemy import select, text
from test_compare import TASK, _drive, _end, _two_versions, _walk_fakes
from test_task_sets import _make_set, _seed_set_compare, _set_runs, _starts

from tvashtr.config import get_settings
from tvashtr.control_plane import agent_test_runner, hidden_checks, team_run
from tvashtr.db import session_scope
from tvashtr.engines import sandbox_cache
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import (
    AgentInvocation,
    AgentTest,
    Compare,
    Document,
    DocumentVersion,
    HiddenCheckResult,
    HumanTask,
    NodeMemory,
    Run,
    RunCheckpoint,
    RunEvent,
    RunWarning,
)

# ------------------------------------------------------------------------- LOCAL, for real


def test_local_a_passing_and_a_failing_command(tmp_path):
    (tmp_path / "rsi.py").write_text("x = 1\n")
    code, out, timed_out = hidden_checks.run_local(str(tmp_path), "test -f rsi.py && echo ok", 30)
    assert (code, out.strip(), timed_out) == (0, "ok", False)
    code, out, timed_out = hidden_checks.run_local(
        str(tmp_path), "echo nope; echo boom >&2; exit 3", 30
    )
    assert (code, timed_out) == (3, False)
    assert out.split() == ["nope", "boom"]  # stderr is kept with stdout


def test_local_a_command_past_its_limit_is_killed_with_its_children(tmp_path):
    began = time.monotonic()
    code, _out, timed_out = hidden_checks.run_local(
        str(tmp_path), "(sleep 30 &); echo started; sleep 30", 0.5
    )
    assert (code, timed_out) == (None, True)
    assert time.monotonic() - began < 10  # the group was killed, its pipe did not hold us


def test_local_only_the_end_of_a_noisy_checks_output_is_kept(tmp_path):
    """A check that prints without end never fills the server's memory: only its last 64 KB come
    back (the review's OOM finding)."""
    code, out, timed_out = hidden_checks.run_local(
        str(tmp_path),
        "head -c 3000000 /dev/zero | tr '\\0' x; echo; echo the last line",
        30,
    )
    assert (code, timed_out) == (0, False)
    assert len(out) <= hidden_checks.OUTPUT_CAP
    assert out.rstrip().endswith("the last line")


def test_the_sandbox_runs_the_check_bounded_and_on_its_own_timer():
    """In a sandbox the check runs under its own GNU timeout (its whole process group killed at the
    limit), stdout and stderr in one stream, and only its last 64 KB come back."""
    import shlex

    assert shlex.split(hidden_checks.sandbox_command("pytest -q -k 'rsi or macd'", 600)) == [
        "bash",
        "-o",
        "pipefail",
        "-c",
        "timeout -k 5 600 bash -c 'pytest -q -k '\"'\"'rsi or macd'\"'\"'' 2>&1"
        f" | tail -c {hidden_checks.OUTPUT_CAP}",
    ]


def _remote(result, *, log_command=None):
    calls: list = []

    def _execute(command, **kwargs):
        calls.append((command, kwargs))
        if log_command:
            import logging

            logging.getLogger(hidden_checks.SDK_LOGGER).warning(
                f"Command timed out after 630 seconds: {command}"
            )
        return result

    return SimpleNamespace(execute_command=_execute), calls


def test_run_remote_passes_the_wrapped_command_with_room_for_its_own_timer():
    ws, calls = _remote(
        SimpleNamespace(exit_code=1, stdout="1 failed\n", stderr="", timeout_occurred=False)
    )
    assert hidden_checks.run_remote(ws, "pytest -q", "/w", 600) == (1, "1 failed\n", False)
    ((command, kwargs),) = calls
    assert command == hidden_checks.sandbox_command("pytest -q", 600)
    assert kwargs == {"cwd": "/w", "timeout": 600 + hidden_checks.GRACE_S}


def test_run_remote_a_check_its_timer_stopped_is_timed_out(monkeypatch):
    clock = iter([100.0, 701.0])
    monkeypatch.setattr(hidden_checks.time, "monotonic", lambda: next(clock))
    ws, _ = _remote(
        SimpleNamespace(exit_code=124, stdout="tick\n", stderr="", timeout_occurred=False)
    )
    assert hidden_checks.run_remote(ws, "sleep 9999", "/w", 600) == (None, "tick\n", True)
    # A check that itself exits 124 at once is an ordinary failure.
    clock = iter([100.0, 102.0])
    ws, _ = _remote(SimpleNamespace(exit_code=124, stdout="", stderr="", timeout_occurred=False))
    assert hidden_checks.run_remote(ws, "exit 124", "/w", 600) == (124, "", False)


def test_run_remote_a_sandbox_error_is_raised_not_recorded_as_the_checks_output():
    ws, _ = _remote(
        SimpleNamespace(
            exit_code=-1,
            stdout="",
            stderr="Remote execution error: ConnectError for url 'http://tv-run-x.flycast/api/bash'",
            timeout_occurred=False,
        )
    )
    with pytest.raises(RuntimeError):
        hidden_checks.run_remote(ws, "pytest -q", "/w", 600)


def test_run_remote_never_lets_the_sdk_log_the_command(caplog):
    caplog.set_level("DEBUG")
    ws, _ = _remote(
        SimpleNamespace(exit_code=0, stdout="", stderr="", timeout_occurred=False),
        log_command=True,
    )
    hidden_checks.run_remote(ws, "pytest -q -k SECRETCHECK", "/w", 600)
    assert "SECRETCHECK" not in caplog.text


def test_local_the_check_does_not_see_the_servers_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("TVASHTR_M9_PROBE", "server-only-value")
    _code, out, _ = hidden_checks.run_local(str(tmp_path), 'echo "[$TVASHTR_M9_PROBE]"', 30)
    assert out.strip() == "[]"


# ----------------------------------------------------------------------------- the runner


def _set_run(client, command: str, *, status: str = "running") -> str:
    owner = auth_user_id()
    team = _two_versions(client)
    ts = _make_set(
        client,
        team,
        name=f"Checks {uuid.uuid4().hex[:6]}",
        items=[{"task": TASK, "starts_from": None, "hidden_check": command}],
    )
    # Finished: an unfinished set compare with a task not launched would be re-armed (and its
    # task launched for real) by the next app startup.
    cid = _seed_set_compare(team, owner, ts, status="finished")
    return make_run(
        owner,
        team,
        status=status,
        pair_id=uuid.UUID(cid),
        pair_label="A",
        task_set_item_id=uuid.UUID(ts["items"][0]["id"]),
    )[0]


def _result(run_id: str) -> HiddenCheckResult | None:
    with session_scope() as session:
        row = session.execute(
            select(HiddenCheckResult).where(HiddenCheckResult.run_id == uuid.UUID(run_id))
        ).scalar_one_or_none()
        if row is not None:
            session.expunge(row)
    return row


@pytest.fixture
def local_mode(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_mode", False)
    monkeypatch.setattr(settings, "agent_sandbox_mode", "local")


def test_a_check_runs_once_and_records_its_result(client, local_mode, monkeypatch, tmp_path):
    (tmp_path / "rsi.py").write_text("x = 1\n")
    run_id = _set_run(client, "test -f rsi.py && echo all good")
    calls: list = []
    real = hidden_checks._execute
    monkeypatch.setattr(hidden_checks, "_execute", lambda *a: calls.append(a) or real(*a))
    try:
        hidden_checks.run_for(run_id, str(tmp_path), "greenfield")
        hidden_checks.run_for(run_id, str(tmp_path), "greenfield")  # a recovery: not again
        assert len(calls) == 1
        row = _result(run_id)
        assert (row.passed, row.exit_code, row.timed_out) == (True, 0, False)
        assert row.output_tail == "all good" and row.duration_s >= 0
    finally:
        _end([run_id])


def test_a_failing_check_keeps_the_last_12_lines_masked(client, local_mode, tmp_path):
    secret = "sk-or-v1-" + "a1b2c3d4" * 6
    command = f"for i in $(seq 1 20); do echo line $i; done; echo key={secret}; exit 1"
    run_id = _set_run(client, command)
    try:
        hidden_checks.run_for(run_id, str(tmp_path), "greenfield")
        row = _result(run_id)
        assert (row.passed, row.exit_code, row.timed_out) == (False, 1, False)
        lines = row.output_tail.splitlines()
        assert len(lines) == 12 and lines[0] == "line 10"
        assert secret not in row.output_tail and "••••" in lines[-1]
    finally:
        _end([run_id])


def test_a_check_past_the_limit_fails_and_says_so(client, local_mode, monkeypatch, tmp_path):
    monkeypatch.setattr(agent_test_runner, "REPLAY_CAP_S", 0.5)
    run_id = _set_run(client, "echo working; sleep 20")
    try:
        hidden_checks.run_for(run_id, str(tmp_path), "greenfield")
        row = _result(run_id)
        assert (row.passed, row.exit_code, row.timed_out) == (False, None, True)
        assert row.output_tail.splitlines()[-1] == agent_test_runner.TOO_LONG
    finally:
        _end([run_id])


def test_a_hosted_server_never_runs_a_check_on_itself(client, monkeypatch, tmp_path):
    """The hosted control plane (a Fly machine) never runs a check on itself, even if its sandbox
    were misconfigured to LOCAL."""
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_mode", True)
    monkeypatch.setattr(settings, "agent_sandbox_mode", "local")
    monkeypatch.setenv("FLY_MACHINE_ID", "148e21ea7e5389")
    marker = tmp_path / "ran"
    run_id = _set_run(client, f"touch {marker}")
    try:
        hidden_checks.run_for(run_id, str(tmp_path), "greenfield")
        assert not marker.exists()
        row = _result(run_id)
        assert (row.passed, row.exit_code) == (False, None)
        assert row.output_tail == hidden_checks.NOT_HERE
    finally:
        _end([run_id])


def test_a_hosted_dev_stack_on_the_local_sandbox_runs_the_check_where_its_agents_ran(
    client, monkeypatch, tmp_path
):
    """Off Fly (a developer's hosted-mode stack, the LOCAL e2e), the agents themselves ran on this
    machine, so the check runs there too (the brief's M9 e2e is a set compare on LOCAL)."""
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_mode", True)
    monkeypatch.setattr(settings, "agent_sandbox_mode", "local")
    monkeypatch.delenv("FLY_MACHINE_ID", raising=False)
    marker = tmp_path / "ran"
    run_id = _set_run(client, f"touch {marker}")
    try:
        hidden_checks.run_for(run_id, str(tmp_path), "greenfield")
        assert marker.exists()
        assert _result(run_id).passed is True
    finally:
        _end([run_id])


def test_no_check_for_a_run_that_has_ended_or_has_no_task(client, local_mode, tmp_path):
    marker = tmp_path / "ran"
    stopped = _set_run(client, f"touch {marker}", status="cancelled")
    plain = make_run(auth_user_id(), None, status="running")[0]
    try:
        hidden_checks.run_for(stopped, str(tmp_path), "greenfield")
        hidden_checks.run_for(plain, str(tmp_path), "greenfield")
        assert not marker.exists()
        assert _result(stopped) is None and _result(plain) is None
    finally:
        _end([plain])


def test_each_sandbox_mode_runs_the_check_in_its_own_sandbox(client, monkeypatch, tmp_path):
    """The dispatch: Fly → the run's microVM helper, docker → a fresh container helper. The
    adapters' helpers are faked here (their own tests are below)."""
    from tvashtr.engines import openhands_docker_adapter, openhands_fly_adapter

    seen: list = []
    monkeypatch.setattr(
        openhands_fly_adapter,
        "run_check",
        lambda *a: seen.append(("fly", *a)) or (0, "fine", False),
    )
    monkeypatch.setattr(
        openhands_docker_adapter,
        "run_check",
        lambda *a: seen.append(("docker", *a)) or (2, "bad", False),
    )
    settings = get_settings()
    for mode in ("fly", "docker"):
        monkeypatch.setattr(settings, "agent_sandbox_mode", mode)
        assert hidden_checks._execute("r1", str(tmp_path), "make check", "brownfield", 600) in (
            (0, "fine", False),
            (2, "bad", False),
        )
    assert seen == [
        ("fly", "r1", str(tmp_path), "make check", "brownfield", 600),
        ("docker", "r1", str(tmp_path), "make check", "brownfield", 600),
    ]


# ------------------------------------------------------------- the adapter helpers (faked)

_RUN = "aa9d8a2b-d54d-49e2-9cc0-ab20b60a1098"


@pytest.fixture
def _clean_cache():
    sandbox_cache.clear()
    yield
    sandbox_cache.clear()


def _host(tmp_path) -> Path:
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "rsi.py").write_text("x = 1\n")
    return tmp_path


def test_fly_runs_the_check_in_a_fresh_dir_on_the_runs_microvm(tmp_path, monkeypatch, _clean_cache):
    from tvashtr.engines import openhands_fly_adapter as mod

    sandbox = SimpleNamespace(
        machine=SimpleNamespace(flycast_host="http://tv-run-x.flycast:8000"),
        session_api_key="per-run-key",
    )
    monkeypatch.setattr(mod, "_ensure_run_sandbox", lambda run_id: (sandbox, True))
    made: list = []

    def _workspace(**kwargs):
        ws = MagicMock()
        ws.working_dir = kwargs["working_dir"]
        ws.execute_command.return_value = SimpleNamespace(
            exit_code=0, stdout="3 passed\n", stderr="", timeout_occurred=False
        )
        ws.file_upload.return_value = SimpleNamespace(success=True)
        made.append((kwargs, ws))
        return ws

    monkeypatch.setattr(mod, "RemoteWorkspace", _workspace)
    host = _host(tmp_path)
    got = mod.run_check(_RUN, str(host), "pytest -q", "greenfield", 600)
    assert got == (0, "3 passed\n", False)
    ((kwargs, ws),) = made
    assert kwargs == {
        "host": "http://tv-run-x.flycast:8000",
        "working_dir": "/workspace/__check__",
        "api_key": "per-run-key",
    }
    commands = [c.args[0] for c in ws.execute_command.call_args_list]
    # A check left running on the machine by a recovered walk is killed before the fresh dir.
    assert commands[0] == mod._CHECK_PREP
    assert "kill -9" in commands[0] and commands[0].endswith(
        "rm -rf /workspace/__check__ && mkdir -p /workspace/__check__"
    )
    assert commands[-1] == hidden_checks.sandbox_command("pytest -q", 600)
    assert ws.execute_command.call_args_list[-1].kwargs == {
        "cwd": "/workspace/__check__",
        "timeout": 600 + hidden_checks.GRACE_S,
    }
    ws.file_upload.assert_called_once_with(
        str(host / "pkg" / "rsi.py"), "/workspace/__check__/pkg/rsi.py"
    )
    # A machine this process (re)attached to is torn down with the run, like an agent step's.
    assert sandbox_cache.get(f"{_RUN}::__fly_machine__") is not None

    # The check can't run: a fresh dir that couldn't be made, or a file that couldn't be pushed.
    def _failing_prep(**kwargs):
        ws = _workspace(**kwargs)
        ws.execute_command.return_value = SimpleNamespace(
            exit_code=1, stdout="", stderr="read-only file system", timeout_occurred=False
        )
        return ws

    monkeypatch.setattr(mod, "RemoteWorkspace", _failing_prep)
    with pytest.raises(RuntimeError):
        mod.run_check(_RUN, str(host), "pytest -q", "greenfield", 600)

    def _failing_upload(**kwargs):
        ws = _workspace(**kwargs)
        ws.file_upload.return_value = SimpleNamespace(success=False, error="disk full")
        return ws

    monkeypatch.setattr(mod, "RemoteWorkspace", _failing_upload)
    with pytest.raises(RuntimeError):
        mod.run_check(_RUN, str(host), "pytest -q", "greenfield", 600)


def test_fly_a_check_that_times_out_reports_it(tmp_path, monkeypatch, _clean_cache):
    from tvashtr.engines import openhands_fly_adapter as mod

    sandbox = SimpleNamespace(machine=SimpleNamespace(flycast_host="h"), session_api_key="k")
    monkeypatch.setattr(mod, "_ensure_run_sandbox", lambda run_id: (sandbox, False))
    ws = MagicMock()
    ws.execute_command.side_effect = [
        SimpleNamespace(exit_code=0, stdout="", stderr="", timeout_occurred=False),  # the fresh dir
        SimpleNamespace(
            exit_code=-1,
            stdout="",
            stderr="Command timed out after 630 seconds",
            timeout_occurred=True,
        ),
    ]
    monkeypatch.setattr(mod, "RemoteWorkspace", lambda **k: ws)
    assert mod.run_check(_RUN, str(tmp_path), "sleep 9999", "greenfield", 600) == (
        None,
        "Command timed out after 630 seconds",
        True,
    )
    assert sandbox_cache.get(f"{_RUN}::__fly_machine__") is None  # already registered elsewhere


def test_docker_runs_the_check_in_a_fresh_container_and_removes_it(tmp_path, monkeypatch):
    from tvashtr.engines import openhands_docker_adapter as mod

    made: list = []

    def _container(**kwargs):
        ws = MagicMock()
        ws.working_dir = "/workspace"
        ws._container_id = "c-check"
        ws.execute_command.return_value = SimpleNamespace(
            exit_code=1, stdout="1 failed\n", stderr="", timeout_occurred=False
        )
        ws.file_upload.return_value = SimpleNamespace(success=True)
        made.append((kwargs, ws))
        return ws

    monkeypatch.setattr(mod, "DockerWorkspace", _container)
    registered: list = []
    monkeypatch.setattr(
        mod.sandbox_cache, "register_live_container", lambda cid, **k: registered.append(cid)
    )
    monkeypatch.setattr(
        mod.sandbox_cache, "deregister_live_container", lambda cid: registered.remove(cid)
    )
    host = _host(tmp_path)
    assert mod.run_check(_RUN, str(host), "pytest -q", "greenfield", 600) == (
        1,
        "1 failed\n",
        False,
    )
    ((kwargs, ws),) = made
    assert kwargs["extra_ports"] is False
    # The check container's log stream is not copied into the server's log.
    assert kwargs["detach_logs"] is False
    ws.file_upload.assert_called_once_with(str(host / "pkg" / "rsi.py"), "/workspace/pkg/rsi.py")
    assert ws.execute_command.call_args_list[-1].args == (
        hidden_checks.sandbox_command("pytest -q", 600),
    )
    assert ws.execute_command.call_args_list[-1].kwargs == {
        "cwd": "/workspace",
        "timeout": 600 + hidden_checks.GRACE_S,
    }
    ws.cleanup.assert_called_once()
    assert registered == []

    # The container goes even when the check can't run.
    made.clear()
    monkeypatch.setattr(mod, "_push_workspace", MagicMock(side_effect=RuntimeError("upload")))
    with pytest.raises(RuntimeError):
        mod.run_check(_RUN, str(host), "pytest -q", "greenfield", 600)
    made[0][1].cleanup.assert_called_once()
    assert registered == []


# ------------------------------------------------------------------- R11, on the real walk


class _CapturingAdapter:
    """Every task handed to an agent is kept (all of its fields). Thinkers write their report; the
    Engineer writes rsi.py; the Reviewer is forced to approve round 1."""

    name = "openhands"

    def __init__(self, seen: list) -> None:
        self.seen = seen

    def run(self, task, on_event=None):  # noqa: ARG002
        self.seen.append(repr(task))
        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        Path(task.workspace_dir).joinpath("rsi.py").write_text("def rsi(): ...\n")
        return AgentRunResult(status="completed", summary="ok", events=[], files_changed=["rsi.py"])


_AGENT_READABLE = (
    Run,
    Compare,
    RunEvent,
    AgentInvocation,
    Document,
    DocumentVersion,
    NodeMemory,
    HumanTask,
    AgentTest,
    RunWarning,
)


def test_r11_the_hidden_check_reaches_no_agent(client, monkeypatch, tmp_path):
    marker = f"HIDDEN-{uuid.uuid4().hex}"
    team = _two_versions(client)
    ts = _make_set(
        client,
        team,
        name=f"R11 {uuid.uuid4().hex[:6]}",
        items=[
            {"task": TASK, "starts_from": None, "hidden_check": f"echo {marker} && test -f rsi.py"}
        ],
    )
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_mode", False)
    monkeypatch.setattr(settings, "agent_sandbox_mode", "local")
    resp, _, _ = _starts(client, team, monkeypatch, task_set_id=ts["id"])
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    run = _set_runs(cid)[0]
    _walk_fakes(monkeypatch, tmp_path)
    seen: list[str] = []
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _CapturingAdapter(seen))
    agents_before_check: list[int] = []
    real = hidden_checks._execute

    def _spy(*args):
        agents_before_check.append(len(seen))
        return real(*args)

    monkeypatch.setattr(hidden_checks, "_execute", _spy)
    try:
        result = _drive(run.id)
        assert result["status"] == "completed", result

        # The check ran — after the run's last agent step, before the run was finalized.
        row = _result(str(run.id))
        assert row is not None and (row.passed, row.exit_code) == (True, 0)
        # (the PM and the Engineer; the Reviewer is forced to approve without an agent)
        assert agents_before_check == [len(seen)] and len(seen) >= 2

        # ...and reached no agent: not in any task handed to an agent (its instruction included),
        assert seen and not [t for t in seen if marker in t]
        # not in any row an agent (or a later run) can read,
        with session_scope() as session:
            for model in _AGENT_READABLE:
                found = session.execute(
                    text(f"SELECT count(*) FROM {model.__table__.name} t WHERE t::text LIKE :m"),
                    {"m": f"%{marker}%"},
                ).scalar_one()
                assert found == 0, model.__table__.name
            payloads = session.execute(
                select(RunEvent.payload).where(RunEvent.run_id == str(run.id))
            ).scalars()
            assert marker not in json.dumps(list(payloads))
            details = session.execute(
                select(AgentInvocation.outcome_detail).where(AgentInvocation.run_id == str(run.id))
            ).scalars()
            assert not [d for d in details if d and marker in d]
            diffs = session.execute(
                select(RunCheckpoint.diff).where(RunCheckpoint.run_id == run.id)
            ).scalars()
            assert not [d for d in diffs if d and marker.encode() in d]
            assert session.get(Run, run.id).idea == TASK
            assert session.get(Compare, uuid.UUID(cid)).task == ts["name"]
        # and in no file of the run's workspace.
        workspace = tmp_path / str(run.id)
        files = [p for p in workspace.rglob("*") if p.is_file()]
        assert files and not [p for p in files if marker.encode() in p.read_bytes()]
        assert (workspace / "rsi.py").exists()
    finally:
        _end(_set_runs(cid))
