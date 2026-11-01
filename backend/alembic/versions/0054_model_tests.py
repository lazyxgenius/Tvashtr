"""user_models, model_test_cases, model_test_set_versions, model_test_runs, model_test_results

Models 1 (brief ``prompts/models-1.md``): a customer describes one job, writes versioned tests, runs
them on any model they hold a key for and compares the results.

* ``user_models``: one job (name, job, kind of answer, choices) and its current test set version
  (0 = no test set yet).
* ``model_test_cases``: immutable, one row = one revision of one test; ``case_key`` is the test's
  identity across revisions.
* ``model_test_set_versions``: immutable snapshots of the job, the choices and the ordered case ids.
* ``model_test_runs``: one model on one version. ``model_test_results``: one row per test of a run,
  unique on ``(run_id, case_id)`` so a retried DBOS step replaces its own row.

Additive: five new tables, no existing table changes, no key is ever stored here. ``downgrade()``
drops them.

Revision ID: 0054_model_tests
Revises: 0053_desktop_routes
Create Date: 2026-11-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0054_model_tests"
down_revision: str | None = "0053_desktop_routes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def _model_id() -> sa.Column:
    return sa.Column(
        "model_id",
        sa.Uuid(),
        sa.ForeignKey("user_models.id", ondelete="CASCADE"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "user_models",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("job", sa.Text(), nullable=False),
        sa.Column("answer_kind", sa.Text(), nullable=False),
        sa.Column(
            "choices", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("current_version", sa.Integer(), nullable=False, server_default="0"),
        _created_at(),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("answer_kind IN ('choice', 'text')", name="ck_user_models_answer_kind"),
    )
    op.create_index("ix_user_models_owner_id", "user_models", ["owner_id"])
    op.create_index(
        "uq_user_models_owner_lower_name",
        "user_models",
        ["owner_id", sa.text("lower(name)")],
        unique=True,
    )

    op.create_table(
        "model_test_cases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _model_id(),
        sa.Column("case_key", sa.Uuid(), nullable=False),
        sa.Column("input", sa.Text(), nullable=False),
        sa.Column("expected", sa.Text(), nullable=False),
        sa.Column("scoring", sa.Text(), nullable=False),
        sa.Column(
            "must_contain",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("rubric", sa.Text(), nullable=True),
        sa.Column("judge_model", sa.Text(), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            "scoring IN ('exact', 'contains', 'judge')", name="ck_model_test_cases_scoring"
        ),
    )
    op.create_index("ix_model_test_cases_model_id", "model_test_cases", ["model_id"])

    op.create_table(
        "model_test_set_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _model_id(),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("job", sa.Text(), nullable=False),
        sa.Column("answer_kind", sa.Text(), nullable=False),
        sa.Column(
            "choices", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column(
            "case_ids", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("change_note", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        _created_at(),
        sa.UniqueConstraint("model_id", "version", name="uq_model_test_set_versions_model_version"),
    )
    op.create_index("ix_model_test_set_versions_model_id", "model_test_set_versions", ["model_id"])

    op.create_table(
        "model_test_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _model_id(),
        sa.Column(
            "version_id",
            sa.Uuid(),
            sa.ForeignKey("model_test_set_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("model_slug", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="running"),
        sa.Column("stop_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("cases_total", sa.Integer(), nullable=False),
        sa.Column("price_known", sa.Boolean(), nullable=False),
        sa.Column("estimate_usd", sa.Numeric(12, 6), nullable=True),
        sa.Column("passed", sa.Integer(), nullable=True),
        sa.Column("failed", sa.Integer(), nullable=True),
        sa.Column("errors", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=True),
        sa.Column("judge_cost_usd", sa.Numeric(12, 6), nullable=True),
        sa.Column("avg_latency_ms", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        _created_at(),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('running', 'completed', 'failed', 'stopped')",
            name="ck_model_test_runs_status",
        ),
    )
    op.create_index("ix_model_test_runs_model_id", "model_test_runs", ["model_id"])

    op.create_table(
        "model_test_results",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id",
            sa.Uuid(),
            sa.ForeignKey("model_test_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "case_id",
            sa.Uuid(),
            sa.ForeignKey("model_test_cases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("case_key", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("verdict", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("model_used", sa.Text(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("judge_model", sa.Text(), nullable=True),
        sa.Column("judge_cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        _created_at(),
        sa.UniqueConstraint("run_id", "case_id", name="uq_model_test_results_run_case"),
        sa.CheckConstraint(
            "verdict IN ('pass', 'fail', 'error')", name="ck_model_test_results_verdict"
        ),
    )
    op.create_index("ix_model_test_results_run_id", "model_test_results", ["run_id"])
    op.create_index("ix_model_test_results_case_id", "model_test_results", ["case_id"])


def downgrade() -> None:
    op.drop_table("model_test_results")
    op.drop_table("model_test_runs")
    op.drop_table("model_test_set_versions")
    op.drop_table("model_test_cases")
    op.drop_table("user_models")
