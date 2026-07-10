"""M-ledger C5 — invocation-scoped events + the durable cost link (offline: NO LLM/agent/openhands).

The headline reproduce-first regression (``test_run_events_kept_per_invocation``) drives the REAL
``run_team`` over the 3-node ``review_loop`` team with ``TVASHTR_FORCE_REVISIONS=1`` (so the worker
node runs iteration 1 AND 2). The agent step is stubbed by a fake that emits events through the REAL
``make_run_event_sink(run_id, invocation_id)`` — exactly as the adapter's ``on_event`` does — so the
sink's idempotency behaviour across two invocations is genuinely exercised. Each invocation restarts
``seq`` at 0; the ``(run_id, invocation_id, seq)`` idempotency key is what keeps the second round's
events instead of dropping them on the old ``(run_id, seq)`` collision.
"""

import uuid
from pathlib import Path

from conftest import auth_user_id, entry_report_result, maybe_write_entry_report
from dbos import DBOS, SetWorkflowID
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult, EngineEvent
from tvashtr.engines.run_event_sink import make_run_event_sink
from tvashtr.main import app
from tvashtr.metering import record_agent_cost
from tvashtr.models import AgentInvocation, CostRecord, Run, RunEvent

# A representative worker context manifest — the worker fake returns it so the invocation close
# persists a non-null ``agent_invocations.context_manifest`` (the /graph + /trajectory slot).
_WORKER_MANIFEST = {
    "parts": [{"name": "instruction", "tokens": 8}, {"name": "idea", "tokens": 4}],
    "total_tokens": 12,
    "budget": 110000,
    "handle_used": False,
}


def _make_review_loop_run() -> str:
    team_graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="build greeting.txt",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def _drive_forced_two_round_run(monkeypatch, tmp_path) -> str:
    """Drive a forced 2-round review_loop run; the worker fake emits events through the REAL sink
    (scoped to the executor-threaded ``invocation_id``) and writes the deliverable so the run ships.
    Returns the run_id."""
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    def _fake_engineer_setup_step(run_id):
        return str(workspace)

    def _fake_agent_run_step(
        run_id,
        node_prompt,
        model,
        iteration,
        idea,
        prd_text,
        workspace_dir,
        vkey,
        reviewer_feedback,
        emits_outcome,
        budget,
        invocation_id,
        edits_allowed=True,
        **kwargs,
    ):
        if not edits_allowed and not emits_outcome:
            return entry_report_result(idea)
        # The outcome-emitting (reviewer) node routes through the REAL forced harness (no events).
        if emits_outcome:
            return team_run._forced_review_outcome(iteration)
        # The worker (engineer) node: emit events through the REAL sink scoped to THIS invocation —
        # exactly what the adapter's on_event does. Each invocation restarts seq at 0, so the sink's
        # invocation-scoped idempotency is what keeps round 2's events.
        sink = make_run_event_sink(run_id, invocation_id)
        sink(EngineEvent(seq=0, kind="action", payload={"iteration": iteration, "tool": "editor"}))
        sink(EngineEvent(seq=1, kind="observation", payload={"iteration": iteration, "ok": True}))
        (Path(workspace_dir) / "greeting.txt").write_text(f"build {iteration}\n")
        return {
            "status": "completed",
            "outcome": None,
            "reasons": None,
            "files_changed": ["greeting.txt"],
            "context_manifest": _WORKER_MANIFEST,
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
            "cost_usd": 0.001,
        }

    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_engineer_setup_step)
    monkeypatch.setattr(team_run, "agent_run_step", _fake_agent_run_step)

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()
    assert result["status"] == "completed", f"forced run did not complete: {result}"
    return run_id


def test_run_events_kept_per_invocation(client, monkeypatch, tmp_path):
    """REPRODUCE-FIRST regression: a forced 2-round run's worker emits events on BOTH invocations;
    run_events must hold >=2 distinct invocation_ids for that ONE looped node. Pre-fix, the sink
    keyed idempotency on (run_id, seq): round 2's seq=0 collided with round 1 and was dropped,
    leaving a single invocation_id -> this assertion FAILS (the RED)."""
    run_id = _drive_forced_two_round_run(monkeypatch, tmp_path)

    with session_scope() as session:
        event_rows = session.execute(
            select(RunEvent.invocation_id, AgentInvocation.node_id, AgentInvocation.iteration)
            .join(AgentInvocation, RunEvent.invocation_id == AgentInvocation.id)
            .where(RunEvent.run_id == run_id)
        ).all()

    assert event_rows, "no run_events were recorded for the forced run"
    node_ids = {r.node_id for r in event_rows}
    distinct_inv_ids = {r.invocation_id for r in event_rows}
    iterations = {r.iteration for r in event_rows}
    assert len(node_ids) == 1, f"expected all events from one looped worker node, got {node_ids}"
    assert len(distinct_inv_ids) >= 2, (
        f"run_events holds only {len(distinct_inv_ids)} invocation(s) {distinct_inv_ids} for the "
        f"looped worker — a later round's events were dropped by the (run_id, seq) collision"
    )
    assert iterations == {1, 2}, f"expected events from iterations 1 AND 2, got {iterations}"


