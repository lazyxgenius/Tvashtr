"""M-h2b: Fly durability + economics — suspend-on-gate, the orphan reaper, and the durable handle.

The milestone in one sentence: **a hosted run must survive the backend process dying while parked at
a human gate.** These tests prove the three mechanisms that make that true, entirely offline.

⚠️ THE HARD RULE (inherited from ``test_fly_machines.py``): no test here may reach the real Fly API
or spend a cent. The Makefile does ``include .env`` + ``export``, so the operator's live
``TVASHTR_FLY_API_TOKEN`` is ambient in every ``make test`` process. Every Fly client here is either
a ``MagicMock`` or an ``httpx.MockTransport``; no socket is ever opened.

The suspend-step tests are deliberately NOT mock-only: they run the real ``apply_budget_hook``
against a real DBOS workflow, a real Postgres and a real blocking gate (the shape
``test_budget.py`` established), because the claim being made — "a docker run's recorded step
sequence is byte-identical to before this milestone" — is precisely the kind of thing a mock would
happily confirm while the real walk did something else.
"""

import time
import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

import httpx
import pytest
from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from pydantic import SecretStr
from sqlalchemy import select

from tvashtr.control_plane import fly_reaper
from tvashtr.control_plane.team_run import apply_budget_hook, suspend_fly_machine_step
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines import openhands_fly_adapter as mod
from tvashtr.engines import sandbox_cache
from tvashtr.engines.fly_machines import FlyApiError, FlyMachineInfo, derive_session_key
from tvashtr.metering import record_agent_cost
from tvashtr.models import Run

RUN_ID = "aa9d8a2b-d54d-49e2-9cc0-ab20b60a1098"
APP = f"tv-run-{RUN_ID}"


@pytest.fixture(autouse=True)
def _clean_caches():
    mod._RUNS.clear()
    sandbox_cache.clear()
    yield
    mod._RUNS.clear()
    sandbox_cache.clear()


# =============================================================================================
# Piece 3 — the durable handle: reconstruct across a backend restart, never re-create
# =============================================================================================


def _reconstructable_fly(state: str = "suspended") -> MagicMock:
    """A Fly client that reports an EXISTING machine for the run — i.e. the world as a freshly
    restarted backend finds it: the process died, the app did not."""
    fly = MagicMock()
    fly.get_run_machine.return_value = FlyMachineInfo(
        machine_id="m-survivor", state=state, private_ip="fdaa:9e:cf46:a7b:513:5988:b76c:2"
    )
    return fly


def test_reconstructs_the_handle_instead_of_creating_a_second_app():
    """THE M-h2b headline. ``_RUNS`` is empty (a fresh process) but the app is alive on Fly.

    Creating a new app here would be the catastrophic failure mode, and a quiet one: ``create_app``
    would 409 against the existing name, and any code that "helpfully" worked around that would
    abandon a still-billing machine and re-clone the repo from scratch, losing the run's work."""
    fly = _reconstructable_fly(state="started")
    with patch.object(mod, "FlyMachines", return_value=fly):
        sandbox, is_new = mod._ensure_run_sandbox(RUN_ID)

    assert is_new is True  # newly entered into THIS process's registry
    assert sandbox.machine.app_name == APP
    assert sandbox.machine.machine_id == "m-survivor"
    fly.start_run_sandbox.assert_not_called()  # no boot
    fly.create_app.assert_not_called()  # and emphatically no second app
    assert mod._RUNS[RUN_ID] is sandbox


def test_reconstruction_re_derives_the_key_without_reading_it_from_anywhere():
    """The key is a pure function of (run_id, secret), so the restarted process re-cuts the byte-
    identical credential having stored nothing. This is what lets Piece 3 be storage-free."""
    fly = _reconstructable_fly(state="started")
    with patch.object(mod, "FlyMachines", return_value=fly):
        sandbox, _ = mod._ensure_run_sandbox(RUN_ID)

    from tvashtr.config import get_settings

    assert sandbox.session_api_key == derive_session_key(
        RUN_ID, get_settings().fly_session_secret.get_secret_value()
    )


