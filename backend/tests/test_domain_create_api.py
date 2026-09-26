"""Revamp New domain dialog (DM-22…DM-29): POST /api/domains takes the reading model picked in the
dialog, enforces the name rule (trimmed, 1–120 characters, unique per account ignoring case → 409)
and answers with the full summary so the dialog can land on the new domain's page."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import ProviderCredential


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domain-create-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register", json={"email": email, "password": "domains-password"}
        ).status_code
        == 200
    )
    return c, uuid.UUID(c.get("/api/auth/me").json()["id"])


def _key(owner: uuid.UUID, provider: str) -> None:
    with session_scope() as s:
        s.add(
            ProviderCredential(
                owner_id=owner, provider=provider, secret_encrypted="x", key_last4="abcd"
            )
        )


def test_create_answers_with_the_summary_and_keeps_the_old_keys():
    c, owner = _fresh()
    _key(owner, "openai")
    resp = c.post("/api/domains", json={"name": "Support docs", "template": "support"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    for key in ("domain_id", "name", "template", "config", "status", "doc_count"):
        assert key in body
    assert body["name"] == "Support docs"
    assert body["state"] == "empty"
    assert body["files"]["total"] == 0
    assert body["config"]["chunking"]["size"] == 600
    # The default reading model is untouched (stored bare, as before).
    assert body["config"]["embedding"]["model"] == "text-embedding-3-small"
    assert body["reading_model"] == {
        "slug": "openai/text-embedding-3-small",
        "label": "OpenAI text-embedding-3-small",
        "provider": "openai",
        "dim": 1536,
        "key_saved": True,
    }
    assert body["setup"]["key"] is True


def test_create_stores_the_picked_reading_model():
    c, _ = _fresh()
    resp = c.post(
        "/api/domains",
        json={
            "name": "Free reads",
            "template": "blank",
            "embedding_model": "huggingface/BAAI/bge-small-en-v1.5",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["config"]["embedding"]["model"] == "huggingface/BAAI/bge-small-en-v1.5"
    assert body["reading_model"]["provider"] == "huggingface"
    assert body["reading_model"]["label"] == "Hugging Face BGE-small (free)"
    assert body["reading_model"]["key_saved"] is False
    # Persisted: the detail read agrees.
    again = c.get(f"/api/domains/{body['domain_id']}").json()
    assert again["config"]["embedding"]["model"] == "huggingface/BAAI/bge-small-en-v1.5"


def test_create_normalises_a_bare_reading_model_slug():
    c, _ = _fresh()
    resp = c.post(
        "/api/domains",
        json={
            "name": "Old model",
            "template": "legal",
            "embedding_model": "text-embedding-ada-002",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["config"]["embedding"]["model"] == "openai/text-embedding-ada-002"


def test_create_rejects_a_reading_model_outside_the_list():
    c, _ = _fresh()
    for model in ("nvidia_nim/nvidia/nv-embedqa-e5-v5", "openai/text-embedding-3-large"):
        resp = c.post(
            "/api/domains",
            json={"name": f"Bad {model}", "template": "blank", "embedding_model": model},
        )
        assert resp.status_code == 422, model
        assert resp.json() == {"detail": "Pick a reading model from the list."}
    assert c.get("/api/domains").json()["domains"] == []


def test_create_rejects_a_name_the_account_already_uses_ignoring_case():
    c, _ = _fresh()
    assert (
        c.post("/api/domains", json={"name": "Support docs", "template": "support"}).status_code
        == 200
    )
    resp = c.post("/api/domains", json={"name": "  support DOCS ", "template": "legal"})
    assert resp.status_code == 409
    assert resp.json() == {"detail": "You already have a domain named “support DOCS”."}
    assert len(c.get("/api/domains").json()["domains"]) == 1


def test_another_account_may_use_the_same_name():
    a, _ = _fresh()
    b, _ = _fresh()
    assert a.post("/api/domains", json={"name": "Support docs", "template": "support"}).is_success
    resp = b.post("/api/domains", json={"name": "Support docs", "template": "support"})
    assert resp.status_code == 200, resp.text


def test_create_trims_the_name_and_limits_it_to_120_characters():
    c, _ = _fresh()
    resp = c.post("/api/domains", json={"name": "  Vendor contracts  ", "template": "legal"})
    assert resp.json()["name"] == "Vendor contracts"

    blank = c.post("/api/domains", json={"name": "   ", "template": "blank"})
    assert blank.status_code == 422
    assert blank.json() == {"detail": "Give this domain a name."}

    long = c.post("/api/domains", json={"name": "x" * 121, "template": "blank"})
    assert long.status_code == 422
    assert long.json() == {"detail": "Use 120 characters or fewer."}

    exact = c.post("/api/domains", json={"name": "y" * 120, "template": "blank"})
    assert exact.status_code == 200, exact.text


def test_unknown_template_is_still_400_before_the_name_clash():
    c, _ = _fresh()
    assert c.post("/api/domains", json={"name": "Twice", "template": "blank"}).is_success
    resp = c.post("/api/domains", json={"name": "Twice", "template": "nope"})
    assert resp.status_code == 400
    assert resp.json() == {"detail": "unknown template"}
