"""M-memory S1b — the polarity substrate contract tests (mutation-real, offline).

Mirrors ``test_memory_api``'s harness (the gateway ``embed`` monkeypatched to a deterministic,
content-dependent 1536-float vector) so these run offline against the REAL endpoints + the REAL DB +
the pgvector column. They assert every one of the 6 polarities round-trips EXACTLY, an invalid value
is rejected 422, the default is ``context``, a polarity-only PATCH flips the tag WITHOUT
re-embedding (the raw stored vector is byte-for-byte unchanged), a content change still re-embeds
even when a polarity rides along, and owner-isolation still holds (B cannot set A's polarity).
"""

import hashlib
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.control_plane import memory
from tvashtr.db import session_scope
from tvashtr.gateway import EmbeddingResult
from tvashtr.main import app
from tvashtr.models import NodeMemory

_POLARITIES = ["require", "prefer", "allow", "context", "avoid", "forbid"]


def _fake_vector(text: str) -> list[float]:
    """Deterministic, content-dependent 1536-float vector (same content => identical vector, so a
    no-re-embed is observably a no-op)."""
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


def _stored(memory_id: str) -> tuple[str, list[float]]:
    """The raw ``(polarity, embedding)`` straight from the DB (bypassing the API), both read inside
    the session; the vector as a plain list regardless of the driver's return shape."""
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(NodeMemory.id == uuid.UUID(memory_id))
        ).scalar_one()
        return row.polarity, [float(x) for x in row.embedding]


def _register_other() -> TestClient:
    other = TestClient(app)
    other.cookies.clear()
    reg = other.post(
        "/api/auth/register",
        json={"email": f"mem-pol-{uuid.uuid4().hex}@tvashtr.local", "password": "pw-123456"},
    )
    assert reg.status_code == 200, reg.text
    return other


# ---------------------------------------------------------------- pure validation ----


def test_is_valid_polarity_matrix():
    for p in _POLARITIES:
        assert memory.is_valid_polarity(p) is True
    assert memory.is_valid_polarity("maybe") is False
    assert memory.is_valid_polarity(None) is False
    assert memory.is_valid_polarity("") is False
    assert memory.is_valid_polarity("REQUIRE") is False  # case-sensitive — exact literals only


def test_invalid_polarity_raises_up_front_before_embedding():
    # The service rejects an invalid polarity BEFORE any DB / embedding work (pure, no fixture).
    with pytest.raises(memory.InvalidPolarityError):
        memory.create_memory(uuid.uuid4(), content="x", polarity="sometimes")


# ---------------------------------------------------------------- create at each polarity ----


@pytest.mark.parametrize("polarity", _POLARITIES)
def test_create_stores_and_returns_each_polarity(client, polarity):
    resp = client.post(
        "/api/memories", json={"content": f"a {polarity} fact", "polarity": polarity}
    )
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["polarity"] == polarity  # returned EXACTLY as sent
    stored_polarity, _ = _stored(row["id"])
    assert stored_polarity == polarity  # and persisted to the DB column


def test_create_without_polarity_defaults_to_context(client):
    resp = client.post("/api/memories", json={"content": "no polarity given"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["polarity"] == "context"
    assert _stored(resp.json()["id"])[0] == "context"


def test_create_invalid_polarity_is_422(client):
    resp = client.post("/api/memories", json={"content": "bad", "polarity": "maybe"})
    assert resp.status_code == 422, resp.text


# -------------------------------------------- polarity-only PATCH: no re-embed ----


def test_patch_polarity_only_changes_tag_without_reembedding(client):
    created = client.post("/api/memories", json={"content": "keep this vector"}).json()
    mid = created["id"]
    assert created["polarity"] == "context"  # default on create
    _, before = _stored(mid)

    resp = client.patch(f"/api/memories/{mid}", json={"polarity": "forbid"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["polarity"] == "forbid"  # the tag flipped

    after_polarity, after = _stored(mid)
    assert after_polarity == "forbid"
    assert after == before  # the embedding was NOT recomputed — byte-for-byte identical


def test_patch_polarity_only_never_calls_the_embed_gateway(client, monkeypatch):
    """The STRICT form of the no-re-embed guarantee: a polarity-only PATCH must not invoke the embed
    gateway AT ALL. (A deterministic fake would hide a wrong re-embed behind an identical vector, so
    assert on the CALL itself, not just the resulting bytes.)"""
    calls = {"n": 0}
    inner = memory.embed  # the autouse deterministic fake

    def counting(request):
        calls["n"] += 1
        return inner(request)

    monkeypatch.setattr(memory, "embed", counting)

    mid = client.post("/api/memories", json={"content": "count my embeds"}).json()["id"]
    assert calls["n"] == 1  # the create embedded exactly once

    resp = client.patch(f"/api/memories/{mid}", json={"polarity": "require"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["polarity"] == "require"
    assert calls["n"] == 1  # a polarity-only PATCH made NO new gateway call — no re-embed

    resp2 = client.patch(f"/api/memories/{mid}", json={"content": "different content now"})
    assert resp2.status_code == 200, resp2.text
    assert calls["n"] == 2  # a real content change DOES re-embed (guards against over-suppression)


def test_patch_invalid_polarity_is_422(client):
    mid = client.post("/api/memories", json={"content": "x"}).json()["id"]
    assert client.patch(f"/api/memories/{mid}", json={"polarity": "nope"}).status_code == 422
    assert _stored(mid)[0] == "context"  # the rejected patch left the row unchanged


def test_patch_content_and_polarity_together_reembeds(client):
    """A content change re-embeds even when a polarity rides along (guards the re-embed rule)."""
    created = client.post("/api/memories", json={"content": "original fact"}).json()
    mid = created["id"]
    _, before = _stored(mid)
    resp = client.patch(
        f"/api/memories/{mid}", json={"content": "a totally different fact", "polarity": "require"}
    )
    assert resp.status_code == 200, resp.text
    after_polarity, after = _stored(mid)
    assert after_polarity == "require"  # polarity set
    assert after != before  # content changed ⇒ re-embedded


# ---------------------------------------------------------------- owner isolation ----


def test_owner_cannot_set_another_owners_polarity(client):
    a_id = client.post("/api/memories", json={"content": "A's fact", "polarity": "prefer"}).json()[
        "id"
    ]
    other = _register_other()  # owner B
    # B PATCHing A's polarity (a VALID value) is a 404 — existence is not even leaked.
    assert other.patch(f"/api/memories/{a_id}", json={"polarity": "forbid"}).status_code == 404
    assert _stored(a_id)[0] == "prefer"  # A's polarity survived B's attempt
    # A can still change its own.
    assert client.patch(f"/api/memories/{a_id}", json={"polarity": "avoid"}).status_code == 200
    assert _stored(a_id)[0] == "avoid"
