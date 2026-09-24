"""desktop node jobs remember which Fly machine holds their workspace

M-subs-prod: prod runs more than one Fly machine, each with its own disk, and the run workspace
lives only on the machine executing the run's workflow. ``desktop_node_jobs.workspace_machine_id``
records that machine's ``FLY_MACHINE_ID`` when the job is enqueued (and follows a DBOS recovery onto
another machine), so a snapshot request that lands elsewhere is ``fly-replay``-ed to the holder.
NULL off Fly — every existing row and every non-Fly deployment keeps today's behaviour.

Revision ID: 0040_desktop_job_machine
Revises: 0039_desktop_runner
Create Date: 2026-09-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0040_desktop_job_machine"
down_revision: str | None = "0039_desktop_runner"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "desktop_node_jobs",
        sa.Column("workspace_machine_id", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("desktop_node_jobs", "workspace_machine_id")
