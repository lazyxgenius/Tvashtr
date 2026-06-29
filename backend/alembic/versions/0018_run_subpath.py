"""runs.subpath — the optional brownfield sub-path scope (M-brownfield scoped-mount Slice 1)

Revision ID: 0018_run_subpath
Revises: 0017_ownership_and_credentials
Create Date: 2026-06-29

M-brownfield scoped-mount Slice 1: an OPTIONAL ``subpath`` that scopes a BROWNFIELD run's agent
CONTEXT MAP + FOCUS to one package of the repo (NOT the git mount) — so the proven NIM-70b /
OpenHands-docker path can land a change in a large monorepo without overflowing the model context on
the whole-repo structure outline (the rung-2 finding). One nullable Text column on ``runs``,
parallel to ``repo_path`` / ``base_ref`` / ``ship_branch`` (migration ``0015``):

* ``subpath`` — NULL ⇒ whole-repo (the default; byte-for-byte today's grounding + behavior).
  Non-NULL on a brownfield run ⇒ the grounding's structure outline folds from ``git ls-files
  <subpath>`` (rooted at the sub-path), the framing line names the focus, and the worker gets a
  per-run FOCUS directive — while the git worktree / ship branch / manifest line stay repo-ROOT.
  A greenfield run (no ``repo_path``) ignores it (stored NULL).

Additive + nullable + no backfill → every existing ``runs`` row stays valid. The FIRST migration
since the ``0001``–``0017`` freeze; no frozen migration is touched; clean ``0017`` → ``0018`` chain,
head ``0018`` (the freeze hook is bumped to ``0018`` as the slice's LAST step).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0018_run_subpath"
down_revision: str | None = "0017_ownership_and_credentials"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("subpath", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "subpath")
