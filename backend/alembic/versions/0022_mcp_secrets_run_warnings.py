"""mcp_secrets + run_warnings — per-account MCP secret store + run-scoped resolution warnings

Revision ID: 0022_mcp_secrets_run_warnings
Revises: 0021_agent_node_tools_skills
Create Date: 2026-07-06

M-tools C7.A (Tools): the two NEW tables behind per-node MCP tools.

* ``mcp_secrets`` — one account's ``${NAME}`` MCP secret, Fernet-encrypted at rest (mirrors
  ``provider_credentials``). UNIQUE ``(owner_id, name)`` — one value per name per
  account, add = upsert/replace. ``secret_encrypted`` is the Fernet ciphertext; resolved server-side
  at run time; the plaintext is never stored or returned by any endpoint. A node's inline
  ``tool_config`` holds only the ``${NAME}`` reference — this table holds the value it points at.
* ``run_warnings`` — a run-scoped resolution warning: a tool/skill source that FAILED to resolve at
  run time (missing secret, unreachable repo, MCP connect fail) and was SKIPPED (the run continued).
  bigint PK, ``run_id`` FK -> ``runs.id`` (``ondelete=CASCADE``) + index. Surfaced in the run
  inspector via ``GET /api/runs/{run_id}/graph``'s ``resolution_warnings`` array; deduped by the
  recorder on (run_id, source_kind, name, reason).

Both additive + nullable-safe (fresh child tables, no backfill); ``downgrade()`` drops both.
Chains ``0021`` -> ``0022``, head ``0022`` (the migration-freeze hook is bumped to include ``0022``
as this milestone's LAST step). Revision id kept <= 32 chars for alembic's ``version_num`` column.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0022_mcp_secrets_run_warnings"
down_revision: str | None = "0021_agent_node_tools_skills"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # mcp_secrets — encrypted-at-rest ${NAME} store, one value per (owner, name).
    op.create_table(
        "mcp_secrets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
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
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], name="fk_mcp_secrets_owner_id_users"),
        sa.UniqueConstraint("owner_id", "name", name="uq_mcp_secrets_owner_name"),
    )
    op.create_index("ix_mcp_secrets_owner_id", "mcp_secrets", ["owner_id"])

    # run_warnings — run-scoped resolution warnings (skipped tool/skill sources).
    op.create_table(
        "run_warnings",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("source_kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["run_id"], ["runs.id"], name="fk_run_warnings_run_id_runs", ondelete="CASCADE"
        ),
    )
    op.create_index("ix_run_warnings_run_id", "run_warnings", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_run_warnings_run_id", table_name="run_warnings")
    op.drop_table("run_warnings")
    op.drop_index("ix_mcp_secrets_owner_id", table_name="mcp_secrets")
    op.drop_table("mcp_secrets")
