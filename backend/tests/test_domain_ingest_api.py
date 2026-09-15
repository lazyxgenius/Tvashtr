"""Phase 2 — ingest enqueue + BYOK 422."""

import uuid
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"ingest-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "ingest-password"},
        ).status_code
        == 200
    )
    return c


def test_ingest_without_openai_key_422(monkeypatch):
    c = _fresh()
    did = c.post("/api/domains", json={"template": "support", "name": "I"}).json()["domain_id"]
    c.post(
        f"/api/domains/{did}/documents",
        files={"file": ("a.txt", b"hello", "text/plain")},
    )
    monkeypatch.setattr("tvashtr.routers.held_provider_slugs", lambda owner_id: set())
    resp = c.post(f"/api/domains/{did}/ingest")
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    blob = detail if isinstance(detail, str) else str(detail)
    assert "openai" in blob.lower() or "API key" in blob or "embed" in blob.lower()


def test_ingest_starts_workflow(monkeypatch):
    c = _fresh()
    did = c.post("/api/domains", json={"template": "blank", "name": "I2"}).json()["domain_id"]
    c.post(
        f"/api/domains/{did}/documents",
        files={"file": ("a.txt", b"hello", "text/plain")},
    )
    monkeypatch.setattr(
        "tvashtr.routers.held_provider_slugs",
        lambda owner_id: {"openai"},
    )
    handle = MagicMock()
    handle.workflow_id = "wf-domain-ingest-1"
    monkeypatch.setattr("tvashtr.routers.DBOS.start_workflow", lambda *a, **k: handle)
    resp = c.post(f"/api/domains/{did}/ingest")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["workflow_id"] == "wf-domain-ingest-1"
    assert body["domain_id"] == did
    assert body["status"] == "indexing"


def test_ingest_foreign_domain_404(monkeypatch):
    a = _fresh()
    b = _fresh()
    did = a.post("/api/domains", json={"template": "blank", "name": "Secret"}).json()["domain_id"]
    monkeypatch.setattr(
        "tvashtr.routers.held_provider_slugs",
        lambda owner_id: {"openai"},
    )
    assert b.post(f"/api/domains/{did}/ingest").status_code == 404
