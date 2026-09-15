"""engine_subscription_statuses — secret-free Desktop subscription mirror

Revision ID: 0032_engine_sub_statuses
Revises: 0031_run_artifacts
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0032_engine_sub_statuses"
down_revision: str | None = "0031_run_artifacts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "engine_subscription_statuses",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("connected", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("state", sa.Text(), server_default="disconnected", nullable=False),
        sa.Column("account_hint", sa.Text(), nullable=True),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "owner_id", "provider", name="uq_engine_subscription_statuses_owner_provider"
        ),
    )
    op.create_index(
        "ix_engine_subscription_statuses_owner_id",
        "engine_subscription_statuses",
        ["owner_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_engine_subscription_statuses_owner_id", table_name="engine_subscription_statuses"
    )
    op.drop_table("engine_subscription_statuses")
