"""M11 (ruling R13) — the failure path: an edge "If it fails or times out" out of an agent.

Offline (no LLM, no openhands): the REAL ``run_team`` walks a review-loop team with the step fakes
``test_resume_walk`` uses; the Engineer fails through the existing ``_forced_failure`` harness
(``TVASHTR_FORCE_FAIL_ROLE`` / ``_ROUND``). With a failure path the walk continues at its target (a
gate that waits for a person, then Stop or Ship as the path ends); without one the run fails exactly
as before. Plus: ordinary routing never follows a failure edge, the validity rules, and the Activity
line."""

import time
import uuid
from pathlib import Path

import pytest
from conftest import auth_user_id, entry_report_result
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane import graph_validity, live_state, run_failure, team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import (
    build_full_squad_team,
    build_plan_review_team,
    build_review_loop_team,
    build_thinker_chain_team,
)
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, Edge, HumanTask, Run

IDEA = "Add an RSI indicator"


# ------------------------------------------------------------------------------------ routing


def _e(source, target, edge_type="work", conditions=None):
    return {"source": source, "target": target, "edge_type": edge_type, "conditions": conditions}


def test_next_node_never_follows_a_failure_edge():
    edges = [_e("eng", "ask", "failure"), _e("eng", "rev", "review")]
    assert team_run.next_node(edges, "eng", None) == "rev"
    assert team_run.next_node(edges, "eng", "approved") == "rev"
    # An agent whose only way out is its failure path has no ordinary route.
    assert team_run.next_node([_e("eng", "ask", "failure")], "eng", None) is None


def test_failure_target_is_the_failure_edge_only():
    edges = [_e("eng", "rev"), _e("eng", "esc", "escalation"), _e("eng", "ask", "failure")]
    assert team_run.failure_target(edges, "eng") == "ask"
    assert team_run.failure_target(edges, "rev") is None
    assert team_run.escalation_target(edges, "eng") == "esc"  # unchanged


def test_a_pre_m11_recorded_graph_routes_exactly_as_before(client):
    """Replay safety: a graph recorded before M11 has no failure edge, so every routing answer the
    walk reads (ordinary, escalation, failure) is what it was — no route gains or loses a target."""
    for build in (
        build_review_loop_team,
        build_thinker_chain_team,
        build_plan_review_team,
        build_full_squad_team,
    ):
        graph_id = build()
        with session_scope() as session:
            edges = [
                _e(str(e.source_node_id), str(e.target_node_id), e.edge_type, e.conditions)
                for e in session.execute(
                    select(Edge).where(Edge.team_graph_id == uuid.UUID(graph_id))
                ).scalars()
            ]
        for source in {e["source"] for e in edges}:
            assert team_run.failure_target(edges, source) is None
            for outcome in (None, "approved", "rejected", "changes_requested"):
                outs = [
                    e for e in edges if e["source"] == source and e["edge_type"] != "escalation"
                ]
                expected = next(
                    (
                        e["target"]
                        for e in outs
                        if outcome is not None and (e["conditions"] or {}).get("when") == outcome
                    ),
                    next(
                        (
                            e["target"]
                            for e in outs
                            if e["conditions"] is None or "when" not in e["conditions"]
                        ),
                        None,
                    ),
                )
                assert team_run.next_node(edges, source, outcome) == expected


# ----------------------------------------------------------------------------------- validity


def _n(nid, kind, **config):
    return {"id": nid, "kind": kind, "config": config or None}


def _ce(eid, source, target, edge_type="work", conditions=None):
    return {
        "id": eid,
        "source_node_id": source,
        "target_node_id": target,
        "edge_type": edge_type,
        "conditions": conditions,
    }


_NODES = [
    _n("pm", "completion"),
    _n("eng", "agent"),
    _n("ask", "gate", gate_kind="gate_approval"),
    _n("ship", "terminal", terminal_kind="ship"),
    _n("stop", "terminal", terminal_kind="stop"),
]
_BASE = [
    _ce("e1", "pm", "eng"),
    _ce("e2", "eng", "ship"),
    _ce("e3", "ask", "eng", conditions={"when": "approved"}),
    _ce("e4", "ask", "stop", conditions={"when": "rejected"}),
]


