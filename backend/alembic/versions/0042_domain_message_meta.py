"""domain_messages.meta — what produced an answer, so the Ask tab can show it after a reload

The revamped Domains › Ask tab shows under each answer the model that wrote it ("1.8 s · OpenAI
gpt-4o-mini") and, for a follow-up, "Used your earlier question for context". Neither can be
derived later: the domain's answer-model setting can change after the answer was written, and a
follow-up can't be told apart from its text. So an assistant row records it once, as
``{"model": …, "used_history": …, "source": "chat"}``.

Nullable, no backfill, no index: old rows stay NULL and the UI simply omits those two details.

Revision ID: 0042_domain_message_meta
Revises: 0041_revamp_schema
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0042_domain_message_meta"
down_revision: str | None = "0041_revamp_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "domain_messages",
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("domain_messages", "meta")
