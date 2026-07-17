"""runs.github_repo + runs.pr_url — hosted-GitHub run target + opened PR url (M-h1b)

Revision ID: 0030_hosted_github_run
Revises: 0029_github_identity
Create Date: 2026-07-17

M-h1b (the ONLY migration this milestone): a HOSTED user picks one of their own GitHub repos, the
backend clones it server-side, the team runs, and a real Pull Request opens on it. Two additive,
nullable columns on ``runs`` carry that:

* ``runs.github_repo`` — ``Text``, NULLABLE. The ``owner/name`` a hosted-GitHub run targets.
  NULL ⇒ NOT a hosted-GitHub run: every existing row, every local brownfield run, every
  greenfield run. A durable clone step reads it, clones into a per-run dir, and SETS
  ``repo_path`` before ``load_graph_step`` — so a hosted run then looks like a local brownfield
  run to the rest of the executor (the walk is never forked for hosted).
* ``runs.pr_url`` — ``Text``, NULLABLE. The opened PR's html url, recorded on the Ship terminal.
  NULL until the PR exists (and forever on a non-hosted run). The RunBanner shows the PR link
  when it is set.

Purely additive: no existing table is rewritten, no column altered, no backfill — both NULLABLE, so
every existing ``runs`` row stays valid. With ``TVASHTR_HOSTED_MODE`` FALSE (the default) nothing
writes these; the self-hosted + greenfield paths are byte-identical. ``downgrade()`` drops the two
columns, round-tripping (``downgrade -1`` -> ``upgrade head``). Chains ``0029`` -> ``0030``, head
``0030`` (the migration-freeze hook is bumped to also cover ``0030`` as this milestone's LAST step).
Revision id kept <= 32 chars for alembic's ``version_num`` column.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0030_hosted_github_run"
down_revision: str | None = "0029_github_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Additive nullable columns on runs — a fast metadata-only add, no backfill, no table rewrite.
    op.add_column("runs", sa.Column("github_repo", sa.Text(), nullable=True))
    op.add_column("runs", sa.Column("pr_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "pr_url")
    op.drop_column("runs", "github_repo")
