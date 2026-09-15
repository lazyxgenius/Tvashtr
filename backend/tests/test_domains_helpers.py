"""Phase 1 Domains — template defaults + CRUD helpers (no ingest)."""

import uuid

from tvashtr.control_plane import domains as domains_cp
from tvashtr.models import Domain


def test_domain_model_importable():
    assert Domain.__tablename__ == "domains"


def test_default_config_has_v1_keys():
    cfg = domains_cp.default_config_for_template("support")
    assert set(cfg) >= {"chunking", "embedding", "retrieval", "generation"}
    assert cfg["chunking"]["strategy"] == "fixed"
    assert cfg["retrieval"]["mode"] == "dense"
