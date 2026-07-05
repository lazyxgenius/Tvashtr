"""P1.4b: per-run virtual key + the mid-loop budget cutoff — offline tests.

Zero LLM / zero agent / zero real proxy: the admin client (``mint_virtual_key``) is mocked,
spend is forced by inserting ``cost_records`` rows, and the over_budget routing is exercised
by a minimal probe workflow in the style of ``test_budget.py``. Stays openhands-free (imports
only the control-plane + engine-neutral contract), so ``test_registry`` purity is unaffected.
The adapter-level classification (``_is_budget_error`` + over_budget vs failed) lives in
``test_proxy_adapter_wiring.py``, which legitimately imports openhands.
"""

import sys
import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest
from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.config import Settings
from tvashtr.control_plane import team_run
from tvashtr.control_plane.team_run import (
    delete_vkey_step,
    finalize_run_step,
    mint_vkey_step,
    persist_agent_cost_step,
)
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult, AgentTask
from tvashtr.metering import record_agent_cost, running_cost
from tvashtr.models import Run

_ENABLED = dict(litellm_proxy_enabled=True, litellm_master_key="sk-master")


# ---- helpers (mirror test_budget.py) --------------------------------------


def _make_run(*, cap: Decimal | None = None, overridden: bool = False) -> str:
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="vkey probe",
                workflow_id=run_id,
                status="running",
                budget_cap_usd=cap,
                budget_overridden=overridden,
            )
        )
    return run_id


def _add_cost(run_id: str, amount: Decimal, key: str) -> None:
    record_agent_cost(
        workflow_id=run_id,
        idempotency_key=key,
        model="test/model",
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        cost_usd=float(amount),
    )


def _run_field(run_id: str, attr: str):
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        return getattr(run, attr) if run is not None else None


def _tasks(client, run_id: str) -> list[dict]:
    resp = client.get(f"/api/runs/{run_id}/tasks")
    assert resp.status_code == 200
    return resp.json()["tasks"]


def _settings(**over) -> Settings:
    return Settings(_env_file=None, **over)


# ---- mint_vkey_step: the remaining-budget logic + the two uncapped guards ----


def test_mint_vkey_proxy_off_returns_none_and_makes_no_admin_call(client):
    run_id = _make_run(cap=Decimal("1.00"))
    with (
        patch.object(team_run, "get_settings", return_value=_settings(litellm_proxy_enabled=False)),
        patch.object(team_run, "mint_virtual_key") as mint,
    ):
        assert mint_vkey_step(run_id) is None
        mint.assert_not_called()  # off -> the agent uses OPENROUTER_API_KEY, exactly as today


def test_mint_vkey_capped_run_uses_remaining_budget(client):
    # cap 0.50, PM already spent 0.10 -> the key's max_budget is the REMAINING 0.40.
    run_id = _make_run(cap=Decimal("0.50"))
    _add_cost(run_id, Decimal("0.10"), key=f"{run_id}:pm")
    with (
        patch.object(team_run, "get_settings", return_value=_settings(**_ENABLED)),
        patch.object(team_run, "mint_virtual_key", return_value={"key": "sk-run"}) as mint,
    ):
        assert mint_vkey_step(run_id) == "sk-run"
    mint.assert_called_once()
    kw = mint.call_args.kwargs
    assert kw["duration"] == "30m"
    assert abs(kw["max_budget"] - 0.40) < 1e-9


def test_mint_vkey_overridden_run_is_uncapped(client):
    # A human approved a P1.2 breach (continue to completion) -> no max_budget on the key.
    run_id = _make_run(cap=Decimal("0.50"), overridden=True)
    _add_cost(run_id, Decimal("0.10"), key=f"{run_id}:pm")
    with (
        patch.object(team_run, "get_settings", return_value=_settings(**_ENABLED)),
        patch.object(team_run, "mint_virtual_key", return_value={"key": "sk-run"}) as mint,
    ):
        mint_vkey_step(run_id)
    assert mint.call_args.kwargs["max_budget"] is None


def test_mint_vkey_no_cap_run_is_uncapped(client):
    run_id = _make_run(cap=None)
    with (
        patch.object(team_run, "get_settings", return_value=_settings(**_ENABLED)),
        patch.object(team_run, "mint_virtual_key", return_value={"key": "sk-run"}) as mint,
    ):
        mint_vkey_step(run_id)
    assert mint.call_args.kwargs["max_budget"] is None


def test_mint_vkey_fails_closed_when_proxy_returns_no_key(client):
    # Defense-in-depth: a 200 without "key" must NOT silently fall back to an uncapped run.
    run_id = _make_run(cap=Decimal("0.50"))
    with (
        patch.object(team_run, "get_settings", return_value=_settings(**_ENABLED)),
        patch.object(team_run, "mint_virtual_key", return_value={}),  # response carries no "key"
        pytest.raises(RuntimeError, match="refusing to run unbudgeted"),
    ):
        mint_vkey_step(run_id)


