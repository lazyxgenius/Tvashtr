"""Metering: turn a gateway result into a persisted, deduplicated cost row.

This is the seam where a (pure) ``CompletionResult`` from the gateway becomes a
durable ``CostRecord``. ``record_cost`` is idempotent on ``idempotency_key`` so
an at-least-once DBOS step re-run after a crash does not double-count cost.
"""

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from tvashtr.db import session_scope
from tvashtr.gateway import CompletionResult
from tvashtr.models import CostRecord


def running_cost(run_id: str) -> Decimal:
    """Live running total of a run's metered spend — a query, NOT a stored field.

    ``COALESCE(SUM(cost_records.cost_usd), 0) WHERE workflow_id == run_id``. The
    single source of a run's accrued cost, shared by ``finalize_run_step`` (the
    terminal total) and ``budget_check_step`` (the in-flight cap check). The
    ``Run`` row keeps no running total — ``cost_total_usd`` is written only at
    finalize, so this query is the one source of truth for accrued spend.
    """
    with session_scope() as session:
        total = session.execute(
            select(func.coalesce(func.sum(CostRecord.cost_usd), 0)).where(
                CostRecord.workflow_id == run_id
            )
        ).scalar_one()
    return Decimal(total)


def record_cost(
    result: CompletionResult,
    *,
    workflow_id: str | None,
    idempotency_key: str,
    invocation_id: int | None = None,
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
            # M-ledger C5: attach this spend to its node-execution (NULL-safe default).
            invocation_id=invocation_id,
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


def record_agent_cost(
    *,
    workflow_id: str | None,
    idempotency_key: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    cost_usd: float,
    invocation_id: int | None = None,
) -> CostRecord:
    """Persist one CostRecord for an agent invocation from engine-neutral usage
    numbers — idempotent on ``idempotency_key``.

    An agent run has no fallback notion, so ``model_requested == model_used ==
    model``. Same insert-or-return shape as ``record_cost``.
    """
    with session_scope() as session:
        existing = session.execute(
            select(CostRecord).where(CostRecord.idempotency_key == idempotency_key)
        ).scalar_one_or_none()
        if existing is not None:
            return existing

        record = CostRecord(
            workflow_id=workflow_id,
            # M-ledger C5: attach this agent spend to its node-execution (NULL-safe default).
            invocation_id=invocation_id,
            idempotency_key=idempotency_key,
            model_requested=model,
            model_used=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_usd=Decimal(str(cost_usd)),
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
