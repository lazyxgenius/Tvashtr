"""gate/terminal node kinds: agent_nodes.model nullable + config jsonb (P1.5b)

Revision ID: 0009_gate_terminal_nodes
Revises: 0008_graph_executor
Create Date: 2026-06-18

Additive schema for P1.5b's uniform graph walk — gates + terminals become
first-class ``agent_nodes`` rows the executor walks (§17 Tvashtr-14):

* ``agent_nodes.model`` becomes NULLABLE — gate + terminal nodes carry no model
  (completion/agent nodes still set it).
* ``agent_nodes.config`` JSONB NULL — node-kind metadata: a gate carries
  ``{gate_kind, title, description}``, a terminal ``{terminal_kind: "ship"|"stop"}``;
  NULL for completion/agent nodes.

``kind`` stays free Text (the vocabulary just grows: ``completion|agent|gate|terminal``,
like ``runs.status``); the loop cap rides the existing ``edges.conditions`` jsonb as a
``loop_limit`` key (no edge migration). No backfill (existing completion/agent rows keep
their non-null model). Round-trips: upgrade -> autogenerate empty -> downgrade ->
re-upgrade (the downgrade re-imposes NOT NULL on a clean schema, before any gate/terminal
rows exist).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0009_gate_terminal_nodes"
down_revision: str | None = "0008_graph_executor"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("agent_nodes", "model", existing_type=sa.Text(), nullable=True)
    op.add_column(
        "agent_nodes",
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_nodes", "config")
    op.alter_column("agent_nodes", "model", existing_type=sa.Text(), nullable=False)
