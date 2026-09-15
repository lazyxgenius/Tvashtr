"""Phase 6 — domain eval HTTP API (cases CRUD + sync run)."""

import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"eval-api-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "eval-api-password"},
        ).status_code
        == 200
    )
    return c


def _domain(c: TestClient) -> str:
    row = c.post("/api/domains", json={"template": "blank", "name": "Eval API"}).json()
    return row["domain_id"]


def test_eval_case_crud_owner_scoped():
    a = _fresh()
    b = _fresh()
    did = _domain(a)
    doc_id = str(uuid.uuid4())

    created = a.post(
        f"/api/domains/{did}/eval/cases",
        json={
            "question": "What is the refund window?",
            "expected_answer": "5 days",
            "expected_citation_doc_ids": [doc_id],
            "expected_keywords": ["refund"],
            "ordinal": 1,
        },
    )
    assert created.status_code in (200, 201), created.text
    body = created.json()
    assert body["question"].startswith("What is")
    assert body["ordinal"] == 1
    case_id = body["case_id"]

    listed = a.get(f"/api/domains/{did}/eval/cases")
    assert listed.status_code == 200
    assert len(listed.json()["cases"]) == 1
    assert listed.json()["cases"][0]["case_id"] == case_id

    assert b.get(f"/api/domains/{did}/eval/cases").status_code == 404
    assert (
        b.post(
            f"/api/domains/{did}/eval/cases",
            json={"question": "hack?"},
        ).status_code
        == 404
    )
    assert b.delete(f"/api/domains/{did}/eval/cases/{case_id}").status_code == 404

    deleted = a.delete(f"/api/domains/{did}/eval/cases/{case_id}")
    assert deleted.status_code == 204
    assert a.get(f"/api/domains/{did}/eval/cases").json()["cases"] == []


def test_post_eval_sync_returns_scores():
    c = _fresh()
    did = _domain(c)
    doc_a = str(uuid.uuid4())
    assert (
        c.post(
            f"/api/domains/{did}/eval/cases",
            json={
                "question": "refund window?",
                "expected_citation_doc_ids": [doc_a],
                "expected_keywords": ["refund"],
            },
        ).status_code
        in (200, 201)
    )
    fake = {
        "citations": [
            {
                "document_id": doc_a,
                "filename": "a.md",
                "chunk_id": "c",
                "ordinal": 0,
                "excerpt": "refund within 5 days",
            }
        ],
        "latency_ms": 7,
    }
    with patch(
        "tvashtr.control_plane.domain_eval.retrieve_domain", return_value=fake
    ):
        r = c.post(f"/api/domains/{did}/eval")
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["status"] == "completed"
    assert run["scores"]["hit_at_k"] == 1.0
    assert run["scores"]["keyword_hit"] == 1.0


def test_post_eval_empty_cases_422():
    c = _fresh()
    did = _domain(c)
    r = c.post(f"/api/domains/{did}/eval")
    assert r.status_code == 422
    assert "eval" in str(r.json()["detail"]).lower() or "case" in str(r.json()["detail"]).lower()


def test_get_latest_run_404_when_none():
    c = _fresh()
    did = _domain(c)
    r = c.get(f"/api/domains/{did}/eval/runs/latest")
    assert r.status_code == 404
    assert r.json()["detail"] == "no eval runs yet"


def test_get_latest_run_404_foreign_domain():
    a = _fresh()
    b = _fresh()
    did = _domain(a)
    assert b.get(f"/api/domains/{did}/eval/runs/latest").status_code == 404
    assert b.get(f"/api/domains/{did}/eval/runs/latest").json()["detail"] == "domain not found"


def test_eval_requires_auth():
    c = TestClient(app)
    c.cookies.clear()
    did = uuid.uuid4()
    assert c.get(f"/api/domains/{did}/eval/cases").status_code == 401
    assert c.post(f"/api/domains/{did}/eval").status_code == 401
