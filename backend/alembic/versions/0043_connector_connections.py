"""connector_connections — one account's sign-in to one connector (Toolkit › Connectors)

A connection is one account's sign-in to one catalog entry (Supabase, Notion, a registry server, a
custom address). One table carries everything the feature stores:

* the connection itself (``connector_key``, ``name``, ``slug``, ``url``, ``transport``,
  ``auth_kind``, ``access``, ``scope``, ``status``, ``tools``);
* the stored sign-in, Fernet-encrypted (``secret_encrypted``): tokens and the client registration
  for ``oauth``, final header values for ``api_key``;
* the sign-in that is in flight (``pending_encrypted`` + ``state_hash``), kept apart from the
  stored one so "Sign in again" never clobbers a working sign-in until the new one succeeds.

Calls are ``run_events`` rows and warnings are ``run_warnings`` rows, so nothing else changes.
A fresh table, no backfill. ``downgrade()`` drops it and its index. Contract:
``docs/superpowers/plans/api/connectors.md``.

Revision ID: 0043_connector_connections
Revises: 0042_domain_message_meta
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0043_connector_connections"
down_revision: str | None = "0042_domain_message_meta"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_T = "connector_connections"


def _now(name: str) -> sa.Column:
    return sa.Column(
        name, sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        _T,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("connector_key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("transport", sa.Text(), server_default="streamable-http", nullable=False),
        sa.Column("auth_kind", sa.Text(), nullable=False),
        sa.Column("access", sa.Text(), server_default="read", nullable=False),
        sa.Column("scope", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("secret_encrypted", sa.Text(), nullable=True),
        sa.Column("pending_encrypted", sa.Text(), nullable=True),
        sa.Column("state_hash", sa.Text(), nullable=True),
        sa.Column("tools", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("connected_at", sa.TIMESTAMP(timezone=True), nullable=True),
        _now("created_at"),
        _now("updated_at"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], name=f"fk_{_T}_owner_id_users"),
        sa.UniqueConstraint("owner_id", "connector_key", name=f"uq_{_T}_owner_key"),
        sa.UniqueConstraint("owner_id", "slug", name=f"uq_{_T}_owner_slug"),
        sa.UniqueConstraint("state_hash", name=f"uq_{_T}_state_hash"),
        sa.CheckConstraint("transport IN ('streamable-http', 'sse')", name=f"ck_{_T}_transport"),
        sa.CheckConstraint("auth_kind IN ('oauth', 'api_key', 'none')", name=f"ck_{_T}_auth_kind"),
        sa.CheckConstraint("access IN ('read', 'write')", name=f"ck_{_T}_access"),
        sa.CheckConstraint(
            "status IN ('pending', 'connected', 'needs_signin')", name=f"ck_{_T}_status"
        ),
    )
    op.create_index(f"ix_{_T}_owner_id", _T, ["owner_id"])


def downgrade() -> None:
    op.drop_index(f"ix_{_T}_owner_id", table_name=_T)
    op.drop_table(_T)
