"""Phase 6 — eval case CRUD + run_domain_eval (mocked retrieve)."""

import uuid
from unittest.mock import patch

import pytest
from conftest import auth_user_id

from tvashtr.control_plane import domain_eval as ev
from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.control_plane.domains import create_domain
from tvashtr.db import session_scope
from tvashtr.models import User


def _seed_other_owner() -> uuid.UUID:
    oid = uuid.uuid4()
    with session_scope() as s:
        s.add(User(id=oid, email=f"{oid.hex}@t.local", password_hash="x"))
    return oid


def test_create_list_delete_eval_case_roundtrip(client):
    owner_id = auth_user_id()
    dom = create_domain(owner_id, "Eval Dom", "blank")
    did = uuid.UUID(dom["domain_id"])
    created = ev.create_eval_case(
        owner_id,
        did,
        question="What is the refund window?",
        expected_answer="5 days",
        expected_citation_doc_ids=[str(uuid.uuid4())],
        expected_keywords=["refund"],
        ordinal=1,
    )
    assert created["question"].startswith("What is")
    assert created["ordinal"] == 1
    rows = ev.list_eval_cases(owner_id, did)
    assert rows is not None and len(rows) == 1
    assert ev.delete_eval_case(owner_id, did, uuid.UUID(created["case_id"])) is True
    assert ev.list_eval_cases(owner_id, did) == []


def test_create_eval_case_rejects_empty_question(client):
    owner_id = auth_user_id()
    did = uuid.UUID(create_domain(owner_id, "E", "blank")["domain_id"])
    with pytest.raises(ValueError, match="question"):
        ev.create_eval_case(owner_id, did, question="   ")


def test_create_eval_case_enforces_max_cap(client, monkeypatch):
    owner_id = auth_user_id()
    did = uuid.UUID(create_domain(owner_id, "E", "blank")["domain_id"])
    monkeypatch.setattr(ev, "MAX_EVAL_CASES", 1)
    ev.create_eval_case(owner_id, did, question="q1")
    with pytest.raises(ValueError, match="50|max|limit|cap"):
        ev.create_eval_case(owner_id, did, question="q2")


def test_list_eval_cases_none_for_foreign_domain(client):
    owner_id = auth_user_id()
    other_owner_id = _seed_other_owner()
    did = uuid.UUID(create_domain(other_owner_id, "X", "blank")["domain_id"])
    assert ev.list_eval_cases(owner_id, did) is None


def test_run_domain_eval_scores_with_mocked_retrieve(client):
    owner_id = auth_user_id()
    did = uuid.UUID(create_domain(owner_id, "Eval Run", "blank")["domain_id"])
    doc_a = str(uuid.uuid4())
    ev.create_eval_case(
        owner_id,
        did,
        question="refund window?",
        expected_citation_doc_ids=[doc_a],
        expected_keywords=["refund"],
    )
    fake = {
        "citations": [
            {
                "document_id": doc_a,
                "filename": "faq.txt",
                "chunk_id": str(uuid.uuid4()),
                "ordinal": 0,
                "excerpt": "Refund policy: 5 days",
                "score": 0.9,
            }
        ],
        "latency_ms": 11,
    }
    with patch.object(ev, "retrieve_domain", return_value=fake) as m:
        run = ev.run_domain_eval(owner_id, did)
    assert m.called
    assert run["status"] == "completed"
    scores = run["scores"]
    assert scores["hit_at_k"] == 1.0
    assert scores["keyword_hit"] == 1.0
    assert scores["cases_total"] == 1
    assert scores["per_case"][0]["hit"] is True


def test_run_domain_eval_rejects_empty_cases(client):
    owner_id = auth_user_id()
    did = uuid.UUID(create_domain(owner_id, "Empty", "blank")["domain_id"])
    with pytest.raises(ValueError, match="no eval cases|empty"):
        ev.run_domain_eval(owner_id, did)


def test_run_domain_eval_records_retrieve_error_per_case(client):
    owner_id = auth_user_id()
    did = uuid.UUID(create_domain(owner_id, "Err", "blank")["domain_id"])
    ev.create_eval_case(
        owner_id, did, question="q?", expected_citation_doc_ids=[str(uuid.uuid4())]
    )
    with patch.object(
        ev,
        "retrieve_domain",
        side_effect=DomainAskError("empty_corpus", "ingest documents before asking"),
    ):
        run = ev.run_domain_eval(owner_id, did)
    assert run["status"] == "completed"
    assert run["scores"]["per_case"][0]["error"]
    assert run["scores"]["hit_at_k"] is None
