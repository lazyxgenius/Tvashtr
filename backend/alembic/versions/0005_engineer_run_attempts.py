"""create engineer_run_attempts

Revision ID: 0005_engineer_run_attempts
Revises: 0004_team_graph_and_runs
Create Date: 2026-06-15

Adds the P0.4b ``engineer_run_attempts`` table (in ``public``): one row per
execution of the coarse agent step, recording the OS pid — the crash-resume proof
observes two rows with distinct pids. Earlier tables are left as-is.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_engineer_run_attempts"
down_revision: str | None = "0004_team_graph_and_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "engineer_run_attempts",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("pid", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_engineer_run_attempts_run_id", "engineer_run_attempts", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_engineer_run_attempts_run_id", table_name="engineer_run_attempts")
    op.drop_table("engineer_run_attempts")
