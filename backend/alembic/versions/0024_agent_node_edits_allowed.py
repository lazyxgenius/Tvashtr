"""agent_nodes.edits_allowed — the M-unify U1 capability toggle (loop-always + the edits toggle)

Revision ID: 0024_agent_node_edits_allowed
Revises: 0023_tool_skill_library
Create Date: 2026-07-09

M-unify U1 (executor unification core): after this slice EVERY ``AgentNode`` executes through the
single agent path (the one workers use today). The ONLY capability distinction is this new boolean:

* ``edits_allowed = true``  — a worker: its file changes are pulled back to the shippable worktree.
* ``edits_allowed = false`` — report-only: it runs the full agent loop (read/terminal + its
  configured MCP tools + skills) but NONE of its file changes leave the sandbox — its pull is
  EXACTLY ``REPORT.md`` + ``REVIEW_VERDICT.json``.

``kind`` (``completion``/``agent``/``gate``/``terminal``) STAYS in place but is now vestigial for
dispatch — this boolean supersedes the completion-vs-agent execution split. A later slice drops
``kind``; this one only adds the durable capability slot + backfills the mapping.

Backfill (the one durable mapping): ``edits_allowed = (kind = 'agent')`` — so a pre-existing
``agent`` node (a worker) becomes edits-ON and a ``completion`` (thinker/PM) — plus the ``gate`` /
``terminal`` control primitives — become edits-OFF. Additive + reversible.

Column is NOT NULL with **NO server default** (a static server default of ``true`` is deliberately
NOT desired): every new-node insert derives the value from its ``kind`` at the create path (the ORM
column's kind-mapped default + the API ``_build_node`` + ``clone_team_graph`` carry it), so a row's
capability always tracks how it was authored, never a blanket DB default.

Chains ``0023`` -> ``0024``, head ``0024`` (the migration-freeze hook is bumped to add ``0024`` as
this milestone's LAST step). Revision id kept <=32 chars for alembic's ``version_num`` column.
``downgrade()`` drops the column (reversible).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0024_agent_node_edits_allowed"
down_revision: str | None = "0023_tool_skill_library"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add the column NULLABLE first (an existing table has rows; a NOT NULL add with no server
    #    default would reject them).
    op.add_column("agent_nodes", sa.Column("edits_allowed", sa.Boolean(), nullable=True))
    # 2. Backfill the one durable mapping: a worker (``agent``) is edits-ON; every other kind
    #    (``completion`` thinker/PM, plus ``gate``/``terminal`` control primitives) is edits-OFF.
    op.execute("UPDATE agent_nodes SET edits_allowed = (kind = 'agent')")
    # 3. Enforce NOT NULL. NO server default is set — new rows get their value from the create path
    #    (the ORM kind-mapped default / the API build + clone), never a blanket DB default.
    op.alter_column("agent_nodes", "edits_allowed", nullable=False)


def downgrade() -> None:
    op.drop_column("agent_nodes", "edits_allowed")
