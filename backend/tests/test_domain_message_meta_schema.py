"""Migration 0042: ``domain_messages.meta`` exists, is a nullable JSONB column (no default, no
backfill), and round-trips the answer meta the Ask tab reads after a reload."""

import importlib.util
import pathlib
import uuid

from sqlalchemy import text

from tvashtr.db import session_scope
from tvashtr.models import Domain, DomainMessage, User

_MIGRATION = (
    pathlib.Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0042_domain_message_meta.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("m0042", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _domain() -> uuid.UUID:
    with session_scope() as s:
        u = User(email=f"meta-{uuid.uuid4().hex}@tvashtr.local", password_hash="x")
        s.add(u)
        s.flush()
        d = Domain(owner_id=u.id, name="Support docs", template="support", config={})
        s.add(d)
        s.flush()
        return d.id


def test_migration_revises_the_revamp_schema():
    m = _migration()
    assert m.revision == "0042_domain_message_meta"
    assert m.down_revision == "0041_revamp_schema"


def test_meta_is_a_nullable_jsonb_column_without_a_default():
    with session_scope() as s:
        row = s.execute(
            text(
                "SELECT data_type, is_nullable, column_default FROM information_schema.columns "
                "WHERE table_name = 'domain_messages' AND column_name = 'meta'"
            )
        ).one()
    assert row == ("jsonb", "YES", None)


def test_meta_defaults_to_null_and_round_trips():
    did = _domain()
    with session_scope() as s:
        old = DomainMessage(domain_id=did, role="assistant", content="An older answer [1]")
        new = DomainMessage(
            domain_id=did,
            role="assistant",
            content="Refunds take 30 days [1]",
            meta={"model": "openai/gpt-4o-mini", "used_history": True, "source": "chat"},
        )
        s.add_all([old, new])
        s.flush()
        old_id, new_id = old.id, new.id
    with session_scope() as s:
        assert s.get(DomainMessage, old_id).meta is None
        assert s.get(DomainMessage, new_id).meta == {
            "model": "openai/gpt-4o-mini",
            "used_history": True,
            "source": "chat",
        }
