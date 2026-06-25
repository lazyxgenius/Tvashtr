"""team_graphs.is_library — first-class library-team identity (P1.8b team library)

Revision ID: 0013_team_graph_is_library
Revises: 0012_agent_node_prompt
Create Date: 2026-06-25

Replaces the P1.8b-1 singleton-by-name persistent team with first-class, multiple persistent teams.
A library team is a ``team_graphs`` row with ``is_library = true``; the user's team list is
``WHERE is_library``. The hardcoded builders + ``clone_team_graph`` never set the flag → it defaults
``false``, so a run's clone-on-launch snapshot, the A/B graphs, and the smoke graphs are all
non-library and can never appear in (or be deleted from) the library list.

* ``is_library`` Boolean NOT NULL, ``server_default false`` — additive, so every existing
  ``team_graphs`` row is valid without a backfill.
* Data step: PROMOTE the existing P1.8b-1 singleton (the reserved name ``"My team"``) to a library
  team, so the user's prior edits carry forward as their first library team (no-op if absent).

Additive + server_default → existing rows stay valid; no frozen migration (``0001``–``0012``) is
touched; clean ``0012`` → ``0013`` chain, head ``0013``.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0013_team_graph_is_library"
down_revision: str | None = "0012_agent_node_prompt"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "team_graphs",
        sa.Column("is_library", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Promote the P1.8b-1 singleton (the reserved name) so the user's edits become their first
    # library team. No-op if absent (a fresh DB seeds one via ``seed_library_if_empty``).
    op.execute("UPDATE team_graphs SET is_library = true WHERE name = 'My team'")


def downgrade() -> None:
    op.drop_column("team_graphs", "is_library")