def test_agent_cost_rows_carry_invocation_id(client, monkeypatch, tmp_path):
    """The durable cost link end-to-end: every agent cost row the forced run wrote carries the
    invocation_id of the worker execution it belongs to (one per engineer iteration). Independent of
    the run_events fix — proves the executor threads inv_id into the metering path too."""
    run_id = _drive_forced_two_round_run(monkeypatch, tmp_path)

    with session_scope() as session:
        all_inv_ids = set(
            session.execute(
                select(AgentInvocation.id).where(AgentInvocation.run_id == run_id)
            ).scalars()
        )
        cost_rows = (
            session.execute(select(CostRecord).where(CostRecord.workflow_id == run_id))
            .scalars()
            .all()
        )

    assert cost_rows, "the forced run wrote no cost rows"
    for row in cost_rows:
        assert row.invocation_id is not None, f"cost row {row.idempotency_key} has no invocation_id"
        assert row.invocation_id in all_inv_ids, (
            f"cost row {row.idempotency_key} has invocation_id {row.invocation_id} not in the run"
        )
    linked = {row.invocation_id for row in cost_rows}
    assert len(linked) >= 2, f"expected agent cost linked to >=2 invocations, got {linked}"


def test_record_agent_cost_writes_invocation_id():
    """Unit: the metering helper persists the invocation link (NULL-safe default kept elsewhere)."""
    rid = f"test-{uuid.uuid4().hex}"
    record_agent_cost(
        workflow_id=rid,
        idempotency_key=f"{rid}:agent-cost:x",
        model="m",
        prompt_tokens=1,
        completion_tokens=2,
        total_tokens=3,
        cost_usd=0.01,
        invocation_id=4242,
    )
    with session_scope() as session:
        row = session.execute(select(CostRecord).where(CostRecord.workflow_id == rid)).scalar_one()
    assert row.invocation_id == 4242


# ---- Endpoint enrichment (M-ledger C5 wire contract) ----


def test_graph_endpoint_enriches_worker_invocations(client, monkeypatch, tmp_path):
    """/graph: each worker (agent) invocation gains ADDITIVE context_manifest + cost; the
    forced/zero-usage reviewer rounds carry null for both (no manifest, no linked cost row)."""
    run_id = _drive_forced_two_round_run(monkeypatch, tmp_path)
    body = client.get(f"/api/runs/{run_id}/graph").json()
    nodes = {n["role_name"]: n for n in body["nodes"]}

    eng_invs = nodes["engineer"]["invocations"]
    assert [i["iteration"] for i in eng_invs] == [1, 2]
    for inv in eng_invs:
        assert inv["context_manifest"] == _WORKER_MANIFEST
        assert inv["cost"] is not None
        assert set(inv["cost"]) == {
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
            "cost_usd",
        }
        assert inv["cost"]["total_tokens"] == 15
        assert inv["cost"]["cost_usd"] > 0
    # The forced reviewer wrote no manifest and no cost row -> both null.
    for inv in nodes["reviewer"]["invocations"]:
        assert inv["context_manifest"] is None
        assert inv["cost"] is None


def test_run_events_endpoint_carries_invocation_fields(client, monkeypatch, tmp_path):
    """/spike/run-events: each event ADDITIVELY carries invocation_id + node_id + iteration (joined
    off agent_invocations); existing seq/kind/payload/created_at unchanged."""
    run_id = _drive_forced_two_round_run(monkeypatch, tmp_path)
    events = client.get(f"/api/spike/run-events/{run_id}").json()["events"]

    assert events, "the endpoint surfaced no events"
    for ev in events:
        assert set(ev) == {
            "seq",
            "kind",
            "payload",
            "created_at",
            "invocation_id",
            "node_id",
            "iteration",
        }
        # every event here came from the worker fake, so all three joins resolve (non-legacy rows).
        assert ev["invocation_id"] is not None
        assert ev["node_id"] is not None
        assert ev["iteration"] in (1, 2)
    # The events span BOTH worker invocations (the collision fix) -> >=2 distinct invocation_ids.
    assert len({ev["invocation_id"] for ev in events}) >= 2