def test_reconstruction_resumes_a_suspended_machine():
    """The machine was parked at a gate. Waking it is the other half of "approve at 8am and it just
    continues" — and ``wait_healthy`` is required, not optional: a just-resumed machine still thinks
    its old connections are live, so the first calls across Flycast can reset."""
    fly = _reconstructable_fly(state="suspended")
    with patch.object(mod, "FlyMachines", return_value=fly):
        sandbox, _ = mod._ensure_run_sandbox(RUN_ID)

    fly.start_machine.assert_called_once_with(APP, "m-survivor")
    fly.wait_healthy.assert_called_once()
    assert sandbox.suspended is False


def test_reconstruction_does_not_start_a_machine_that_is_already_running():
    """A crash that happened mid-node (not at a gate) leaves a RUNNING machine. Starting it again
    would be a pointless API call at best."""
    fly = _reconstructable_fly(state="started")
    with patch.object(mod, "FlyMachines", return_value=fly):
        mod._ensure_run_sandbox(RUN_ID)

    fly.start_machine.assert_not_called()


def test_the_reconstructed_handle_has_no_node_conversations():
    """Conversation ids are deliberately NOT persisted (agent-native resume is a separate bet). The
    empty nodes dict is what makes the next node a MISS: it opens a fresh conversation and re-seeds
    from the HOST workspace, which survived on disk.

    That is also what makes the path snapshot-agnostic — identical whether Fly restored the memory
    snapshot or silently cold-booted — so correctness never rests on guest RAM."""
    fly = _reconstructable_fly()
    with patch.object(mod, "FlyMachines", return_value=fly):
        sandbox, _ = mod._ensure_run_sandbox(RUN_ID)

    assert sandbox.nodes == {}


def test_a_genuinely_new_run_still_boots_fresh():
    """The reconstruct arm must not swallow the ordinary case: no app on Fly ⇒ boot one."""
    fly = MagicMock()
    fly.get_run_machine.return_value = None
    fly.app_exists.return_value = False
    with (
        patch.object(mod, "FlyMachines", return_value=fly),
        patch.object(mod, "_resolve_owner_id", return_value="owner-1"),
    ):
        _, is_new = mod._ensure_run_sandbox(RUN_ID)

    assert is_new is True
    fly.start_run_sandbox.assert_called_once()


def test_an_app_with_no_machine_is_cleared_before_a_fresh_boot():
    """A crash BETWEEN ``create_app`` and ``create_machine`` leaves a husk. Left alone it would make
    ``create_app`` 409 forever and wedge the run permanently — a narrow window, but an unrecoverable
    one, so the boot path clears it."""
    fly = MagicMock()
    fly.get_run_machine.return_value = None  # app exists, but carries no machine
    fly.app_exists.return_value = True
    with (
        patch.object(mod, "FlyMachines", return_value=fly),
        patch.object(mod, "_resolve_owner_id", return_value="owner-1"),
    ):
        mod._ensure_run_sandbox(RUN_ID)

    fly.delete_app.assert_called_once_with(APP)
    fly.start_run_sandbox.assert_called_once()


def test_an_in_process_hit_resumes_before_handing_the_sandbox_back():
    """The lazy-resume seam: the node after a gate gets a WOKEN machine without knowing a gate ever
    happened."""
    fly = MagicMock()
    machine = MagicMock(app_name=APP, machine_id="m1", flycast_host=f"http://{APP}.flycast:8000")
    sandbox = mod._FlyRunSandbox(fly, machine, "k", suspended=True)
    mod._RUNS[RUN_ID] = sandbox

    got, is_new = mod._ensure_run_sandbox(RUN_ID)

    assert got is sandbox
    assert is_new is False
    fly.start_machine.assert_called_once_with(APP, "m1")
    assert sandbox.suspended is False


# =============================================================================================
# Piece 1 — suspend the machine while a run waits at a gate
# =============================================================================================


