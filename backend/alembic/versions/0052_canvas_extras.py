"""team_graphs.layout + human_tasks.edited_version — M11 Canvas extras (rulings R13, R14)

* ``team_graphs.layout``: the canvas's groups, ``{"groups": [{"id", "label", "node_ids",
  "folded"}]}``. Layout only: never part of a team version, never read by the walk.
* ``human_tasks.edited_version``: the spec version a person saved with "Approve with my edits"
  (NULL for every other resolution).

Additive: two nullable columns, no backfill. ``downgrade()`` drops them.
Contract: ``docs/superpowers/plans/api/canvas-extras.md``.

Revision ID: 0052_canvas_extras
Revises: 0051_start_from_run
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0052_canvas_extras"
down_revision: str | None = "0051_start_from_run"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "team_graphs", sa.Column("layout", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.add_column("human_tasks", sa.Column("edited_version", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("human_tasks", "edited_version")
    op.drop_column("team_graphs", "layout")
