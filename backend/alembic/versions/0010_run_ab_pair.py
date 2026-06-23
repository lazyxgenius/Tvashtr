"""add A/B pairing columns to runs (P1.5c §14.2)

Revision ID: 0010_run_ab_pair
Revises: 0009_gate_terminal_nodes
Create Date: 2026-06-23

Adds the team A/B attributability pairing to ``runs`` (in ``public``) — the durable,
queryable key that ties the two runs of one A/B comparison together (§14, the
"which config ships better" instrument). Two runs sharing a ``pair_id`` are the A/B;
``pair_label`` is which side. The smallest pairing that composes with all existing run
machinery — a full ``run_pairs`` entity is over-build for a 2-config v1 (deferred until
>2 configs / pair metadata).

* ``pair_id`` Uuid NULL — the pairing key; NULL for an ordinary standalone run.
  Indexed (``ix_runs_pair_id``) because the §14.3 comparison view fetches a pair by it.
* ``pair_label`` Text NULL — ``"A"`` / ``"B"`` (the config side); NULL for a standalone run.

Both nullable + no backfill: every existing ``runs`` row is a standalone (non-paired) run
and stays so. This migration is purely additive — NO change to the executor, the team
builders, or any frozen migration (``0001``–``0009``).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_run_ab_pair"
down_revision: str | None = "0009_gate_terminal_nodes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("pair_id", sa.Uuid(), nullable=True))
    op.add_column("runs", sa.Column("pair_label", sa.Text(), nullable=True))
    op.create_index("ix_runs_pair_id", "runs", ["pair_id"])


def downgrade() -> None:
    op.drop_index("ix_runs_pair_id", table_name="runs")
    op.drop_column("runs", "pair_label")
    op.drop_column("runs", "pair_id")
