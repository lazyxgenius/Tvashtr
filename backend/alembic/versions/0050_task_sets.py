"""task sets — M9 Task sets and a check before saving

A task set is a library team's named list of tasks (1–20), each with the branch it starts from and
a hidden check command (ruling R11: read only by the check runner, never by an agent). A compare can
run on a set (``compares.task_set_id``; ``compares.item_count`` keeps how many tasks it runs even
after the set is edited or deleted); each of its runs says which task it is for
(``runs.task_set_item_id``). ``hidden_check_results`` holds each run's check result (one per run).
Version checks (R6) are derived from set compares, not stored. Additive: three tables, three
nullable columns. Contract: ``docs/superpowers/plans/api/task-sets.md``.

Revision ID: 0050_task_sets
Revises: 0049_compares
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0050_task_sets"
down_revision: str | None = "0049_compares"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_sets",
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
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "uq_task_sets_team_name",
        "task_sets",
        ["team_graph_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_table(
        "task_set_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "task_set_id",
            sa.Uuid(),
            sa.ForeignKey("task_sets.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("task", sa.Text(), nullable=False),
        sa.Column("starts_from", sa.Text(), nullable=True),
        sa.Column("hidden_check", sa.Text(), nullable=False),
    )
    op.add_column(
        "compares",
        sa.Column(
            "task_set_id",
            sa.Uuid(),
            sa.ForeignKey("task_sets.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("compares", sa.Column("item_count", sa.Integer(), nullable=True))
    op.add_column(
        "runs",
        sa.Column(
            "task_set_item_id",
            sa.Uuid(),
            sa.ForeignKey("task_set_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_table(
        "hidden_check_results",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "run_id",
            sa.Uuid(),
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("timed_out", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("output_tail", sa.Text(), nullable=False, server_default=""),
        sa.Column("duration_s", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("hidden_check_results")
    op.drop_column("runs", "task_set_item_id")
    op.drop_column("compares", "item_count")
    op.drop_column("compares", "task_set_id")
    op.drop_table("task_set_items")
    op.drop_index("uq_task_sets_team_name", table_name="task_sets")
    op.drop_table("task_sets")
