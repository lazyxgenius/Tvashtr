"""M1 stall guard, ruling R2 on the WORKER path: when the agent's own retry envelope is used up on a
busy provider (429 / rate limit / timeout / overloaded), or on a hard failure, the step switches
ONCE to its backup model — the node's ``config["fallback_model"]``, else the account's backup for
the node's capability — only when the owner holds a key for it and it differs from the primary.
The switch is a ``backup_model`` run event and a ``fallback_model`` RunWarning.

Adapter tests drive the REAL except blocks with the SDK mocked (``test_proxy_adapter_wiring``'s
harness); executor tests drive the REAL ``run_team`` with a fake adapter at ``resolve_adapter``.
"""

import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from conftest import auth_user_id
from openhands.sdk.event.conversation_error import ConversationErrorEvent
from sqlalchemy import update
from test_node_capabilities import _drive_run, _seed_run_for, _set_config_by_role, _warnings_for
from test_proxy_adapter_wiring import (
    _GENERIC_REMOTE_EXC,
    _budget_error_event,
    _FakeProxyRateLimitError,
    _run_docker_result,
    _run_local_result,
)

from tvashtr.config import Settings
from tvashtr.db import session_scope
from tvashtr.engines import openhands_adapter as local_mod
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import AgentNode

# ---- the contract: an additive, default-False field ----------------------------------------------


def test_retries_exhausted_is_an_additive_default_false_field():
    result = AgentRunResult(status="completed", summary="s", events=[], files_changed=[])
    assert result.retries_exhausted is False
    assert result.provider_failure is False


# ---- the adapters classify a busy provider whose retries ran out ---------------------------------


def _local(tmp_path, monkeypatch, exc):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    settings = Settings(_env_file=None, litellm_proxy_enabled=False)
    return _run_local_result(settings, tmp_path, run_side_effect=exc)


@pytest.mark.parametrize(
    "exc",
    [
        RuntimeError("litellm.RateLimitError: OpenAIException - 429 Too Many Requests"),
        RuntimeError("litellm.APITimeoutError: APITimeoutError - Request timed out."),
        RuntimeError("litellm.InternalServerError: Overloaded"),
        type("RateLimitError", (Exception,), {})(""),
        type("Timeout", (Exception,), {})(""),
    ],
)
def test_local_adapter_flags_a_busy_provider_as_retries_exhausted(tmp_path, monkeypatch, exc):
    result = _local(tmp_path, monkeypatch, exc)
    assert (result.status, result.retries_exhausted, result.provider_failure) == (
        "failed",
        True,
        False,
    )


def test_local_adapter_budget_cutoff_is_never_retries_exhausted(tmp_path, monkeypatch):
    result = _local(tmp_path, monkeypatch, _FakeProxyRateLimitError())
    assert (result.status, result.retries_exhausted, result.provider_failure) == (
        "over_budget",
        False,
        False,
    )


def test_local_adapter_hard_failure_is_provider_failure_only(tmp_path, monkeypatch):
    exc = RuntimeError(
        "litellm.AuthenticationError: OpenrouterException - No auth credentials found"
    )
    result = _local(tmp_path, monkeypatch, exc)
    assert (result.retries_exhausted, result.provider_failure) == (False, True)


def test_local_adapter_generic_failure_sets_neither(tmp_path, monkeypatch):
    result = _local(tmp_path, monkeypatch, RuntimeError("boom"))
    assert (result.retries_exhausted, result.provider_failure) == (False, False)


def _rate_limit_event() -> ConversationErrorEvent:
    return ConversationErrorEvent.model_construct(
        code="LLMRateLimitError",
        detail="litellm.RateLimitError: OpenrouterException - 429 Too Many Requests",
    )


def test_docker_flags_retries_exhausted_from_the_error_event(tmp_path):
    """Remote mode: the raised exception is the SDK's generic wrap; the 429 is only in the event."""
    result = _run_docker_result(
        tmp_path, feed_events=[_rate_limit_event()], raise_exc=_GENERIC_REMOTE_EXC
    )
    assert (result.status, result.retries_exhausted, result.provider_failure) == (
        "failed",
        True,
        False,
    )


