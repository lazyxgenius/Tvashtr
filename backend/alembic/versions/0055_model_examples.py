"""model training examples, training set versions, example batches and drafts; test sources

M2 (brief ``prompts/m2-examples.md``): a model gains a training set kept apart from its tests, and an
agent team can draft both from a Domain, each draft quoting its source.

* ``model_test_cases`` + ``source`` (jsonb, null), ``origin`` (``hand|csv|draft``, null = before M2)
  and ``origin_note`` (the CSV's filename or the drafting team's name).
* ``user_models`` + ``training_version`` (0 = no training set yet).
* ``model_training_examples``: immutable, one row = one revision of one example (``example_key`` is
  its identity across revisions).
* ``model_training_set_versions``: immutable, the ordered example ids of one version.
* ``model_example_batches``: one drafting run for one model (unique on ``run_id``).
* ``model_example_drafts``: what the team handed in, until the customer accepts or rejects it.

Additive: new tables and nullable or defaulted columns only, so the code before M2 runs on a
database at ``0055``. No key is ever stored here. ``downgrade()`` drops them.

Revision ID: 0055_model_examples
Revises: 0054_model_tests
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0055_model_examples"
down_revision: str | None = "0054_model_tests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _now(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def _model_id() -> sa.Column:
    return sa.Column(
        "model_id", sa.Uuid(), sa.ForeignKey("user_models.id", ondelete="CASCADE"), nullable=False
    )


def _jsonb_list(name: str) -> sa.Column:
    return sa.Column(
        name, postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
    )


def upgrade() -> None:
    op.add_column("model_test_cases", sa.Column("source", postgresql.JSONB(), nullable=True))
    op.add_column("model_test_cases", sa.Column("origin", sa.Text(), nullable=True))
    op.add_column("model_test_cases", sa.Column("origin_note", sa.Text(), nullable=True))
    op.add_column(
        "user_models",
        sa.Column("training_version", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "model_training_examples",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _model_id(),
        sa.Column("example_key", sa.Uuid(), nullable=False),
        sa.Column("input", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("source", postgresql.JSONB(), nullable=True),
        sa.Column("origin", sa.Text(), nullable=False),
        sa.Column("origin_note", sa.Text(), nullable=True),
        sa.Column("edited", sa.Boolean(), nullable=False, server_default=sa.false()),
        _now("created_at"),
        sa.CheckConstraint(
            "origin IN ('hand', 'csv', 'draft')", name="ck_model_training_examples_origin"
        ),
    )
    op.create_index("ix_model_training_examples_model_id", "model_training_examples", ["model_id"])

    op.create_table(
        "model_training_set_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _model_id(),
        sa.Column("version", sa.Integer(), nullable=False),
        _jsonb_list("example_ids"),
        sa.Column("change_note", sa.Text(), nullable=False),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        _now("created_at"),
        sa.UniqueConstraint(
            "model_id", "version", name="uq_model_training_set_versions_model_version"
        ),
    )
    op.create_index(
        "ix_model_training_set_versions_model_id", "model_training_set_versions", ["model_id"]
    )

    op.create_table(
        "model_example_batches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _model_id(),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "run_id",
            sa.Uuid(),
            sa.ForeignKey("runs.id", ondelete="SET NULL"),
            nullable=True,
            unique=True,
        ),
        sa.Column(
            "domain_id", sa.Uuid(), sa.ForeignKey("domains.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("domain_name", sa.Text(), nullable=False),
        sa.Column(
            "team_id",
            sa.Uuid(),
            sa.ForeignKey("team_graphs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("team_name", sa.Text(), nullable=False),
        sa.Column("tests_wanted", sa.Integer(), nullable=False),
        sa.Column("training_wanted", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="drafting"),
        sa.Column("review_rounds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_back", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("estimate_usd", sa.Numeric(12, 6), nullable=True),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=True),
        _now("created_at"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('drafting', 'ready')", name="ck_model_example_batches_status"
        ),
    )
    op.create_index("ix_model_example_batches_model_id", "model_example_batches", ["model_id"])
    op.create_index("ix_model_example_batches_owner_id", "model_example_batches", ["owner_id"])

    op.create_table(
        "model_example_drafts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "batch_id",
            sa.Uuid(),
            sa.ForeignKey("model_example_batches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        _model_id(),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("input", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        _jsonb_list("must_contain"),
        sa.Column("source", postgresql.JSONB(), nullable=False),
        sa.Column("review", sa.Text(), nullable=False, server_default="none"),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.Text(), nullable=True),
        sa.Column("was_flagged", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("edited", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("state", sa.Text(), nullable=False, server_default="open"),
        _now("created_at"),
        _now("updated_at"),
        sa.CheckConstraint("kind IN ('test', 'training')", name="ck_model_example_drafts_kind"),
        sa.CheckConstraint(
            "review IN ('none', 'ok', 'flagged')", name="ck_model_example_drafts_review"
        ),
        sa.CheckConstraint(
            "state IN ('open', 'accepted', 'rejected')", name="ck_model_example_drafts_state"
        ),
    )
    op.create_index("ix_model_example_drafts_batch_id", "model_example_drafts", ["batch_id"])
    op.create_index("ix_model_example_drafts_model_id", "model_example_drafts", ["model_id"])


def downgrade() -> None:
    op.drop_table("model_example_drafts")
    op.drop_table("model_example_batches")
    op.drop_table("model_training_set_versions")
    op.drop_table("model_training_examples")
    op.drop_column("user_models", "training_version")
    op.drop_column("model_test_cases", "origin_note")
    op.drop_column("model_test_cases", "origin")
    op.drop_column("model_test_cases", "source")
