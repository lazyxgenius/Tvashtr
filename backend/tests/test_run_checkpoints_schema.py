"""Migration 0044 (M3, ruling R8): ``run_checkpoints`` and ``runs.resumed_from_*`` exist with the
contract's columns, constraints and delete behaviour, and the migration goes down and up again."""

import importlib.util
import pathlib
import uuid

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from tests.home_fixtures import clone_node, fresh_account, make_run
from tvashtr.db import get_engine, session_scope
from tvashtr.models import AgentInvocation, Run, RunCheckpoint

_MIGRATION = (
    pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0044_run_checkpoints.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("m0044", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _columns(table: str) -> dict:
    with session_scope() as s:
        rows = s.execute(
            text(
                "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                "WHERE table_name = :t"
            ),
            {"t": table},
        ).all()
    return {name: (kind, nullable) for name, kind, nullable in rows}


def _run_with_step(status: str = "failed") -> tuple[str, int, str]:
    _, owner = fresh_account("cp-schema")
    run_id, clone = make_run(owner, None, status=status)
    node = clone_node(clone, "engineer")
    with session_scope() as s:
        inv = AgentInvocation(run_id=run_id, node_id=uuid.UUID(node), iteration=1, status="done")
        s.add(inv)
        s.flush()
        return run_id, inv.id, node


def _checkpoint(run_id: str, inv_id: int, node: str, **over) -> RunCheckpoint:
    fields = dict(
        run_id=uuid.UUID(run_id),
        invocation_id=inv_id,
        node_id=uuid.UUID(node),
        iteration=1,
        base_sha="a" * 40,
        diff=b"diff --git a/x b/x\n",
    )
    return RunCheckpoint(**{**fields, **over})


def test_migration_revises_connector_connections():
    m = _migration()
    assert (m.revision, m.down_revision) == ("0044_run_checkpoints", "0043_connector_connections")


def test_run_checkpoints_columns():
    assert _columns("run_checkpoints") == {
        "id": ("bigint", "NO"),
        "run_id": ("uuid", "NO"),
        "invocation_id": ("bigint", "NO"),
        "node_id": ("uuid", "NO"),
        "iteration": ("integer", "NO"),
        "base_sha": ("text", "NO"),
        "diff": ("bytea", "YES"),
        "too_large": ("boolean", "NO"),
        "created_at": ("timestamp with time zone", "NO"),
    }


def test_runs_gains_two_nullable_columns():
    cols = _columns("runs")
    assert cols["resumed_from_run_id"] == ("uuid", "YES")
    assert cols["resumed_from_step"] == ("bigint", "YES")


def test_one_checkpoint_per_step_and_it_round_trips_bytes():
    run_id, inv_id, node = _run_with_step()
    blob = bytes(range(256))
    with session_scope() as s:
        s.add(_checkpoint(run_id, inv_id, node, diff=blob))
    with session_scope() as s:
        row = s.execute(
            select(RunCheckpoint).where(RunCheckpoint.invocation_id == inv_id)
        ).scalar_one()
        assert row.diff == blob and row.too_large is False and row.created_at is not None
    with pytest.raises(IntegrityError), session_scope() as s:
        s.add(_checkpoint(run_id, inv_id, node))


def test_deleting_a_run_deletes_its_checkpoints_and_unlinks_runs_resumed_from_it():
    run_id, inv_id, node = _run_with_step()
    with session_scope() as s:
        s.add(_checkpoint(run_id, inv_id, node))
        old = s.get(Run, uuid.UUID(run_id))
        new_id = uuid.uuid4()
        s.add(
            Run(
                id=new_id,
                team_graph_id=old.team_graph_id,
                owner_id=old.owner_id,
                idea=old.idea,
                workflow_id=str(new_id),
                status="pending",
                resumed_from_run_id=old.id,
                resumed_from_step=inv_id,
            )
        )
    with session_scope() as s:
        s.execute(text("DELETE FROM agent_invocations WHERE id = :i"), {"i": inv_id})
        assert s.get(Run, new_id).resumed_from_step is None
        s.execute(text("DELETE FROM runs WHERE id = :r"), {"r": uuid.UUID(run_id)})
    with session_scope() as s:
        assert s.get(Run, new_id).resumed_from_run_id is None
        assert (
            s.execute(
                select(RunCheckpoint).where(RunCheckpoint.run_id == uuid.UUID(run_id))
            ).first()
            is None
        )


def test_downgrade_then_upgrade_round_trips():
    """Inside one rolled-back transaction, so the suite's rows are left alone."""
    m = _migration()
    exists = text("SELECT to_regclass('public.run_checkpoints') IS NOT NULL")
    column = text(
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'runs' AND column_name LIKE 'resumed_from_%'"
    )
    with get_engine().connect() as conn:
        tx = conn.begin()
        try:
            with Operations.context(MigrationContext.configure(conn)):
                m.downgrade()
                assert conn.execute(exists).scalar() is False
                assert conn.execute(column).scalar() == 0
                m.upgrade()
            assert conn.execute(exists).scalar() is True
            assert conn.execute(column).scalar() == 2
        finally:
            tx.rollback()
