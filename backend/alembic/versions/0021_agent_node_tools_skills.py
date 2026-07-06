"""agent_nodes.tool_config + agent_nodes.skills — the per-node tools/skills seam (M-tools C7.0)

Revision ID: 0021_agent_node_tools_skills
Revises: 0020_invocation_scoped_events
Create Date: 2026-07-06

M-tools (C7.0 scaffold): give every authored/cloned node two OPTIONAL, inline configuration slots so
a later milestone can attach per-node tools + skills WITHOUT another schema change or any executor
churn. Both are additive, nullable JSONB, NO server default, NO backfill (legacy rows keep NULL):

* ``agent_nodes.tool_config`` — the raw MCP config object ``{"mcpServers": {…}}`` (the inline
  shape Cursor's ``mcp.json`` / ``.mcp.json`` use). NULL ⇒ the node has no inline tools.
* ``agent_nodes.skills`` — a JSON ARRAY of inline skill-source objects. NULL ⇒ no inline skills.

Prime directive of the milestone: ZERO behavior change. With both columns NULL everywhere (there is
no UI to set them yet), every existing run behaves byte-for-byte as before — adapters map an empty
tool_config to no MCP tools and an empty skills list to ``agent_context=None``. This migration only
adds the durable slots; the wiring that reads them is inert until the columns are populated.

Chains ``0020`` -> ``0021``, head ``0021`` (the migration-freeze hook is bumped to add ``0021`` as
this milestone's LAST step). Revision id kept <=32 chars for alembic's ``version_num`` column.
``downgrade()`` drops both columns (reversible).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0021_agent_node_tools_skills"
down_revision: str | None = "0020_invocation_scoped_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Two inline, nullable JSONB slots on every node — additive + reversible, no backfill.
    op.add_column(
        "agent_nodes",
        sa.Column("tool_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "agent_nodes",
        sa.Column("skills", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_nodes", "skills")
    op.drop_column("agent_nodes", "tool_config")