def _codes(edges, nodes=_NODES):
    return {f["code"] for f in graph_validity.validate_graph(nodes, edges)["errors"]}


def test_a_failure_path_with_a_retry_gate_is_runnable():
    """Engineer → (fails) → Ask me what to do → retry (back to the Engineer) or Stop. The retry
    loop is bounded by the Engineer's loop limit, so it is not an unbounded loop."""
    verdict = graph_validity.validate_graph(_NODES, [*_BASE, _ce("f", "eng", "ask", "failure")])
    assert verdict["runnable"], verdict["errors"]
    assert not verdict["warnings"]  # the gate is reached (through the failure path): no orphan


def test_a_failure_path_only_out_of_an_agent():
    for source in ("ask", "ship", "stop"):
        assert "failure_not_agent" in _codes([*_BASE, _ce("f", source, "stop", "failure")])
    nodes = [*_NODES, _n("dq", "domain_query", domain_id="d")]
    edges = [
        *_BASE,
        _ce("q1", "eng", "dq"),
        _ce("q2", "dq", "ship"),
        _ce("f", "dq", "stop", "failure"),
    ]
    assert "failure_not_agent" in _codes(edges, nodes)
    # The thinker is an agent too.
    assert "failure_not_agent" not in _codes([*_BASE, _ce("f", "pm", "stop", "failure")])


def test_one_failure_path_per_agent():
    edges = [*_BASE, _ce("f1", "eng", "ask", "failure"), _ce("f2", "eng", "stop", "failure")]
    assert "failure_twice" in _codes(edges)


def test_a_failure_path_must_reach_an_ending():
    # The failure path leads into a loop that never ends.
    nodes = [*_NODES, _n("lost", "agent"), _n("void", "agent")]
    edges = [
        *_BASE,
        _ce("f", "eng", "lost", "failure"),
        _ce("l1", "lost", "void"),
        _ce("l2", "void", "lost"),
    ]
    assert "failure_dead_end" in _codes(edges, nodes)


def test_a_failure_path_counts_as_a_route_to_an_ending():
    """Agents whose only way to an ending is the failure path still reach one (no dead end)."""
    nodes = [
        _n("pm", "completion"),
        _n("x", "agent"),
        _n("y", "agent"),
        _n("stop", "terminal", terminal_kind="stop"),
    ]
    edges = [_ce("e1", "pm", "x"), _ce("e2", "x", "y"), _ce("e3", "y", "x")]

    def dead_ends(edges):
        findings = graph_validity.validate_graph(nodes, edges)["errors"]
        return {f["node_id"] for f in findings if f["code"] == "dead_end"}

    assert dead_ends(edges) == {"pm", "x", "y"}
    assert dead_ends([*edges, _ce("f", "x", "stop", "failure")]) == set()


def test_the_pipeline_strip_ignores_failure_paths():
    nodes = [*_NODES]
    for n in nodes:
        n.setdefault("role_name", n["id"])
    edges = [*_BASE, _ce("f", "eng", "ask", "failure")]
    shape = graph_validity.team_shape(nodes, edges)
    assert [n["id"] for n in shape["nodes"]] == ["pm", "eng", "ship"]


# ------------------------------------------------------------------------------- the walk


