"""domain_chunks.embedding unbound vector — multi-dim Domains embeds (Groq 768)

Revision ID: 0038_domain_chunks_unbound_vec
Revises: 0037_domain_eval
Create Date: 2026-09-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0038_domain_chunks_unbound_vec"
down_revision: str | None = "0037_domain_eval"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop fixed 1536 so Domains can store Groq Nomic 768 alongside OpenAI 1536.
    # Existing 1536 rows cast cleanly to unbound vector. node_memories untouched.
    op.execute(
        "ALTER TABLE domain_chunks "
        "ALTER COLUMN embedding TYPE vector USING embedding::vector"
    )
    # ORM: Vector() (dim=None). No HNSW on this column historically.


def downgrade() -> None:
    # Fails if any non-null embedding is not exactly 1536 — intentional.
    op.execute(
        "ALTER TABLE domain_chunks "
        "ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector(1536)"
    )
