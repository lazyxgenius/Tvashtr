"""Phase 3 — ask + messages API."""

import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"askapi-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "ask-password"},
        ).status_code
        == 200
    )
    return c


def test_ask_foreign_domain_404(monkeypatch):
    a = _fresh()
    b = _fresh()
    did = a.post("/api/domains", json={"template": "blank", "name": "Secret"}).json()[
        "domain_id"
    ]
    monkeypatch.setattr(
        "tvashtr.routers.ask_domain",
        lambda *a, **k: (_ for _ in ()).throw(DomainAskError("not_found", "domain not found")),
    )
    # even without mock, ownership 404: prefer real path
    assert b.post(f"/api/domains/{did}/ask", json={"question": "hi"}).status_code == 404


def test_messages_foreign_domain_404():
    a = _fresh()
    b = _fresh()
    did = a.post("/api/domains", json={"template": "blank", "name": "Secret"}).json()[
        "domain_id"
    ]
    assert b.get(f"/api/domains/{did}/messages").status_code == 404


def test_ask_empty_corpus_422(monkeypatch):
    c = _fresh()
    did = c.post("/api/domains", json={"template": "support", "name": "Empty"}).json()[
        "domain_id"
    ]
    monkeypatch.setattr(
        "tvashtr.routers.held_provider_slugs",
        lambda owner_id: {"openai"},
    )
    resp = c.post(f"/api/domains/{did}/ask", json={"question": "What?"})
    assert resp.status_code == 422, resp.text
    blob = str(resp.json().get("detail", ""))
    assert "ingest" in blob.lower()


def test_ask_missing_keys_422(monkeypatch):
    c = _fresh()
    did = c.post("/api/domains", json={"template": "support", "name": "Keys"}).json()[
        "domain_id"
    ]

    def _boom(*a, **k):
        raise DomainAskError(
            "missing_providers",
            {
                "message": "you have no API key for: openai — needed to embed...",
                "missing_providers": ["openai"],
            },
        )

    monkeypatch.setattr("tvashtr.routers.ask_domain", _boom)
    resp = c.post(f"/api/domains/{did}/ask", json={"question": "What?"})
    assert resp.status_code == 422, resp.text


def test_ask_happy_path(monkeypatch):
    c = _fresh()
    did = c.post("/api/domains", json={"template": "support", "name": "Ok"}).json()[
        "domain_id"
    ]

    def _ok(owner_id, domain_id, question):
        return {
            "answer": "Hello cited",
            "citations": [
                {
                    "document_id": str(uuid.uuid4()),
                    "filename": "a.txt",
                    "chunk_id": str(uuid.uuid4()),
                    "ordinal": 0,
                    "excerpt": "Hello",
                    "score": 0.9,
                }
            ],
            "message_id": str(uuid.uuid4()),
            "user_message_id": str(uuid.uuid4()),
            "latency_ms": 42,
            "cost_usd": 0.001,
            "model": "openai/gpt-4o-mini",
        }

    monkeypatch.setattr("tvashtr.routers.ask_domain", _ok)
    resp = c.post(f"/api/domains/{did}/ask", json={"question": "Hi?"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["answer"] == "Hello cited"
    assert body["citations"][0]["filename"] == "a.txt"
    assert body["latency_ms"] == 42


def test_list_messages_empty():
    c = _fresh()
    did = c.post("/api/domains", json={"template": "blank", "name": "M"}).json()[
        "domain_id"
    ]
    resp = c.get(f"/api/domains/{did}/messages")
    assert resp.status_code == 200, resp.text
    assert resp.json()["messages"] == []
