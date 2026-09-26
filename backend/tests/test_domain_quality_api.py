"""Revamp Domains — the Quality tab's API (DM-70…DM-79, OQ-26).

Test questions name their expected files (and say when one was deleted), can be edited, and are
checked under the Quality copy; test runs are asynchronous (``POST …/eval/runs`` starts the
``run_domain_eval_workflow``; the workflow is run synchronously here with a faked search).
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tvashtr.control_plane import domain_eval
from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import DomainDocument, DomainEvalRun


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domain-quality-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register", json={"email": email, "password": "domains-password"}
        ).status_code
        == 200
    )
    return c, uuid.UUID(c.get("/api/auth/me").json()["id"])


def _domain(c: TestClient) -> str:
    r = c.post("/api/domains", json={"template": "support", "name": "Support docs"})
    assert r.status_code == 200, r.text
    return r.json()["domain_id"]


def _doc(domain_id: str, filename: str) -> str:
    with session_scope() as s:
        doc = DomainDocument(
            domain_id=uuid.UUID(domain_id),
            filename=filename,
            content_type="text/markdown",
            storage_path=f"x/{uuid.uuid4().hex}",
            byte_size=100,
            ingest_status="ready",
        )
        s.add(doc)
        s.flush()
        return str(doc.id)


def _case(c: TestClient, did: str, **body) -> dict:
    r = c.post(f"/api/domains/{did}/eval/cases", json={"question": "Q?", **body})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def started(monkeypatch):
    """Record ``DBOS.start_workflow`` calls instead of starting workflows."""
    calls: list[tuple] = []
    monkeypatch.setattr(
        domain_eval.DBOS, "start_workflow", lambda fn, *args: calls.append((fn, *args))
    )
    return calls


def _search(monkeypatch, found: dict[str, list[tuple[str, str, str]]]):
    """Fake search: question → [(document_id, filename, excerpt)]; unknown questions fail."""

    def _retrieve(owner_id, domain_id, question):
        if question not in found:
            raise DomainAskError("missing_providers", {"message": "no openai key"})
        return {
            "citations": [
                {"document_id": d, "filename": f, "chunk_id": "c", "ordinal": 0, "excerpt": e}
                for d, f, e in found[question]
            ],
            "latency_ms": 5,
        }

    monkeypatch.setattr(domain_eval, "retrieve_domain", _retrieve)


def test_cases_name_their_files_and_flag_deleted_ones():
    c, _ = _fresh()
    did = _domain(c)
    doc = _doc(did, "webhooks.md")
    gone = str(uuid.uuid4())
    created = _case(c, did, expected_citation_doc_ids=[doc, gone], expected_keywords=["secret"])
    files = [
        {"document_id": doc, "filename": "webhooks.md", "exists": True},
        {"document_id": gone, "filename": None, "exists": False},
    ]
    assert created["expected_files"] == files
    assert c.get(f"/api/domains/{did}/eval/cases").json()["cases"][0]["expected_files"] == files


def test_case_rules_use_the_quality_copy(monkeypatch):
    c, _ = _fresh()
    did = _domain(c)
    url = f"/api/domains/{did}/eval/cases"
    r = c.post(url, json={"question": "  ", "expected_keywords": ["a"]})
    assert (r.status_code, r.json()["detail"]) == (422, "Write the question first.")
    r = c.post(url, json={"question": "Why?"})
    assert (r.status_code, r.json()["detail"]) == (
        422,
        "Add a file or a key word, so there’s something to check.",
    )
    monkeypatch.setattr(domain_eval, "MAX_EVAL_CASES", 1)
    _case(c, did, expected_keywords=["a"])
    r = c.post(url, json={"question": "One more?", "expected_keywords": ["b"]})
    assert (r.status_code, r.json()["detail"]) == (422, "You can have up to 50 test questions.")


def test_edit_a_case_changes_only_what_is_sent():
    c, _ = _fresh()
    did = _domain(c)
    doc = _doc(did, "sso-setup.md")
    case = _case(c, did, expected_keywords=["SAML"])
    url = f"/api/domains/{did}/eval/cases/{case['case_id']}"

    r = c.patch(
        url, json={"question": " How do I turn on SSO? ", "expected_citation_doc_ids": [doc]}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["question"] == "How do I turn on SSO?"
    assert body["expected_keywords"] == ["SAML"]
    assert body["expected_files"] == [
        {"document_id": doc, "filename": "sso-setup.md", "exists": True}
    ]

    r = c.patch(url, json={"expected_citation_doc_ids": [], "expected_keywords": []})
    assert (r.status_code, r.json()["detail"]) == (
        422,
        "Add a file or a key word, so there’s something to check.",
    )
    r = c.patch(url, json={"question": ""})
    assert (r.status_code, r.json()["detail"]) == (422, "Write the question first.")
    missing = f"/api/domains/{did}/eval/cases/{uuid.uuid4()}"
    assert c.patch(missing, json={"question": "x"}).json()["detail"] == "case not found"


def test_quality_endpoints_are_owner_scoped(started):
    a, _ = _fresh()
    b, _ = _fresh()
    did = _domain(a)
    case = _case(a, did, expected_keywords=["x"])
    run = a.post(f"/api/domains/{did}/eval/runs").json()
    for r in (
        b.patch(f"/api/domains/{did}/eval/cases/{case['case_id']}", json={"question": "x"}),
        b.post(f"/api/domains/{did}/eval/runs"),
        b.get(f"/api/domains/{did}/eval/runs"),
        b.get(f"/api/domains/{did}/eval/runs/{run['run_id']}"),
    ):
        assert (r.status_code, r.json()["detail"]) == (404, "domain not found")
    assert len(started) == 1


def test_a_run_starts_once_and_needs_a_question(started):
    c, _ = _fresh()
    did = _domain(c)
    r = c.post(f"/api/domains/{did}/eval/runs")
    assert (r.status_code, r.json()["detail"]) == (422, "Add a test question first.")

    _case(c, did, expected_keywords=["a"])
    _case(c, did, expected_keywords=["b"])
    r = c.post(f"/api/domains/{did}/eval/runs")
    assert r.status_code == 202, r.text
    run = r.json()
    assert run["status"] == "running"
    assert run["number"] == 1
    assert run["progress"] == {"done": 0, "total": 2}
    assert run["top_k"] == 8 and run["retrieval_mode"] == "dense"
    assert set(run["config"]) >= {"chunking", "retrieval"}
    assert [len(call[4]) for call in started] == [2]

    again = c.post(f"/api/domains/{did}/eval/runs").json()
    assert again["run_id"] == run["run_id"]
    assert len(started) == 1


def test_a_stale_running_run_does_not_block_a_new_one(started):
    c, _ = _fresh()
    did = _domain(c)
    _case(c, did, expected_keywords=["a"])
    with session_scope() as s:
        s.add(
            DomainEvalRun(
                domain_id=uuid.UUID(did),
                status="running",
                created_at=datetime.now(UTC) - timedelta(hours=1),
            )
        )
    run = c.post(f"/api/domains/{did}/eval/runs").json()
    assert run["number"] == 2
    assert len(started) == 1


def test_the_run_workflow_scores_each_case_with_its_top_passages(client, started, monkeypatch):
    c, _ = _fresh()
    did = _domain(c)
    hooks = _doc(did, "webhooks.md")
    limits = _doc(did, "api-limits.html")
    found = _case(c, did, expected_citation_doc_ids=[limits], expected_keywords=["600"])
    missed = _case(
        c, did, question="Webhooks?", expected_citation_doc_ids=[hooks], expected_keywords=["x"]
    )
    passages = [
        (limits, "api-limits.html", "…up to 600 requests per minute…"),
        (str(uuid.uuid4()), "integrations.html", "…signed payloads…"),
        (str(uuid.uuid4()), "troubleshooting.pdf", "…we retry 5 times…"),
        (str(uuid.uuid4()), "release-notes.html", "…September…"),
    ]
    _search(monkeypatch, {"Q?": passages[:1], "Webhooks?": passages[1:]})

    run = c.post(f"/api/domains/{did}/eval/runs").json()
    fn, *args = started[0]
    assert fn(*args)["status"] == "completed"

    detail = c.get(f"/api/domains/{did}/eval/runs/{run['run_id']}").json()
    assert detail["status"] == "completed"
    assert detail["progress"] == {"done": 2, "total": 2}
    assert (detail["hit_at_k"], detail["keyword_hit"]) == (0.5, 0.5)
    per = {p["case_id"]: p for p in detail["scores"]["per_case"]}
    assert (per[found["case_id"]]["hit"], per[found["case_id"]]["keyword_hit"]) == (True, True)
    assert per[missed["case_id"]]["hit"] is False
    assert [(t["number"], t["filename"]) for t in per[missed["case_id"]]["top"]] == [
        (1, "integrations.html"),
        (2, "troubleshooting.pdf"),
        (3, "release-notes.html"),
    ]
    assert detail["config"] == run["config"]

    listed = c.get(f"/api/domains/{did}/eval/runs").json()["runs"]
    assert [(r["run_id"], r["number"], r["hit_at_k"]) for r in listed] == [(run["run_id"], 1, 0.5)]
    assert "scores" not in listed[0]
    # The old sync endpoints still work (the run route only takes uuids).
    assert c.get(f"/api/domains/{did}/eval/runs/latest").json()["run_id"] == run["run_id"]
    # The domain's quality summary reads the finished run.
    assert c.get(f"/api/domains/{did}").json()["quality"]["hit_at_k"] == 0.5


def test_a_run_where_every_case_fails_is_failed_with_the_reason(client, started, monkeypatch):
    c, _ = _fresh()
    did = _domain(c)
    _case(c, did, expected_keywords=["a"])
    _search(monkeypatch, {})
    run = c.post(f"/api/domains/{did}/eval/runs").json()
    fn, *args = started[0]
    assert fn(*args)["status"] == "failed"
    detail = c.get(f"/api/domains/{did}/eval/runs/{run['run_id']}").json()
    assert (detail["status"], detail["error_message"]) == ("failed", "no openai key")


def test_newest_runs_first_numbered_within_the_domain(started):
    c, _ = _fresh()
    did = _domain(c)
    _case(c, did, expected_keywords=["a"])
    now = datetime.now(UTC)
    with session_scope() as s:
        for i in range(3):
            s.add(
                DomainEvalRun(
                    domain_id=uuid.UUID(did),
                    status="completed",
                    scores={"hit_at_k": i / 2, "per_case": [], "cases_total": 1},
                    created_at=now - timedelta(days=3 - i),
                    completed_at=now - timedelta(days=3 - i),
                )
            )
    runs = c.get(f"/api/domains/{did}/eval/runs?limit=2").json()["runs"]
    assert [(r["number"], r["hit_at_k"]) for r in runs] == [(3, 1.0), (2, 0.5)]
