"""MA ruling R17: on an agent node with a usable backup, the host sends R2's envelope — 3 attempts —
so a hanging or busy primary reaches the backup switch inside R1's stall ceiling; with no backup the
wider milestone-B envelope (8 attempts) stays.

The envelope is a HOST setting: ``AgentTask.llm_num_retries`` → ``config.agent_llm_routing`` → the
OpenHands ``LLM``'s ``num_retries`` in all three adapters. "Usable backup" is decided by the SAME
choice the switch makes (``team_run._backup_for``) plus a key the owner holds, so the two never
disagree. Executor tests reuse ``test_stall_guard_worker``'s harness (the REAL ``run_team``, a fake
adapter at ``resolve_adapter``, no LLM)."""

from types import SimpleNamespace
from unittest.mock import patch

from openhands.sdk import LLM
from tenacity import wait_exponential
from test_fly_adapter import _Ctx
from test_fly_adapter import _task as _fly_task
from test_proxy_adapter_wiring import _run_docker, _run_local
from test_stall_guard_worker import (
    _NODE_FALLBACK,
    _account_worker_backup,
    _backup_events,
    _fallback_warnings,
    _run,
)

from tvashtr.config import BACKUP_ENVELOPE_RETRIES, Settings, agent_llm_routing
from tvashtr.engines import openhands_fly_adapter as fly_mod
from tvashtr.engines.base import AgentTask

_UNHELD = "anthropic/claude-sonnet-5"  # a provider conftest's owner holds NO key for


def _real_settings() -> Settings:
    """The production defaults (no .env): the numbers a hosted run actually gets."""
    return Settings(_env_file=None, litellm_proxy_enabled=False)


def _worst_case_to_switch_s(task: AgentTask) -> float:
    """How long a model that never answers keeps the step before the host sees the envelope used
    up and can switch, from the REAL settings and the REAL ``LLM`` the adapters build:

    - the SDK makes ``num_retries`` attempts, waiting ``wait_exponential(retry_multiplier,
      retry_min_wait, retry_max_wait)`` between them (its own parameters: multiplier 8, min 8);
    - inside ONE attempt litellm's OpenAI client makes up to ``1 + DEFAULT_MAX_RETRIES`` HTTP
      requests, each cut at the per-request ``timeout``, with the client's own short backoff
      (``INITIAL_RETRY_DELAY`` doubling, capped at ``MAX_RETRY_DELAY``). Measured live by
      ``make backup-envelope-check`` (3 attempts at a 10 s timeout: switch after ~122 s)."""
    from litellm.constants import DEFAULT_MAX_RETRIES
    from openai._constants import INITIAL_RETRY_DELAY, MAX_RETRY_DELAY

    llm = LLM(
        **agent_llm_routing(
            _real_settings(),
            "openai/gpt-4o-mini",
            "local",
            api_key_override="k",
            num_retries=task.llm_num_retries,
        ),
        usage_id="tvashtr-agent",
    )
    wait = wait_exponential(
        multiplier=llm.retry_multiplier, min=llm.retry_min_wait, max=llm.retry_max_wait
    )
    sdk_waits = sum(wait(SimpleNamespace(attempt_number=n)) for n in range(1, llm.num_retries))
    client_backoff = sum(
        min(INITIAL_RETRY_DELAY * 2**i, MAX_RETRY_DELAY) for i in range(DEFAULT_MAX_RETRIES)
    )
    one_attempt = (1 + DEFAULT_MAX_RETRIES) * llm.timeout + client_backoff
    return llm.num_retries * one_attempt + sdk_waits


def _first_worker_task(monkeypatch, tmp_path, **kwargs) -> tuple[str, list]:
    tasks: list = []
    run_id, result = _run(monkeypatch, tmp_path, tasks, fail_times=0, **kwargs)
    assert result["status"] == "completed", result
    assert tasks, "the worker ran"
    return run_id, tasks


# ---- (a) the arithmetic: today's envelope outlives the sweep; R17's reaches the switch first -----


def test_a_hanging_model_reaches_the_switch_before_the_stall_sweep(client, monkeypatch, tmp_path):
    ceiling = _real_settings().stall_fail_after_s
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    _, with_backup = _first_worker_task(monkeypatch, tmp_path / "a", fallback=_NODE_FALLBACK)
    from tvashtr.control_plane import team_run

    monkeypatch.setattr(team_run, "account_fallback_model", lambda held, capability: None)
    _, without = _first_worker_task(monkeypatch, tmp_path / "b")

    today = _worst_case_to_switch_s(without[0])
    r17 = _worst_case_to_switch_s(with_backup[0])
    # 8 attempts × (3 HTTP tries × 120 s + 1.5 s) + 8+16+32+64+120+120+120 s of waits ≈ 3372 s:
    # the 20-minute sweep ends the step long before the envelope is used up.
    assert today > ceiling, (today, ceiling)
    # 3 attempts × (3 × 120 s + 1.5 s) + 8+16 s = 1108.5 s (~18.5 min): the switch comes first.
    assert r17 < ceiling, (r17, ceiling)
    assert r17 == 3 * (3 * 120 + 1.5) + 8 + 16


# ---- (b) the task each adapter gets -------------------------------------------------------------


