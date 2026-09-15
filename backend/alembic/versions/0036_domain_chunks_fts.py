"""domain_chunks FTS tsvector — PolyRAG Phase 5 hybrid retrieval

Revision ID: 0036_domain_chunks_fts
Revises: 0035_domain_messages
Create Date: 2026-09-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0036_domain_chunks_fts"
down_revision: str | None = "0035_domain_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE domain_chunks
          ADD COLUMN text_tsv tsvector
          GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED
        """
    )
    op.execute(
        "CREATE INDEX ix_domain_chunks_text_tsv ON domain_chunks USING GIN (text_tsv)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_domain_chunks_text_tsv")
    op.execute("ALTER TABLE domain_chunks DROP COLUMN IF EXISTS text_tsv")