def _team(*, failure_to: str | None, drop_escalation: bool = False) -> str:
    """The review-loop team and — when ``failure_to`` names a role — the Engineer's failure path to
    it; ``"ask_gate"`` adds an "Ask me what to do" gate (approve = retry the Engineer, reject =
    Stop). ``drop_escalation`` removes the escalation gate (and so the Engineer's cap exit)."""
    graph_id = uuid.UUID(build_review_loop_team())
    with session_scope() as session:
        by_role = {
            n.role_name: n
            for n in session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == graph_id)
            ).scalars()
        }
        eng = by_role["engineer"].id
        if failure_to == "ask_gate":
            ask = AgentNode(
                team_graph_id=graph_id,
                role_name="ask_gate",
                kind="gate",
                position={"x": 520, "y": 360},
                config={
                    "gate_kind": "gate_approval",
                    "title": "Ask me what to do",
                    "description": "Retry the Engineer or stop the run",
                },
            )
            session.add(ask)
            session.flush()
            by_role["ask_gate"] = ask
            session.add_all(
                [
                    Edge(
                        team_graph_id=graph_id,
                        source_node_id=ask.id,
                        target_node_id=eng,
                        edge_type="work",
                        conditions={"when": "approved"},
                    ),
                    Edge(
                        team_graph_id=graph_id,
                        source_node_id=ask.id,
                        target_node_id=by_role["stop"].id,
                        edge_type="work",
                        conditions={"when": "rejected"},
                    ),
                ]
            )
        if failure_to is not None:
            session.add(
                Edge(
                    team_graph_id=graph_id,
                    source_node_id=eng,
                    target_node_id=by_role[failure_to].id,
                    edge_type="failure",
                    conditions=None,
                )
            )
        if drop_escalation:
            session.delete(by_role["escalation_gate"])  # its edges cascade
    return str(graph_id)


def _new_run(graph_id: str) -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(graph_id),
                owner_id=auth_user_id(),
                idea=IDEA,
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def _harness(monkeypatch, tmp_path, *, fail_round: int, every_round: bool = False):
    """The two openhands-touching steps faked; the Engineer fails through ``_forced_failure``.
    Returns the call log (each agent step's role, round and the spec it read)."""
    calls: list[dict] = []
    monkeypatch.setattr(get_settings(), "force_fail_role", "engineer")
    monkeypatch.setattr(get_settings(), "force_fail_round", fail_round)

    def _setup(run_id):
        ws = tmp_path / run_id
        if not ws.exists():
            ws.mkdir()
            init_workspace_repo(str(ws))
            team_run._write_workspace_gitignore(str(ws))
        return str(ws)

    def _agent(run_id, node_prompt, model, iteration, idea, prd_text, workspace_dir, vkey,
               reviewer_feedback, emits_outcome, budget, invocation_id=None, edits_allowed=True,
               node_id=None, **kwargs):  # fmt: skip
        role = (
            "entry"
            if not (edits_allowed or emits_outcome)
            else ("reviewer" if emits_outcome else "engineer")
        )
        calls.append({"run_id": run_id, "role": role, "iteration": iteration, "spec": prd_text})
        if not edits_allowed and not emits_outcome:
            return entry_report_result(idea)
        if emits_outcome:
            return team_run._forced_review_outcome(iteration)
        failed = team_run._forced_failure(run_id, node_id, fail_round if every_round else iteration)
        if failed is not None:
            return failed
        ws = Path(workspace_dir)
        (ws / "rsi.py").write_text(f"round {iteration}\n")
        return {
            "status": "completed",
            "outcome": None,
            "reasons": None,
            "files_changed": ["rsi.py"],
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
        }

    monkeypatch.setattr(team_run, "engineer_setup_step", _setup)
    monkeypatch.setattr(team_run, "agent_run_step", _agent)
    return calls


def _start(run_id: str):
    with SetWorkflowID(run_id):
        return DBOS.start_workflow(team_run.run_team, IDEA)


def _invocations(run_id: str) -> list[tuple]:
    with session_scope() as session:
        rows = session.execute(
            select(
                AgentNode.role_name,
                AgentInvocation.iteration,
                AgentInvocation.status,
                AgentInvocation.outcome,
            )
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .where(AgentInvocation.run_id == run_id)
            .order_by(AgentInvocation.id)
        ).all()
    return [tuple(r) for r in rows]


def _pending_task(run_id: str, role: str, timeout: float = 20.0) -> int:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with session_scope() as session:
            node_id = session.execute(
                select(AgentNode.id)
                .join(Run, Run.team_graph_id == AgentNode.team_graph_id)
                .where(Run.workflow_id == run_id, AgentNode.role_name == role)
            ).scalar_one()
            task_id = session.execute(
                select(HumanTask.id).where(
                    HumanTask.run_id == run_id,
                    HumanTask.topic == f"gate:{run_id}:{node_id}",
                    HumanTask.status == "pending",
                )
            ).scalar_one_or_none()
        if task_id is not None:
            return task_id
        time.sleep(0.05)
    raise AssertionError(f"no pending {role} task; steps so far: {_invocations(run_id)}")