def test_docker_generic_failure_is_not_retries_exhausted(tmp_path):
    result = _run_docker_result(tmp_path, feed_events=[], raise_exc=_GENERIC_REMOTE_EXC)
    assert result.retries_exhausted is False


def test_docker_budget_event_is_never_retries_exhausted(tmp_path):
    result = _run_docker_result(
        tmp_path, feed_events=[_budget_error_event()], raise_exc=_GENERIC_REMOTE_EXC
    )
    assert (result.status, result.retries_exhausted) == ("over_budget", False)


def _run_fly_result(tmp_path, *, feed_events, raise_exc):
    """Drive the REAL fly adapter's except block: the conversation feeds ``feed_events`` through
    its callbacks, then raises ``raise_exc`` (``test_fly_adapter``'s fakes, no socket)."""
    from test_fly_adapter import _Ctx, _fake_conversation, _task

    from tvashtr.engines import openhands_fly_adapter as fly_mod
    from tvashtr.engines import sandbox_cache

    def _make_conversation(*args, callbacks=None, **kwargs):
        convo = _fake_conversation()

        def _run():
            for ev in feed_events:
                for cb in callbacks or []:
                    cb(ev)
            raise raise_exc

        convo.run.side_effect = _run
        return convo

    fly_mod._RUNS.clear()
    sandbox_cache.clear()
    try:
        with _Ctx(), patch.object(fly_mod, "Conversation", side_effect=_make_conversation):
            return fly_mod.OpenHandsFlyAdapter().run(_task(tmp_path, "node-a"))
    finally:
        fly_mod._RUNS.clear()
        sandbox_cache.clear()


def test_fly_flags_retries_exhausted_from_the_error_event(tmp_path):
    result = _run_fly_result(
        tmp_path, feed_events=[_rate_limit_event()], raise_exc=_GENERIC_REMOTE_EXC
    )
    budget = _run_fly_result(
        tmp_path, feed_events=[_budget_error_event()], raise_exc=_GENERIC_REMOTE_EXC
    )
    assert (result.status, result.retries_exhausted, result.provider_failure) == (
        "failed",
        True,
        False,
    )
    assert (budget.status, budget.retries_exhausted) == ("over_budget", False)


def test_is_transient_error_excludes_the_budget_cutoff():
    assert (
        local_mod._is_transient_error(
            RuntimeError("litellm.RateLimitError: OpenAIException - 429 Too Many Requests")
        )
        is True
    )
    # Review fix: a bare "429" with no litellm error around it is not evidence of a busy MODEL.
    assert local_mod._is_transient_error(RuntimeError("429 Too Many Requests")) is False
    assert local_mod._is_transient_error(_FakeProxyRateLimitError()) is False
    assert local_mod._is_transient_error(RuntimeError("boom")) is False


# ---- host events: the executor's own run events, in a seq band of their own ----------------------


def _events(run_id: str):
    from sqlalchemy import select

    from tvashtr.db import session_scope
    from tvashtr.models import RunEvent

    with session_scope() as session:
        return list(
            session.execute(
                select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.seq)
            ).scalars()
        )


def test_record_host_event_appends_in_its_own_band_per_invocation():
    import uuid

    from tvashtr.control_plane.live_state import HOST_EVENT_SEQ_BAND, record_host_event

    run_id = str(uuid.uuid4())
    record_host_event(run_id, 7, "backup_model", {"to_model": "a"})
    record_host_event(run_id, 7, "backup_model", {"to_model": "b"})
    record_host_event(run_id, 8, "backup_model", {"to_model": "c"})
    rows = [(e.invocation_id, e.seq, e.kind, e.payload["to_model"]) for e in _events(run_id)]
    assert sorted(rows) == [
        (7, HOST_EVENT_SEQ_BAND, "backup_model", "a"),
        (7, HOST_EVENT_SEQ_BAND + 1, "backup_model", "b"),
        (8, HOST_EVENT_SEQ_BAND, "backup_model", "c"),
    ]


