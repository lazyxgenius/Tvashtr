"""memory polarity — the directive-force tag on every node_memories row (M-memory S1b)

Revision ID: 0026_memory_polarity
Revises: 0025_node_memories
Create Date: 2026-07-12

M-memory Slice 1b (the ONLY migration this slice): add ``polarity`` — a single first-class
attribute naming a memory's directive FORCE — to every ``node_memories`` row, so the write slice
(S2) can label each learned fact and the read slice (S3) can render it. PURE SUBSTRATE (no
distillation / injection / triage / frontend — those are S2/S3/S5).

``polarity`` is ``TEXT NOT NULL`` with a ``server_default`` of ``'context'``. Because it is added
NOT NULL **with** a constant server default, Postgres (>= 11) backfills every pre-existing row to
``'context'`` as a fast metadata-only change — no separate UPDATE. A CHECK constraint
(``ck_node_memories_polarity``) restricts the value set to the 6-value RFC-2119 taxonomy:

    require (MUST) · prefer (SHOULD) · allow (MAY) · context (neutral — the DEFAULT) ·
    avoid (SHOULD NOT) · forbid (MUST NOT)

The CHECK is defense-in-depth behind the app-level validation in ``control_plane.memory`` (an
invalid value is rejected 422 before it ever reaches the DB). Additive + backfill-safe.
``downgrade()`` drops the CHECK then the column; the migration round-trips (``downgrade -1`` ->
``upgrade head``). Chains
``0025`` -> ``0026``, head ``0026`` (the freeze hook is bumped to add ``0026`` as this slice's LAST
step). Revision id kept <= 32 chars for alembic's ``version_num`` column.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0026_memory_polarity"
down_revision: str | None = "0025_node_memories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_POLARITY_CK = "ck_node_memories_polarity"
_POLARITY_VALUES = ("require", "prefer", "allow", "context", "avoid", "forbid")


def upgrade() -> None:
    # NOT NULL + a constant server_default => every existing row auto-fills 'context' (PG >= 11 fast
    # metadata-only add; no backfill UPDATE needed — verify the existing rows read 'context').
    op.add_column(
        "node_memories",
        sa.Column("polarity", sa.Text(), nullable=False, server_default=sa.text("'context'")),
    )
    # Restrict to the 6-value taxonomy (defense-in-depth behind the app-level validation).
    values = ", ".join(f"'{v}'" for v in _POLARITY_VALUES)
    op.create_check_constraint(_POLARITY_CK, "node_memories", f"polarity IN ({values})")


def downgrade() -> None:
    op.drop_constraint(_POLARITY_CK, "node_memories", type_="check")
    op.drop_column("node_memories", "polarity")
