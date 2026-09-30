"""Migration 0043: ``connector_connections`` exists with every column, the three unique
constraints, the four checks and the owner index the Connectors contract names, and the migration
goes down and up again cleanly."""

import importlib.util
import pathlib
import uuid

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tvashtr.db import get_engine, session_scope
from tvashtr.models import ConnectorConnection, User

_MIGRATION = (
    pathlib.Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0043_connector_connections.py"
)
_TABLE = "connector_connections"


def _migration():
    spec = importlib.util.spec_from_file_location("m0043", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _user() -> uuid.UUID:
    with session_scope() as s:
        u = User(email=f"conn-{uuid.uuid4().hex}@tvashtr.local", password_hash="x")
        s.add(u)
        s.flush()
        return u.id


def _row(owner_id: uuid.UUID, **over) -> ConnectorConnection:
    fields = {
        "owner_id": owner_id,
        "connector_key": "supabase",
        "name": "Supabase",
        "slug": "supabase",
        "url": "https://mcp.supabase.com/mcp",
        "auth_kind": "oauth",
        "status": "pending",
    }
    return ConnectorConnection(**{**fields, **over})


def _constraints(kind: str) -> set[str]:
    with session_scope() as s:
        return set(
            s.execute(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid = 'connector_connections'::regclass AND contype = :k"
                ),
                {"k": kind},
            ).scalars()
        )


def test_migration_revises_domain_message_meta():
    m = _migration()
    assert m.revision == "0043_connector_connections"
    assert m.down_revision == "0042_domain_message_meta"


def test_every_column_has_the_contract_type_and_nullability():
    with session_scope() as s:
        rows = s.execute(
            text(
                "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                "WHERE table_name = :t"
            ),
            {"t": _TABLE},
        ).all()
    assert {name: (kind, nullable) for name, kind, nullable in rows} == {
        "id": ("uuid", "NO"),
        "owner_id": ("uuid", "NO"),
        "connector_key": ("text", "NO"),
        "name": ("text", "NO"),
        "slug": ("text", "NO"),
        "url": ("text", "NO"),
        "transport": ("text", "NO"),
        "auth_kind": ("text", "NO"),
        "access": ("text", "NO"),
        "scope": ("jsonb", "YES"),
        "status": ("text", "NO"),
        "secret_encrypted": ("text", "YES"),
        "pending_encrypted": ("text", "YES"),
        "state_hash": ("text", "YES"),
        "tools": ("jsonb", "YES"),
        "last_error": ("text", "YES"),
        "connected_at": ("timestamp with time zone", "YES"),
        "created_at": ("timestamp with time zone", "NO"),
        "updated_at": ("timestamp with time zone", "NO"),
    }


def test_constraints_and_the_owner_index_are_named_as_the_contract_says():
    assert _constraints("u") == {
        "uq_connector_connections_owner_key",
        "uq_connector_connections_owner_slug",
        "uq_connector_connections_state_hash",
    }
    assert _constraints("c") == {
        "ck_connector_connections_transport",
        "ck_connector_connections_auth_kind",
        "ck_connector_connections_access",
        "ck_connector_connections_status",
    }
    assert _constraints("f") == {"fk_connector_connections_owner_id_users"}
    with session_scope() as s:
        indexes = set(
            s.execute(
                text("SELECT indexname FROM pg_indexes WHERE tablename = :t"), {"t": _TABLE}
            ).scalars()
        )
    assert "ix_connector_connections_owner_id" in indexes


def test_defaults_are_streamable_http_and_read():
    owner = _user()
    with session_scope() as s:
        row = _row(owner)
        s.add(row)
        s.flush()
        rid = row.id
    with session_scope() as s:
        row = s.get(ConnectorConnection, rid)
        assert (row.transport, row.access) == ("streamable-http", "read")
        assert row.scope is None and row.tools is None and row.secret_encrypted is None
        assert row.created_at is not None and row.updated_at is not None


@pytest.mark.parametrize(
    "over",
    [
        {"transport": "stdio"},
        {"auth_kind": "basic"},
        {"access": "admin"},
        {"status": "broken"},
    ],
)
def test_each_check_refuses_a_value_outside_its_set(over):
    owner = _user()
    with pytest.raises(IntegrityError), session_scope() as s:
        s.add(_row(owner, **over))


@pytest.mark.parametrize(
    "second",
    [
        {"slug": "supabase-2"},  # same key
        {"connector_key": "neon"},  # same slug
        {"connector_key": "neon", "slug": "neon", "state_hash": "abc"},  # same state_hash
    ],
)
def test_each_unique_constraint_refuses_a_duplicate(second):
    owner = _user()
    state = uuid.uuid4().hex
    with session_scope() as s:
        s.add(_row(owner, state_hash=state))
    if "state_hash" in second:
        second = {**second, "state_hash": state}
    with pytest.raises(IntegrityError), session_scope() as s:
        s.add(_row(owner, **second))


def test_another_owner_may_connect_the_same_key():
    with session_scope() as s:
        s.add(_row(_user()))
        s.add(_row(_user()))


def test_downgrade_then_upgrade_round_trips():
    """Runs inside one transaction that is rolled back, so the suite's rows are left alone
    (Postgres DDL is transactional)."""
    m = _migration()
    exists = text("SELECT to_regclass('public.connector_connections') IS NOT NULL")
    with get_engine().connect() as conn:
        tx = conn.begin()
        try:
            with Operations.context(MigrationContext.configure(conn)):
                m.downgrade()
                assert conn.execute(exists).scalar() is False
                m.upgrade()
            assert conn.execute(exists).scalar() is True
            assert (
                conn.execute(
                    text("SELECT count(*) FROM pg_constraint WHERE conrelid = :t ::regclass"),
                    {"t": _TABLE},
                ).scalar()
                == 9
            )  # pk + fk + 3 unique + 4 checks
        finally:
            tx.rollback()
