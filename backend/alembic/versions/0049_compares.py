"""compares — M8 Compare two versions

A compare runs two versions of a library team on one task at the same time (ruling R5). Its id is
the two runs' ``pair_id`` (``pair_label`` 'A' / 'B'), so ``runs`` gains nothing. ``status``:
waiting (the hosted caps had no room for two runs yet; no run rows) | running | finished | stopped.
At most one waiting or running compare per team (a partial unique index). Additive: one new table.
Contract: ``docs/superpowers/plans/api/compare.md``.

Revision ID: 0049_compares
Revises: 0048_agent_tests
Create Date: 2026-10-02
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0049_compares"
down_revision: str | None = "0048_agent_tests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "compares",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "team_graph_id",
            sa.Uuid(),
            sa.ForeignKey("team_graphs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_a", sa.Integer(), nullable=False),
        sa.Column("version_b", sa.Integer(), nullable=False),
        sa.Column("task", sa.Text(), nullable=False),
        sa.Column("auto_approve", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("repo", sa.Text(), nullable=True),
        sa.Column("base_ref", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("stop_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_compares_team_created", "compares", ["team_graph_id", sa.text("created_at DESC")]
    )
    op.create_index(
        "uq_compares_team_active",
        "compares",
        ["team_graph_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('waiting', 'running')"),
    )


def downgrade() -> None:
    op.drop_index("uq_compares_team_active", table_name="compares")
    op.drop_index("ix_compares_team_created", table_name="compares")
    op.drop_table("compares")
