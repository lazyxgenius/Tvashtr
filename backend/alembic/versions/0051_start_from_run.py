"""runs.started_from_run_id + runs.carry — M10 Start a new run from this one (ruling R9)

* ``runs.started_from_run_id``: the run this one was started from (SET NULL when that run is
  deleted), indexed.
* ``runs.carry``: a snapshot, taken at start, of what came along — the final spec, the person's
  decisions, the confirmed memories and each agent's summary — and where the run started from.
  Later changes to the old run never change it.

Additive: two nullable columns, no backfill. ``downgrade()`` drops them.
Contract: ``docs/superpowers/plans/api/start-from-run.md``.

Revision ID: 0051_start_from_run
Revises: 0050_task_sets
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0051_start_from_run"
down_revision: str | None = "0050_task_sets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("started_from_run_id", sa.Uuid(), nullable=True))
    op.add_column(
        "runs", sa.Column("carry", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.create_foreign_key(
        "fk_runs_started_from_run_id_runs",
        "runs",
        "runs",
        ["started_from_run_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_runs_started_from_run_id", "runs", ["started_from_run_id"])


def downgrade() -> None:
    op.drop_index("ix_runs_started_from_run_id", table_name="runs")
    op.drop_constraint("fk_runs_started_from_run_id_runs", "runs", type_="foreignkey")
    op.drop_column("runs", "carry")
    op.drop_column("runs", "started_from_run_id")
