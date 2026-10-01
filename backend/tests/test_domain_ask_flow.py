"""Phase 3 — ask_domain sync flow with mocked gateway."""

import uuid

import pytest
from fastapi.testclient import TestClient

from tvashtr.control_plane.domain_ask import DomainAskError, ask_domain
from tvashtr.db import session_scope
from tvashtr.gateway import CompletionResult, EmbeddingResult
from tvashtr.main import app
from tvashtr.models import Domain, DomainChunk, DomainDocument


def _register() -> tuple[TestClient, uuid.UUID, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"askflow-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post("/api/auth/register", json={"email": email, "password": "ask-password"}).status_code
        == 200
    )
    did = uuid.UUID(
        c.post("/api/domains", json={"template": "support", "name": "AskFlow"}).json()["domain_id"]
    )
    with session_scope() as session:
        domain = session.get(Domain, did)
        assert domain is not None
        owner_id = domain.owner_id
    return c, owner_id, did


def test_ask_domain_persists_messages(monkeypatch):
    _c, owner_id, did = _register()
    # seed ready doc + chunk
    with session_scope() as session:
        domain = session.get(Domain, did)
        assert domain is not None
        doc = DomainDocument(
            domain_id=did,
            filename="faq.txt",
            content_type="text/plain",
            storage_path=f"x/{did}/d/faq.txt",
            byte_size=12,
            ingest_status="ready",
        )
        session.add(doc)
        session.flush()
        # 1536-dim zero vector is fine for cosine ordering with a single row
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=0,
                text="Refunds take 5 business days.",
                embedding=[0.0] * 1536,
            )
        )
        session.flush()

    emb = EmbeddingResult(
        vectors=[[0.0] * 1536],
        model="openai/text-embedding-3-small",
        prompt_tokens=1,
        total_tokens=1,
        cost_usd=0.0,
        raw_provider="openai",
        latency_ms=1.0,
    )
    cmp = CompletionResult(
        text="Refunds take 5 business days [1].",
        model_requested="openai/gpt-4o-mini",
        model_used="openai/gpt-4o-mini",
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        cost_usd=0.001,
        raw_provider="openai",
        latency_ms=12.0,
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        lambda oid: {"openai"},
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.resolve_owner_api_key",
        lambda oid, model: "sk-test",
    )
    monkeypatch.setattr("tvashtr.control_plane.domain_ask.embed", lambda req: emb)
    monkeypatch.setattr("tvashtr.control_plane.domain_ask.complete", lambda req: cmp)

    # The chat's call (POST /ask passes persist=True; the default writes nothing).
    result = ask_domain(owner_id, did, "How long do refunds take?", persist=True)
    assert "5 business days" in result["answer"]
    assert result["citations"]
    assert result["citations"][0]["filename"] == "faq.txt"
    assert result["latency_ms"] is not None

    from tvashtr.control_plane.domain_ask import list_domain_messages

    msgs = list_domain_messages(owner_id, did)
    assert msgs is not None
    assert len(msgs) >= 2
    assert msgs[-2]["role"] == "user"
    assert msgs[-1]["role"] == "assistant"
    assert msgs[-1]["citations"]


def test_ask_domain_empty_corpus(monkeypatch):
    _c, owner_id, did = _register()
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        lambda oid: {"openai"},
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.resolve_domain_generation_model",
        lambda oid, cfg: "openai/gpt-4o-mini",
    )
    with pytest.raises(DomainAskError) as ei:
        ask_domain(owner_id, did, "Anything?")
    assert ei.value.code == "empty_corpus"


def _seed_ready_chunk(did: uuid.UUID) -> None:
    with session_scope() as session:
        doc = DomainDocument(
            domain_id=did,
            filename="faq.txt",
            content_type="text/plain",
            storage_path=f"x/{did}/d/faq.txt",
            byte_size=12,
            ingest_status="ready",
        )
        session.add(doc)
        session.flush()
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=0,
                text="Refunds take 5 business days.",
                embedding=[0.0] * 1536,
            )
        )
        session.flush()


def _patch_gateway(monkeypatch, *, latency_ms, cost_usd):
    emb = EmbeddingResult(
        vectors=[[0.0] * 1536],
        model="openai/text-embedding-3-small",
        prompt_tokens=1,
        total_tokens=1,
        cost_usd=0.0,
        raw_provider="openai",
        latency_ms=1.0,
    )
    cmp = CompletionResult(
        text="Answer [1].",
        model_requested="openai/gpt-4o-mini",
        model_used="openai/gpt-4o-mini",
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        cost_usd=cost_usd,
        raw_provider="openai",
        latency_ms=latency_ms,
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        lambda oid: {"openai"},
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.resolve_owner_api_key",
        lambda oid, model: "sk-test",
    )
    monkeypatch.setattr("tvashtr.control_plane.domain_ask.embed", lambda req: emb)
    monkeypatch.setattr("tvashtr.control_plane.domain_ask.complete", lambda req: cmp)