def test_record_host_event_never_raises(monkeypatch):
    from tvashtr.control_plane import live_state

    def _boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(live_state, "session_scope", _boom)
    live_state.record_host_event("not-a-run", 1, "backup_model", {})  # logs, never raises


# ---- the executor: one switch to the backup model ------------------------------------------------
#
# The REAL ``run_team`` on the two-node team, a fake adapter at ``resolve_adapter`` (no LLM).

_NODE_FALLBACK = "openai/gpt-4o-mini"  # a provider the conftest owner holds a dummy key for


class _BusyAdapter:
    """Fails the worker's first ``fail_times`` attempts with ``result_kwargs`` (default: a busy
    provider whose retries ran out), then succeeds. Records every worker ``AgentTask``."""

    name = "openhands"

    def __init__(self, tasks: list, *, fail_times: int, **result_kwargs) -> None:
        self._tasks = tasks
        self._fail_times = fail_times
        self._result = {"status": "failed", "retries_exhausted": True, **result_kwargs}

    def run(self, task, on_event=None):
        from conftest import maybe_write_entry_report

        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        self._tasks.append(task)
        if len(self._tasks) <= self._fail_times:
            return AgentRunResult(
                summary="busy",
                events=[],
                files_changed=[],
                error="litellm.RateLimitError: 429 Too Many Requests",
                **self._result,
            )
        Path(task.workspace_dir).joinpath("greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def _run(
    monkeypatch,
    tmp_path,
    tasks,
    *,
    fallback=None,
    engineer_model=None,
    adapter_cls=None,
    **adapter_kwargs,
):
    """Build the two-node team (optionally authoring the Engineer's fallback / model), seed an
    owned run and drive the REAL workflow. Returns ``(run_id, result)``."""
    from tvashtr.control_plane import team_run
    from tvashtr.control_plane.shipping import init_workspace_repo
    from tvashtr.control_plane.teams import build_two_node_team

    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(
        team_run,
        "resolve_adapter",
        lambda name: (adapter_cls or _BusyAdapter)(tasks, **adapter_kwargs),
    )
    team_graph_id = build_two_node_team()
    if fallback is not None:
        _set_config_by_role(team_graph_id, "engineer", {"fallback_model": fallback})
    if engineer_model is not None:
        with session_scope() as session:
            session.execute(
                update(AgentNode)
                .where(
                    AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                    AgentNode.role_name == "engineer",
                )
                .values(model=engineer_model)
            )
    run_id = str(uuid.uuid4())
    _seed_run_for(run_id, team_graph_id, "Add a greeting.")
    return run_id, _drive_run(run_id, "Add a greeting.")


def _account_worker_backup() -> str | None:
    from tvashtr.control_plane.credentials import held_provider_slugs
    from tvashtr.control_plane.teams import account_fallback_model

    return account_fallback_model(held_provider_slugs(auth_user_id()), "worker")


def _backup_events(run_id: str) -> list:
    return [e for e in _events(run_id) if e.kind == "backup_model"]


def _fallback_warnings(run_id: str) -> list:
    return [w for w in _warnings_for(run_id) if w.source_kind == "fallback_model"]


def test_retries_exhausted_switches_once_to_the_node_fallback(client, monkeypatch, tmp_path):
    """THE REPRODUCE-FIRST CASE (M1 acceptance c, worker path): the busy primary's envelope is used
    up; the step re-runs ONCE on the node's fallback, says so in the feed and in a RunWarning."""
    tasks: list = []
    run_id, result = _run(monkeypatch, tmp_path, tasks, fallback=_NODE_FALLBACK, fail_times=1)
    assert result["status"] == "completed", result
    assert [t.model for t in tasks][1:] == [_NODE_FALLBACK]
    primary = tasks[0].model

    events = _backup_events(run_id)
    assert [e.payload for e in events] == [
        {"from_model": primary, "to_model": _NODE_FALLBACK, "reason": "busy"}
    ]
    assert events[0].invocation_id is not None
    warnings = _fallback_warnings(run_id)
    assert [(w.name, w.reason) for w in warnings] == [
        (
            _NODE_FALLBACK,
            f"primary {primary!r} stayed busy after its retries — switched to the backup model",
        )
    ]


