"""run_events + cost_records invocation_id — the durable invocation join key (M-ledger C5)

Revision ID: 0020_invocation_scoped_events
Revises: 0019_invocation_manifest
Create Date: 2026-07-05

M-ledger (deep-dive C5): give every node-execution a durable ``invocation_id`` join key on the two
run-scoped tables so (a) the ``run_events`` idempotency check can key on ``(run_id, invocation_id,
seq)`` instead of ``(run_id, seq)`` — each engine ``run()`` restarts ``seq`` at 0, so a later loop
round's ``seq=0`` collided with round 1's row and was silently dropped — and (b) each cost row
attaches to the exact invocation that incurred it (the ``/graph`` + ``/trajectory`` ledger join).

Three additive + nullable changes, NO backfill (legacy rows keep NULL; Postgres treats NULLs as
distinct so the new ``run_events`` unique constraint accepts them):

* ``run_events.invocation_id`` (+ index ``ix_run_events_invocation_id``); DROP the unique constraint
  ``uq_run_events_run_seq`` (run_id, seq), ADD unique ``uq_run_events_run_invocation_seq``
  (run_id, invocation_id, seq).
* ``cost_records.invocation_id`` (+ index ``ix_cost_records_invocation_id``).

Chains cleanly ``0019`` -> ``0020``, head ``0020`` (the migration-freeze hook is bumped to include
``0020`` as the milestone's LAST step). Revision id kept <=32 chars for alembic's ``version_num``
column. ``downgrade()`` reverses all of it.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0020_invocation_scoped_events"
down_revision: str | None = "0019_invocation_manifest"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # run_events: the invocation join key + the invocation-scoped idempotency constraint (the fix
    # for the cross-invocation seq collision that silently dropped every round after the first).
    op.add_column("run_events", sa.Column("invocation_id", sa.BigInteger(), nullable=True))
    op.create_index("ix_run_events_invocation_id", "run_events", ["invocation_id"])
    op.drop_constraint("uq_run_events_run_seq", "run_events", type_="unique")
    op.create_unique_constraint(
        "uq_run_events_run_invocation_seq",
        "run_events",
        ["run_id", "invocation_id", "seq"],
    )
    # cost_records: attach each metered spend to the invocation it belongs to.
    op.add_column("cost_records", sa.Column("invocation_id", sa.BigInteger(), nullable=True))
    op.create_index("ix_cost_records_invocation_id", "cost_records", ["invocation_id"])


def downgrade() -> None:
    op.drop_index("ix_cost_records_invocation_id", table_name="cost_records")
    op.drop_column("cost_records", "invocation_id")
    op.drop_constraint("uq_run_events_run_invocation_seq", "run_events", type_="unique")
    op.create_unique_constraint("uq_run_events_run_seq", "run_events", ["run_id", "seq"])
    op.drop_index("ix_run_events_invocation_id", table_name="run_events")
    op.drop_column("run_events", "invocation_id")
