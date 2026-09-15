"""domain_eval_cases + domain_eval_runs — PolyRAG Phase 6 eval

Revision ID: 0037_domain_eval
Revises: 0036_domain_chunks_fts
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0037_domain_eval"
down_revision: str | None = "0036_domain_chunks_fts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "domain_eval_cases",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "domain_id",
            sa.Uuid(),
            sa.ForeignKey("domains.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("expected_answer", sa.Text(), nullable=True),
        sa.Column(
            "expected_citation_doc_ids",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "expected_keywords",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_domain_eval_cases_domain_id", "domain_eval_cases", ["domain_id"])

    op.create_table(
        "domain_eval_runs",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "domain_id",
            sa.Uuid(),
            sa.ForeignKey("domains.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("scores", JSONB(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_domain_eval_runs_domain_id", "domain_eval_runs", ["domain_id"])


def downgrade() -> None:
    op.drop_index("ix_domain_eval_runs_domain_id", table_name="domain_eval_runs")
    op.drop_table("domain_eval_runs")
    op.drop_index("ix_domain_eval_cases_domain_id", table_name="domain_eval_cases")
    op.drop_table("domain_eval_cases")
