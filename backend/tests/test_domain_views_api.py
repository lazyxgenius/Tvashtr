"""Revamp Domains list + detail summaries (DM-1, DM-8..DM-12): GET /api/domains and
GET /api/domains/{id} carry files by phase, pieces, state, quality, usage, last activity and the
reading model — computed owner-scoped — while every old key stays."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from tvashtr.control_plane.domain_usage import agent_domain_scope
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import (
    AgentNode,
    DomainChunk,
    DomainDocument,
    DomainEvalCase,
    DomainEvalRun,
    ProviderCredential,
    TeamGraph,
)


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domain-views-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register", json={"email": email, "password": "domains-password"}
        ).status_code
        == 200
    )
    return c, uuid.UUID(c.get("/api/auth/me").json()["id"])


def _domain(c: TestClient, name: str = "Support docs", template: str = "support") -> uuid.UUID:
    resp = c.post("/api/domains", json={"name": name, "template": template})
    assert resp.status_code == 200, resp.text
    return uuid.UUID(resp.json()["domain_id"])


def _doc(domain_id: uuid.UUID, status: str, *, pieces: int = 0, version: int = 1) -> uuid.UUID:
    with session_scope() as s:
        doc = DomainDocument(
            domain_id=domain_id,
            filename=f"{uuid.uuid4().hex[:6]}.md",
            content_type="text/markdown",
            storage_path=f"x/{uuid.uuid4().hex}",
            byte_size=100,
            ingest_status=status,
            version=version,
        )
        s.add(doc)
        s.flush()
        for i in range(pieces):
            s.add(
                DomainChunk(domain_id=domain_id, document_id=doc.id, ordinal=i, text=f"piece {i}")
            )
        return doc.id


def _key(owner: uuid.UUID, provider: str) -> None:
    with session_scope() as s:
        s.add(
            ProviderCredential(
                owner_id=owner, provider=provider, secret_encrypted="x", key_last4="abcd"
            )
        )


def _item(c: TestClient, domain_id: uuid.UUID) -> dict:
    items = {d["domain_id"]: d for d in c.get("/api/domains").json()["domains"]}
    return items[str(domain_id)]


def test_empty_domain_summary_keeps_old_keys_and_adds_new_ones():
    c, _owner = _fresh()
    did = _domain(c)
    item = _item(c, did)
    # Old keys unchanged.
    assert item["name"] == "Support docs"
    assert item["status"] == "empty"
    assert item["doc_count"] == 0
    assert "config" in item and "created_at" in item and "updated_at" in item
    # New keys.
    assert item["files"] == {
        "total": 0,
        "ready": 0,
        "reading": 0,
        "waiting": 0,
        "waiting_for_key": 0,
        "needs_attention": 0,
    }
    assert item["pieces"] == 0
    assert item["state"] == "empty"
    assert item["quality"] == {
        "cases": 0,
        "last_run_at": None,
        "hit_at_k": None,
        "keyword_hit": None,
        "retrieval_mode": None,
        "top_k": None,
    }
    assert item["usage"] == {"uses": 0, "teams": 0, "steps": 0, "agents": 0}
    assert item["last_activity_at"] == item["updated_at"]
    assert item["reading_model"] == {
        "slug": "openai/text-embedding-3-small",
        "label": "OpenAI text-embedding-3-small",
        "provider": "openai",
        "dim": 1536,
        "key_saved": False,
    }


def test_files_by_phase_pieces_and_reading_state():
    c, owner = _fresh()
    _key(owner, "openai")
    did = _domain(c)
    _doc(did, "ready", pieces=3)
    _doc(did, "ready", pieces=2)
    _doc(did, "indexing", pieces=4)  # being read: its pieces don't count yet
    _doc(did, "pending")
    _doc(did, "error")
    item = _item(c, did)
    assert item["files"] == {
        "total": 5,
        "ready": 2,
        "reading": 1,
        "waiting": 1,
        "waiting_for_key": 0,
        "needs_attention": 1,
    }
    assert item["pieces"] == 5
    assert item["state"] == "reading"
    assert item["reading_model"]["key_saved"] is True


def test_waiting_for_a_key_then_needs_attention_then_ready():
    c, owner = _fresh()
    waiting = _domain(c, "Q3 filings", "financial")
    _doc(waiting, "pending")
    _doc(waiting, "ready", pieces=1)
    item = _item(c, waiting)
    assert item["files"]["waiting_for_key"] == 1 and item["files"]["waiting"] == 0
    assert item["state"] == "waiting_for_key"

    broken = _domain(c, "Research papers", "scientific")
    _doc(broken, "ready", pieces=1)
    _doc(broken, "error")
    assert _item(c, broken)["state"] == "needs_attention"

    ready = _domain(c, "Vendor contracts", "legal")
    _doc(ready, "ready", pieces=2)
    assert _item(c, ready)["state"] == "ready"

    # Saving the key turns the waiting file into a queued one.
    _key(owner, "openai")
    item = _item(c, waiting)
    assert item["files"]["waiting"] == 1 and item["files"]["waiting_for_key"] == 0
    assert item["state"] == "reading"


def test_a_file_read_before_is_rereading():
    c, owner = _fresh()
    _key(owner, "openai")
    did = _domain(c)
    _doc(did, "ready", pieces=1, version=2)
    _doc(did, "indexing", version=2)
    assert _item(c, did)["state"] == "rereading"


def test_reading_model_label_and_key_follow_the_config():
    c, owner = _fresh()
    _key(owner, "huggingface")
    did = _domain(c)
    cfg = c.get(f"/api/domains/{did}").json()["config"]
    cfg["embedding"]["model"] = "huggingface/BAAI/bge-small-en-v1.5"
    assert c.patch(f"/api/domains/{did}", json={"config": cfg}).status_code == 200
    assert _item(c, did)["reading_model"] == {
        "slug": "huggingface/BAAI/bge-small-en-v1.5",
        "label": "Hugging Face BGE-small (free)",
        "provider": "huggingface",
        "dim": 384,
        "key_saved": True,
    }


def test_quality_reads_the_latest_finished_run():
    c, _owner = _fresh()
    did = _domain(c)
    now = datetime.now(UTC)
    with session_scope() as s:
        for i in range(3):
            s.add(DomainEvalCase(domain_id=did, question=f"q{i}", ordinal=i))
        s.add(
            DomainEvalRun(
                domain_id=did,
                status="completed",
                scores={
                    "hit_at_k": 0.5,
                    "keyword_hit": None,
                    "retrieval_mode": "dense",
                    "top_k": 8,
                },
                completed_at=now - timedelta(days=2),
            )
        )
        s.add(
            DomainEvalRun(
                domain_id=did,
                status="completed",
                scores={
                    "hit_at_k": 0.8333,
                    "keyword_hit": 0.5,
                    "retrieval_mode": "hybrid",
                    "top_k": 8,
                },
                completed_at=now - timedelta(hours=1),
            )
        )
        s.add(DomainEvalRun(domain_id=did, status="failed", scores=None, completed_at=now))
    q = _item(c, did)["quality"]
    assert q["cases"] == 3
    assert q["hit_at_k"] == 0.8333
    assert q["keyword_hit"] == 0.5
    assert q["retrieval_mode"] == "hybrid"
    assert q["top_k"] == 8
    assert q["last_run_at"] is not None


def _team(owner: uuid.UUID | None, *, library: bool = True) -> uuid.UUID:
    with session_scope() as s:
        t = TeamGraph(name="Docs team", is_library=library, owner_id=owner)
        s.add(t)
        s.flush()
        return t.id


def _node(team: uuid.UUID, kind: str, *, config=None, tool_config=None) -> None:
    with session_scope() as s:
        s.add(
            AgentNode(
                team_graph_id=team,
                role_name=kind,
                kind=kind,
                config=config,
                tool_config=tool_config,
                position={},
            )
        )


def test_usage_counts_steps_agents_and_distinct_library_teams():
    c, owner = _fresh()
    other, other_owner = _fresh()
    support = _domain(c)
    vendor = _domain(c, "Vendor contracts", "legal")

    docs_team = _team(owner)
    _node(docs_team, "domain_query", config={"domain_id": str(support)})
    _node(docs_team, "agent", tool_config={"tvashtr": {"domains": [str(support)]}})
    sprint_team = _team(owner)
    # The legacy "all domains" switch counts for every domain.
    _node(sprint_team, "completion", tool_config={"tvashtr": {"domains": True}})
    _node(sprint_team, "domain_query", config={"domain_id": None})
    # A run-snapshot clone and another account's team never count.
    clone = _team(owner, library=False)
    _node(clone, "domain_query", config={"domain_id": str(support)})
    foreign = _team(other_owner)
    _node(foreign, "domain_query", config={"domain_id": str(support)})

    assert _item(c, support)["usage"] == {"uses": 3, "teams": 2, "steps": 1, "agents": 2}
    assert _item(c, vendor)["usage"] == {"uses": 1, "teams": 1, "steps": 0, "agents": 1}
    assert other.get("/api/domains").json() == {"domains": []}


def test_agent_domain_scope_reads_true_dict_and_list():
    did = uuid.uuid4()
    assert agent_domain_scope({"tvashtr": {"domains": True}}, did) == "all"
    assert agent_domain_scope({"tvashtr": {"domains": {"enabled": True}}}, did) == "all"
    assert agent_domain_scope({"tvashtr": {"domains": {"enabled": False}}}, did) is None
    assert agent_domain_scope({"tvashtr": {"domains": [str(did)]}}, did) == "this"
    assert agent_domain_scope({"tvashtr": {"domains": [str(uuid.uuid4())]}}, did) is None
    assert agent_domain_scope({"mcpServers": {}}, did) is None
    assert agent_domain_scope(None, did) is None


def test_last_activity_follows_the_newest_file():
    c, _owner = _fresh()
    did = _domain(c)
    doc = _doc(did, "ready", pieces=1)
    later = datetime.now(UTC) + timedelta(hours=1)
    with session_scope() as s:
        s.get(DomainDocument, doc).updated_at = later
    assert _item(c, did)["last_activity_at"] == later.isoformat()


def test_detail_carries_the_same_summary_and_is_owner_scoped():
    c, owner = _fresh()
    other, _ = _fresh()
    _key(owner, "openai")
    did = _domain(c)
    _doc(did, "ready", pieces=2)
    detail = c.get(f"/api/domains/{did}").json()
    listed = _item(c, did)
    for key in (
        "files",
        "pieces",
        "state",
        "quality",
        "usage",
        "last_activity_at",
        "reading_model",
    ):
        assert detail[key] == listed[key], key
    assert detail["state"] == "ready" and detail["pieces"] == 2
    resp = other.get(f"/api/domains/{did}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "domain not found"


def test_list_is_in_creation_order():
    c, _owner = _fresh()
    names = ["Support docs", "Vendor contracts", "Research papers", "Q3 filings"]
    for n in names:
        _domain(c, n)
    assert [d["name"] for d in c.get("/api/domains").json()["domains"]] == names


def test_templates_in_design_order_with_copy_and_sizes():
    c, _owner = _fresh()
    body = c.get("/api/domain-templates").json()["templates"]
    assert [t["template"] for t in body] == ["support", "legal", "financial", "scientific", "blank"]
    assert [(t["short"], t["piece_size"], t["overlap"]) for t in body] == [
        ("Help center and product docs", 600, 100),
        ("Contracts and policies", 500, 80),
        ("Filings and investor docs", 700, 100),
        ("Papers and methods", 1000, 150),
        ("Start from defaults", 800, 100),
    ]
    assert body[1]["description"] == "Contracts and policies · precise sources"
    assert body[4]["name"] == "Blank"
