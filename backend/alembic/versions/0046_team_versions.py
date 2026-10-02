"""team_versions + runs.team_version_number — M5 Team versions

A version is an explicit checkpoint of a library team (ruling R3): ``number`` (v1, v2, … unique per
team), the team in the M4 team-file format (``snapshot``, for the file and Compare), a full copy of
its rows (``graph``: the team's name / budget / repo, every node by id and every edge — What changed
and Restore read it; never sent to the browser), a plain ``summary`` ("Reviewer: instructions
changed"), an optional ``note``, who saved it, how (``source``: first / save / run / restore) and,
for a restore, the version it restored. Deleting the team deletes its versions.
``runs.team_version_number``: the version a run started on (NULL for a run of an ephemeral team, and
for runs from before M5). Additive: a new table and a nullable column, no backfill (a team gets v1
the first time anything asks). Contract: ``docs/superpowers/plans/api/versions.md``.

Revision ID: 0046_team_versions
Revises: 0045_team_defaults
Create Date: 2026-10-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0046_team_versions"
down_revision: str | None = "0045_team_defaults"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "team_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "team_graph_id",
            sa.Uuid(),
            sa.ForeignKey("team_graphs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("graph", postgresql.JSONB(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("source", sa.Text(), nullable=False, server_default="save"),
        sa.Column("restored_from", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("team_graph_id", "number", name="uq_team_versions_team_number"),
    )
    op.create_index("ix_team_versions_team_graph_id", "team_versions", ["team_graph_id"])
    op.add_column("runs", sa.Column("team_version_number", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "team_version_number")
    op.drop_index("ix_team_versions_team_graph_id", table_name="team_versions")
    op.drop_table("team_versions")
