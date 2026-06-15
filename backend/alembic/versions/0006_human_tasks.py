"""create human_tasks

Revision ID: 0006_human_tasks
Revises: 0005_engineer_run_attempts
Create Date: 2026-06-15

Adds the P1.1a ``human_tasks`` table (in ``public``): one Tasks-for-Human item per
gate. A blocking ``gate_approval`` row pauses a run until a human resolves it.
Unique ``(run_id, topic)`` makes ``open_gate_step`` an idempotent insert-or-return.

No enum migration for ``runs.status``: it is free Text. P1.1a only *documents*
three new values it can take — ``awaiting_human`` / ``rejected`` / ``cancelled``
— so this migration adds the table and nothing else. Earlier tables are left as-is.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_human_tasks"
down_revision: str | None = "0005_engineer_run_attempts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "human_tasks",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("priority", sa.Text(), nullable=False),
        sa.Column("blocking", sa.Boolean(), nullable=False),
        sa.Column("topic", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.UniqueConstraint("run_id", "topic", name="uq_human_tasks_run_topic"),
    )
    op.create_index("ix_human_tasks_run_id", "human_tasks", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_human_tasks_run_id", table_name="human_tasks")
    op.drop_table("human_tasks")