def test_a_node_fallback_gets_the_three_try_envelope(client, monkeypatch, tmp_path):
    _, tasks = _first_worker_task(monkeypatch, tmp_path, fallback=_NODE_FALLBACK)
    assert BACKUP_ENVELOPE_RETRIES == 3
    assert tasks[0].llm_num_retries == 3


def test_an_account_backup_gets_the_three_try_envelope(client, monkeypatch, tmp_path):
    assert _account_worker_backup() is not None
    _, tasks = _first_worker_task(monkeypatch, tmp_path)
    assert tasks[0].llm_num_retries == 3


def test_no_backup_keeps_todays_envelope(client, monkeypatch, tmp_path):
    from tvashtr.control_plane import team_run

    monkeypatch.setattr(team_run, "account_fallback_model", lambda held, capability: None)
    _, tasks = _first_worker_task(monkeypatch, tmp_path)
    assert tasks[0].llm_num_retries is None  # ⇒ settings.agent_num_retries (8)


def test_a_fallback_without_a_key_keeps_todays_envelope(client, monkeypatch, tmp_path):
    """The switch would be skipped (no credential for the fallback's provider): a short envelope
    would only fail the step sooner, with nothing to switch to."""
    _, tasks = _first_worker_task(monkeypatch, tmp_path, fallback=_UNHELD)
    assert tasks[0].llm_num_retries is None


def test_a_fallback_equal_to_the_primary_keeps_todays_envelope(client, monkeypatch, tmp_path):
    _, tasks = _first_worker_task(
        monkeypatch, tmp_path, fallback=_NODE_FALLBACK, engineer_model=_NODE_FALLBACK
    )
    assert tasks[0].model == _NODE_FALLBACK
    assert tasks[0].llm_num_retries is None


def test_the_failover_attempt_keeps_todays_envelope(client, monkeypatch, tmp_path):
    """The backup has no backup of its own (at most one switch): its attempt gets the wide one."""
    tasks: list = []
    run_id, result = _run(monkeypatch, tmp_path, tasks, fallback=_NODE_FALLBACK, fail_times=1)
    assert result["status"] == "completed", result
    assert [(t.model == _NODE_FALLBACK, t.llm_num_retries) for t in tasks] == [
        (False, 3),
        (True, None),
    ]


def test_routing_carries_the_task_envelope_and_defaults_to_todays():
    s = _real_settings()
    assert agent_llm_routing(s, "openai/x", "local", api_key_override="k")["num_retries"] == 8
    assert (
        agent_llm_routing(s, "openai/x", "local", api_key_override="k", num_retries=None)[
            "num_retries"
        ]
        == 8
    )
    assert (
        agent_llm_routing(s, "openai/x", "fly", api_key_override="k", num_retries=3)["num_retries"]
        == 3
    )


def test_proxy_on_routing_carries_no_envelope():
    s = Settings(_env_file=None, litellm_proxy_enabled=True)
    kwargs = agent_llm_routing(s, "openai/x", "docker", api_key_override="vk", num_retries=3)
    assert "num_retries" not in kwargs


def _with_envelope(task: AgentTask, n: int | None) -> AgentTask:
    from dataclasses import replace

    return replace(task, llm_num_retries=n)


def test_the_local_adapter_builds_its_llm_with_the_task_envelope(tmp_path, monkeypatch):
    s = _real_settings()
    with patch(
        "test_proxy_adapter_wiring.AgentTask", lambda **kw: AgentTask(**kw, llm_num_retries=3)
    ):
        assert _run_local(s, tmp_path, llm_api_key="k")["num_retries"] == 3
    assert _run_local(s, tmp_path, llm_api_key="k")["num_retries"] == 8


def test_the_docker_adapter_builds_its_llm_with_the_task_envelope(tmp_path, monkeypatch):
    s = _real_settings()
    with patch(
        "test_proxy_adapter_wiring.AgentTask", lambda **kw: AgentTask(**kw, llm_num_retries=3)
    ):
        assert _run_docker(s, tmp_path, llm_api_key="k")["num_retries"] == 3
    assert _run_docker(s, tmp_path, llm_api_key="k")["num_retries"] == 8


def test_the_fly_adapter_builds_its_llm_with_the_task_envelope(tmp_path):
    seen = []
    for n in (3, None):
        fly_mod._RUNS.clear()
        with _Ctx(), patch.object(fly_mod, "get_settings", return_value=_real_settings()):
            fly_mod.OpenHandsFlyAdapter().run(_with_envelope(_fly_task(tmp_path, None), n))
            seen.append(fly_mod.LLM.call_args.kwargs["num_retries"])
        fly_mod._RUNS.clear()
    assert seen == [3, 8]


# ---- (c) the worker path: busy past the envelope → one switch, one warning, before the sweep ----


def test_a_busy_primary_switches_once_inside_the_ceiling(client, monkeypatch, tmp_path):
    tasks: list = []
    run_id, result = _run(monkeypatch, tmp_path, tasks, fallback=_NODE_FALLBACK, fail_times=1)
    assert result["status"] == "completed", result
    assert tasks[0].llm_num_retries == 3
    assert _worst_case_to_switch_s(tasks[0]) < _real_settings().stall_fail_after_s
    assert len(_backup_events(run_id)) == 1
    assert len(_fallback_warnings(run_id)) == 1