def test_ask_domain_sanitizes_nonfinite_latency_cost(monkeypatch):
    _c, owner_id, did = _register()
    _seed_ready_chunk(did)
    _patch_gateway(monkeypatch, latency_ms=float("nan"), cost_usd=float("inf"))
    result = ask_domain(owner_id, did, "How long?", persist=True)
    assert result["latency_ms"] is None
    assert result["cost_usd"] is None
    from tvashtr.control_plane.domain_ask import list_domain_messages

    msgs = list_domain_messages(owner_id, did)
    assert msgs is not None
    asst = [m for m in msgs if m["role"] == "assistant"][-1]
    assert asst["latency_ms"] is None
    assert asst["cost_usd"] is None


def test_ask_domain_bad_top_k_defaults_without_500(monkeypatch):
    _c, owner_id, did = _register()
    _seed_ready_chunk(did)
    with session_scope() as session:
        domain = session.get(Domain, did)
        assert domain is not None
        cfg = dict(domain.config or {})
        cfg["retrieval"] = {**(cfg.get("retrieval") or {}), "top_k": "oops"}
        domain.config = cfg
        session.flush()
    _patch_gateway(monkeypatch, latency_ms=10.0, cost_usd=0.001)
    result = ask_domain(owner_id, did, "How long?")
    assert "Answer" in result["answer"]
    assert result["latency_ms"] == 10


def test_ask_domain_passes_the_run_event_hook_to_the_gateway(monkeypatch):
    """M1 stall guard: a Query domain node's model call reports its retries and backup switch —
    ``ask_domain(on_event=...)`` reaches the gateway request."""
    _c, owner_id, did = _register()
    with session_scope() as session:
        doc = DomainDocument(
            domain_id=did,
            filename="faq.txt",
            content_type="text/plain",
            storage_path=f"x/{did}/d/faq.txt",
            byte_size=12,
            ingest_status="ready",
        )
        session.add(doc)
        session.flush()
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=0,
                text="Refunds take 5 business days.",
                embedding=[0.0] * 1536,
            )
        )
    emb = EmbeddingResult(
        vectors=[[0.0] * 1536],
        model="openai/text-embedding-3-small",
        prompt_tokens=1,
        total_tokens=1,
        cost_usd=0.0,
        raw_provider="openai",
        latency_ms=1.0,
    )
    cmp = CompletionResult(
        text="Refunds take 5 business days [1].",
        model_requested="openai/gpt-4o-mini",
        model_used="openai/gpt-4o-mini",
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        cost_usd=0.001,
        raw_provider="openai",
        latency_ms=12.0,
    )
    seen: list = []
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.held_provider_slugs", lambda oid: {"openai"}
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.resolve_owner_api_key", lambda oid, model: "sk-test"
    )
    monkeypatch.setattr("tvashtr.control_plane.domain_ask.embed", lambda req: emb)
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.complete", lambda req: seen.append(req) or cmp
    )

    def hook(kind, payload):
        return None

    ask_domain(owner_id, did, "How long do refunds take?", on_event=hook)
    assert seen[0].on_event is hook


def test_a_domain_round_gets_the_account_backup_for_its_seat(monkeypatch):
    """M1 (R2): ``backup_capability`` gives the call the account's backup model — on another
    provider the owner holds a key for — with that provider's key."""
    from tvashtr.control_plane import domain_ask as mod

    monkeypatch.setattr(mod, "held_provider_slugs", lambda oid: {"openai", "gemini"})
    monkeypatch.setattr(mod, "resolve_owner_api_key", lambda oid, model: f"key-for-{model}")
    monkeypatch.setattr(mod, "account_fallback_model", lambda held, cap: "gemini/gemini-2.5-flash")
    assert mod._account_backup(uuid.uuid4(), "thinker", "openai/gpt-4o-mini") == {
        "fallback_model": "gemini/gemini-2.5-flash",
        "fallback_api_key": "key-for-gemini/gemini-2.5-flash",
    }
    # Same provider as the primary: not a backup. No capability: none asked for.
    assert mod._account_backup(uuid.uuid4(), "thinker", "gemini/gemini-2.0") == {}
    assert mod._account_backup(uuid.uuid4(), None, "openai/gpt-4o-mini") == {}
