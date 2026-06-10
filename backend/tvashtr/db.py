"""SQLAlchemy engine/session factory for Tvashtr's own application tables.

DBOS manages its own system tables (in a separate ``dbos`` schema) over the same
Postgres database; this module is only for Tvashtr app tables (e.g.
``spike_hello_events``), which Alembic owns.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from tvashtr.config import get_settings

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def sqlalchemy_url() -> str:
    """Return the connection URL with an explicit psycopg-3 driver.

    The canonical ``DATABASE_URL`` uses the bare ``postgresql://`` scheme (what
    DBOS and ``psql`` expect). SQLAlchemy maps that scheme to psycopg2 by
    default, but we install psycopg 3, so we pin the driver here.
    """
    url = get_settings().database_url
    prefix = "postgresql://"
    if url.startswith(prefix):
        url = "postgresql+psycopg://" + url[len(prefix) :]
    return url


def get_engine() -> Engine:
    global _engine, _session_factory
    if _engine is None:
        _engine = create_engine(sqlalchemy_url(), pool_pre_ping=True, future=True)
        _session_factory = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    if _session_factory is None:
        get_engine()
    assert _session_factory is not None
    return _session_factory


@contextmanager
def session_scope() -> Iterator[Session]:
    """Provide a transactional session scope around a series of operations."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ping() -> bool:
    """Execute a trivial query to confirm the database is reachable."""
    with get_engine().connect() as conn:
        conn.execute(text("SELECT 1"))
    return True
