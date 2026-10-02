"""team_graphs.budget_usd + team_graphs.repo — M4 Team file

A team's default budget and default repo, so a team file carries them (``budget_usd``, ``repo`` in
``tvashtr_team: 1``) and an imported team keeps them. Both nullable; an export of a team without
them falls back to its last run's. ``repo`` is a hosted GitHub repo (``owner/name``) — never a
server path. Additive: two nullable columns, no backfill. ``downgrade()`` drops them. Contract:
``docs/superpowers/plans/api/team-file.md``.

Revision ID: 0045_team_defaults
Revises: 0044_run_checkpoints
Create Date: 2026-10-02
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0045_team_defaults"
down_revision: str | None = "0044_run_checkpoints"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("team_graphs", sa.Column("budget_usd", sa.Numeric(12, 6), nullable=True))
    op.add_column("team_graphs", sa.Column("repo", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("team_graphs", "repo")
    op.drop_column("team_graphs", "budget_usd")
