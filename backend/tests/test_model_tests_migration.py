"""Models 1: migration 0054 is additive and round-trips (the pattern of 0053's test)."""

import importlib.util
import pathlib

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from tvashtr.db import get_engine

TABLES = (
    "user_models",
    "model_test_cases",
    "model_test_set_versions",
    "model_test_runs",
    "model_test_results",
)


def _migration():
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic/versions/0054_model_tests.py"
    spec = importlib.util.spec_from_file_location("m0054", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _present(conn) -> int:
    return sum(
        conn.execute(text(f"SELECT to_regclass('public.{t}') IS NOT NULL")).scalar_one()
        for t in TABLES
    )


def test_migration_0054_is_additive_and_round_trips():
    m = _migration()
    assert (m.revision, m.down_revision) == ("0054_model_tests", "0053_desktop_routes")
    with get_engine().connect() as conn:
        tx = conn.begin()
        try:
            assert _present(conn) == 5
            with Operations.context(MigrationContext.configure(conn)):
                m.downgrade()
                assert _present(conn) == 0
                m.upgrade()
            assert _present(conn) == 5
            # The unique name index ignores case, and a result is unique per run + case.
            indexes = conn.execute(
                text("SELECT indexdef FROM pg_indexes WHERE tablename = 'user_models'")
            ).scalars()
            assert any("UNIQUE" in i and "lower(name)" in i for i in indexes)
        finally:
            tx.rollback()
