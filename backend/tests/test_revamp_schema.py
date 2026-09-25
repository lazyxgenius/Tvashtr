"""Migration 0041 (the revamp's schema): new columns/tables exist, constraints hold, and the two
data fixes do what they say — runs get their library team, and clone-path memory keys become the
GitHub ``owner/name``."""

import importlib.util
import pathlib
import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from tvashtr.db import session_scope
from tvashtr.models import (
    AgentNode,
    DocumentVersion,
    InboxDismissal,
    NodeMemory,
    RepoSnapshot,
    Run,
    TeamGraph,
    User,
)

_MIGRATION = (
    pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0041_revamp_schema.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("m0041", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _user() -> uuid.UUID:
    with session_scope() as s:
        u = User(email=f"schema-{uuid.uuid4().hex}@tvashtr.local", password_hash="x")
        s.add(u)
        s.flush()
        return u.id


def test_head_has_the_revamp_columns():
    with session_scope() as s:
        rows = s.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_name IN ('runs','team_graphs','users','document_versions',"
                "'node_memories','inbox_dismissals','repo_snapshots')"
            )
        ).all()
    have = {(t, c) for t, c in rows}
    for pair in [
        ("team_graphs", "template_key"),
        ("team_graphs", "duplicated_from_id"),
        ("runs", "library_team_id"),
        ("runs", "retry_of_run_id"),
        ("runs", "failure_code"),
        ("runs", "failure_message"),
        ("runs", "failed_node_id"),
        ("runs", "local_repo_label"),
        ("runs", "local_snapshot_id"),
        ("users", "preferences"),
        ("document_versions", "note"),
        ("document_versions", "author_node_id"),
        ("node_memories", "source_node_id"),
        ("node_memories", "edited_at"),
        ("inbox_dismissals", "item_key"),
        ("repo_snapshots", "data"),
    ]:
        assert pair in have, pair


def test_user_preferences_default_to_an_empty_object():
    uid = _user()
    with session_scope() as s:
        assert s.get(User, uid).preferences == {}


def test_inbox_dismissal_action_is_checked_and_unique_per_owner_key():
    uid = _user()
    with session_scope() as s:
        s.add(InboxDismissal(owner_id=uid, item_key="memories", action="dismissed"))
    with pytest.raises(IntegrityError), session_scope() as s:
        s.add(InboxDismissal(owner_id=uid, item_key="memories", action="snoozed"))
    with pytest.raises(IntegrityError), session_scope() as s:
        s.add(InboxDismissal(owner_id=uid, item_key="other", action="archived"))


def test_repo_snapshot_kind_is_checked():
    uid = _user()
    with session_scope() as s:
        s.add(RepoSnapshot(owner_id=uid, kind="source", size_bytes=3, data=b"abc"))
    with pytest.raises(IntegrityError), session_scope() as s:
        s.add(RepoSnapshot(owner_id=uid, kind="other", size_bytes=3, data=b"abc"))


def test_backfill_maps_a_run_to_its_library_team():
    uid = _user()
    with session_scope() as s:
        lib = TeamGraph(name="Indicator sprint team", is_library=True, owner_id=uid)
        clone = TeamGraph(name="run clone", is_library=False)
        s.add_all([lib, clone])
        s.flush()
        origin = AgentNode(team_graph_id=lib.id, role_name="pm", kind="completion", position={})
        s.add(origin)
        s.flush()
        s.add(
            AgentNode(
                team_graph_id=clone.id,
                role_name="pm",
                kind="completion",
                position={},
                cloned_from_node_id=origin.id,
            )
        )
        run_id = uuid.uuid4()
        s.add(
            Run(
                id=run_id,
                team_graph_id=clone.id,
                owner_id=uid,
                idea="x",
                workflow_id=str(run_id),
                status="completed",
            )
        )
        lib_id = lib.id
    with session_scope() as s:
        s.execute(text(_migration().BACKFILL_LIBRARY_TEAM_SQL))
    with session_scope() as s:
        assert s.get(Run, run_id).library_team_id == lib_id


def test_memory_fix_rewrites_clone_path_keys_to_the_github_repo():
    uid = _user()
    run_id = uuid.uuid4()
    with session_scope() as s:
        g = TeamGraph(name="clone", is_library=False)
        s.add(g)
        s.flush()
        s.add(
            Run(
                id=run_id,
                team_graph_id=g.id,
                owner_id=uid,
                idea="x",
                workflow_id=str(run_id),
                status="completed",
                github_repo="lazyxgenius/trade_mcp",
            )
        )
        s.flush()
        hosted = NodeMemory(
            owner_id=uid,
            repo_key=f"/data/repos/trade_mcp/.tvashtr_clones/{run_id}",
            content="Tests live under tests/",
            source_run_id=str(run_id),
        )
        local = NodeMemory(
            owner_id=uid, repo_key="/Users/me/code/trade_mcp", content="local path stays"
        )
        s.add_all([hosted, local])
        s.flush()
        hosted_id, local_id = hosted.id, local.id
    with session_scope() as s:
        s.execute(text(_migration().FIX_MEMORY_REPO_KEY_SQL))
    with session_scope() as s:
        assert s.get(NodeMemory, hosted_id).repo_key == "lazyxgenius/trade_mcp"
        assert s.get(NodeMemory, local_id).repo_key == "/Users/me/code/trade_mcp"


def test_document_version_note_and_author_are_optional():
    # Every existing writer inserts without them; the columns must not break that.
    assert DocumentVersion.__table__.c.note.nullable
    assert DocumentVersion.__table__.c.author_node_id.nullable
    with session_scope() as s:
        assert s.execute(select(DocumentVersion.note).limit(1)).all() is not None
