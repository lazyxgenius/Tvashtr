"""M1 stall guard — a Query domain round writes its model retries as run events."""

import uuid

from home_fixtures import fresh_account
from sqlalchemy import select

from tvashtr.control_plane import domain_ask as domain_ask_mod
from tvashtr.control_plane import team_run
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, Run, RunEvent, RunWarning


def test_the_domain_round_records_the_gateway_retry_events(client, monkeypatch):
    c, owner = fresh_account("dq-retry")
    domain_id = c.post("/api/domains", json={"name": "Docs", "template": "support"}).json()[
        "domain_id"
    ]
    run_id = str(uuid.uuid4())
    clone = build_two_node_team()
    with session_scope() as s:
        s.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(clone),
                owner_id=owner,
                idea="refunds",
                workflow_id=run_id,
                status="running",
            )
        )
        node = s.execute(
            select(AgentNode.id).where(AgentNode.team_graph_id == uuid.UUID(clone)).limit(1)
        ).scalar_one()
        inv = AgentInvocation(run_id=run_id, node_id=node, iteration=1, status="running")
        s.add(inv)
        s.flush()
        inv_id = inv.id

    asked: dict = {}

    def fake_ask(*args, on_event=None, **kwargs):
        asked.update(kwargs)
        on_event("retry", {"attempt": 1, "of": 3, "wait_s": 10.0, "reason": "busy"})
        on_event("backup_model", {"from_model": "a/x", "to_model": "b/y", "reason": "busy"})
        return {"answer": "x", "answer_text": "x", "covered": True, "sources": [], "usage": {}}

    monkeypatch.setattr(domain_ask_mod, "ask_domain", fake_ask)
    team_run.domain_query_step_v2(run_id, str(node), 1, inv_id, domain_id, "Refunds?")

    with session_scope() as s:
        kinds = (
            s.execute(
                select(RunEvent.kind).where(RunEvent.invocation_id == inv_id).order_by(RunEvent.seq)
            )
            .scalars()
            .all()
        )
    assert kinds == ["retry", "backup_model"]
    # R2: the round gets the account's backup for a thinker seat, and the switch is a RunWarning.
    assert asked["backup_capability"] == "thinker"
    with session_scope() as s:
        warnings = s.execute(
            select(RunWarning.name, RunWarning.reason).where(RunWarning.run_id == uuid.UUID(run_id))
        ).all()
    assert warnings == [
        ("b/y", "primary 'a/x' stayed busy after its retries — switched to the backup model")
    ]


def test_the_domain_round_can_be_switched_to_its_backup_while_it_runs(client, monkeypatch):
    """M2: while the round's model call waits out a retry, "Switch to the backup model now" sets
    the round's signal — the one the call was given — and the signal is gone once the round ends.
    A switch the person asked for reads as asked in the round's RunWarning."""
    from tvashtr.control_plane import live_state

    c, owner = fresh_account("dq-switch")
    domain_id = c.post("/api/domains", json={"name": "Docs", "template": "support"}).json()[
        "domain_id"
    ]
    run_id = str(uuid.uuid4())
    clone = build_two_node_team()
    with session_scope() as s:
        s.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(clone),
                owner_id=owner,
                idea="refunds",
                workflow_id=run_id,
                status="running",
            )
        )
        node = s.execute(
            select(AgentNode.id).where(AgentNode.team_graph_id == uuid.UUID(clone)).limit(1)
        ).scalar_one()
        inv = AgentInvocation(run_id=run_id, node_id=node, iteration=1, status="running")
        s.add(inv)
        s.flush()
        inv_id = inv.id

    seen: dict = {}

    def fake_ask(*args, on_event=None, switch_signal=None, **kwargs):
        seen["signal"] = switch_signal
        on_event("retry", {"attempt": 1, "of": 3, "wait_s": 10.0, "reason": "busy"})
        seen["switched"] = live_state.request_switch(run_id, inv_id)
        seen["set"] = switch_signal.is_set()
        on_event("backup_model", {"from_model": "a/x", "to_model": "b/y", "reason": "asked"})
        return {"answer": "x", "answer_text": "x", "covered": True, "sources": [], "usage": {}}

    monkeypatch.setattr(domain_ask_mod, "ask_domain", fake_ask)
    team_run.domain_query_step_v2(run_id, str(node), 1, inv_id, domain_id, "Refunds?")

    assert seen["switched"] is True and seen["set"] is True
    # The round is over: nothing left to switch.
    assert live_state.request_switch(run_id, inv_id) is False
    with session_scope() as s:
        warnings = s.execute(
            select(RunWarning.name, RunWarning.reason).where(RunWarning.run_id == uuid.UUID(run_id))
        ).all()
    assert warnings == [("b/y", "primary 'a/x' was busy — you switched to the backup model")]


def test_a_switch_for_a_step_that_isnt_running_here_does_nothing():
    from tvashtr.control_plane import live_state

    assert live_state.request_switch(str(uuid.uuid4()), 1) is False