def test_retries_exhausted_without_a_node_fallback_uses_the_account_backup(
    client, monkeypatch, tmp_path
):
    """No ``fallback_model`` authored: the account's backup for the node's capability (a WORKER
    here), which the owner holds a key for by construction."""
    backup = _account_worker_backup()
    tasks: list = []
    run_id, result = _run(monkeypatch, tmp_path, tasks, fail_times=1)
    assert backup is not None and backup != tasks[0].model, (backup, tasks[0].model)
    assert result["status"] == "completed", result
    assert [t.model for t in tasks][1:] == [backup]
    assert [e.payload["to_model"] for e in _backup_events(run_id)] == [backup]
    assert [w.name for w in _fallback_warnings(run_id)] == [backup]


def test_an_account_backup_equal_to_the_primary_is_not_used(client, monkeypatch, tmp_path):
    tasks: list = []
    run_id, result = _run(
        monkeypatch, tmp_path, tasks, engineer_model=_account_worker_backup(), fail_times=1
    )
    assert result["status"] == "failed", result
    assert len(tasks) == 1, [t.model for t in tasks]
    assert _backup_events(run_id) == []
    assert _fallback_warnings(run_id) == []


def test_an_account_backup_the_owner_holds_no_key_for_is_not_used(client, monkeypatch, tmp_path):
    from tvashtr.control_plane import team_run

    monkeypatch.setattr(
        team_run, "account_fallback_model", lambda held, capability: "anthropic/claude-sonnet-5"
    )
    tasks: list = []
    run_id, result = _run(monkeypatch, tmp_path, tasks, fail_times=1)
    assert result["status"] == "failed", result
    assert len(tasks) == 1, [t.model for t in tasks]
    assert _backup_events(run_id) == []


def test_no_backup_at_all_keeps_the_original_failure(client, monkeypatch, tmp_path):
    from tvashtr.control_plane import team_run

    monkeypatch.setattr(team_run, "account_fallback_model", lambda held, capability: None)
    tasks: list = []
    run_id, result = _run(monkeypatch, tmp_path, tasks, fail_times=1)
    assert result["status"] == "failed", result
    assert len(tasks) == 1, [t.model for t in tasks]
    assert _backup_events(run_id) == []
    assert _fallback_warnings(run_id) == []


def test_an_account_backup_lookup_error_never_crashes_the_step(client, monkeypatch, tmp_path):
    from tvashtr.control_plane import team_run

    def _boom(held, capability):
        raise RuntimeError("catalogue unavailable")

    monkeypatch.setattr(team_run, "account_fallback_model", _boom)
    tasks: list = []
    _, result = _run(monkeypatch, tmp_path, tasks, fail_times=1)
    assert result["status"] == "failed", result
    assert len(tasks) == 1, [t.model for t in tasks]


def test_the_switch_happens_at_most_once(client, monkeypatch, tmp_path):
    tasks: list = []
    run_id, result = _run(monkeypatch, tmp_path, tasks, fallback=_NODE_FALLBACK, fail_times=2)
    assert result["status"] == "failed", result
    assert len(tasks) == 2, [t.model for t in tasks]
    assert len(_backup_events(run_id)) == 1


def test_a_budget_cutoff_never_switches(client, monkeypatch, tmp_path):
    """``over_budget`` owns its own terminal — even a result that (wrongly) also carried the flag
    must not buy a second run on the backup."""
    tasks: list = []
    run_id, result = _run(
        monkeypatch, tmp_path, tasks, fallback=_NODE_FALLBACK, fail_times=1, status="over_budget"
    )
    assert result["status"] == "over_budget", result
    assert len(tasks) == 1, [t.model for t in tasks]
    assert _backup_events(run_id) == []