def test_suspend_run_machine_suspends_the_in_process_handle():
    fly = MagicMock()
    machine = MagicMock(app_name=APP, machine_id="m1")
    mod._RUNS[RUN_ID] = mod._FlyRunSandbox(fly, machine, "k")

    assert mod.suspend_run_machine(RUN_ID) is True
    fly.suspend_machine.assert_called_once_with(APP, "m1")
    assert mod._RUNS[RUN_ID].suspended is True


def test_suspend_never_raises_when_fly_refuses():
    """Suspending is an ECONOMY measure. The cost of failure is that we keep paying for a machine we
    were already paying for — strictly no worse than today — so it must never fail a run."""
    fly = MagicMock()
    fly.suspend_machine.side_effect = FlyApiError("fly suspend_machine failed: HTTP 500")
    machine = MagicMock(app_name=APP, machine_id="m1")
    mod._RUNS[RUN_ID] = mod._FlyRunSandbox(fly, machine, "k")

    assert mod.suspend_run_machine(RUN_ID) is False  # no exception escapes
    assert mod._RUNS[RUN_ID].suspended is False


def test_suspend_works_without_an_in_process_handle():
    """The backend restarted between the agent node and the gate, so ``_RUNS`` is empty — but the
    machine is still burning money and we still want it parked. Reached WITHOUT going through
    ``_ensure_run_sandbox``, because that path resumes a suspended machine and resuming one purely
    in order to suspend it again would be perverse."""
    fly = MagicMock()
    fly.get_run_machine.return_value = FlyMachineInfo("m-x", "started", "fdaa::1")
    with patch.object(mod, "FlyMachines", return_value=fly):
        assert mod.suspend_run_machine(RUN_ID) is True

    fly.suspend_machine.assert_called_once_with(APP, "m-x")
    fly.start_machine.assert_not_called()  # never wake it just to park it


def test_a_handle_free_suspend_is_a_no_op_when_already_suspended():
    fly = MagicMock()
    fly.get_run_machine.return_value = FlyMachineInfo("m-x", "suspended", "fdaa::1")
    with patch.object(mod, "FlyMachines", return_value=fly):
        assert mod.suspend_run_machine(RUN_ID) is False
    fly.suspend_machine.assert_not_called()


def test_teardown_works_on_a_suspended_machine():
    """If a terminal (ship/stop) follows the gate instead of another node, the suspended machine is
    simply deleted — ``DELETE /v1/apps`` is total regardless of machine state, so nothing has to be
    woken up just to be destroyed."""
    fly = MagicMock()
    machine = MagicMock(app_name=APP, machine_id="m1")
    mod._RUNS[RUN_ID] = mod._FlyRunSandbox(fly, machine, "k", suspended=True)

    mod.close_run_machine(RUN_ID)

    fly.delete_app.assert_called_once_with(APP)
    fly.start_machine.assert_not_called()


def test_the_suspend_step_is_a_recorded_dbos_step():
    """Replay-safety comes from being a recorded step: on a crash-replay DBOS returns the
    checkpointed output instead of re-executing, so a resumed workflow never re-suspends — which
    matters because the in-process handle it would have needed died with the old process."""
    assert hasattr(suspend_fly_machine_step, "dbos_function_name")


def test_the_suspend_step_swallows_an_adapter_failure():
    with patch(
        "tvashtr.engines.openhands_fly_adapter.suspend_run_machine",
        side_effect=RuntimeError("fly is down"),
    ):
        assert suspend_fly_machine_step(RUN_ID) is False  # never raises into the walk


# ---- the gating, proven against a REAL workflow + a REAL blocking gate ----


@DBOS.workflow()
def _budget_gate_probe(node_id: str) -> dict:
    """``test_budget.py``'s probe shape: exercise the real ``apply_budget_hook`` — the breach path
    that opens a blocking budget gate — with zero LLM and zero agent."""
    run_id = DBOS.workflow_id
    rejected = apply_budget_hook(run_id, node_id=node_id, iteration=1)
    return {"status": "over_budget" if rejected else "continued"}


def _make_over_budget_run() -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=auth_user_id(),
                idea="m-h2b suspend gating probe",
                workflow_id=run_id,
                status="running",
                budget_cap_usd=Decimal("0.001"),
            )
        )
    record_agent_cost(
        workflow_id=run_id,
        idempotency_key=f"{run_id}:agent",
        model="test/model",
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        cost_usd=0.01,
    )
    return run_id


