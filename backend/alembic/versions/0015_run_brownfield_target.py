"""runs.repo_path / base_ref / ship_branch — the brownfield run-mode target (M-brownfield Slice 1)

Revision ID: 0015_run_brownfield_target
Revises: 0014_agent_node_cloned_from
Create Date: 2026-06-27

M-brownfield Slice 1: the backend "work on a real local folder" run mode. The discriminator for
the whole slice is one column — ``runs.repo_path IS NULL`` ⇒ greenfield (the legacy ephemeral
workspace, untouched); non-NULL ⇒ brownfield (the run worked on an isolated ``git worktree`` of the
user's real repo). Three nullable Text columns on ``runs``:

* ``repo_path`` — the user's real local repo the run targets (the worktree is cut from it).
* ``base_ref`` — the branch/commit the worktree was created from (defaulted to the repo's current
  branch at ``create_run`` when omitted).
* ``ship_branch`` — the real branch ``tvashtr/<run_id>`` the change landed on, recorded when the
  worktree is set up (so the run result/banner can surface it).

No FK, no index (per-run read-by-id). Additive + nullable + no backfill → every existing ``runs``
row stays valid; no frozen migration (``0001``–``0014``) is touched; clean ``0014`` → ``0015``
chain, head ``0015``.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0015_run_brownfield_target"
down_revision: str | None = "0014_agent_node_cloned_from"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("repo_path", sa.Text(), nullable=True))
    op.add_column("runs", sa.Column("base_ref", sa.Text(), nullable=True))
    op.add_column("runs", sa.Column("ship_branch", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "ship_branch")
    op.drop_column("runs", "base_ref")
    op.drop_column("runs", "repo_path")
