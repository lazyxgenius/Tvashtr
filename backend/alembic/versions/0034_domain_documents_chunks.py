"""domain_documents + domain_chunks — PolyRAG Phase 2 ingest

Revision ID: 0034_domain_documents_chunks
Revises: 0033_domains
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0034_domain_documents_chunks"
down_revision: str | None = "0033_domains"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "domain_documents",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "domain_id",
            sa.Uuid(),
            sa.ForeignKey("domains.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("ingest_status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_domain_documents_domain_id", "domain_documents", ["domain_id"])

    op.create_table(
        "domain_chunks",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "domain_id",
            sa.Uuid(),
            sa.ForeignKey("domains.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("domain_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column("meta", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_domain_chunks_domain_id", "domain_chunks", ["domain_id"])
    op.create_index("ix_domain_chunks_document_id", "domain_chunks", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_domain_chunks_document_id", table_name="domain_chunks")
    op.drop_index("ix_domain_chunks_domain_id", table_name="domain_chunks")
    op.drop_table("domain_chunks")
    op.drop_index("ix_domain_documents_domain_id", table_name="domain_documents")
    op.drop_table("domain_documents")
