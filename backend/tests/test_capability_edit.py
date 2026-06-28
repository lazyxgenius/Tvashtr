"""Capability (thinker ↔ worker) editing on the node-update PATCH (P1.8c).

The node-edit panel gains a capability toggle: flipping it is a paired ``kind`` + ``engine`` write
(``thinker`` -> ``completion``/``null``; ``worker`` -> ``agent``/``openhands``), gated by the ONE
executor invariant — the ROOT node must stay a thinker (it writes the shared spec the rest of the
team reads). Each assertion re-reads the row, so it proves the write genuinely landed (or was
genuinely rejected), not just the response echo. Offline: pure DB + the in-process client, no LLM.
"""

import uuid

from conftest import auth_user_id
from sqlalchemy import select

from tvashtr import routers
from tvashtr.control_plane.teams import create_team_from_template
from tvashtr.db import session_scope
from tvashtr.models import AgentNode


def _graph_nodes(client, tid: str) -> dict[str, dict]:
    return {n["role_name"]: n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]}


def _row(node_id: str) -> AgentNode:
    with session_scope() as session:
        return session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(node_id))
        ).scalar_one()


# --- The pure mapping helper -------------------------------------------------------------------


def test_capability_to_columns_mapping():
    """``thinker`` -> (completion, None); ``worker`` -> (agent, openhands). Workers carry the engine
    honest (the canvas convention + the data model), thinkers carry null — matching the builders."""
    assert routers._capability_to_columns("thinker") == ("completion", None)
    assert routers._capability_to_columns("worker") == ("agent", "openhands")


# --- The PATCH endpoint ------------------------------------------------------------------------


def test_patch_flips_non_root_thinker_to_worker_and_back(client):
    """On a thinker_chain team, the Architect is a NON-root completion (thinker). Flipping it to a
    worker is a paired kind+engine write; flipping it back restores completion/null. Re-read each
    time so the persistence is genuine."""
    tid = create_team_from_template("thinker_chain", "Cap flip", auth_user_id())
    architect = _graph_nodes(client, tid)["architect"]
    assert architect["kind"] == "completion" and architect["engine"] is None  # seeded as a thinker

    # (a) thinker -> worker.
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{architect['id']}",
        json={"prompt": architect["prompt"], "model": architect["model"], "capability": "worker"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["kind"] == "agent" and resp.json()["engine"] == "openhands"
    row = _row(architect["id"])
    assert row.kind == "agent" and row.engine == "openhands"  # persisted

    # (b) worker -> thinker (back to completion / no engine).
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{architect['id']}",
        json={"prompt": architect["prompt"], "model": architect["model"], "capability": "thinker"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["kind"] == "completion" and resp.json()["engine"] is None
    row = _row(architect["id"])
    assert row.kind == "completion" and row.engine is None  # persisted


def test_patch_worker_on_root_is_rejected_409(client):
    """The ROOT node (the PM — not targeted by any edge) must stay a thinker: it writes the spec the
    rest of the team reads, so making it a worker would leave no spec for read_latest_prd_step. The
    endpoint rejects it 409 and the row is unchanged."""
    tid = create_team_from_template("thinker_chain", "Root lock", auth_user_id())
    pm = _graph_nodes(client, tid)["pm"]
    assert pm["kind"] == "completion"

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{pm['id']}",
        json={"prompt": pm["prompt"], "model": pm["model"], "capability": "worker"},
    )
    assert resp.status_code == 409, resp.text
    # The rejected write never landed — the PM is still a completion/thinker with no engine.
    row = _row(pm["id"])
    assert row.kind == "completion" and row.engine is None


def test_patch_root_to_thinker_is_allowed_noop(client):
    """Asking the root to be a thinker (its current capability) is allowed — only ``worker`` on the
    root is locked. The PM stays a completion."""
    tid = create_team_from_template("thinker_chain", "Root stays thinker", auth_user_id())
    pm = _graph_nodes(client, tid)["pm"]
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{pm['id']}",
        json={"prompt": pm["prompt"], "model": pm["model"], "capability": "thinker"},
    )
    assert resp.status_code == 200, resp.text
    row = _row(pm["id"])
    assert row.kind == "completion" and row.engine is None


def test_patch_without_capability_leaves_kind_and_engine_unchanged(client):
    """Back-compat: a ``{prompt, model}`` save with NO ``capability`` leaves kind/engine untouched
    (the prior P1.8b save contract still works). The Engineer stays an agent/openhands worker; only
    its prompt/model change."""
    tid = create_team_from_template("thinker_chain", "Back compat", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]
    assert eng["kind"] == "agent" and eng["engine"] == "openhands"
    new_prompt = f"sentinel {uuid.uuid4().hex}"

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={"prompt": new_prompt, "model": "openai/gpt-4o-mini"},
    )
    assert resp.status_code == 200, resp.text
    row = _row(eng["id"])
    # kind/engine UNCHANGED; prompt/model updated.
    assert row.kind == "agent" and row.engine == "openhands"
    assert row.prompt == new_prompt and row.model == "openai/gpt-4o-mini"


def test_patch_capability_still_writes_prompt_and_model(client):
    """A capability flip carries the prompt/model write too (the panel posts all fields). Flipping
    the Architect to a worker AND editing its prompt persists both in one PATCH."""
    tid = create_team_from_template("thinker_chain", "Flip plus edit", auth_user_id())
    architect = _graph_nodes(client, tid)["architect"]
    new_prompt = f"worker now {uuid.uuid4().hex}"
    new_model = "nvidia_nim/meta/llama-3.3-70b-instruct"

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{architect['id']}",
        json={"prompt": new_prompt, "model": new_model, "capability": "worker"},
    )
    assert resp.status_code == 200, resp.text
    row = _row(architect["id"])
    assert row.kind == "agent" and row.engine == "openhands"
    assert row.prompt == new_prompt and row.model == new_model
