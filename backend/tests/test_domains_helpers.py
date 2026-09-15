"""Phase 1 Domains — template defaults + CRUD helpers (no ingest)."""

import uuid

from conftest import auth_user_id

from tvashtr.control_plane import domains as domains_cp
from tvashtr.models import Domain


def test_domain_model_importable():
    assert Domain.__tablename__ == "domains"


def test_default_config_has_v1_keys():
    cfg = domains_cp.default_config_for_template("support")
    assert set(cfg) >= {"chunking", "embedding", "retrieval", "generation"}
    assert cfg["chunking"]["strategy"] == "fixed"
    assert cfg["retrieval"]["mode"] == "dense"


def test_list_domain_templates_order_and_keys():
    keys = [t["template"] for t in domains_cp.list_domain_templates()]
    assert keys == ["financial", "legal", "scientific", "support", "blank"]
    for t in domains_cp.list_domain_templates():
        assert t["name"] and t["description"]


def test_create_domain_seeds_template_config(client):
    summary = domains_cp.create_domain(auth_user_id(), "Support docs", "support")
    assert summary["name"] == "Support docs"
    assert summary["template"] == "support"
    assert summary["status"] == "empty"
    assert summary["doc_count"] == 0
    assert summary["config"]["chunking"]["size"] == 600
    assert summary["domain_id"]


def test_create_domain_unknown_template_raises(client):
    try:
        domains_cp.create_domain(auth_user_id(), "X", "nope")
        raise AssertionError("expected KeyError")
    except KeyError:
        pass


def test_create_domain_blank_name_raises(client):
    try:
        domains_cp.create_domain(auth_user_id(), "   ", "blank")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_list_get_update_delete_owner_scoped(client):
    other = uuid.uuid4()
    a = domains_cp.create_domain(auth_user_id(), "A", "blank")
    # other owner needs a real users row if FK is enforced — prefer creating via a second
    # registered user in API tests; for helpers, only assert auth_user_id isolation:
    listed = domains_cp.list_domains(auth_user_id())
    assert any(d["domain_id"] == a["domain_id"] for d in listed)
    assert domains_cp.get_domain(other, uuid.UUID(a["domain_id"])) is None
    updated = domains_cp.update_domain(
        auth_user_id(),
        uuid.UUID(a["domain_id"]),
        name="A2",
        config={
            "chunking": {"strategy": "fixed", "size": 100, "overlap": 10},
            "embedding": {"model": "text-embedding-3-small"},
            "retrieval": {"top_k": 3, "mode": "dense"},
            "generation": {"model": None},
        },
    )
    assert updated["name"] == "A2"
    assert updated["config"]["retrieval"]["top_k"] == 3
    assert domains_cp.delete_domain(auth_user_id(), uuid.UUID(a["domain_id"])) is True
    assert domains_cp.get_domain(auth_user_id(), uuid.UUID(a["domain_id"])) is None


from tvashtr.control_plane.domains import compute_domain_status


def test_compute_domain_status_rules():
    assert compute_domain_status([]) == "empty"
    assert compute_domain_status(["pending"]) == "indexing"
    assert compute_domain_status(["indexing", "ready"]) == "indexing"
    assert compute_domain_status(["ready", "error"]) == "error"
    assert compute_domain_status(["ready", "ready"]) == "ready"
    assert compute_domain_status(["error"]) == "error"


def test_default_config_includes_rerank_knobs():
    cfg = domains_cp.default_config_for_template("blank")
    assert cfg["retrieval"]["mode"] == "dense"
    assert cfg["retrieval"]["rerank"] == {
        "enabled": False,
        "model": None,
        "top_n": 20,
    }


def test_validate_rejects_unknown_retrieval_mode():
    cfg = domains_cp.default_config_for_template("blank")
    cfg["retrieval"]["mode"] = "colbert"
    try:
        domains_cp.validate_domain_config(cfg)
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "mode" in str(e).lower()


def test_validate_accepts_hybrid_and_rerank():
    cfg = domains_cp.default_config_for_template("legal")
    cfg["retrieval"]["mode"] = "hybrid"
    cfg["retrieval"]["rerank"] = {"enabled": True, "model": None, "top_n": 16}
    domains_cp.validate_domain_config(cfg)


def test_validate_rejects_bad_rerank():
    cfg = domains_cp.default_config_for_template("blank")
    cfg["retrieval"]["rerank"] = "yes"
    try:
        domains_cp.validate_domain_config(cfg)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
    cfg["retrieval"]["rerank"] = {"enabled": True, "top_n": 0}
    try:
        domains_cp.validate_domain_config(cfg)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
