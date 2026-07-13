"""users.memory_review_mode — the per-owner review-before-persist toggle (M-memory S4)

Revision ID: 0027_memory_review_mode
Revises: 0026_memory_polarity
Create Date: 2026-07-13

M-memory Slice 4 (the ONLY migration this slice): add ``memory_review_mode`` — a single per-owner
boolean — to every ``users`` row. When a user turns it ON, every memory write that would otherwise
land ``status='active'`` (the run-END distilled positive/neutral/success facts AND the deliberate
agent-remember captures) lands ``status='pending_review'`` instead, and any supersession of an
existing active fact is DEFERRED until the human promotes it. OFF (the default) is the pre-S4
behaviour exactly — only failed-run negatives are quarantined (S2 layer 3).

``memory_review_mode`` is ``BOOLEAN NOT NULL`` with a ``server_default`` of ``false``. Because it is
added NOT NULL **with** a constant server default, Postgres (>= 11) backfills every pre-existing row
to ``false`` as a fast metadata-only change — no separate UPDATE, no table rewrite. Purely additive
and backfill-safe. ``downgrade()`` drops the column; the migration round-trips (``downgrade -1`` ->
``upgrade head``). Chains ``0026`` -> ``0027``, head ``0027`` (the freeze hook is bumped to add
``0027`` as this slice's LAST step). Revision id kept <= 32 chars for alembic's ``version_num``
column.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0027_memory_review_mode"
down_revision: str | None = "0026_memory_polarity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # NOT NULL + a constant server_default => every existing user auto-fills false (PG >= 11 fast
    # metadata-only add; no backfill UPDATE needed). Off = the pre-S4 write behaviour exactly.
    op.add_column(
        "users",
        sa.Column(
            "memory_review_mode",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "memory_review_mode")
