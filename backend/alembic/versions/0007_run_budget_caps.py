"""add per-run budget cap to runs

Revision ID: 0007_run_budget_caps
Revises: 0006_human_tasks
Create Date: 2026-06-16

Adds the P1.2 per-run cost-cap fields to ``runs`` (in ``public``):

* ``budget_cap_usd`` Numeric(12,6) NULL — the per-run dollar cap (NULL = no cap;
  enforcement is opt-in). The live running total stays a query
  (``metering.running_cost``), so NO running-total column is added — ``cost_total_usd``
  stays finalize-only.
* ``budget_overridden`` Boolean NOT NULL DEFAULT false — set True when a human
  approves a budget breach so the rest of the run is not re-gated.

``runs.status`` stays free Text (no enum migration); P1.2 only *documents* the new
terminal value ``over_budget`` it can take.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_run_budget_caps"
down_revision: str | None = "0006_human_tasks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("budget_cap_usd", sa.Numeric(12, 6), nullable=True))
    op.add_column(
        "runs",
        sa.Column(
            "budget_overridden",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("runs", "budget_overridden")
    op.drop_column("runs", "budget_cap_usd")
