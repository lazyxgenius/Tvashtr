"""Metering: turn a gateway result into a persisted, deduplicated cost row.

This is the seam where a (pure) ``CompletionResult`` from the gateway becomes a
durable ``CostRecord``. ``record_cost`` is idempotent on ``idempotency_key`` so
an at-least-once DBOS step re-run after a crash does not double-count cost.
"""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from tvashtr.db import session_scope
from tvashtr.gateway import CompletionResult
from tvashtr.models import CostRecord


def record_cost(
    result: CompletionResult,
    *,
    workflow_id: str | None,
    idempotency_key: str,
) -> CostRecord:
    """Persist one metered call — idempotent on ``idempotency_key``.

    If a row already exists for this key, return it unchanged. The unique-
    violation race is handled by catching ``IntegrityError`` and re-reading.
    """
    with session_scope() as session:
        existing = session.execute(
            select(CostRecord).where(CostRecord.idempotency_key == idempotency_key)
        ).scalar_one_or_none()
        if existing is not None:
            return existing

        record = CostRecord(
            workflow_id=workflow_id,
            idempotency_key=idempotency_key,
            model_requested=result.model_requested,
            model_used=result.model_used,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            total_tokens=result.total_tokens,
            cost_usd=Decimal(str(result.cost_usd)),
        )
        session.add(record)
        try:
            session.flush()
        except IntegrityError:
            session.rollback()
            won = session.execute(
                select(CostRecord).where(CostRecord.idempotency_key == idempotency_key)
            ).scalar_one_or_none()
            if won is not None:
                return won
            raise
        session.refresh(record)
        return record
