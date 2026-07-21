"""run_artifacts — a greenfield run's shipped diff, snapshotted durably at ship time (M-wsgc S1)

Revision ID: 0031_run_artifacts
Revises: 0030_hosted_github_run
Create Date: 2026-07-21

The ONE migration of the Tvashtr-79 batch, and the substrate for PERSIST-THEN-REAP.

``0030``-and-earlier, a GREENFIELD run's workspace could never be reclaimed: ``idempotent_ship``
makes the run's commit + tag INSIDE that directory's own git repo and there is no remote, so the
directory *was* the deliverable — and ``run_diff._greenfield_files`` served the run view's "Changes"
tab straight out of it. The workspace reaper therefore spared greenfield FOREVER (the Tvashtr-78
ruling), which closed the unbounded-growth item only halfway.

This table is what lets the other half close. One row per run:

* ``run_artifacts.run_id`` — ``Uuid``, NOT NULL, FK -> ``runs.id`` (``ondelete=CASCADE``, so a
  deleted run takes its snapshot with it) and **UNIQUE** (a single unique index doubles as the
  lookup index). The uniqueness is load-bearing, not cosmetic: ``ship_step`` is a DBOS step that a
  crash can re-run, so the writer UPSERTs ``ON CONFLICT (run_id) DO UPDATE`` and a re-ship
  re-persists the same snapshot rather than duplicating it.
* ``run_artifacts.files`` — ``JSONB``, NOT NULL. The WHOLE ``compute_run_diff`` result dict
  (``{run_id, base_ref, ship_branch, files, total}``), stored verbatim so
  ``GET /api/runs/{id}/diff`` can return it byte-for-byte identically to a live computation once
  the directory is gone.
* ``run_artifacts.created_at`` — ``TIMESTAMP(timezone=True)``, ``now()`` default.

A fresh child table: purely additive, no existing table rewritten, no column altered, no backfill —
every existing row stays valid and every existing run keeps behaving exactly as it does today
(no row ⇒ still spared, which is the safe state the hard invariant rests on). ``downgrade()`` drops
the index + table, round-tripping (``downgrade -1`` -> ``upgrade head``). Chains ``0030`` ->
``0031``, head ``0031`` (the migration-freeze hook is bumped to also cover ``0031`` as this
milestone's LAST step). Revision id kept <= 32 chars for alembic's ``version_num`` column.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0031_run_artifacts"
down_revision: str | None = "0030_hosted_github_run"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # run_artifacts — one durable diff snapshot per greenfield run (shaped like run_warnings).
    op.create_table(
        "run_artifacts",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("files", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["run_id"], ["runs.id"], name="fk_run_artifacts_run_id_runs", ondelete="CASCADE"
        ),
    )
    # UNIQUE index — one artifact per run, and the ON CONFLICT target the idempotent ship upsert
    # arbitrates on. Matches the model's ``unique=True, index=True`` (SQLAlchemy emits exactly one
    # unique index for that pair), so no second plain index is created.
    op.create_index("ix_run_artifacts_run_id", "run_artifacts", ["run_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_run_artifacts_run_id", table_name="run_artifacts")
    op.drop_table("run_artifacts")
