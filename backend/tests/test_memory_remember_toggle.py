"""M-memory — the per-node "Remember what I learn" toggle (retires the global flag).

Deliberate agent-remember is gated PER-NODE by ``AgentNode.config["memory_remember_enabled"]`` (a
top-level bool in the EXISTING config JSONB — no migration), AND ``edits_allowed`` (only an edits-on
node runs the sandbox and can write the ``TVASHTR_REMEMBER.jsonl`` sidecar). The former global
remember setting/env is DELETED and has ZERO effect. Default-False-per-node keeps every existing
team/run byte-identical.

These are mutation-real: the resolver/gate tests drive the real ``resolve_remember_enabled`` +
``compile_context``; the PATCH tests re-read the persisted ``AgentNode.config`` row.
"""

import uuid

from conftest import auth_user_id
from sqlalchemy import select

from tvashtr.config import Settings
from tvashtr.control_plane.teams import create_team_from_template
from tvashtr.db import session_scope
from tvashtr.models import AgentNode


def test_retired_global_flag_has_zero_effect():
    """PROOF-OF-DESIGN (FAILS on pre-change main, PASSES after): the former global remember flag is
    RETIRED. (a) The ``Settings`` model no longer declares the field, so its env alias maps to
    nothing and the environment can have no effect; (b) the per-node resolver reads only the node's
    own config — a node WITHOUT the key does NOT remember.

    On pre-change main this FAILS at (a): the global field is still present (and would force the
    remember protocol onto a node that never opted in — the coupling this milestone removes)."""
    # (a) the global setting is DELETED from the Settings model.
    assert "memory_remember_enabled" not in Settings.model_fields
    # (b) the per-node resolver reads only the node's own config. Imported HERE (after the (a)
    #     assertion) so on pre-change main the test fails cleanly at (a) before this import is
    #     reached — no collection-time ImportError masking the design failure.
    from tvashtr.control_plane.context_compiler import resolve_remember_enabled

    assert resolve_remember_enabled(None) is False
    assert resolve_remember_enabled({}) is False
    assert resolve_remember_enabled({"model_config": {"model": "x"}}) is False


# ---- The node PATCH: memory_remember_enabled merges into the EXISTING config JSONB ---------------


def _graph_nodes(client, tid: str) -> dict[str, dict]:
    return {n["role_name"]: n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]}


def _row(node_id: str) -> AgentNode:
    with session_scope() as session:
        return session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(node_id))
        ).scalar_one()


def _seed_config(node_id: str, cfg: dict) -> None:
    """Directly seed a node's config JSONB (a fresh dict so the JSONB column is flagged dirty)."""
    with session_scope() as session:
        node = session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(node_id))
        ).scalar_one()
        node.config = dict(cfg)


def test_patch_remember_true_merges_and_preserves_existing_config(client):
    """PATCH ``memory_remember_enabled=True`` on an edits-on worker MERGES the key into the EXISTING
    config JSONB — a pre-existing sub-key (``model_config``) is preserved. Re-reads the row, so it
    proves the persisted state, not the response echo."""
    tid = create_team_from_template("plan_review", "Remember merge", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]
    assert eng["kind"] == "agent"  # an edits-on worker
    _seed_config(eng["id"], {"model_config": {"worker_context_token_budget": 55_000}})

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={"prompt": eng["prompt"], "model": eng["model"], "memory_remember_enabled": True},
    )
    assert resp.status_code == 200, resp.text
    assert _row(eng["id"]).config == {
        "model_config": {"worker_context_token_budget": 55_000},
        "memory_remember_enabled": True,
    }


def test_patch_omitting_remember_leaves_config_byte_unchanged(client):
    """A ``{prompt, model}`` save WITHOUT the field leaves ``node.config`` byte-unchanged (the
    ``model_fields_set`` clear-semantics: omitted ⇒ untouched)."""
    tid = create_team_from_template("plan_review", "Remember omit", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]
    seeded = {"model_config": {"worker_context_token_budget": 42_000}}
    _seed_config(eng["id"], seeded)

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={"prompt": eng["prompt"], "model": eng["model"]},
    )
    assert resp.status_code == 200, resp.text
    assert _row(eng["id"]).config == seeded  # unchanged — no memory_remember_enabled key added


def test_patch_remember_false_stores_false(client):
    """Sending the field as ``False`` stores ``False`` — an explicit opt-out is persisted, not
    dropped."""
    tid = create_team_from_template("plan_review", "Remember false", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={"prompt": eng["prompt"], "model": eng["model"], "memory_remember_enabled": False},
    )
    assert resp.status_code == 200, resp.text
    assert _row(eng["id"]).config["memory_remember_enabled"] is False
