"""users.github_* identity link + github_installations — GitHub App identity + repo source (M-h1a)

Revision ID: 0029_github_identity
Revises: 0028_document_run_scope
Create Date: 2026-07-17

M-h1a (the ONLY migration this milestone): GitHub becomes an identity provider + a repo source in
HOSTED mode. Two additive, nullable columns on ``users`` link an account to its GitHub identity, and
a new ``github_installations`` table records which GitHub App installation(s) an account owns.

* ``users.github_user_id`` — ``BigInteger`` (GitHub numeric user ids exceed int32), NULLABLE +
  UNIQUE (``uq_users_github_user_id``). The stable find-or-link key: one Tvashtr account per GitHub
  user. Postgres treats NULLs as distinct, so every existing email/password account (github_user_id
  NULL) coexists under the UNIQUE constraint — no backfill, byte-identical behavior.
* ``users.github_login`` — ``Text``, NULLABLE. The display handle. NULL on self-hosted accounts.
* ``github_installations`` — a new owner-scoped table (like ``provider_credentials``, minus
  any secret column): ``owner_id`` FK -> ``users.id`` (NOT NULL, indexed), ``installation_id``
  ``BigInteger`` NOT NULL + UNIQUE (``uq_github_installations_installation_id`` — one owner per
  installation), plus created_at/updated_at. It stores NO token — installation access tokens are
  minted on demand and cached in-process only (``control_plane/github_app.py``).

Purely additive: no existing table is rewritten, no column altered, no backfill. With
``TVASHTR_HOSTED_MODE`` FALSE (the default) nothing reads these — every existing account and the
password path behave byte-identically. ``downgrade()`` drops the table (+ its index) then the unique
constraint + the two columns, round-tripping (``downgrade -1`` -> ``upgrade head``). Chains ``0028``
-> ``0029``, head ``0029`` (the migration-freeze hook is bumped ``2[0-8]`` -> ``2[0-9]`` as this
milestone's LAST step). Revision id kept <= 32 chars for alembic's ``version_num`` column.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0029_github_identity"
down_revision: str | None = "0028_document_run_scope"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Additive nullable columns on users — a fast metadata-only add, no backfill, no table rewrite.
    op.add_column("users", sa.Column("github_user_id", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("github_login", sa.Text(), nullable=True))
    # Nullable-UNIQUE: Postgres NULLs are distinct, so every existing (NULL) account coexists.
    op.create_unique_constraint("uq_users_github_user_id", "users", ["github_user_id"])
    # Owner-scoped installation table — NO secret column (tokens are minted+cached, never stored).
    op.create_table(
        "github_installations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("installation_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name="fk_github_installations_owner_id_users"
        ),
        sa.UniqueConstraint("installation_id", name="uq_github_installations_installation_id"),
    )
    op.create_index("ix_github_installations_owner_id", "github_installations", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_github_installations_owner_id", table_name="github_installations")
    op.drop_table("github_installations")
    op.drop_constraint("uq_users_github_user_id", "users", type_="unique")
    op.drop_column("users", "github_login")
    op.drop_column("users", "github_user_id")
