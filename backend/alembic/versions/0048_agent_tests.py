"""agent_tests + agent_test_runs + agent_test_results + ai_check_usage — M7 Agent tests

A test is one saved round of one agent (``agent_tests``: what it got — the task, the documents it
read, the change it saw as a git diff against its base — and the checks on what it says). Running a
library agent's tests makes an ``agent_test_runs`` row with one ``agent_test_results`` row per test
(a replay of only that agent). ``ai_check_usage`` counts each account's AI checks per month (R7,
limit 200). Additive: four new tables. Contract: ``docs/superpowers/plans/api/agent-tests.md``.

Revision ID: 0048_agent_tests
Revises: 0047_saved_agents
Create Date: 2026-10-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0048_agent_tests"
down_revision: str | None = "0047_saved_agents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _now(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=None if nullable else sa.func.now(),
        nullable=nullable,
    )


def _owned() -> list[sa.Column]:
    return [
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "team_id",
            sa.Uuid(),
            sa.ForeignKey("team_graphs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "node_id",
            sa.Uuid(),
            sa.ForeignKey("agent_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "agent_tests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        *_owned(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column(
            "source_run_id", sa.Uuid(), sa.ForeignKey("runs.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("source_run_number", sa.Integer(), nullable=True),
        sa.Column("source_invocation_id", sa.BigInteger(), nullable=True),
        sa.Column("source_iteration", sa.Integer(), nullable=True),
        sa.Column("source_row", sa.Integer(), nullable=True),
        sa.Column("inputs", postgresql.JSONB(), nullable=False),
        sa.Column("diff", sa.LargeBinary(), nullable=True),
        sa.Column("checks", postgresql.JSONB(), nullable=False),
        _now("created_at"),
        _now("updated_at"),
    )
    op.create_index("ix_agent_tests_node_id", "agent_tests", ["node_id"])
    op.create_table(
        "agent_test_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        # A run outlives its agent and team (its cost stays in the owner's spend).
        sa.Column(
            "team_id",
            sa.Uuid(),
            sa.ForeignKey("team_graphs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "node_id",
            sa.Uuid(),
            sa.ForeignKey("agent_nodes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("version_number", sa.Integer(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("trigger", sa.Text(), nullable=False, server_default="manual"),
        sa.Column("stop_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("waiting_for_slot", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        _now("created_at"),
        _now("heartbeat_at"),
        _now("ended_at", nullable=True),
    )
    op.create_index("ix_agent_test_runs_node_id", "agent_test_runs", ["node_id"])
    op.create_index("ix_agent_test_runs_owner_status", "agent_test_runs", ["owner_id", "status"])
    op.create_table(
        "agent_test_results",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "test_run_id",
            sa.Uuid(),
            sa.ForeignKey("agent_test_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "test_id",
            sa.Uuid(),
            sa.ForeignKey("agent_tests.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("files", postgresql.JSONB(), nullable=True),
        sa.Column("checks", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
        _now("started_at", nullable=True),
        _now("ended_at", nullable=True),
    )
    op.create_index("ix_agent_test_results_test_run_id", "agent_test_results", ["test_run_id"])
    op.create_index("ix_agent_test_results_status", "agent_test_results", ["status"])
    op.create_table(
        "ai_check_usage",
        sa.Column(
            "owner_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("month", sa.Text(), primary_key=True),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("ai_check_usage")
    op.drop_index("ix_agent_test_results_status", table_name="agent_test_results")
    op.drop_index("ix_agent_test_results_test_run_id", table_name="agent_test_results")
    op.drop_table("agent_test_results")
    op.drop_index("ix_agent_test_runs_owner_status", table_name="agent_test_runs")
    op.drop_index("ix_agent_test_runs_node_id", table_name="agent_test_runs")
    op.drop_table("agent_test_runs")
    op.drop_index("ix_agent_tests_node_id", table_name="agent_tests")
    op.drop_table("agent_tests")