def test_a_hard_failure_switch_is_a_backup_model_event_too(client, monkeypatch, tmp_path):
    tasks: list = []
    run_id, result = _run(
        monkeypatch,
        tmp_path,
        tasks,
        fallback=_NODE_FALLBACK,
        fail_times=1,
        retries_exhausted=False,
        provider_failure=True,
    )
    assert result["status"] == "completed", result
    assert [e.payload for e in _backup_events(run_id)] == [
        {"from_model": tasks[0].model, "to_model": _NODE_FALLBACK, "reason": "error"}
    ]
    # The hard-failure RunWarning is the pre-M1 one, unchanged.
    assert [w.reason for w in _fallback_warnings(run_id)] == [
        f"primary {tasks[0].model!r} hard-failed mid-run — failed over to the node's fallback model"
    ]


def test_a_hard_failure_without_a_node_fallback_uses_the_account_backup(
    client, monkeypatch, tmp_path
):
    """R2 covers the hard failure too: "When the tries are used up (or on a hard failure), the step
    switches ONCE to its backup model: the node's config.fallback_model, else
    teams.account_fallback_model for its capability"."""
    backup = _account_worker_backup()
    tasks: list = []
    run_id, result = _run(
        monkeypatch, tmp_path, tasks, fail_times=1, retries_exhausted=False, provider_failure=True
    )
    assert backup is not None and backup != tasks[0].model, (backup, tasks[0].model)
    assert result["status"] == "completed", result
    assert [t.model for t in tasks][1:] == [backup]
    assert [e.payload for e in _backup_events(run_id)] == [
        {"from_model": tasks[0].model, "to_model": backup, "reason": "error"}
    ]


# ---- review fixes: only a MODEL-layer busy error counts; never switch on a run that ended --------


@pytest.mark.parametrize(
    "exc",
    [
        # A Fly agent server that never came up — an infrastructure timeout, not a busy model.
        RuntimeError(
            "tv-run-x agent server never became healthy within 300.0s (last: ReadTimeout)"
        ),
        type("ReadTimeout", (Exception,), {})("pull timed out"),
        type("ConnectTimeout", (Exception,), {})(""),
        RuntimeError("upstream said 429 while pulling the workspace"),
    ],
)
def test_an_infrastructure_timeout_is_not_retries_exhausted(tmp_path, monkeypatch, exc):
    result = _local(tmp_path, monkeypatch, exc)
    assert (result.status, result.retries_exhausted) == ("failed", False)


def test_a_docker_event_without_model_evidence_is_not_retries_exhausted(tmp_path):
    event = ConversationErrorEvent.model_construct(
        code="SandboxError", detail="sandbox request timed out (ReadTimeout)"
    )
    result = _run_docker_result(tmp_path, feed_events=[event], raise_exc=_GENERIC_REMOTE_EXC)
    assert result.retries_exhausted is False


def test_no_switch_once_the_run_has_ended(client, monkeypatch, tmp_path):
    """Review finding 2: the agent's envelope can outlast the 20-minute sweep; a step that comes
    back 'busy' after its run was failed (slot freed) must not start a second run on the backup."""
    from tvashtr.engines.sandbox_cache import _run_id_of
    from tvashtr.models import Run

    class _EndsTheRun(_BusyAdapter):
        def run(self, task, on_event=None):
            out = super().run(task, on_event)
            if out.status == "failed" and task.session_key:
                with session_scope() as s:
                    s.execute(
                        update(Run)
                        .where(Run.workflow_id == _run_id_of(task.session_key))
                        .values(status="failed", failure_code="stalled")
                    )
            return out

    tasks: list = []
    run_id, _ = _run(
        monkeypatch,
        tmp_path,
        tasks,
        fallback=_NODE_FALLBACK,
        fail_times=1,
        adapter_cls=_EndsTheRun,
    )
    assert len(tasks) == 1, [t.model for t in tasks]
    assert _backup_events(run_id) == []
