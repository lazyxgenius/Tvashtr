"""Cost-cap **enforcement** in the Control Plane (P1.2 — §13 Risk 3).

The Model Gateway stays a pure dollar-*metering* chokepoint; *enforcement* lives
here (DP-B), so the P1.4 proxy swap stays clean — no run context, DB reads, or
budget logic ever leak into ``gateway.complete()``.

These steps inspect a run's accumulated *prior* spend (via
``metering.running_cost``) and gate the *next* step. The check is reactive /
between-steps: you can't know a call's cost until it returns, so a breach can
overshoot by ~one step's spend. That is expected — interrupting a step mid-flight
(e.g. the agent's own LLM loop) is P1.4's proxy job, not ours.

Boundary: this module imports only ``dbos`` / ``sqlalchemy`` / ``tvashtr.{db,
models,metering}`` — no ``litellm``, no ``openhands.*`` — so it stays inside the
offline / no-heavy-imports control-plane boundary, exactly like ``gates.py``.
"""

import uuid

from dbos import DBOS
from sqlalchemy import select, update

from tvashtr.db import session_scope
from tvashtr.metering import running_cost
from tvashtr.models import Run


@DBOS.step()
def budget_check_step(run_id: str) -> dict:
    """Is the run over its per-run dollar cap? A pure read (trivially idempotent).

    ``over`` is True iff a cap is set, the human has not already overridden it, and
    accumulated prior spend exceeds the cap. Returns plain floats for a clean,
    picklable step output. Being a recorded ``@DBOS.step``, the verdict is
    checkpointed — a crash-resume replays the same decision even if live spend has
    changed in the restarted process.
    """
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        cap = run.budget_cap_usd
        overridden = run.budget_overridden
    spent = running_cost(run_id)
    over = cap is not None and not overridden and spent > cap
    return {
        "over": over,
        "spent": float(spent),
        "cap": float(cap) if cap is not None else None,
    }


@DBOS.step()
def mark_budget_overridden_step(run_id: str) -> None:
    """Record a human's "approve = continue to completion" for a budget breach.

    Sets ``Run.budget_overridden = True`` so the rest of the run is not re-gated.
    Idempotent: setting an already-True flag True again is a no-op.
    """
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == uuid.UUID(run_id)).values(budget_overridden=True)
        )
