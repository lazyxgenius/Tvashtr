"""B-NODES (frontend revamp): one agent's rounds across runs
(``GET /api/teams/{team}/nodes/{node}/runs``) and "Preview as the agent sees it"
(``POST /api/teams/{team}/nodes/{node}/context-preview``)."""

import uuid
from decimal import Decimal

import litellm
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from tvashtr.control_plane.teams import clone_team_graph, create_team_from_template
from tvashtr.db import session_scope
from tvashtr.documents.service import add_version, create_document_with_initial_version
from tvashtr.main import app
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    DesktopNodeJob,
    NodeMemory,
    Run,
)


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"nodes-hist-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "nodes-password"})
    assert resp.status_code == 200
    return c, uuid.UUID(resp.json()["id"])


@pytest.fixture
def owner(client):
    """A fresh account with its own review_loop team (so memories/runs never leak across tests)."""
    c, owner_id = _fresh()
    tid = create_team_from_template("review_loop", "Indicator sprint team", owner_id)
    nodes = {n["role_name"]: n for n in c.get(f"/api/teams/{tid}/graph").json()["nodes"]}
    return c, owner_id, tid, nodes


def _clone_nodes(clone_id: str) -> dict[str, uuid.UUID]:
    with session_scope() as session:
        rows = session.execute(
            select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(clone_id))
        ).scalars()
        return {n.role_name: n.id for n in rows}


def _seed_run(owner_id: uuid.UUID, tid: str, idea: str = "Add an RSI indicator") -> dict:
    """A finished run of ``tid``: spec v1 (entry), build-notes v1 (engineer round 1), two reviewer
    rounds (round 1 on a Desktop subscription, round 2 on an API key with a cost row)."""
    clone_id = clone_team_graph(tid)
    clone = _clone_nodes(clone_id)
    run_id = uuid.uuid4()
    rid = str(run_id)
    with session_scope() as session:
        session.add(
            Run(
                id=run_id,
                team_graph_id=uuid.UUID(clone_id),
                owner_id=owner_id,
                idea=idea,
                workflow_id=rid,
                status="completed",
            )
        )
    spec = create_document_with_initial_version(
        "Mini-PRD", "prd", "PRD: RSI", "agent:entry", f"{rid}:pm-prd-v1", run_id=run_id, name="spec"
    )
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == run_id).values(pm_document_id=spec.id))
        pm_inv = AgentInvocation(
            run_id=rid, node_id=clone["pm"], iteration=1, status="done", outcome="prd_written"
        )
        eng_inv = AgentInvocation(
            run_id=rid, node_id=clone["engineer"], iteration=1, status="done", outcome="built"
        )
        session.add_all([pm_inv, eng_inv])
        session.flush()
        ids = {"pm": pm_inv.id, "engineer": eng_inv.id}
    from tvashtr.documents.service import find_or_create_run_document

    find_or_create_run_document(
        run_id=run_id,
        name="build-notes",
        title="Document: build-notes",
        doc_type="build-notes",
        content="notes v1",
        created_by=f"agent:{clone['engineer']}",
        idempotency_key=f"{rid}:doc:build-notes:{clone['engineer']}:1",
    )
    with session_scope() as session:
        r1 = AgentInvocation(
            run_id=rid,
            node_id=clone["reviewer"],
            iteration=1,
            status="done",
            outcome="changes_requested",
            outcome_detail="The new function is not registered on `INDICATORS`.",
            context_manifest={"parts": [], "memory": [{"id": "m1", "polarity": "require"}]},
        )
        r2 = AgentInvocation(
            run_id=rid, node_id=clone["reviewer"], iteration=2, status="done", outcome="approved"
        )
        session.add_all([r1, r2])
        session.flush()
        ids["reviewer_1"], ids["reviewer_2"] = r1.id, r2.id
        session.add(
            CostRecord(
                workflow_id=rid,
                invocation_id=r2.id,
                idempotency_key=f"{rid}:agent-cost:{clone['reviewer']}:2",
                model_requested="xai/grok-4.7",
                model_used="openai/gpt-4o-mini",
                prompt_tokens=16000,
                completion_tokens=900,
                total_tokens=16900,
                cost_usd=Decimal("0.012"),
            )
        )
        session.add(
            DesktopNodeJob(
                owner_id=owner_id,
                run_id=rid,
                node_id=str(clone["reviewer"]),
                attempt_key=f"{clone['reviewer']}:1",
                invocation_id=r1.id,
                provider="grok",
                model="xai/grok-4.7",
                instruction="…",
                workspace_dir="/tmp/x",
                status="completed",
                files_changed=["REVIEW_VERDICT.json"],
            )
        )
    return {"run_id": rid, "clone": clone, "inv": ids, "spec_id": str(spec.id)}


