"""Phase 1 Domains HTTP CRUD — owner-scoped like /api/teams."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domains-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "domains-password"},
        ).status_code
        == 200
    )
    return c


def test_templates_endpoint():
    c = _fresh()
    body = c.get("/api/domain-templates").json()
    assert [t["template"] for t in body["templates"]] == [
        "financial",
        "legal",
        "scientific",
        "support",
        "blank",
    ]


def test_list_empty_then_create_and_get():
    c = _fresh()
    assert c.get("/api/domains").json() == {"domains": []}
    resp = c.post("/api/domains", json={"template": "support", "name": "Support docs"})
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["name"] == "Support docs"
    assert row["template"] == "support"
    assert row["status"] == "empty"
    assert row["doc_count"] == 0
    assert row["config"]["embedding"]["model"] == "text-embedding-3-small"
    listed = c.get("/api/domains").json()["domains"]
    assert len(listed) == 1
    got = c.get(f"/api/domains/{row['domain_id']}").json()
    assert got["domain_id"] == row["domain_id"]


def test_create_unknown_template_400():
    c = _fresh()
    assert c.post("/api/domains", json={"template": "nope", "name": "X"}).status_code == 400


def test_create_blank_name_422():
    c = _fresh()
    assert c.post("/api/domains", json={"template": "blank", "name": "  "}).status_code == 422


def test_patch_config_and_delete():
    c = _fresh()
    row = c.post("/api/domains", json={"template": "blank", "name": "Tmp"}).json()
    cfg = dict(row["config"])
    cfg["retrieval"] = {"top_k": 4, "mode": "dense"}
    patched = c.patch(f"/api/domains/{row['domain_id']}", json={"name": "Tmp2", "config": cfg})
    assert patched.status_code == 200
    assert patched.json()["name"] == "Tmp2"
    assert patched.json()["config"]["retrieval"]["top_k"] == 4
    assert c.delete(f"/api/domains/{row['domain_id']}").json() == {
        "domain_id": row["domain_id"],
        "deleted": True,
    }
    assert c.get(f"/api/domains/{row['domain_id']}").status_code == 404


def test_foreign_domain_404():
    a = _fresh()
    b = _fresh()
    row = a.post("/api/domains", json={"template": "legal", "name": "Secret"}).json()
    assert b.get(f"/api/domains/{row['domain_id']}").status_code == 404
    assert b.patch(f"/api/domains/{row['domain_id']}", json={"name": "Hack"}).status_code == 404
    assert b.delete(f"/api/domains/{row['domain_id']}").status_code == 404


def test_invalid_id_400():
    c = _fresh()
    assert c.get("/api/domains/not-a-uuid").status_code == 400
