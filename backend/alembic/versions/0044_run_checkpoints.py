"""run_checkpoints + runs.resumed_from_* — M3 Resume from here (ruling R8)

* ``run_checkpoints``: one row per finished agent step — the run workspace's change against the
  commit its branch started from (``diff``, binary git patch; NULL when over the size cap, then
  ``too_large``), that commit (``base_sha``) and the step it follows (``invocation_id``, unique, so
  writing it again is a no-op). Enough to rebuild the workspace with no old sandbox.
* ``runs.resumed_from_run_id`` / ``runs.resumed_from_step``: a run made by Resume names the run it
  picks up and the step of that run it starts again from (an ``agent_invocations`` id).

Additive: a fresh table and two nullable columns, no backfill. ``downgrade()`` drops them.
Contract: ``docs/superpowers/plans/api/resume.md``.

Revision ID: 0044_run_checkpoints
Revises: 0043_connector_connections
Create Date: 2026-10-02
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0044_run_checkpoints"
down_revision: str | None = "0043_connector_connections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_T = "run_checkpoints"


def upgrade() -> None:
    op.create_table(
        _T,
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("invocation_id", sa.BigInteger(), nullable=False),
        sa.Column("node_id", sa.Uuid(), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("base_sha", sa.Text(), nullable=False),
        sa.Column("diff", sa.LargeBinary(), nullable=True),
        sa.Column("too_large", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["run_id"], ["runs.id"], name=f"fk_{_T}_run_id_runs", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["invocation_id"],
            ["agent_invocations.id"],
            name=f"fk_{_T}_invocation_id_agent_invocations",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("invocation_id", name=f"uq_{_T}_invocation_id"),
    )
    op.create_index(f"ix_{_T}_run_id", _T, ["run_id"])
    op.add_column("runs", sa.Column("resumed_from_run_id", sa.Uuid(), nullable=True))
    op.add_column("runs", sa.Column("resumed_from_step", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_runs_resumed_from_run_id_runs",
        "runs",
        "runs",
        ["resumed_from_run_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_runs_resumed_from_step_agent_invocations",
        "runs",
        "agent_invocations",
        ["resumed_from_step"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_runs_resumed_from_run_id", "runs", ["resumed_from_run_id"])


def downgrade() -> None:
    op.drop_index("ix_runs_resumed_from_run_id", table_name="runs")
    op.drop_constraint("fk_runs_resumed_from_step_agent_invocations", "runs", type_="foreignkey")
    op.drop_constraint("fk_runs_resumed_from_run_id_runs", "runs", type_="foreignkey")
    op.drop_column("runs", "resumed_from_step")
    op.drop_column("runs", "resumed_from_run_id")
    op.drop_index(f"ix_{_T}_run_id", table_name=_T)
    op.drop_table(_T)
