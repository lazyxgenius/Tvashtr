"""users — minimal email/password identity (M-accounts Slice A)

Revision ID: 0016_users
Revises: 0015_run_brownfield_target
Create Date: 2026-06-28

M-accounts Slice A: the app's first identity table. A ``users`` row is a registered account —
``email`` (stored normalized: lower-cased + trimmed; unique on the stored value) + a bcrypt
``password_hash``. This slice is identity + login enforcement ONLY; ownership columns
(``runs.owner_id`` / ``teams.owner_id`` / ``provider_credentials.owner_id``) and per-user model-key
resolution are LATER slices. Additive (a brand-new table) — it touches NO existing table and NO
frozen migration (``0001``–``0015``); clean ``0015`` → ``0016`` chain, head ``0016``.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0016_users"
down_revision: str | None = "0015_run_brownfield_target"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )


def downgrade() -> None:
    op.drop_table("users")
