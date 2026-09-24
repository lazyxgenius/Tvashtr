"""desktop runner — subscription node jobs, runner heartbeats, desktop-targeted runs

M-subs-desktop: Tvashtr Desktop runs a team's Claude/Grok nodes with the owner's OWN CLI sign-in.
The hosted control plane stays the only executor; a desktop-targeted run's subscription nodes are
queued as ``desktop_node_jobs`` for the owner's Desktop runner, whose polls land in
``desktop_runner_heartbeats``. ``runs`` gains the two launch-time routing columns (defaults keep
every existing row + hosted caller unchanged). No secret of any kind is stored.

Revision ID: 0039_desktop_runner
Revises: 0038_domain_chunks_unbound_vec
Create Date: 2026-09-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0039_desktop_runner"
down_revision: str | None = "0038_domain_chunks_unbound_vec"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column("desktop_target", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "runs",
        sa.Column("desktop_subscriptions", postgresql.JSONB(), nullable=True),
    )
    op.create_table(
        "desktop_node_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("node_id", sa.Text(), nullable=False),
        sa.Column("attempt_key", sa.Text(), nullable=False),
        sa.Column("invocation_id", sa.BigInteger(), nullable=True),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("workspace_dir", sa.Text(), nullable=False),
        sa.Column("sidecars", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("result_text", sa.Text(), nullable=True),
        sa.Column("patch", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("usage", postgresql.JSONB(), nullable=True),
        sa.Column("files_changed", postgresql.JSONB(), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("run_id", "attempt_key", name="uq_desktop_node_jobs_run_attempt"),
    )
    op.create_index("ix_desktop_node_jobs_owner_id", "desktop_node_jobs", ["owner_id"])
    op.create_index("ix_desktop_node_jobs_run_id", "desktop_node_jobs", ["run_id"])
    op.create_table(
        "desktop_runner_heartbeats",
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("providers", postgresql.JSONB(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_table("desktop_runner_heartbeats")
    op.drop_index("ix_desktop_node_jobs_run_id", table_name="desktop_node_jobs")
    op.drop_index("ix_desktop_node_jobs_owner_id", table_name="desktop_node_jobs")
    op.drop_table("desktop_node_jobs")
    op.drop_column("runs", "desktop_subscriptions")
    op.drop_column("runs", "desktop_target")
