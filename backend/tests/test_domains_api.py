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


def test_unauthenticated_domains_401():
    c = TestClient(app)
    c.cookies.clear()
    assert c.get("/api/domains").status_code == 401
    assert (
        c.post("/api/domains", json={"template": "blank", "name": "X"}).status_code == 401
    )


def test_patch_rejects_secret_keys_in_config():
    c = _fresh()
    row = c.post("/api/domains", json={"template": "blank", "name": "Secrets"}).json()
    did = row["domain_id"]
    base = dict(row["config"])
    # Top-level secret key
    poison_top = {**base, "api_key": "sk-leak"}
    assert c.patch(f"/api/domains/{did}", json={"config": poison_top}).status_code == 422
    # Nested under embedding
    poison_embed = {
        **base,
        "embedding": {**base["embedding"], "api_key": "sk-nested"},
    }
    assert c.patch(f"/api/domains/{did}", json={"config": poison_embed}).status_code == 422
    # Nested under generation (case-insensitive)
    poison_gen = {
        **base,
        "generation": {**base["generation"], "API_KEY": "sk-case"},
    }
    assert c.patch(f"/api/domains/{did}", json={"config": poison_gen}).status_code == 422


def test_patch_rejects_invalid_v1_config_shape():
    c = _fresh()
    row = c.post("/api/domains", json={"template": "blank", "name": "Shape"}).json()
    did = row["domain_id"]
    # Missing required keys
    assert c.patch(f"/api/domains/{did}", json={"config": {}}).status_code == 422
    # Unknown top-level key
    bad = dict(row["config"])
    bad["rerank"] = {"model": "x"}
    assert c.patch(f"/api/domains/{did}", json={"config": bad}).status_code == 422
    # Missing one required section
    incomplete = {k: v for k, v in row["config"].items() if k != "generation"}
    assert c.patch(f"/api/domains/{did}", json={"config": incomplete}).status_code == 422


def test_patch_accepts_hybrid_mode_and_rerank():
    c = _fresh()
    row = c.post("/api/domains", json={"template": "blank", "name": "Hyb"}).json()
    cfg = dict(row["config"])
    cfg["retrieval"] = {
        "top_k": 6,
        "mode": "hybrid",
        "rerank": {"enabled": True, "model": None, "top_n": 16},
    }
    patched = c.patch(f"/api/domains/{row['domain_id']}", json={"config": cfg})
    assert patched.status_code == 200, patched.text
    ret = patched.json()["config"]["retrieval"]
    assert ret["mode"] == "hybrid"
    assert ret["rerank"]["enabled"] is True
    assert ret["rerank"]["top_n"] == 16


def test_patch_rejects_unknown_retrieval_mode():
    c = _fresh()
    row = c.post("/api/domains", json={"template": "blank", "name": "BadMode"}).json()
    cfg = dict(row["config"])
    cfg["retrieval"] = {"top_k": 8, "mode": "colbert"}
    assert c.patch(f"/api/domains/{row['domain_id']}", json={"config": cfg}).status_code == 422


def test_patch_accepts_graph_enabled():
    c = _fresh()
    row = c.post("/api/domains", json={"template": "blank", "name": "GraphOn"}).json()
    cfg = dict(row["config"])
    cfg["retrieval"] = {
        **cfg.get("retrieval", {}),
        "top_k": cfg.get("retrieval", {}).get("top_k", 8),
        "mode": cfg.get("retrieval", {}).get("mode", "dense"),
        "graph": {"enabled": True},
    }
    patched = c.patch(f"/api/domains/{row['domain_id']}", json={"config": cfg})
    assert patched.status_code == 200, patched.text
    assert patched.json()["config"]["retrieval"]["graph"]["enabled"] is True


def test_patch_rejects_invalid_graph():
    c = _fresh()
    row = c.post("/api/domains", json={"template": "blank", "name": "GraphBad"}).json()
    cfg = dict(row["config"])
    cfg["retrieval"] = {**cfg.get("retrieval", {}), "graph": True}
    assert c.patch(f"/api/domains/{row['domain_id']}", json={"config": cfg}).status_code == 422
    cfg["retrieval"] = {**cfg.get("retrieval", {}), "graph": {"enabled": True, "neo4j": "x"}}
    assert c.patch(f"/api/domains/{row['domain_id']}", json={"config": cfg}).status_code == 422
