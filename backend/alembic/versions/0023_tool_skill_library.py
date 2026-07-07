"""tool_library + skill_library — per-account reusable Tools + Skills library (M-tools C7.C)

Revision ID: 0023_tool_skill_library
Revises: 0022_mcp_secrets_run_warnings
Create Date: 2026-07-07

M-tools C7.C (the reusable account library): the two NEW owner-scoped tables behind an account's
reusable library items a node can REFERENCE (by id, stored INSIDE its existing ``tool_config``/
``skills`` — NO new node column) in addition to its one-off inline config. Both mirror
``mcp_secrets`` / ``provider_credentials``.

* ``tool_library`` — one account's reusable MCP server: ``name`` (the ``mcpServers`` key) +
  ``server_config`` JSONB (the value under that key — ``{command,args,env}`` stdio or
  ``{url,headers,type}`` http/sse). UNIQUE ``(owner_id, name)`` — one server per name per account;
  add = upsert/replace. A node references it by id via ``tool_config.tvashtr.library``.
* ``skill_library`` — one account's reusable skill: ``name`` (display label) + ``source`` JSONB (one
  C7.B skill-source object — inline/repo/project_rules). UNIQUE ``(owner_id, name)``. A node
  references it via a ``{"type":"library","id":…}`` element in its ``skills`` list.

The reference is LIVE (id only; content fetched fresh at run time). Both additive + nullable-safe
(fresh child tables, no backfill); ``downgrade()`` drops both (+ their indexes). Chains ``0022`` ->
``0023``, head ``0023`` (the migration-freeze hook is bumped to include ``0023`` as this milestone's
LAST step). Revision id kept <= 32 chars for alembic's ``version_num`` column.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0023_tool_skill_library"
down_revision: str | None = "0022_mcp_secrets_run_warnings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # tool_library — one account's reusable MCP server, one row per (owner, name).
    op.create_table(
        "tool_library",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("server_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
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
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], name="fk_tool_library_owner_id_users"),
        sa.UniqueConstraint("owner_id", "name", name="uq_tool_library_owner_name"),
    )
    op.create_index("ix_tool_library_owner_id", "tool_library", ["owner_id"])

    # skill_library — one account's reusable skill source, one row per (owner, name).
    op.create_table(
        "skill_library",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("source", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
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
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], name="fk_skill_library_owner_id_users"),
        sa.UniqueConstraint("owner_id", "name", name="uq_skill_library_owner_name"),
    )
    op.create_index("ix_skill_library_owner_id", "skill_library", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_skill_library_owner_id", table_name="skill_library")
    op.drop_table("skill_library")
    op.drop_index("ix_tool_library_owner_id", table_name="tool_library")
    op.drop_table("tool_library")
