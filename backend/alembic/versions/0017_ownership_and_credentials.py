"""ownership columns + encrypted provider credentials (M-accounts Slice B)

Revision ID: 0017_ownership_and_credentials
Revises: 0016_users
Create Date: 2026-06-28

M-accounts Slice B: the app becomes fully account-based and ``.env``-free for provider keys.

* ``runs.owner_id`` — the account that owns a run (FK → ``users.id``). NULLABLE at the DB level so
  this additive migration applies to a DB with pre-existing rows AND a pre-seed window (the operator
  user only exists after ``make seed``); the APPLICATION guarantees non-null (``create_run`` always
  sets it; the executor hard-errors on a NULL owner). DB-level NOT NULL is a later hardening.
* ``team_graphs.owner_id`` — the account that owns a LIBRARY team (FK → ``users.id``). Library teams
  get it set; ephemeral run-snapshot clones / A-B / smoke graphs stay NULL (never listed).
* ``provider_credentials`` — one account's BYOK provider key, encrypted at rest (Fernet). Unique
  ``(owner_id, provider)`` (one key per provider per account; add = upsert/replace).

Carries NO data — the operator user only exists after the seed, which does all backfill/import.
Additive: touches NO frozen migration (``0001``–``0016``); clean ``0016`` → ``0017`` chain, head
``0017``.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0017_ownership_and_credentials"
down_revision: str | None = "0016_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # runs.owner_id — nullable FK (the app guarantees non-null; the executor asserts it).
    op.add_column("runs", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_runs_owner_id_users", "runs", "users", ["owner_id"], ["id"])
    op.create_index("ix_runs_owner_id", "runs", ["owner_id"])

    # team_graphs.owner_id — nullable FK (set on library teams; NULL on clones/A-B/smoke graphs).
    op.add_column("team_graphs", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_team_graphs_owner_id_users", "team_graphs", "users", ["owner_id"], ["id"]
    )
    op.create_index("ix_team_graphs_owner_id", "team_graphs", ["owner_id"])

    # provider_credentials — encrypted-at-rest BYOK keys, one per (owner, provider).
    op.create_table(
        "provider_credentials",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
        sa.Column("key_last4", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name="fk_provider_credentials_owner_id_users"
        ),
        sa.UniqueConstraint("owner_id", "provider", name="uq_provider_credentials_owner_provider"),
    )
    op.create_index("ix_provider_credentials_owner_id", "provider_credentials", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_provider_credentials_owner_id", table_name="provider_credentials")
    op.drop_table("provider_credentials")

    op.drop_index("ix_team_graphs_owner_id", table_name="team_graphs")
    op.drop_constraint("fk_team_graphs_owner_id_users", "team_graphs", type_="foreignkey")
    op.drop_column("team_graphs", "owner_id")

    op.drop_index("ix_runs_owner_id", table_name="runs")
    op.drop_constraint("fk_runs_owner_id_users", "runs", type_="foreignkey")
    op.drop_column("runs", "owner_id")