def test_mint_vkey_floor_when_remaining_is_zero(client):
    # spent == cap (not strictly over, so the pre-engineer gate passed) -> remaining 0 ->
    # the tiny floor keeps the key usable so the agent can at least start (cutoff lands DURING).
    run_id = _make_run(cap=Decimal("0.10"))
    _add_cost(run_id, Decimal("0.10"), key=f"{run_id}:pm")
    with (
        patch.object(team_run, "get_settings", return_value=_settings(**_ENABLED)),
        patch.object(team_run, "mint_virtual_key", return_value={"key": "sk-run"}) as mint,
    ):
        mint_vkey_step(run_id)
    assert mint.call_args.kwargs["max_budget"] > 0  # the floor, not 0/negative


# ---- delete_vkey_step: best-effort, None is a no-op ----


def test_delete_vkey_none_is_noop(client):
    with patch.object(team_run, "delete_virtual_key") as d:
        delete_vkey_step("run", None)
        d.assert_not_called()


def test_delete_vkey_calls_the_client(client):
    with patch.object(team_run, "delete_virtual_key") as d:
        delete_vkey_step("run", "sk-run")
        d.assert_called_once_with("sk-run")


# ---- the contract edits (additive, backward-compatible) ----


def test_agent_task_carries_llm_api_key():
    t = AgentTask(instruction="x", workspace_dir="/tmp/x", model="m", llm_api_key="sk-run")
    assert t.llm_api_key == "sk-run"
    assert AgentTask(instruction="x", workspace_dir="/tmp/x").llm_api_key is None  # default


def test_agent_run_result_over_budget_is_constructible():
    r = AgentRunResult(status="over_budget", summary="cut off", events=[], files_changed=[])
    assert r.status == "over_budget"


# ---- the over_budget routing: finalize over_budget, no ship, NO budget task ----


@DBOS.workflow()
def _over_budget_route_probe(total_tokens: int, cost_usd: float) -> dict:
    """Mirror run_team's over_budget block WITHOUT LLM/agent/proxy: an over_budget engineer
    result (carrying the given partial usage) -> best-effort partial-cost record IFF usage is
    present -> finalize_run_step('over_budget'), no ship. Mirrors the real branch (the persist
    guard + the finalize) so both arms of the partial-cost path are exercised."""
    run_id = DBOS.workflow_id
    engineer = {
        "status": "over_budget",
        "prompt_tokens": total_tokens,
        "completion_tokens": 0,
        "total_tokens": total_tokens,
        "cost_usd": cost_usd,
    }
    if engineer["total_tokens"] or engineer["cost_usd"]:
        # P1.8a: persist_agent_cost_step gained a node_id (the per-node cost key
        # {run_id}:agent-cost:{node_id}:{iteration}); M-ledger C5 gained an invocation_id. This bare
        # route probe passes stand-ins for both (no real node/invocation to reference here).
        persist_agent_cost_step(run_id, "node-probe", "test/model", engineer, 1, invocation_id=1)
    finalize_run_step(run_id, status="over_budget")
    return {"status": "over_budget"}


def test_over_budget_routing_finalizes_no_ship_no_budget_task(client):
    # usage 0 -> the best-effort partial-cost record is SKIPPED (no fabrication).
    run_id = _make_run(cap=Decimal("0.001"))
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(_over_budget_route_probe, 0, 0.0)

    assert handle.get_result() == {"status": "over_budget"}
    assert _run_field(run_id, "status") == "over_budget"
    # No ship: finalize_run_step("over_budget") never calls ship_step.
    assert _run_field(run_id, "ship_tag") is None
    assert _run_field(run_id, "ship_commit_sha") is None
    # THE distinguishing assertion vs P1.2's budget-demo: the mid-loop proxy cutoff created
    # NO budget_approval HumanTask (the between-steps gate never fired on this path).
    assert [t for t in _tasks(client, run_id) if t["kind"] == "budget_approval"] == []
    assert running_cost(run_id) == Decimal("0")  # nothing fabricated on the zero-usage arm


def test_over_budget_records_partial_spend_when_usage_present(client):
    # usage present -> the partial agent spend is recorded (idempotent) and totaled at finalize.
    run_id = _make_run(cap=Decimal("0.001"))
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(_over_budget_route_probe, 1234, 0.0009)

    assert handle.get_result() == {"status": "over_budget"}
    assert _run_field(run_id, "status") == "over_budget"
    assert abs(float(running_cost(run_id)) - 0.0009) < 1e-9  # partial spend recorded
    assert abs(float(_run_field(run_id, "cost_total_usd")) - 0.0009) < 1e-9  # totaled at finalize
    assert _run_field(run_id, "ship_tag") is None
    assert [t for t in _tasks(client, run_id) if t["kind"] == "budget_approval"] == []


# ---- boundary: the admin client imports neither litellm nor openhands ----


def test_litellm_admin_imports_no_litellm_or_openhands():
    for name in list(sys.modules):
        if name in ("litellm", "openhands") or name.startswith(("litellm.", "openhands.")):
            del sys.modules[name]
    sys.modules.pop("tvashtr.control_plane.litellm_admin", None)

    import tvashtr.control_plane.litellm_admin  # noqa: F401

    leaked = [
        m
        for m in sys.modules
        if m in ("litellm", "openhands") or m.startswith(("litellm.", "openhands."))
    ]
    assert leaked == [], f"litellm_admin must import neither litellm nor openhands: {leaked}"
