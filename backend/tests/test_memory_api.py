"""M-memory S1 — owner-scoped CRUD API contract tests (mutation-real, offline).

The gateway ``embed`` is monkeypatched to a DETERMINISTIC, content-dependent 1536-float vector (an
autouse fixture) so these run offline yet exercise the REAL endpoints + the REAL DB + the REAL
pgvector ``vector(1536)`` column (a live round-trip is the separate ``scripts/memory_smoke``
target). They assert the exact tier derivation, the stored 1536 length, re-embed-ON-content-change
(the stored vector actually changes), pin/unpin, delete, off-ledger metering, and owner-isolation (A
cannot GET/PATCH/DELETE/pin B's memory).
"""

import hashlib
import uuid

import pytest
from conftest import auth_user_id
from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.control_plane import memory
from tvashtr.db import session_scope
from tvashtr.gateway import EmbeddingResult
from tvashtr.main import app
from tvashtr.models import CostRecord, NodeMemory

_EMBED_MODEL = "openai/text-embedding-3-small"


def _fake_vector(text: str) -> list[float]:
    """A deterministic, content-dependent 1536-float vector — different content ⇒ different vector
    (so a re-embed is observably different), same content ⇒ identical (so a no-op is a no-op)."""
    seed = int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")
    return [((seed + i * 2654435761) % 1000) / 1000.0 for i in range(1536)]


@pytest.fixture(autouse=True)
def _fake_embed(monkeypatch):
    """Patch the gateway embed the memory service calls — offline, deterministic, 1536-dim."""

    def fake(request):
        return EmbeddingResult(
            vectors=[_fake_vector(t) for t in request.input],
            model=request.model,
            prompt_tokens=4,
            total_tokens=4,
            cost_usd=0.0,
            raw_provider="openai",
            latency_ms=0.5,
        )

    monkeypatch.setattr(memory, "embed", fake)


def _stored_vector(memory_id: str) -> list[float]:
    """Read the raw stored embedding straight from the DB (bypassing the API, which returns only the
    dimension) — as a plain list regardless of the driver's list/ndarray return shape."""
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(NodeMemory.id == uuid.UUID(memory_id))
        ).scalar_one()
        emb = row.embedding
        return [float(x) for x in emb]


def _register_other() -> TestClient:
    other = TestClient(app)
    other.cookies.clear()
    reg = other.post(
        "/api/auth/register",
        json={"email": f"mem-other-{uuid.uuid4().hex}@tvashtr.local", "password": "pw-123456"},
    )
    assert reg.status_code == 200, reg.text
    return other


# ---------------------------------------------------------------- tier creation ----


def test_create_account_tier_stores_a_real_1536_vector(client):
    resp = client.post("/api/memories", json={"content": "prefers pytest over unittest"})
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["tier"] == "account"  # no repo_key, no node_id
    assert row["repo_key"] is None and row["node_id"] is None
    assert row["embedding_dim"] == 1536  # a real vector was stored
    assert row["status"] == "active"
    assert row["pinned"] is False
    assert row["confirmation_count"] == 1
    # The vector really landed in the pgvector column at the pinned dimension.
    assert len(_stored_vector(row["id"])) == 1536


def test_create_repo_tier(client):
    repo = f"/repo/{uuid.uuid4().hex}"
    resp = client.post("/api/memories", json={"content": "the build uses uv", "repo_key": repo})
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["tier"] == "repo"
    assert row["repo_key"] == repo and row["node_id"] is None
    assert row["embedding_dim"] == 1536


def test_create_node_tier(client):
    repo = f"/repo/{uuid.uuid4().hex}"
    node = str(uuid.uuid4())
    resp = client.post(
        "/api/memories",
        json={"content": "this reviewer is strict", "repo_key": repo, "node_id": node},
    )
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["tier"] == "node"
    assert row["repo_key"] == repo and row["node_id"] == node
    assert row["embedding_dim"] == 1536


def test_node_only_tier_without_repo_is_allowed(client):
    # Revamp (FOCUS-58 / OQ-18): a node_id without a repo_key is the node-only tier ("Not
    # repo-specific" agent notes) — it used to be rejected 422.
    node = str(uuid.uuid4())
    resp = client.post("/api/memories", json={"content": "agent-wide note", "node_id": node})
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["tier"] == "node"
    assert row["repo_key"] is None and row["node_id"] == node


def test_empty_content_is_422(client):
    assert client.post("/api/memories", json={"content": "   "}).status_code == 422


def test_malformed_node_id_is_422(client):
    resp = client.post(
        "/api/memories", json={"content": "x", "repo_key": "/r", "node_id": "not-a-uuid"}
    )
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------- listing / filters ----


