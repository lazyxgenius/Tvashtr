"""agent_nodes.cloned_from_node_id — clone->origin back-reference for the authoring brief (M2)

Revision ID: 0014_agent_node_cloned_from
Revises: 0013_team_graph_is_library
Create Date: 2026-06-26

Option A Milestone 2: surface the per-node "what I did last run" brief in the AUTHORING view. A run
executes against a clone-on-launch snapshot (``clone_team_graph``), so today there is no link from a
clone node back to the authored node it came from — and matching by ``role_name`` shows the WRONG
node's brief on duplicate-named nodes. This adds:

* ``agent_nodes.cloned_from_node_id`` (Uuid, nullable, indexed) — the back-reference value
  ``clone_team_graph`` sets to the origin authored node's id. A PLAIN value, NOT a ``ForeignKey``
  (authored nodes are deletable/re-addable, so a dangling value simply matches nothing). NULL on
  every authored/builder node.
* an index on ``agent_invocations.node_id`` — the join key the authoring "last run" read uses, which
  was never indexed before (the FK column carried no index).

Additive + nullable + no backfill → every existing ``agent_nodes`` row stays valid; no frozen
migration (``0001``–``0013``) is touched; clean ``0013`` → ``0014`` chain, head ``0014``.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014_agent_node_cloned_from"
down_revision: str | None = "0013_team_graph_is_library"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_nodes", sa.Column("cloned_from_node_id", sa.Uuid(), nullable=True))
    op.create_index("ix_agent_nodes_cloned_from_node_id", "agent_nodes", ["cloned_from_node_id"])
    # The authoring "last run" read joins agent_invocations.node_id -> agent_nodes.id; that FK
    # column was never indexed. Add it so the per-team DISTINCT ON read stays an index scan.
    op.create_index("ix_agent_invocations_node_id", "agent_invocations", ["node_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_invocations_node_id", table_name="agent_invocations")
    op.drop_index("ix_agent_nodes_cloned_from_node_id", table_name="agent_nodes")
    op.drop_column("agent_nodes", "cloned_from_node_id")
