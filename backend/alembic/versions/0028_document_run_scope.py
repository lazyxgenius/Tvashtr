"""documents.run_id + documents.name — run-scoped, named work products (M-docs)

Revision ID: 0028_document_run_scope
Revises: 0027_memory_review_mode
Create Date: 2026-07-16

M-docs (the ONLY migration this milestone): a run's documents become run-scoped + NAMED so a node
can author its OWN document (``config["writes_to"]``) and another node can read it by name
(``config["reads_from"]``). Two additive, nullable columns on ``documents``:

* ``run_id`` — ``Uuid`` FK -> ``runs.id`` with ``ondelete=CASCADE`` + an index. The executor
  find-or-creates a run's documents on ``(run_id, name)``. The CASCADE ALSO closes the registered
  orphaned-``documents`` leak (deleting a run now deletes every document it produced). Nullable: the
  legacy pre-0028 rows + the ``doc_writer`` proof workflow's documents have no run and stay NULL (a
  NULL FK never cascades — legacy orphans are untouched, the leak is closed going forward).
* ``name`` — ``Text``, the document's run-scoped name (the find-or-create key's second half). The
  default document the entry node writes is ``"spec"`` (``Run.pm_document_id`` still points at it);
  a node's ``config["writes_to"]`` authors another (e.g. ``"design"``). Nullable, no server
  default: legacy / non-run documents have no name; the executor sets it on every document written.

Both columns are added NULLABLE with NO backfill, so this is a fast metadata-only change on any DB
size — purely additive and backfill-safe. Every existing team behaves byte-identically: a node with
no ``writes_to`` / ``reads_from`` keeps writing/reading the single "spec" document as before; the
only difference is that document now also carries ``run_id`` + ``name="spec"``.

``downgrade()`` drops the index, the FK, then both columns; the migration round-trips
(``downgrade -1`` -> ``upgrade head``). Chains ``0027`` -> ``0028``, head ``0028`` (the migration-
freeze hook is bumped ``2[0-7]`` -> ``2[0-8]`` as this milestone's LAST step). Revision id kept
<= 32 chars for alembic's ``version_num`` column.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0028_document_run_scope"
down_revision: str | None = "0027_memory_review_mode"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Additive + nullable => a fast metadata-only add on any DB size, no backfill, no table rewrite.
    op.add_column("documents", sa.Column("run_id", sa.Uuid(), nullable=True))
    op.add_column("documents", sa.Column("name", sa.Text(), nullable=True))
    # ondelete CASCADE: deleting a run deletes every document it produced (closes the orphan leak).
    op.create_foreign_key(
        "fk_documents_run_id_runs",
        "documents",
        "runs",
        ["run_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_documents_run_id", "documents", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_documents_run_id", table_name="documents")
    op.drop_constraint("fk_documents_run_id_runs", "documents", type_="foreignkey")
    op.drop_column("documents", "name")
    op.drop_column("documents", "run_id")
