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
            s.execute(select(RunEvent.kind).where(RunEvent.invocation_id == inv_id)).scalars().all()
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
