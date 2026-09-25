"""every schema change the frontend revamp needs, in one migration

The redesign (docs/superpowers/specs/2026-09-25-frontend-revamp-design.md) is built as parallel
backend slices; putting all of its schema here — before any slice starts — keeps them from creating
competing Alembic heads. Everything is additive and nullable (or defaulted), so existing rows and
callers behave exactly as before until a slice starts writing the new columns.

* ``team_graphs.template_key`` / ``duplicated_from_id`` — which template a library team came from,
  and the team it was duplicated from (plain uuid, like ``cloned_from_node_id``).
* ``runs.library_team_id`` — the library team a run was launched from (FK, SET NULL), indexed and
  backfilled from the clone→origin node join. Replaces three separate join implementations.
* ``runs.retry_of_run_id`` — a retry's failed predecessor (FK, SET NULL).
* ``runs.failure_code`` / ``failure_message`` / ``failed_node_id`` — a readable failure reason.
* ``runs.local_repo_label`` / ``local_snapshot_id`` — a Desktop local-folder run's source.
* ``users.preferences`` — per-account UI preferences (e.g. the hidden get-started checklist).
* ``inbox_dismissals`` — Home "Needs you" items the user dismissed or snoozed.
* ``document_versions.note`` / ``author_node_id`` — a version's change note and authoring node.
* ``node_memories.source_node_id`` / ``edited_at`` — which agent learned a memory, and when a
  human last edited it; plus a data fix: hosted runs keyed repo memories by the per-run clone
  path, so they never carried over to the next run — rewrite those keys to the GitHub
  ``owner/name``.
* ``repo_snapshots`` — git bundles for Desktop local-folder runs (the uploaded source and the result
  branch), stored in Postgres so any backend machine can read them.
* an index on ``cost_records.created_at`` for spend-by-period queries.

Revision ID: 0041_revamp_schema
Revises: 0040_desktop_job_machine
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0041_revamp_schema"
down_revision: str | None = "0040_desktop_job_machine"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Kept as module constants so tests can run them against seeded rows.
BACKFILL_LIBRARY_TEAM_SQL = """
        UPDATE runs r SET library_team_id = s.team_id
        FROM (
            SELECT DISTINCT ON (r2.id) r2.id AS run_id, o.team_graph_id AS team_id
            FROM runs r2
            JOIN agent_nodes c ON c.team_graph_id = r2.team_graph_id
            JOIN agent_nodes o ON o.id = c.cloned_from_node_id
            JOIN team_graphs t ON t.id = o.team_graph_id AND t.is_library
            ORDER BY r2.id
        ) s
        WHERE r.id = s.run_id AND r.library_team_id IS NULL
"""

FIX_MEMORY_REPO_KEY_SQL = """
        UPDATE node_memories m SET repo_key = r.github_repo
        FROM runs r
        WHERE m.source_run_id = r.id::text
          AND r.github_repo IS NOT NULL
          AND m.repo_key LIKE '%/.tvashtr_clones/%'
"""


def upgrade() -> None:
    # ---- team_graphs ----
    op.add_column("team_graphs", sa.Column("template_key", sa.Text(), nullable=True))
    op.add_column("team_graphs", sa.Column("duplicated_from_id", sa.Uuid(), nullable=True))

    # ---- runs ----
    op.add_column("runs", sa.Column("library_team_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_runs_library_team_id_team_graphs",
        "runs",
        "team_graphs",
        ["library_team_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_runs_library_team_id", "runs", ["library_team_id"])
    op.add_column("runs", sa.Column("retry_of_run_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_runs_retry_of_run_id_runs",
        "runs",
        "runs",
        ["retry_of_run_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("runs", sa.Column("failure_code", sa.Text(), nullable=True))
    op.add_column("runs", sa.Column("failure_message", sa.Text(), nullable=True))
    op.add_column("runs", sa.Column("failed_node_id", sa.Uuid(), nullable=True))
    op.add_column("runs", sa.Column("local_repo_label", sa.Text(), nullable=True))
    op.add_column("runs", sa.Column("local_snapshot_id", sa.Uuid(), nullable=True))
    # Backfill library_team_id: a run executes a clone of its library team; each clone node points
    # at its authored origin node, whose team is the library team.
    op.execute(BACKFILL_LIBRARY_TEAM_SQL)

    # ---- users ----
    op.add_column(
        "users",
        sa.Column(
            "preferences",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )

    # ---- inbox_dismissals ----
    op.create_table(
        "inbox_dismissals",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("item_key", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("snooze_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fingerprint", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("action IN ('dismissed', 'snoozed')", name="ck_inbox_dismissals_action"),
        sa.UniqueConstraint("owner_id", "item_key", name="uq_inbox_dismissals_owner_key"),
    )

    # ---- document_versions ----
    op.add_column("document_versions", sa.Column("note", sa.Text(), nullable=True))
    op.add_column("document_versions", sa.Column("author_node_id", sa.Uuid(), nullable=True))

    # ---- node_memories ----
    op.add_column("node_memories", sa.Column("source_node_id", sa.Uuid(), nullable=True))
    op.add_column(
        "node_memories", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True)
    )
    # Hosted runs work in a per-run clone (``<repo>/.tvashtr_clones/<run_id>``) and memories were
    # keyed by that path, so each run got a unique key and repo memories never carried over. Key
    # them by the GitHub repo the run targeted instead (the write sites switch to it in the same
    # release).
    op.execute(FIX_MEMORY_REPO_KEY_SQL)

    # ---- repo_snapshots ----
    op.create_table(
        "repo_snapshots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Uuid(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=True),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("base_ref", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('source', 'result')", name="ck_repo_snapshots_kind"),
    )
    op.create_index("ix_repo_snapshots_owner_created", "repo_snapshots", ["owner_id", "created_at"])
    op.create_index("ix_repo_snapshots_run_id", "repo_snapshots", ["run_id"])

    # ---- cost_records ----
    op.create_index("ix_cost_records_created_at", "cost_records", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_cost_records_created_at", table_name="cost_records")
    op.drop_index("ix_repo_snapshots_run_id", table_name="repo_snapshots")
    op.drop_index("ix_repo_snapshots_owner_created", table_name="repo_snapshots")
    op.drop_table("repo_snapshots")
    # The node_memories repo_key rewrite is a data fix and is not reversed.
    op.drop_column("node_memories", "edited_at")
    op.drop_column("node_memories", "source_node_id")
    op.drop_column("document_versions", "author_node_id")
    op.drop_column("document_versions", "note")
    op.drop_table("inbox_dismissals")
    op.drop_column("users", "preferences")
    op.drop_column("runs", "local_snapshot_id")
    op.drop_column("runs", "local_repo_label")
    op.drop_column("runs", "failed_node_id")
    op.drop_column("runs", "failure_message")
    op.drop_column("runs", "failure_code")
    op.drop_constraint("fk_runs_retry_of_run_id_runs", "runs", type_="foreignkey")
    op.drop_column("runs", "retry_of_run_id")
    op.drop_index("ix_runs_library_team_id", table_name="runs")
    op.drop_constraint("fk_runs_library_team_id_team_graphs", "runs", type_="foreignkey")
    op.drop_column("runs", "library_team_id")
    op.drop_column("team_graphs", "duplicated_from_id")
    op.drop_column("team_graphs", "template_key")
