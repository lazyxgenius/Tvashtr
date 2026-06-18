"""add edge conditions + agent_invocations (P1.5a graph executor)

Revision ID: 0008_graph_executor
Revises: 0007_run_budget_caps
Create Date: 2026-06-18

Additive schema for the generic cyclic executor (in ``public``):

* ``edges.conditions`` JSONB NULL — the outgoing-edge routing condition. NULL =
  unconditional; a conditional edge carries ``{"when": <outcome-label>}`` (the
  Reviewer->Engineer loop-back is ``{"when": "changes_requested"}``).
* ``agent_invocations`` — per-node-execution live state, one row per
  ``(run_id, node_id, iteration)``, idempotent on that triple (insert-on-enter,
  update-on-exit). The canvas's per-node status source. Distinct from
  ``engineer_run_attempts`` (which stays deliberately non-idempotent).

No change to ``team_graphs``; no backfill. ``runs.status`` stays free Text (the
review-escalation blocker uses ``kind="review_escalation"`` on ``human_tasks``,
no new terminal). Round-trips: upgrade -> autogenerate empty -> downgrade ->
re-upgrade.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0008_graph_executor"
down_revision: str | None = "0007_run_budget_caps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "edges",
        sa.Column("conditions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.create_table(
        "agent_invocations",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("node_id", sa.Uuid(), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column(
            "started_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("ended_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["node_id"],
            ["agent_nodes.id"],
            ondelete="CASCADE",
            name="fk_agent_invocations_node_id",
        ),
        sa.UniqueConstraint(
            "run_id", "node_id", "iteration", name="uq_agent_invocations_run_node_iter"
        ),
    )
    op.create_index("ix_agent_invocations_run_id", "agent_invocations", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_invocations_run_id", table_name="agent_invocations")
    op.drop_table("agent_invocations")
    op.drop_column("edges", "conditions")
