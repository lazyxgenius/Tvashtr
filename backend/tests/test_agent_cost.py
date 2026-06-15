"""Agent-cost metering idempotency — no network.

`record_agent_cost` writes one CostRecord from engine-neutral usage numbers,
idempotent on the key (so a crash-retry of the cost step never double-counts).
"""

from uuid import uuid4

from sqlalchemy import func, select

from tvashtr.db import session_scope
from tvashtr.metering import record_agent_cost
from tvashtr.models import CostRecord

_MODEL = "openrouter/openai/gpt-4o-mini"


def test_record_agent_cost_is_idempotent_on_key():
    key = f"test:{uuid4().hex}:agent-cost"

    first = record_agent_cost(
        workflow_id="wf-test",
        idempotency_key=key,
        model=_MODEL,
        prompt_tokens=100,
        completion_tokens=50,
        total_tokens=150,
        cost_usd=0.0012,
    )
    second = record_agent_cost(
        workflow_id="wf-test",
        idempotency_key=key,
        model=_MODEL,
        prompt_tokens=100,
        completion_tokens=50,
        total_tokens=150,
        cost_usd=0.0012,
    )

    assert second.id == first.id
    # No fallback notion inside an agent run: requested == used == model.
    assert first.model_requested == first.model_used == _MODEL
    assert first.total_tokens == 150

    with session_scope() as session:
        count = session.execute(
            select(func.count()).select_from(CostRecord).where(CostRecord.idempotency_key == key)
        ).scalar_one()
    assert count == 1
