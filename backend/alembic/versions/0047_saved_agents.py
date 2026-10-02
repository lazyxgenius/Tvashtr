"""saved_agents + saved_agent_versions — M6 My agents

A saved agent ("my agent") is one agent's setup, saved from its panel to use in any of the owner's
teams (ruling R4): ``saved_agents`` (owner, name unique per owner ignoring case, what it's for) and
``saved_agent_versions`` (v1, v2 … unique per agent: the included parts — instructions, model,
skills and tools, file access — secrets masked or left out, the agent's own memories only when
asked, the role it was built on). A node made from one carries ``config.based_on`` (no column).
Deleting an agent never changes a team. Additive: two new tables. Contract:
``docs/superpowers/plans/api/my-agents.md``.

Revision ID: 0047_saved_agents
Revises: 0046_team_versions
Create Date: 2026-10-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0047_saved_agents"
down_revision: str | None = "0046_team_versions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_agents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_saved_agents_owner_id", "saved_agents", ["owner_id"])
    op.create_index(
        "uq_saved_agents_owner_name",
        "saved_agents",
        ["owner_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_table(
        "saved_agent_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "saved_agent_id",
            sa.Uuid(),
            sa.ForeignKey("saved_agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("parts", postgresql.JSONB(), nullable=False),
        sa.Column("included", postgresql.JSONB(), nullable=False),
        sa.Column("memories", postgresql.JSONB(), nullable=True),
        sa.Column("built_on", sa.Text(), nullable=False),
        sa.Column(
            "author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("saved_agent_id", "number", name="uq_saved_agent_versions_number"),
    )
    op.create_index(
        "ix_saved_agent_versions_saved_agent_id", "saved_agent_versions", ["saved_agent_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_saved_agent_versions_saved_agent_id", table_name="saved_agent_versions")
    op.drop_table("saved_agent_versions")
    op.drop_index("uq_saved_agents_owner_name", table_name="saved_agents")
    op.drop_index("ix_saved_agents_owner_id", table_name="saved_agents")
    op.drop_table("saved_agents")