def _wait_until(predicate, *, timeout: float = 10.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError("condition not met within timeout")


def _run_status(run_id: str):
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        return run.status if run is not None else None


def _drive_gate_to_a_verdict(client, run_id: str, sandbox_mode: str) -> MagicMock:
    """Run the probe under ``sandbox_mode`` with a spy on the suspend step, park it at the real
    budget gate, then resolve it. Returns the spy."""
    from tvashtr.control_plane import team_run as tr

    spy = MagicMock(return_value=True)
    fake_settings = MagicMock(agent_sandbox_mode=sandbox_mode)
    with (
        patch.object(tr, "suspend_fly_machine_step", spy),
        patch.object(tr, "get_settings", return_value=fake_settings),
    ):
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(_budget_gate_probe, "pre-ship")
        _wait_until(lambda: _run_status(run_id) == "awaiting_human")
        tasks = client.get(f"/api/runs/{run_id}/tasks").json()["tasks"]
        pending = [t for t in tasks if t["status"] == "pending" and t["kind"] == "budget_approval"]
        assert len(pending) == 1, f"expected one pending budget task, got {pending}"
        resp = client.post(
            f"/api/runs/{run_id}/tasks/{pending[0]['id']}/resolve", json={"decision": "reject"}
        )
        assert resp.status_code == 200
        handle.get_result()
    return spy


def test_a_fly_run_suspends_before_blocking_on_the_budget_gate(client):
    """The real walk, in fly mode: the machine is parked BEFORE the run blocks on the human."""
    run_id = _make_over_budget_run()
    spy = _drive_gate_to_a_verdict(client, run_id, "fly")
    spy.assert_called_once_with(run_id)


def test_a_docker_run_never_calls_the_suspend_step(client):
    """The invariant that keeps this milestone safe for the proven docker path: the step is ABSENT
    from a docker walk — not called-and-no-opped, absent — so a docker run's recorded DBOS step
    sequence is byte-identical to before M-h2b."""
    run_id = _make_over_budget_run()
    spy = _drive_gate_to_a_verdict(client, run_id, "docker")
    spy.assert_not_called()


# =============================================================================================
# Piece 2 — the orphan reaper
# =============================================================================================


def _reaper_fly(app_names: list[str]) -> MagicMock:
    fly = MagicMock()
    fly.list_apps.return_value = app_names
    return fly


def _sweep_with(app_names: list[str], live_ids: set[str]) -> MagicMock:
    """Run the sweep against a scripted app list + a scripted liveness answer. Returns the fake Fly
    so the caller can assert exactly what was (and was not) deleted."""
    fly = _reaper_fly(app_names)
    settings = MagicMock(
        agent_sandbox_mode="fly",
        # SecretStr, matching the real Settings field — the reaper unwraps it, so a bare str here
        # would make this fake diverge from the object it stands in for.
        fly_api_token=SecretStr("fake-token"),
        fly_org="personal",
        fly_region="bom",
        fly_agent_image="img",
    )
    with (
        patch.object(fly_reaper, "FlyMachines", return_value=fly),
        patch.object(fly_reaper, "get_settings", return_value=settings),
        patch.object(fly_reaper, "_live_run_ids", return_value=live_ids),
    ):
        fly_reaper.sweep_orphaned_fly_apps()
    return fly


def test_the_reaper_never_touches_an_app_that_is_not_ours():
    """THE unrecoverable mistake this guards against. ``cryptoground-data`` is the operator's real,
    unrelated app; deleting it would be catastrophic and unbilled-for. Asserted BY NAME, with the
    orphan and the live run present in the same list so the filter is doing real work."""
    fly = _sweep_with(
        ["cryptoground-data", "tv-run-terminal-x", "tv-run-live-y"],
        live_ids={"live-y"},
    )
    deleted = [c.args[0] for c in fly.delete_app.call_args_list]
    assert deleted == ["tv-run-terminal-x"]
    assert "cryptoground-data" not in deleted


def test_the_reaper_spares_a_run_parked_at_a_gate():
    """``awaiting_human`` is the load-bearing spare: that is a run legitimately parked (and
    SUSPENDED) at an approval gate, possibly overnight. Reaping it would destroy exactly the
    durability M-h2b exists to provide — the reaper and suspend-on-gate would cancel out."""
    fly = _sweep_with(["tv-run-parked"], live_ids={"parked"})
    fly.delete_app.assert_not_called()


def test_the_reaper_reaps_an_app_whose_run_is_gone():
    """No Run row at all — a deleted run, or an app that never had one. Nothing will ever come back
    for it, so it would bill forever."""
    fly = _sweep_with(["tv-run-ghost"], live_ids=set())
    fly.delete_app.assert_called_once_with("tv-run-ghost")


def test_one_stubborn_app_does_not_abort_the_rest_of_the_sweep():
    fly = _reaper_fly(["tv-run-a", "tv-run-b"])
    fly.delete_app.side_effect = [FlyApiError("HTTP 500"), None]
    settings = MagicMock(
        agent_sandbox_mode="fly",
        # SecretStr, matching the real Settings field — the reaper unwraps it, so a bare str here
        # would make this fake diverge from the object it stands in for.
        fly_api_token=SecretStr("fake-token"),
        fly_org="personal",
        fly_region="bom",
        fly_agent_image="img",
    )
    with (
        patch.object(fly_reaper, "FlyMachines", return_value=fly),
        patch.object(fly_reaper, "get_settings", return_value=settings),
        patch.object(fly_reaper, "_live_run_ids", return_value=set()),
    ):
        fly_reaper.sweep_orphaned_fly_apps()

    assert fly.delete_app.call_count == 2  # the failure did not stop the sweep


def test_the_sweep_never_raises_when_the_fly_api_is_down():
    """Called from FastAPI startup BEFORE DBOS recovery — an exception here would take the whole
    backend down over a cost optimization."""
    settings = MagicMock(
        agent_sandbox_mode="fly",
        # SecretStr, matching the real Settings field — the reaper unwraps it, so a bare str here
        # would make this fake diverge from the object it stands in for.
        fly_api_token=SecretStr("fake-token"),
        fly_org="personal",
        fly_region="bom",
        fly_agent_image="img",
    )
    fly = MagicMock()
    fly.list_apps.side_effect = FlyApiError("fly list_apps failed: HTTP 503")
    with (
        patch.object(fly_reaper, "FlyMachines", return_value=fly),
        patch.object(fly_reaper, "get_settings", return_value=settings),
    ):
        assert fly_reaper.sweep_orphaned_fly_apps() == 0  # no exception


def test_the_sweep_is_inert_outside_fly_mode():
    """docker/local installs must not pay a Fly API call — or arm a reaper — for a feature they do
    not use."""
    with patch.object(
        fly_reaper, "get_settings", return_value=MagicMock(agent_sandbox_mode="docker")
    ):
        assert fly_reaper.sweep_orphaned_fly_apps() == 0


def test_the_sweep_is_inert_without_a_token():
    with patch.object(
        fly_reaper,
        "get_settings",
        # An EMPTY SecretStr — the unconfigured install, which must still skip the sweep.
        return_value=MagicMock(agent_sandbox_mode="fly", fly_api_token=SecretStr("")),
    ):
        assert fly_reaper.sweep_orphaned_fly_apps() == 0


def test_liveness_is_read_from_the_runs_table(client):
    """The real DB query behind the keep/reap decision — Fly apps are cross-process and cross-host
    durable, so the database is the only thing that knows whether a run is still alive."""
    live_id = str(uuid.uuid4())
    terminal_id = str(uuid.uuid4())
    team_graph_id = uuid.UUID(build_two_node_team())
    with session_scope() as session:
        for rid, status in ((live_id, "awaiting_human"), (terminal_id, "completed")):
            session.add(
                Run(
                    id=uuid.UUID(rid),
                    team_graph_id=team_graph_id,
                    owner_id=auth_user_id(),
                    idea="m-h2b reaper liveness",
                    workflow_id=rid,
                    status=status,
                )
            )

    live = fly_reaper._live_run_ids([live_id, terminal_id, str(uuid.uuid4())])

    assert live == {live_id}, "only the parked run is alive; terminal and absent are reapable"


def test_a_non_uuid_app_name_reads_as_absent_and_is_reapable():
    """A stray app named after something that was never a run cannot match a Run row, so it must not
    crash the sweep — it is simply an orphan."""
    assert fly_reaper._live_run_ids(["not-a-uuid", ""]) == set()


def test_the_periodic_sweeper_is_not_registered_outside_fly_mode():
    """Registration is gated on the DECORATOR, not just the body — and this is load-bearing.

    ``DBOS.scheduled`` registers a poller at import that ``DBOS.launch()`` starts as a thread, and
    ``make test`` launches DBOS (conftest's session-scoped ``with TestClient(app)``). Registering
    unconditionally would arm a real 10-minute cron inside the offline suite, enqueueing genuine
    workflow rows into the shared system database whenever a session happened to span a ``*/10``
    boundary — flaky by wall-clock. The default sandbox mode is docker, so nothing is armed here."""
    from tvashtr.config import get_settings

    if get_settings().agent_sandbox_mode != "fly":
        assert not hasattr(fly_reaper, "periodic_fly_sweep")


def test_the_periodic_sweep_body_delegates_to_the_same_sweep():
    """One reap implementation, two cadences (boot sweep + periodic) — defense in depth without two
    behaviours to keep in sync."""
    from datetime import datetime

    with patch.object(fly_reaper, "sweep_orphaned_fly_apps", return_value=0) as swept:
        fly_reaper._periodic_fly_sweep(datetime.now(), datetime.now())
    swept.assert_called_once()


# =============================================================================================
# C8 — the per-run key is never persisted, logged, or serialized
# =============================================================================================


def test_the_derived_key_is_never_written_to_the_run_row(client):
    """A derivation exists precisely so the key never has to be stored. Assert the negative."""
    run_id = _make_over_budget_run()
    from tvashtr.config import get_settings

    key = derive_session_key(run_id, get_settings().fly_session_secret.get_secret_value())
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        serialized = repr({c.name: getattr(run, c.name) for c in Run.__table__.columns})
    assert key not in serialized


def test_the_key_is_not_carried_on_the_machine_object():
    """``FlyRunMachine`` gets logged; ``FlyMachineInfo`` is read back off the API. Neither may ever
    carry the credential."""
    info = FlyMachineInfo("m1", "suspended", "fdaa::1")
    assert "session" not in repr(info).lower()
    fly = _reconstructable_fly()
    with patch.object(mod, "FlyMachines", return_value=fly):
        sandbox, _ = mod._ensure_run_sandbox(RUN_ID)
    assert sandbox.session_api_key not in repr(sandbox.machine)


def test_the_suspend_path_never_logs_the_key(caplog):
    fly = MagicMock()
    machine = MagicMock(app_name=APP, machine_id="m1")
    secret_key = "super-secret-per-run-key"
    mod._RUNS[RUN_ID] = mod._FlyRunSandbox(fly, machine, secret_key)

    with caplog.at_level("DEBUG"):
        mod.suspend_run_machine(RUN_ID)

    assert secret_key not in caplog.text


def test_the_fly_client_never_opens_a_socket_in_this_module():
    """Belt-and-braces on the money rule: a real ``httpx.MockTransport`` proves the wire calls the
    suspend path makes are the ones we think, with a fake token that could not authenticate."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(f"{request.method} {request.url.path}")
        return httpx.Response(200, json={"ok": True})

    from tvashtr.engines.fly_machines import FlyMachines

    fly = FlyMachines(
        token="fly-test-token-NOT-REAL",
        image="img",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    fly.suspend_machine(APP, "m1")
    fly.start_machine(APP, "m1")
    assert seen == [
        f"POST /v1/apps/{APP}/machines/m1/suspend",
        f"POST /v1/apps/{APP}/machines/m1/start",
    ]
