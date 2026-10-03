"""desktop_node_jobs.purpose, agent_test_runs.desktop_target, compare_desktop_targets — M-desk

On the Desktop, Compare (and task sets), agent tests and Ask run on the owner's subscriptions
through the Desktop runner (brief ``prompts/m-desk-routes.md``, D2 D4 D6):

* ``desktop_node_jobs.purpose``: what a Desktop job is for — ``run_node`` (a run's node: every
  existing job, the server default), ``test_replay`` (one agent test's replay) or ``ask`` (one Ask
  about a node of a run).
* ``agent_test_runs.desktop_target``: the tests were started from Tvashtr Desktop (NULL: the
  website, as every existing row).
* ``compare_desktop_targets``: one row per compare started from Tvashtr Desktop, so the runs it
  launches later (from the queue, or a set's later tasks) are Desktop-routed too. A table rather
  than a ``compares`` column: that table's column set is the M8 contract, pinned as such.

Additive: two nullable columns and one new table, no backfill. ``downgrade()`` drops them.

Revision ID: 0053_desktop_routes
Revises: 0052_canvas_extras
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0053_desktop_routes"
down_revision: str | None = "0052_canvas_extras"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "desktop_node_jobs",
        sa.Column("purpose", sa.Text(), nullable=True, server_default="run_node"),
    )
    op.add_column("agent_test_runs", sa.Column("desktop_target", sa.Boolean(), nullable=True))
    op.create_table(
        "compare_desktop_targets",
        sa.Column(
            "compare_id",
            sa.Uuid(),
            sa.ForeignKey("compares.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("compare_desktop_targets")
    op.drop_column("agent_test_runs", "desktop_target")
    op.drop_column("desktop_node_jobs", "purpose")