def test_list_filtered_by_tier(client):
    repo_a = f"/a/{uuid.uuid4().hex}"
    repo_b = f"/b/{uuid.uuid4().hex}"
    node = str(uuid.uuid4())
    acct = client.post("/api/memories", json={"content": "acct pref"}).json()["id"]
    a_repo = client.post("/api/memories", json={"content": "a repo", "repo_key": repo_a}).json()[
        "id"
    ]
    a_node = client.post(
        "/api/memories", json={"content": "a node", "repo_key": repo_a, "node_id": node}
    ).json()["id"]
    b_repo = client.post("/api/memories", json={"content": "b repo", "repo_key": repo_b}).json()[
        "id"
    ]

    # ?repo_key=repo_a → the repo + node rows on repo_a, NOT repo_b, NOT the account row.
    by_repo = {m["id"] for m in client.get(f"/api/memories?repo_key={repo_a}").json()["memories"]}
    assert by_repo == {a_repo, a_node}

    # ?node_id=node → just that node's row.
    by_node = {m["id"] for m in client.get(f"/api/memories?node_id={node}").json()["memories"]}
    assert by_node == {a_node}

    # No filter → all of the owner's rows include every one just created.
    all_ids = {m["id"] for m in client.get("/api/memories").json()["memories"]}
    assert {acct, a_repo, a_node, b_repo} <= all_ids


def test_list_excludes_superseded_by_default(client):
    # Directly insert a non-active row (what S2 will produce) to prove the status filter.
    repo = f"/sup/{uuid.uuid4().hex}"
    with session_scope() as session:
        row = NodeMemory(
            owner_id=auth_user_id(),
            repo_key=repo,
            content="an old, superseded fact",
            embedding=_fake_vector("old"),
            status="superseded",
        )
        session.add(row)
        session.flush()
        sup_id = str(row.id)

    default_ids = {m["id"] for m in client.get(f"/api/memories?repo_key={repo}").json()["memories"]}
    assert sup_id not in default_ids  # excluded by default
    incl_ids = {
        m["id"]
        for m in client.get(f"/api/memories?repo_key={repo}&include_superseded=true").json()[
            "memories"
        ]
    }
    assert sup_id in incl_ids  # included on request


# ---------------------------------------------------------------- edit / re-embed ----


def test_patch_content_reembeds_the_vector(client):
    created = client.post("/api/memories", json={"content": "original fact"}).json()
    mid = created["id"]
    before = _stored_vector(mid)

    resp = client.patch(f"/api/memories/{mid}", json={"content": "a completely different fact"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["content"] == "a completely different fact"

    after = _stored_vector(mid)
    assert len(after) == 1536  # still the pinned dimension
    assert after != before  # re-embedded — the stored vector actually CHANGED


def test_patch_pinned_only_does_not_reembed(client):
    created = client.post("/api/memories", json={"content": "keep this vector"}).json()
    mid = created["id"]
    before = _stored_vector(mid)

    resp = client.patch(f"/api/memories/{mid}", json={"pinned": True})
    assert resp.status_code == 200, resp.text
    assert resp.json()["pinned"] is True
    assert _stored_vector(mid) == before  # pin-only change left the embedding untouched


def test_pin_and_unpin_endpoints(client):
    mid = client.post("/api/memories", json={"content": "pin me"}).json()["id"]
    assert client.post(f"/api/memories/{mid}/pin").json()["pinned"] is True
    assert client.post(f"/api/memories/{mid}/unpin").json()["pinned"] is False


# ---------------------------------------------------------------- delete ----


def test_delete_removes_the_row(client):
    repo = f"/del/{uuid.uuid4().hex}"
    mid = client.post("/api/memories", json={"content": "delete me", "repo_key": repo}).json()["id"]
    assert client.delete(f"/api/memories/{mid}").status_code == 204
    remaining = {m["id"] for m in client.get(f"/api/memories?repo_key={repo}").json()["memories"]}
    assert mid not in remaining
    # A subsequent PATCH on the deleted id 404s (it is truly gone).
    assert client.patch(f"/api/memories/{mid}", json={"pinned": True}).status_code == 404


# ---------------------------------------------------------------- metering ----


def test_create_meters_embedding_off_ledger(client):
    client.post("/api/memories", json={"content": "meter me off-ledger"})
    with session_scope() as session:
        n = (
            session.execute(
                select(CostRecord).where(
                    CostRecord.model_requested == _EMBED_MODEL,
                    CostRecord.workflow_id.is_(None),
                    CostRecord.completion_tokens == 0,
                )
            )
            .scalars()
            .all()
        )
    assert len(n) >= 1  # the embedding cost was recorded, NOT attributed to any run


# ---------------------------------------------------------------- owner isolation ----


def test_owner_cannot_touch_another_owners_memory(client):
    # Owner A (the shared conftest client) creates a memory.
    repo = f"/iso/{uuid.uuid4().hex}"
    a_id = client.post("/api/memories", json={"content": "A's secret", "repo_key": repo}).json()[
        "id"
    ]

    other = _register_other()  # owner B

    # B's list never shows A's row (owner-scoped always).
    b_ids = {m["id"] for m in other.get(f"/api/memories?repo_key={repo}").json()["memories"]}
    assert a_id not in b_ids
    assert b_ids == set()

    # B cannot PATCH or pin A's memory — 404 (existence not even leaked).
    assert other.patch(f"/api/memories/{a_id}", json={"pinned": True}).status_code == 404
    assert other.post(f"/api/memories/{a_id}/pin").status_code == 404

    # B's DELETE is idempotent 204 but must NOT delete A's row.
    assert other.delete(f"/api/memories/{a_id}").status_code == 204
    still = {m["id"] for m in client.get(f"/api/memories?repo_key={repo}").json()["memories"]}
    assert a_id in still  # A's memory survived B's delete attempt

    # Sanity: A can still edit it.
    assert client.patch(f"/api/memories/{a_id}", json={"pinned": True}).status_code == 200
