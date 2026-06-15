"""create team_graphs, agent_nodes, edges, runs

Revision ID: 0004_team_graph_and_runs
Revises: 0003_run_events
Create Date: 2026-06-15

Adds the P0.4 graph/run schema (in ``public``): a team graph of agent nodes wired
by edges, and a run that executes it. DBOS system tables are untouched; the
earlier app tables are left as-is.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004_team_graph_and_runs"
down_revision: str | None = "0003_run_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "team_graphs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_table(
        "agent_nodes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("team_graph_id", sa.Uuid(), nullable=False),
        sa.Column("role_name", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("engine", sa.Text(), nullable=True),
        sa.Column("position", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["team_graph_id"],
            ["team_graphs.id"],
            ondelete="CASCADE",
            name="fk_agent_nodes_team_graph_id",
        ),
    )
    op.create_index("ix_agent_nodes_team_graph_id", "agent_nodes", ["team_graph_id"])

    op.create_table(
        "edges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("team_graph_id", sa.Uuid(), nullable=False),
        sa.Column("source_node_id", sa.Uuid(), nullable=False),
        sa.Column("target_node_id", sa.Uuid(), nullable=False),
        sa.Column("edge_type", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["team_graph_id"],
            ["team_graphs.id"],
            ondelete="CASCADE",
            name="fk_edges_team_graph_id",
        ),
        sa.ForeignKeyConstraint(
            ["source_node_id"],
            ["agent_nodes.id"],
            ondelete="CASCADE",
            name="fk_edges_source_node_id",
        ),
        sa.ForeignKeyConstraint(
            ["target_node_id"],
            ["agent_nodes.id"],
            ondelete="CASCADE",
            name="fk_edges_target_node_id",
        ),
    )
    op.create_index("ix_edges_team_graph_id", "edges", ["team_graph_id"])

    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("team_graph_id", sa.Uuid(), nullable=False),
        sa.Column("idea", sa.Text(), nullable=False),
        sa.Column("workflow_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("pm_document_id", sa.Uuid(), nullable=True),
        sa.Column("ship_commit_sha", sa.Text(), nullable=True),
        sa.Column("ship_tag", sa.Text(), nullable=True),
        sa.Column("cost_total_usd", sa.Numeric(12, 6), nullable=True),
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
            ["team_graph_id"], ["team_graphs.id"], name="fk_runs_team_graph_id"
        ),
        sa.ForeignKeyConstraint(
            ["pm_document_id"], ["documents.id"], name="fk_runs_pm_document_id"
        ),
    )
    op.create_index("ix_runs_team_graph_id", "runs", ["team_graph_id"])


def downgrade() -> None:
    op.drop_index("ix_runs_team_graph_id", table_name="runs")
    op.drop_table("runs")
    op.drop_index("ix_edges_team_graph_id", table_name="edges")
    op.drop_table("edges")
    op.drop_index("ix_agent_nodes_team_graph_id", table_name="agent_nodes")
    op.drop_table("agent_nodes")
    op.drop_table("team_graphs")