# ---- GET …/nodes/{node}/runs --------------------------------------------------------------------


def test_history_lists_runs_and_rounds_newest_first(owner):
    c, owner_id, tid, nodes = owner
    seeded = _seed_run(owner_id, tid)
    body = c.get(f"/api/teams/{tid}/nodes/{nodes['reviewer']['id']}/runs").json()
    assert len(body["runs"]) == 1
    brief = body["runs"][0]
    assert brief["run_id"] == seeded["run_id"]
    assert brief["idea"] == "Add an RSI indicator"
    assert brief["rounds_count"] == 2
    assert brief["last_outcome"] == "approved"
    assert brief["live"] is False

    run = body["run"]
    assert run["run_id"] == seeded["run_id"]
    assert [r["iteration"] for r in run["rounds"]] == [2, 1]
    latest, first = run["rounds"]
    assert latest["invocation_id"] == seeded["inv"]["reviewer_2"]
    assert latest["cost"]["total_tokens"] == 16900
    assert latest["cost"]["cost_usd"] == pytest.approx(0.012)
    assert latest["model_used"] == "openai/gpt-4o-mini"
    assert latest["runs_on"] == {"via": "api_key", "provider": "openai"}
    assert first["runs_on"] == {"via": "subscription", "provider": "grok"}
    assert first["cost"] is None
    # What it was given: the shared spec (default reads), the manifest's lessons, its skills.
    assert first["given"]["documents"] == [
        {
            "document_id": seeded["spec_id"],
            "name": "spec",
            "version_no": 1,
            "is_shared_spec": True,
        }
    ]
    assert first["given"]["memory"] == [{"id": "m1", "polarity": "require"}]
    # What it produced: its verdict (it routes on one) and the files the Desktop job changed.
    assert first["produced"]["verdict"] == {
        "file": "REVIEW_VERDICT.json",
        "verdict": "changes_requested",
        "reasons": "The new function is not registered on `INDICATORS`.",
    }
    assert first["produced"]["files"] == ["REVIEW_VERDICT.json"]
    assert latest["produced"]["verdict"]["verdict"] == "approved"


def test_history_reports_documents_written(owner):
    c, owner_id, tid, nodes = owner
    seeded = _seed_run(owner_id, tid)
    eng = c.get(f"/api/teams/{tid}/nodes/{nodes['engineer']['id']}/runs").json()["run"]
    produced = eng["rounds"][0]["produced"]
    assert produced["verdict"] is None
    assert [(d["name"], d["version_no"]) for d in produced["documents"]] == [("build-notes", 1)]
    pm = c.get(f"/api/teams/{tid}/nodes/{nodes['pm']['id']}/runs").json()["run"]
    assert pm["rounds"][0]["produced"]["documents"] == [
        {"document_id": seeded["spec_id"], "name": "spec", "version_no": 1, "is_shared_spec": True}
    ]
    assert pm["rounds"][0]["given"]["documents"] == []  # the entry's first round writes the spec


def test_history_run_id_selects_and_limit_caps(owner):
    c, owner_id, tid, nodes = owner
    older = _seed_run(owner_id, tid, idea="First team run")
    newer = _seed_run(owner_id, tid, idea="Fix the MACD label")
    url = f"/api/teams/{tid}/nodes/{nodes['reviewer']['id']}/runs"
    body = c.get(url).json()
    assert [r["run_id"] for r in body["runs"]] == [newer["run_id"], older["run_id"]]
    assert body["run"]["run_id"] == newer["run_id"]
    picked = c.get(url, params={"run_id": older["run_id"]}).json()
    assert picked["run"]["idea"] == "First team run"
    assert len(c.get(url, params={"limit": 1}).json()["runs"]) == 1


def test_history_empty_for_a_node_that_never_ran(owner):
    c, _owner_id, tid, nodes = owner
    body = c.get(f"/api/teams/{tid}/nodes/{nodes['reviewer']['id']}/runs").json()
    assert body == {"runs": [], "run": None}


def test_history_is_owner_scoped(owner):
    c, owner_id, tid, nodes = owner
    seeded = _seed_run(owner_id, tid)
    other, other_id = _fresh()
    url = f"/api/teams/{tid}/nodes/{nodes['reviewer']['id']}/runs"
    resp = other.get(url)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "library team not found"
    # A run of another team (even the caller's own) is not this agent's run.
    other_tid = create_team_from_template("review_loop", "Other", other_id)
    other_run = _seed_run(other_id, other_tid)
    assert c.get(url, params={"run_id": other_run["run_id"]}).status_code == 404
    assert c.get(url, params={"run_id": "not-a-uuid"}).status_code == 404
    assert c.get(f"/api/teams/{tid}/nodes/{uuid.uuid4()}/runs").status_code == 404
    assert c.get(url, params={"run_id": seeded["run_id"]}).status_code == 200


