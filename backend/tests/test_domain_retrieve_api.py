"""Phase 4b — POST /api/domains/{id}/retrieve."""

import uuid
from unittest.mock import patch

from tvashtr.control_plane.domain_ask import DomainAskError


def test_retrieve_requires_auth(unauth_client):
    r = unauth_client.post(
        f"/api/domains/{uuid.uuid4()}/retrieve", json={"query": "hi"}
    )
    assert r.status_code in (401, 403)


def test_retrieve_foreign_domain_404(client):
    with patch("tvashtr.routers.get_domain", return_value=None):
        r = client.post(
            f"/api/domains/{uuid.uuid4()}/retrieve",
            json={"query": "hi"},
        )
    assert r.status_code == 404


def test_retrieve_ok_returns_citations(client):
    did = str(uuid.uuid4())
    fake = {
        "citations": [
            {
                "document_id": "d",
                "filename": "a.md",
                "chunk_id": "c",
                "ordinal": 0,
                "excerpt": "e",
            }
        ],
        "latency_ms": 5,
    }
    with patch("tvashtr.routers.get_domain", return_value={"id": did, "config": {}}):
        with patch("tvashtr.routers.retrieve_domain", return_value=fake) as m:
            r = client.post(f"/api/domains/{did}/retrieve", json={"query": "SLA?"})
    assert r.status_code == 200
    body = r.json()
    assert body["citations"][0]["filename"] == "a.md"
    assert body["domain_id"] == did
    assert body["latency_ms"] == 5
    m.assert_called_once()


def test_retrieve_byok_422(client):
    did = str(uuid.uuid4())
    err = DomainAskError(
        "missing_providers",
        {
            "message": "you have no API key for: openai — needed to embed the query.",
            "missing_providers": ["openai"],
        },
    )
    with patch("tvashtr.routers.get_domain", return_value={"id": did}):
        with patch("tvashtr.routers.retrieve_domain", side_effect=err):
            r = client.post(f"/api/domains/{did}/retrieve", json={"query": "q"})
    assert r.status_code == 422
    assert "openai" in str(r.json()["detail"]).lower() or "openai" in str(r.json())