def test_trajectory_endpoint_ordered_rows_with_joins(client, monkeypatch, tmp_path):
    """/trajectory: one row per invocation, ordered by started_at ASC, each joining role/kind + the
    linked cost + the stored manifest; the run header carries {id, idea, status, cost_total_usd}."""
    run_id = _drive_forced_two_round_run(monkeypatch, tmp_path)
    body = client.get(f"/api/runs/{run_id}/trajectory").json()

    assert set(body["run"]) == {"id", "idea", "status", "cost_total_usd"}
    assert body["run"]["id"] == run_id
    assert body["run"]["status"] == "completed"

    rows = body["rows"]
    with session_scope() as session:
        inv_count = session.execute(
            select(func.count())
            .select_from(AgentInvocation)
            .where(AgentInvocation.run_id == run_id)
        ).scalar_one()
    assert len(rows) == inv_count, "trajectory must be one row per invocation"
    # Ordered by started_at ASC (the walk order) — pin the exact deterministic sequence, not just
    # monotonicity (started_at ties would make a bare sorted() check trivially true).
    starts = [r["started_at"] for r in rows]
    assert starts == sorted(starts)
    assert [(r["role_name"], r["iteration"]) for r in rows] == [
        ("pm", 1),
        ("prd_gate", 1),
        ("engineer", 1),
        ("reviewer", 1),
        ("engineer", 2),
        ("reviewer", 2),
        ("ship", 1),
    ]
    for r in rows:
        assert set(r) == {
            "invocation_id",
            "node_id",
            "role_name",
            "kind",
            "iteration",
            "status",
            "outcome",
            "outcome_detail",
            "context_manifest",
            "cost",
            "started_at",
            "ended_at",
        }
        assert r["kind"] in {"completion", "agent", "gate", "terminal"}
    # The worker (engineer) rows carry the joined manifest + cost.
    eng_rows = [r for r in rows if r["role_name"] == "engineer"]
    assert len(eng_rows) == 2
    for r in eng_rows:
        assert r["context_manifest"] == _WORKER_MANIFEST
        assert r["cost"] is not None and r["cost"]["total_tokens"] == 15


def test_trajectory_endpoint_is_owner_scoped(client):
    """/trajectory is owner-scoped: a DIFFERENT authenticated user gets 404 (existence not even
    probeable); the owner gets 200."""
    run_id = _make_review_loop_run()  # owned by the shared client's user
    other = TestClient(app)
    other.cookies.clear()
    reg = other.post(
        "/api/auth/register",
        json={"email": f"ledger-other-{uuid.uuid4().hex}@tvashtr.local", "password": "pw-123456"},
    )
    assert reg.status_code == 200, reg.text
    assert other.get(f"/api/runs/{run_id}/trajectory").status_code == 404
    assert client.get(f"/api/runs/{run_id}/trajectory").status_code == 200


class _EmittingAdapter:
    """Stub adapter that emits events through the executor-provided ``on_event`` — i.e. the REAL
    ``make_run_event_sink(run_id, invocation_id)`` hand-off inside ``agent_run_step`` — and writes a
    deliverable so the run ships. No LLM, no container."""

    name = "openhands-docker"

    def run(self, task, on_event=None):
        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        if on_event is not None:
            on_event(EngineEvent(seq=0, kind="action", payload={"stub": True}))
            on_event(EngineEvent(seq=1, kind="observation", payload={"stub": True}))
        (Path(task.workspace_dir) / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed",
            summary="ok",
            events=[],
            files_changed=["greeting.txt"],
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            cost_usd=0.001,
        )


def test_real_agent_run_step_scopes_events_to_invocation(client, monkeypatch, tmp_path):
    """Guard the PRODUCTION run_events hand-off: the REAL ``agent_run_step`` (NOT faked here)
    constructs ``make_run_event_sink(run_id, invocation_id)`` and hands it to the adapter. The stub
    adapter emits through it, so a regression dropping the invocation_id arg (back to
    ``make_run_event_sink(run_id)``) reintroduces the (run_id, seq) collision and this goes RED."""
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    # Fake ONLY the LLM / workspace-setup seams; agent_run_step itself runs for real so its
    # make_run_event_sink(run_id, invocation_id) construction is exercised end-to-end.
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(workspace))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _EmittingAdapter())

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    assert handle.get_result()["status"] == "completed"

    with session_scope() as session:
        event_inv_ids = set(
            session.execute(
                select(RunEvent.invocation_id)
                .join(AgentInvocation, RunEvent.invocation_id == AgentInvocation.id)
                .where(RunEvent.run_id == run_id)
            ).scalars()
        )
    assert len(event_inv_ids) >= 2, (
        f"the real agent_run_step sink hand-off did not invocation-scope events: {event_inv_ids}"
    )


def test_run_events_endpoint_surfaces_legacy_null_invocation(client):
    """A legacy pre-0020 event (invocation_id NULL) must STILL surface via /spike/run-events (the
    LEFT outer join) with invocation_id/node_id/iteration all null + seq/kind/payload/created_at
    intact. Guards against an outerjoin->join regression that would silently drop legacy events."""
    run_id = f"test-{uuid.uuid4().hex}"
    with session_scope() as session:
        session.add(
            RunEvent(run_id=run_id, invocation_id=None, seq=0, kind="message", payload={"t": "old"})
        )
    events = client.get(f"/api/spike/run-events/{run_id}").json()["events"]
    assert len(events) == 1
    ev = events[0]
    assert ev["seq"] == 0 and ev["kind"] == "message" and ev["payload"] == {"t": "old"}
    assert ev["created_at"]
    assert ev["invocation_id"] is None
    assert ev["node_id"] is None
    assert ev["iteration"] is None
