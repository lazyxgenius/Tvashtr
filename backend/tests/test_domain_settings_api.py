"""Revamp Domains Settings tab (DM-81…DM-85): PATCH takes a starting point, checks the numbers with
the tab's own copy, and "Look wider, then keep the best" really re-scores its wider pool."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.control_plane.domain_retrieve import apply_rerank
from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domain-settings-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register", json={"email": email, "password": "domains-password"}
        ).status_code
        == 200
    )
    return c


def _domain(c: TestClient) -> tuple[str, dict]:
    resp = c.post("/api/domains", json={"name": "Support docs", "template": "support"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["domain_id"], body["config"]


def _with(cfg: dict, section: str, **values) -> dict:
    return {**cfg, section: {**cfg[section], **values}}


def test_patch_sets_the_starting_point():
    c = _fresh()
    did, cfg = _domain(c)
    resp = c.patch(
        f"/api/domains/{did}",
        json={"template": "legal", "config": _with(cfg, "chunking", size=500, overlap=80)},
    )
    assert resp.status_code == 200, resp.text
    body = c.get(f"/api/domains/{did}").json()
    assert body["template"] == "legal"
    assert body["config"]["chunking"]["size"] == 500


def test_patch_rejects_an_unknown_starting_point():
    c = _fresh()
    did, _cfg = _domain(c)
    resp = c.patch(f"/api/domains/{did}", json={"template": "poetry"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "unknown template"
    assert c.get(f"/api/domains/{did}").json()["template"] == "support"


def test_patch_checks_piece_size_with_the_tab_copy():
    c = _fresh()
    did, cfg = _domain(c)
    for size in (99, 4001, "600", 600.5, True):
        resp = c.patch(f"/api/domains/{did}", json={"config": _with(cfg, "chunking", size=size)})
        assert resp.status_code == 422, size
        assert resp.json()["detail"] == "Use a number from 100 to 4,000."
    ok = c.patch(f"/api/domains/{did}", json={"config": _with(cfg, "chunking", size=4000)})
    assert ok.status_code == 200


def test_patch_checks_overlap_against_the_piece_size():
    c = _fresh()
    did, cfg = _domain(c)
    resp = c.patch(
        f"/api/domains/{did}", json={"config": _with(cfg, "chunking", size=600, overlap=600)}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Overlap must be smaller than the piece size."
    resp = c.patch(
        f"/api/domains/{did}", json={"config": _with(cfg, "chunking", size=1200, overlap=-1)}
    )
    assert resp.json()["detail"] == "Use a number from 0 to 1,199."
    ok = c.patch(f"/api/domains/{did}", json={"config": _with(cfg, "chunking", overlap=0)})
    assert ok.status_code == 200


def test_patch_checks_passages_per_question():
    c = _fresh()
    did, cfg = _domain(c)
    for top_k in (0, 31, "8"):
        resp = c.patch(f"/api/domains/{did}", json={"config": _with(cfg, "retrieval", top_k=top_k)})
        assert resp.status_code == 422, top_k
        assert resp.json()["detail"] == "Use a number from 1 to 30."
    ok = c.patch(f"/api/domains/{did}", json={"config": _with(cfg, "retrieval", top_k=30)})
    assert ok.status_code == 200


def test_look_wider_must_look_at_least_as_far_as_it_keeps():
    c = _fresh()
    did, cfg = _domain(c)
    wide = _with(cfg, "retrieval", top_k=25, rerank={"enabled": True, "model": None, "top_n": 20})
    resp = c.patch(f"/api/domains/{did}", json={"config": wide})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Look wider needs at least as many passages as it keeps."
    # Off, the pool size is only kept for later.
    off = _with(cfg, "retrieval", top_k=25, rerank={"enabled": False, "model": None, "top_n": 20})
    assert c.patch(f"/api/domains/{did}", json={"config": off}).status_code == 200


def test_settings_are_owner_scoped():
    a = _fresh()
    did, cfg = _domain(a)
    b = _fresh()
    assert b.patch(f"/api/domains/{did}", json={"template": "legal"}).status_code == 404
    assert b.patch(f"/api/domains/{did}", json={"config": cfg}).status_code == 404


def _piece(cid: str, text: str) -> dict:
    return {"chunk_id": cid, "text": text, "score": 0.5}


def test_look_wider_moves_exact_word_matches_up():
    pool = [
        _piece("a", "Our plans are billed monthly."),
        _piece("b", "Invoices are emailed to the account owner."),
        _piece("c", "Refunds are allowed within 30 days of a refund request."),
        _piece("d", "Contact support for anything else."),
    ]
    out = apply_rerank(pool, "How many days for a refund?", {"enabled": True, "top_n": 20})
    assert [p["chunk_id"] for p in out][0] == "c"
    assert sorted(p["chunk_id"] for p in out) == ["a", "b", "c", "d"]


def test_look_wider_keeps_the_order_when_no_words_match_or_off():
    pool = [_piece("a", "alpha"), _piece("b", "beta")]
    on = {"enabled": True, "top_n": 20}
    assert [p["chunk_id"] for p in apply_rerank(pool, "gamma", on)] == ["a", "b"]
    assert [p["chunk_id"] for p in apply_rerank(pool, "the of", on)] == ["a", "b"]
    off = {"enabled": False, "top_n": 20}
    assert apply_rerank(pool[::-1], "alpha", off) == pool[::-1]
