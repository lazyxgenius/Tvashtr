"""add outcome_detail to agent_invocations (P1.5c §14.3-prep)

Revision ID: 0011_invocation_outcome_detail
Revises: 0010_run_ab_pair
Create Date: 2026-06-23

Persists the Reviewer's per-round verdict REASONS so the §14.3 comparison view can
later tell the "what B caught" story. Today ``agent_invocations`` stores only the
verdict LABEL (``outcome``, e.g. ``changes_requested`` / ``approved``); the reasons
(``verdict["reasons"]``) are written nowhere queryable.

* ``outcome_detail`` Text NULL — the free-text detail behind an ``outcome`` label
  (mirrors ``outcome``; the reasons are already a bounded string, so plain Text, NOT
  JSONB). Generic name: the detail behind ANY outcome, though only the Reviewer's
  successful-verdict close populates it for now.

Nullable + no backfill: every existing row keeps ``outcome_detail`` NULL, and every
``close_invocation_step`` call-site that omits the new optional param writes NULL
(unchanged). Purely additive — NO change to the executor's control flow, the team
builders, or any frozen migration (``0001``–``0010``). There is NO read surface here
(the endpoint / FE that CONSUMES ``outcome_detail`` is §14.3).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_invocation_outcome_detail"
down_revision: str | None = "0010_run_ab_pair"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_invocations", sa.Column("outcome_detail", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_invocations", "outcome_detail")
