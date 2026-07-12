"""node_memories — the owner-scoped agentic-memory substrate + pgvector (M-memory S1)

Revision ID: 0025_node_memories
Revises: 0024_agent_node_edits_allowed
Create Date: 2026-07-12

M-memory Slice 1 (the ONLY migration this whole milestone): the persistent, owner-scoped agentic
memory store the later slices distil into (S2), inject from (S3), and expose (S5).

* ``CREATE EXTENSION IF NOT EXISTS vector`` first — the ``pgvector/pgvector:pg16`` compose image
  makes the extension AVAILABLE; this enables it in the ``tvashtr`` database so the ``vector``
  column type resolves.
* ``node_memories`` — one row per fact. TIER is DERIVED from which of ``repo_key`` / ``node_id`` are
  set (account = both NULL, repo = repo_key only, node = both), NOT stored. ``owner_id`` FKs
  ``users.id`` (owner-scoped, like ``provider_credentials``). ``node_id`` is a PLAIN uuid
  (NOT a FK) — the authored origin node is deletable/re-addable, so a dangling value must match
  nothing (mirrors ``agent_nodes.cloned_from_node_id``). ``embedding`` is ``vector(1536)`` NULLABLE
  (1536 = ``text-embedding-3-small``'s dimension, PINNED here — a different-dimension model later
  needs a NEW migration + a re-embed). The bi-temporal / provenance columns
  (``invalid_at``/``superseded_by``/``confirmation_count``/``source_run_id``/``source_invocation_id``
  /``status``) are the supersede-not-delete substrate S2/S4 write; S1 only ever writes
  ``status='active'``.

Indexes: a btree on ``owner_id`` (owner scoping), a btree on ``(owner_id, repo_key, node_id)`` (tier
queries), a btree on ``status``, and a pgvector **ANN index** — HNSW + ``vector_cosine_ops`` (cosine
is standard for ``text-embedding-3``; HNSW is the modern default, available in pgvector >= 0.5 — the
image ships 0.8.5). Building HNSW on an empty column is fine (it fills incrementally).

Additive + nullable-safe (a fresh child table, no backfill). ``downgrade()`` drops the indexes +
the table, then ``DROP EXTENSION IF EXISTS vector`` (safe — nothing else uses it yet; the table is
gone first so nothing depends on the type). The migration round-trips (``downgrade -1`` →
``upgrade head``). Chains ``0024`` -> ``0025``, head ``0025`` (the freeze hook is bumped to
add ``0025`` as this milestone's LAST step). Revision id kept <= 32 chars for alembic's
``version_num`` column.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

revision: str = "0025_node_memories"
down_revision: str | None = "0024_agent_node_edits_allowed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Enable pgvector in this database (the image makes it available; this runs it once). MUST
    #    precede the vector column so the ``vector`` type resolves.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # 2. node_memories — one owner-scoped fact per row.
    op.create_table(
        "node_memories",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("repo_key", sa.Text(), nullable=True),
        # PLAIN uuid, NOT a FK (the authored origin node is deletable/re-addable).
        sa.Column("node_id", sa.Uuid(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        # 1536 = text-embedding-3-small's dimension (PINNED — a re-dimension needs a new migration).
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column(
            "valid_from",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("invalid_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("superseded_by", sa.Uuid(), nullable=True),
        sa.Column("confirmation_count", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("source_run_id", sa.Text(), nullable=True),
        sa.Column("source_invocation_id", sa.BigInteger(), nullable=True),
        sa.Column("pinned", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'active'"), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], name="fk_node_memories_owner_id_users"),
    )

    # 3. Indexes: owner scoping + tier queries + the status filter.
    op.create_index("ix_node_memories_owner_id", "node_memories", ["owner_id"])
    op.create_index("ix_node_memories_tier", "node_memories", ["owner_id", "repo_key", "node_id"])
    op.create_index("ix_node_memories_status", "node_memories", ["status"])

    # 4. The pgvector ANN index — HNSW + cosine (the modern default for text-embedding-3 cosine
    #    similarity; the S3 retrieval path queries it). Built via raw SQL because the operator-class
    #    (``vector_cosine_ops``) is pgvector-specific.
    op.execute(
        "CREATE INDEX ix_node_memories_embedding_hnsw ON node_memories "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.drop_index("ix_node_memories_embedding_hnsw", table_name="node_memories")
    op.drop_index("ix_node_memories_status", table_name="node_memories")
    op.drop_index("ix_node_memories_tier", table_name="node_memories")
    op.drop_index("ix_node_memories_owner_id", table_name="node_memories")
    op.drop_table("node_memories")
    # Safe: the table (the only vector user) is gone, so nothing depends on the type.
    op.execute("DROP EXTENSION IF EXISTS vector")
