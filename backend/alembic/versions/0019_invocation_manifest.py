"""agent_invocations.context_manifest — the per-worker context manifest (M-ctx1 C2/C4)

Revision ID: 0019_invocation_manifest
Revises: 0018_run_subpath
Create Date: 2026-07-04

M-ctx1 (deep-dive C2/C4): the node context compiler + input-token budget records, per WORKER
(``agent``) invocation, the compiled instruction's shape so the input budget + the SPEC.md
doc-handle are observable. One nullable JSONB column on ``agent_invocations``, parallel to
``outcome_detail`` (migration ``0011``):

* ``context_manifest`` — ``{parts: [{name, tokens}], total_tokens, budget, handle_used}``: the
  compiled context's typed parts + their (``len//4``-estimated) token sizes, the per-node input
  budget the node was checked against, and whether the large-spec doc-handle offloaded the spec to
  ``<workspace>/SPEC.md``. Written ONLY at a worker node's close; NULL for thinker/gate/terminal
  nodes and every pre-``0019`` row.

Additive + nullable + no backfill → every existing ``agent_invocations`` row stays valid, and every
``close_invocation_step`` call-site that omits the new optional param writes NULL (unchanged). The
FIRST migration since the ``0001``–``0018`` freeze; no frozen migration is touched; clean ``0018`` →
``0019`` chain, head ``0019`` (the freeze hook is bumped to ``0019`` as the milestone's LAST step).
The revision id is kept short (≤32 chars) to fit alembic's ``alembic_version.version_num`` column.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0019_invocation_manifest"
down_revision: str | None = "0018_run_subpath"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agent_invocations",
        sa.Column("context_manifest", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_invocations", "context_manifest")
