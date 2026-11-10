"""M2: migration 0055 is additive and round-trips (the pattern of 0054's test)."""

import importlib.util
import pathlib

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from tvashtr.db import get_engine

TABLES = (
    "model_training_examples",
    "model_training_set_versions",
    "model_example_batches",
    "model_example_drafts",
)
COLUMNS = (
    ("model_test_cases", "source"),
    ("model_test_cases", "origin"),
    ("model_test_cases", "origin_note"),
    ("user_models", "training_version"),
)


def _migration():
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic/versions/0055_model_examples.py"
    spec = importlib.util.spec_from_file_location("m0055", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _present(conn) -> int:
    tables = sum(
        conn.execute(text(f"SELECT to_regclass('public.{t}') IS NOT NULL")).scalar_one()
        for t in TABLES
    )
    columns = sum(
        conn.execute(
            text(
                "SELECT count(*) FROM information_schema.columns"
                " WHERE table_name = :t AND column_name = :c"
            ),
            {"t": t, "c": c},
        ).scalar_one()
        for t, c in COLUMNS
    )
    return tables + columns


def test_migration_0055_is_additive_and_round_trips():
    m = _migration()
    assert (m.revision, m.down_revision) == ("0055_model_examples", "0054_model_tests")
    with get_engine().connect() as conn:
        tx = conn.begin()
        try:
            assert _present(conn) == 8
            with Operations.context(MigrationContext.configure(conn)):
                m.downgrade()
                assert _present(conn) == 0
                # The tables M2 builds on are still there (only additions were undone).
                assert conn.execute(text("SELECT to_regclass('public.user_models')")).scalar_one()
                m.upgrade()
            assert _present(conn) == 8
            # Every new column on an existing table is nullable or defaulted: old code can insert.
            rows = conn.execute(
                text(
                    "SELECT is_nullable, column_default FROM information_schema.columns"
                    " WHERE (table_name, column_name) IN (('model_test_cases','source'),"
                    " ('model_test_cases','origin'), ('model_test_cases','origin_note'),"
                    " ('user_models','training_version'))"
                )
            ).all()
            assert len(rows) == 4
            assert all(n == "YES" or d is not None for n, d in rows)
        finally:
            tx.rollback()
