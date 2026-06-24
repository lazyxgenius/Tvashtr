"""add prompt to agent_nodes (P1.8a — the prompt-driven executor core)

Revision ID: 0012_agent_node_prompt
Revises: 0011_invocation_outcome_detail
Create Date: 2026-06-24

Retires fixed-function role dispatch from the executor: every agent/PM node's behavior now
comes from a per-node ``prompt`` rather than a hardcoded instruction selected by ``role_name`` /
``config.agent_kind``. ``run_graph`` runs ``node.prompt`` generically and decides a node's role in
the loop from the authored topology (does it have a conditional out-edge?), not from a capability
flag.

* ``prompt`` Text NULL — the static behavior instruction for a completion/agent node. The
  builders (``teams.py``) seed it (the PM/Engineer/Reviewer text moved off ``team_run.py``); the
  executor appends the idea / live PRD / revision context at run time. NULL for gate/terminal
  nodes (no LLM) and on every pre-0012 row.

Nullable + no backfill: additive only — every existing ``agent_nodes`` row keeps ``prompt`` NULL,
and no executor control flow, team builder, or frozen migration (``0001``–``0011``) changes here.
The capability tier still rides ``kind`` (``completion`` thinker vs ``agent`` worker); this adds
ONLY the behavior column.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012_agent_node_prompt"
down_revision: str | None = "0011_invocation_outcome_detail"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_nodes", sa.Column("prompt", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_nodes", "prompt")
