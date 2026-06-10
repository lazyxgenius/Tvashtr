"""create spike_hello_events

Revision ID: 0001_spike_hello_events
Revises:
Create Date: 2026-06-10

Baseline migration. Owns only Tvashtr's app table; DBOS system tables are
created by DBOS itself in the ``dbos`` schema and are not tracked here.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001_spike_hello_events"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "spike_hello_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("workflow_id", sa.Text(), nullable=False),
        sa.Column("step_name", sa.Text(), nullable=False),
        sa.Column("pid", sa.Integer(), nullable=False),
        sa.Column(
            "executed_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_spike_hello_events_workflow_id",
        "spike_hello_events",
        ["workflow_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_spike_hello_events_workflow_id", table_name="spike_hello_events")
    op.drop_table("spike_hello_events")
