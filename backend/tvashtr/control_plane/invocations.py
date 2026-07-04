"""Per-node run-state — the executor's live record of each node execution (P1.5a).

Two idempotent ``@DBOS.step``s the generic executor wraps around every node it
walks: :func:`open_invocation_step` on enter, :func:`close_invocation_step` on
exit. Together they own the :class:`~tvashtr.models.AgentInvocation` row keyed by
``(run_id, node_id, iteration)`` — the canvas's per-node status source.

Idempotency (the at-least-once-safe convention, like ``open_gate_step`` and the
metering/document writes): a crash-then-resume re-running ``open`` returns the
existing row instead of inserting a duplicate (insert-or-return with the
IntegrityError-race catch); re-running ``close`` is a safe update of the same
triple. ``EngineerRunAttempt`` stays deliberately non-idempotent — a different
job (proving re-execution via distinct pids).

This module imports neither ``litellm`` nor ``openhands.*`` — it stays inside the
offline/no-heavy-imports boundary (only ``dbos`` / ``sqlalchemy`` / ``tvashtr``).
"""

import uuid

from dbos import DBOS
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation


@DBOS.step()
def open_invocation_step(run_id: str, node_id: str, iteration: int) -> int:
    """Idempotently open an invocation: insert the ``(run_id, node_id, iteration)``
    row as ``status="running"`` (``outcome`` NULL). Returns the invocation id.

    A crash-then-resume re-running this step returns the existing row instead of
    inserting a duplicate (insert-or-return, the same shape as ``open_gate_step``).
    """
    node_uuid = uuid.UUID(node_id)
    with session_scope() as session:
        existing = session.execute(
            select(AgentInvocation).where(
                AgentInvocation.run_id == run_id,
                AgentInvocation.node_id == node_uuid,
                AgentInvocation.iteration == iteration,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing.id

        invocation = AgentInvocation(
            run_id=run_id,
            node_id=node_uuid,
            iteration=iteration,
            status="running",
            outcome=None,
        )
        session.add(invocation)
        try:
            session.flush()
        except IntegrityError:
            session.rollback()
            won = session.execute(
                select(AgentInvocation).where(
                    AgentInvocation.run_id == run_id,
                    AgentInvocation.node_id == node_uuid,
                    AgentInvocation.iteration == iteration,
                )
            ).scalar_one()
            return won.id
        return invocation.id


@DBOS.step()
def close_invocation_step(
    run_id: str,
    node_id: str,
    iteration: int,
    status: str,
    outcome: str | None,
    outcome_detail: str | None = None,
    context_manifest: dict | None = None,
) -> None:
    """Idempotently close an invocation: set ``status`` / ``outcome`` / ``outcome_detail`` /
    ``context_manifest`` / ``ended_at`` on the matching ``(run_id, node_id, iteration)`` row.

    A no-op-safe update — re-running it (or running it for a triple that was never
    opened, defensively) writes the same values, never appends a row.

    ``outcome_detail`` (P1.5c §14.3-prep) is the free-text detail behind the ``outcome``
    label; it defaults to ``None``, so every call-site that omits it writes NULL exactly
    as before. Only the Reviewer's successful-verdict close supplies it today (the
    verdict reasons).

    ``context_manifest`` (M-ctx1 C2/C4, migration ``0019``) is the compiled-context manifest
    ``{parts, total_tokens, budget, handle_used}`` — supplied ONLY by a WORKER (``agent``) node's
    close (from ``agent_run_step``'s return); it defaults to ``None`` so thinker/gate/terminal
    closes write NULL exactly as before."""
    with session_scope() as session:
        session.execute(
            update(AgentInvocation)
            .where(
                AgentInvocation.run_id == run_id,
                AgentInvocation.node_id == uuid.UUID(node_id),
                AgentInvocation.iteration == iteration,
            )
            .values(
                status=status,
                outcome=outcome,
                outcome_detail=outcome_detail,
                context_manifest=context_manifest,
                ended_at=func.now(),
            )
        )