def _run(run_id: str) -> Run:
    with session_scope() as session:
        run = session.get(Run, uuid.UUID(run_id))
        session.expunge(run)
        return run


def test_a_failing_agent_with_a_failure_path_continues_to_its_target(client, monkeypatch, tmp_path):
    """Engineer round 1 fails → the run takes its failure path to "Ask me what to do", which waits
    for a person; they stop the run → it ends at Stop (stopped), never failed."""
    run_id = _new_run(_team(failure_to="ask_gate"))
    _harness(monkeypatch, tmp_path, fail_round=1)
    handle = _start(run_id)
    resolved = client.post(
        f"/api/runs/{run_id}/tasks/{_pending_task(run_id, 'prd_gate')}/resolve",
        json={"decision": "approve"},
    )
    assert resolved.status_code == 200, resolved.text

    ask = _pending_task(run_id, "ask_gate")
    assert _invocations(run_id) == [
        ("pm", 1, "done", "prd_written"),
        ("prd_gate", 1, "done", "approved"),
        ("engineer", 1, "failed", "failure_path"),
        ("ask_gate", 1, "running", None),
    ]
    run = _run(run_id)
    assert run.status == "awaiting_human" and run.failure_code is None
    with session_scope() as session:
        detail = session.execute(
            select(AgentInvocation.outcome_detail).where(
                AgentInvocation.run_id == run_id, AgentInvocation.status == "failed"
            )
        ).scalar_one()
    assert detail == "the model didn't answer after 3 tries (forced failure)"  # its reason kept

    act = client.get(f"/api/runs/{run_id}/activity").json()
    texts = [(ln["label"], ln["kind"], ln["text"]) for ln in act["lines"]]
    failed_at = texts.index(
        ("Engineer", "error", "Failed: the model didn't answer after 3 tries (forced failure)")
    )
    assert texts[failed_at + 1] == (
        "Run",
        "failure_path",
        "The Engineer failed, so the run takes its failure path to Gate approval",
    )
    path_line = act["lines"][failed_at + 1]
    assert path_line["tone"] == "warn" and path_line["node_id"] is None
    assert act["pinned"]["kind"] == "gate"

    resolved = client.post(f"/api/runs/{run_id}/tasks/{ask}/resolve", json={"decision": "reject"})
    assert resolved.status_code == 200, resolved.text
    assert handle.get_result()["status"] == "rejected"
    assert _invocations(run_id)[-2:] == [
        ("ask_gate", 1, "done", "rejected"),
        ("stop", 1, "done", "stopped"),
    ]
    assert _run(run_id).status == "rejected"


def test_the_failure_path_to_a_ship_ending_ships_the_last_build(client, monkeypatch, tmp_path):
    """Engineer round 2 fails after round 1 built; its failure path goes to the escalation gate
    (ship the last build as-is) → approved → Ship: the run ends shipped."""
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")  # Reviewer: changes in round 1
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    run_id = _new_run(_team(failure_to="escalation_gate"))
    _harness(monkeypatch, tmp_path, fail_round=2)
    assert _start(run_id).get_result()["status"] == "completed"
    assert _invocations(run_id) == [
        ("pm", 1, "done", "prd_written"),
        ("prd_gate", 1, "done", "approved"),
        ("engineer", 1, "done", "built"),
        ("reviewer", 1, "done", "changes_requested"),
        ("engineer", 2, "failed", "failure_path"),
        ("escalation_gate", 1, "done", "approved"),
        ("ship", 1, "done", "shipped"),
    ]
    run = _run(run_id)
    assert run.status == "completed" and run.failure_code is None