# ---- POST …/nodes/{node}/context-preview --------------------------------------------------------


@pytest.fixture
def no_model_calls(monkeypatch):
    def boom(*_a, **_k):
        raise AssertionError("the preview must not call a model")

    monkeypatch.setattr(litellm, "completion", boom)
    monkeypatch.setattr(litellm, "embedding", boom)


def _preview(c, tid, node_id, body=None):
    return c.post(f"/api/teams/{tid}/nodes/{node_id}/context-preview", json=body or {})


def test_preview_entry_agent_before_any_run(owner, no_model_calls):
    c, _owner_id, tid, nodes = owner
    resp = _preview(c, tid, nodes["pm"]["id"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source_run"] is None
    assert [p["key"] for p in body["parts"]] == ["node_prompt", "idea", "capability_note"]
    idea = body["parts"][1]
    assert idea["placeholder"] is True
    assert "No run yet" in idea["text"]
    assert body["parts"][0]["text"] == nodes["pm"]["prompt"]
    assert body["total_tokens"] == sum(p["tokens"] for p in body["parts"])
    assert body["budget"] > 0 and body["over_budget"] is False
    assert any("writes the shared spec" in n for n in body["notes"])


def test_preview_reviewer_uses_the_latest_run_and_spec(owner, no_model_calls):
    c, owner_id, tid, nodes = owner
    seeded = _seed_run(owner_id, tid)
    add_version(
        uuid.UUID(seeded["spec_id"]), "PRD: RSI v2", created_by="human", idempotency_key="h-v2"
    )
    body = _preview(c, tid, nodes["reviewer"]["id"]).json()
    assert body["source_run"]["run_id"] == seeded["run_id"]
    parts = {p["key"]: p for p in body["parts"]}
    assert parts["idea"]["text"].endswith("Add an RSI indicator")
    assert parts["spec"]["source"]["version_no"] == 2
    assert parts["spec"]["source"]["label"] == "Shared spec · v2"
    assert "PRD: RSI v2" in parts["spec"]["text"]


def test_preview_applies_the_draft(owner, no_model_calls):
    c, owner_id, tid, nodes = owner
    _seed_run(owner_id, tid)
    rid = nodes["reviewer"]["id"]
    body = _preview(
        c,
        tid,
        rid,
        {"prompt": "Review it carefully.", "edits_allowed": True, "reads_from": ["build-notes"]},
    ).json()
    keys = [p["key"] for p in body["parts"]]
    assert keys == ["node_prompt", "idea", "read_documents"]  # edits on → no report-only note
    assert body["parts"][0]["text"] == "Review it carefully."
    docs = body["parts"][2]["source"]["documents"]
    assert [(d["name"], d["version_no"]) for d in docs] == [("build-notes", 1)]

    none = _preview(c, tid, rid, {"reads_default": False}).json()
    assert "spec" not in [p["key"] for p in none["parts"]]
    missing = _preview(c, tid, rid, {"reads_from": ["design"]}).json()
    assert "read_documents" not in [p["key"] for p in missing["parts"]]
    assert any("“design” isn’t written yet" in n for n in missing["notes"])


def test_preview_includes_pinned_lessons_and_skills(owner, no_model_calls):
    c, owner_id, tid, nodes = owner
    with session_scope() as session:
        session.add(
            NodeMemory(owner_id=owner_id, content="Run pytest -q.", polarity="require", pinned=True)
        )
        session.add(NodeMemory(owner_id=owner_id, content="Unpinned lesson", pinned=False))
    skills = [
        {"type": "inline", "name": "house-style", "content": "Use tabs.", "mode": "always"},
        {"type": "repo", "url": "https://github.com/org/skills", "ref": "main"},
    ]
    body = _preview(c, tid, nodes["engineer"]["id"], {"skills": skills}).json()
    memory = next(p for p in body["parts"] if p["key"] == "memory")
    assert "Run pytest -q." in memory["text"]
    assert "Unpinned lesson" not in memory["text"]
    assert [s["name"] for s in body["skills"]] == ["house-style", "https://github.com/org/skills"]
    assert body["skills"][0]["tokens"] > 0 and body["skills"][1]["fetched_at_run_time"] is True
    assert body["skills_tokens"] == body["skills"][0]["tokens"]


def test_preview_refuses_non_agents_and_other_accounts(owner, no_model_calls):
    c, owner_id, tid, nodes = owner
    resp = _preview(c, tid, nodes["ship"]["id"])
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Only agents have a context preview."
    other, _ = _fresh()
    assert _preview(other, tid, nodes["pm"]["id"]).status_code == 404
    assert _preview(c, tid, nodes["pm"]["id"], {"run_id": str(uuid.uuid4())}).status_code == 404
