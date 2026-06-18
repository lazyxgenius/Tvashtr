"""The 80%-of-cap budget **nudge** — a low-priority informational Tasks-for-Human
item (P1.5b). The drawer's Low/nudges side (J4): unlike the ``budget_approval``
blocker (which pauses the run at the cap), this never blocks — it informs the
operator the run is nearing its cost cap, and is dismissed via the acknowledge
endpoint (it gates no ``recv``, so it must NOT go through ``/resolve``).

A single recorded ``@DBOS.step`` the budget hook calls after every spend-bearing
node. Idempotent two ways: being a recorded step it self-dedups on a crash-replay
(the recorded output replays, the body does not re-run), and the existence check
(one ``kind="budget_threshold"`` task per run) dedups across the hook's many
call-sites in a single walk.

This module imports only ``dbos`` / ``sqlalchemy`` / ``tvashtr.{db,metering,models}``
— no ``openhands.*`` (the enforced startup rail) — so it stays inside the offline /
no-heavy-imports control-plane boundary, exactly like ``budget.py`` (which likewise
reaches ``litellm`` only transitively through ``metering.running_cost`` -> the gateway).
"""

import uuid
from decimal import Decimal

from dbos import DBOS
from sqlalchemy import select

from tvashtr.db import session_scope
from tvashtr.metering import running_cost
from tvashtr.models import HumanTask, Run

# The fraction of the cap at which the informational nudge fires (J4 Low/nudge): at or
# above this, but NOT yet over the cap — the ``budget_approval`` blocker owns "over".
_NUDGE_THRESHOLD = Decimal("0.8")


@DBOS.step()
def maybe_emit_budget_nudge_step(run_id: str) -> None:
    """Idempotently create one ``low_nudge`` ``budget_threshold`` HumanTask when a capped
    run's spend reaches >= 80% of the cap (and is not yet over). A no-op when: the run has
    no cap; spend is under the threshold; spend is already over the cap (the blocker owns
    that); or such a task already exists for the run.

    Topic-less + non-blocking (it gates no ``recv``) — dismissed via the acknowledge
    endpoint, never ``/resolve``. Being a recorded ``@DBOS.step`` it self-dedups on replay;
    the existence check dedups across the budget hook's many call-sites in one walk."""
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        cap = run.budget_cap_usd
    if cap is None:
        return
    spent = running_cost(run_id)
    if spent < _NUDGE_THRESHOLD * cap or spent > cap:
        return
    with session_scope() as session:
        existing = session.execute(
            select(HumanTask).where(
                HumanTask.run_id == run_id, HumanTask.kind == "budget_threshold"
            )
        ).first()
        if existing is not None:
            return
        session.add(
            HumanTask(
                run_id=run_id,
                kind="budget_threshold",
                priority="low_nudge",
                blocking=False,
                topic=None,
                title=f"Approaching budget: ${spent:.4f} of ${cap:.4f} (≥ 80%)",
                description=(
                    "Informational — the run is nearing its cost cap. It keeps running; "
                    "acknowledge to dismiss."
                ),
                status="pending",
            )
        )