def test_without_a_failure_path_the_run_fails_exactly_as_before(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    run_id = _new_run(_team(failure_to=None))
    _harness(monkeypatch, tmp_path, fail_round=2)
    result = _start(run_id).get_result()
    assert result["status"] == "failed"
    assert result["error"] == "the model didn't answer after 3 tries (forced failure)"
    assert _invocations(run_id) == [
        ("pm", 1, "done", "prd_written"),
        ("prd_gate", 1, "done", "approved"),
        ("engineer", 1, "done", "built"),
        ("reviewer", 1, "done", "changes_requested"),
        ("engineer", 2, "failed", None),
    ]
    run = _run(run_id)
    assert (run.status, run.failure_code) == ("failed", run_failure.AGENT_ERROR)
    act = client.get(f"/api/runs/{run_id}/activity").json()
    assert not [ln for ln in act["lines"] if ln["kind"] == "failure_path"]
    assert act["pinned"]["kind"] == "failed"


def test_loop_limits_still_apply_to_a_failure_path(client, monkeypatch, tmp_path):
    """An Engineer that fails every round, whose failure path retries it automatically: the path is
    taken while its rounds are within its loop limit (3); the round past it fails the run."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    run_id = _new_run(_team(failure_to="ask_gate", drop_escalation=True))
    _harness(monkeypatch, tmp_path, fail_round=1, every_round=True)
    result = _start(run_id).get_result()
    assert result["status"] == "failed"
    engineer = [row for row in _invocations(run_id) if row[0] == "engineer"]
    assert engineer == [
        ("engineer", 1, "failed", "failure_path"),
        ("engineer", 2, "failed", "failure_path"),
        ("engineer", 3, "failed", "failure_path"),
        ("engineer", 4, "failed", None),
    ]
    assert _run(run_id).failure_code == run_failure.AGENT_ERROR


@pytest.mark.parametrize("swept", ["stalled", "timed_out"])
def test_a_step_the_sweep_ended_keeps_the_sweeps_reason(client, monkeypatch, tmp_path, swept):
    """The stall sweep (or the time limit) closes the step with its reason before releasing the
    sandbox; the walk then takes the failure path and keeps that reason, not the engine's error."""
    run_id = _new_run(_team(failure_to="ask_gate"))
    message = "The Engineer stopped responding: no update for 20 minutes"
    _harness(monkeypatch, tmp_path, fail_round=1)
    real_forced = team_run._forced_failure

    def _swept_then_failed(rid, node_id, iteration):
        failed = real_forced(rid, node_id, iteration)
        if failed is not None:
            with session_scope() as session:
                inv = session.execute(
                    select(AgentInvocation).where(
                        AgentInvocation.run_id == rid,
                        AgentInvocation.node_id == uuid.UUID(node_id),
                        AgentInvocation.iteration == iteration,
                    )
                ).scalar_one()
                inv.status, inv.outcome, inv.outcome_detail = "failed", swept, message
                inv_id = inv.id
            if swept == "stalled":  # what the sweep records for a stall
                live_state.record_host_event(
                    rid, inv_id, "stalled", {"after_s": 1200, "message": message}
                )
        return failed

    monkeypatch.setattr(team_run, "_forced_failure", _swept_then_failed)
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "0")  # Reviewer approves round 1
    assert _start(run_id).get_result()["status"] == "completed"  # retried, then shipped
    with session_scope() as session:
        first = session.execute(
            select(AgentInvocation)
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .where(
                AgentInvocation.run_id == run_id,
                AgentNode.role_name == "engineer",
                AgentInvocation.iteration == 1,
            )
        ).scalar_one()
        assert (first.status, first.outcome) == ("failed", "failure_path")
        assert first.outcome_detail == message
        first_id = first.id
    lines = client.get(f"/api/runs/{run_id}/activity").json()["lines"]
    step = [
        (ln["kind"], ln["text"])
        for ln in lines
        if ln["id"].startswith(f"inv:{first_id}:") and ln["kind"] != "started"
    ]
    step += [(ln["kind"], ln["text"]) for ln in lines if ln["kind"] == "stalled"]
    path = (
        "failure_path",
        "The Engineer failed, so the run takes its failure path to Gate approval",
    )
    if swept == "stalled":  # its own stall line, then the path — no second "Failed:" line
        assert step == [path, ("stalled", "Stopped responding: no update for 20 minutes")]
    else:
        assert [kind for kind, _ in step] == ["error", "failure_path"] and step[1] == path
