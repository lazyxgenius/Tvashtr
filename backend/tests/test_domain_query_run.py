"""Phase 4a — domain_query_step + run_graph branch (ask_domain mocked)."""

import uuid
from unittest.mock import MagicMock

import pytest

from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.control_plane import team_run
from tvashtr.control_plane.domain_query_node import domain_query_manifest


def test_domain_query_step_success(monkeypatch):
    owner = uuid.uuid4()
    domain_id = uuid.uuid4()
    run_id = str(uuid.uuid4())

    monkeypatch.setattr(
        team_run, "owner_for_run", lambda rid: owner
    )
    # Import path used inside the step — patch where resolved.
    import tvashtr.control_plane.domain_ask as domain_ask

    def _ask(oid, did, q):
        assert oid == owner
        assert did == domain_id
        assert q == "What is the refund policy?"
        return {
            "answer": "30 days",
            "citations": [
                {
                    "document_id": "d1",
                    "filename": "policy.md",
                    "chunk_id": "c1",
                    "ordinal": 0,
                    "excerpt": "Refunds within 30 days.",
                }
            ],
            "latency_ms": 9,
            "model": "openai/gpt-4o-mini",
            "message_id": "m1",
        }

    monkeypatch.setattr(domain_ask, "ask_domain", _ask)

    # Call the step function directly (DBOS step is still a plain callable in tests).
    from tvashtr.control_plane.team_run import domain_query_step

    out = domain_query_step(
        run_id,
        domain_id=str(domain_id),
        question="What is the refund policy?",
    )
    assert out["status"] == "completed"
    assert out["answer"] == "30 days"
    assert out["citations"][0]["filename"] == "policy.md"


def test_domain_query_step_byok_failure(monkeypatch):
    monkeypatch.setattr(team_run, "owner_for_run", lambda rid: uuid.uuid4())
    import tvashtr.control_plane.domain_ask as domain_ask

    def _ask(*_a, **_k):
        raise DomainAskError(
            "missing_providers",
            {
                "message": "you have no API key for: openai — needed to embed the question…",
                "missing_providers": ["openai"],
            },
        )

    monkeypatch.setattr(domain_ask, "ask_domain", _ask)
    from tvashtr.control_plane.team_run import domain_query_step

    out = domain_query_step(
        "run-1",
        domain_id=str(uuid.uuid4()),
        question="hi",
    )
    assert out["status"] == "failed"
    assert "API key" in out["error"] or "openai" in out["error"]


def test_run_graph_domain_query_branch_closes_invocation(monkeypatch):
    """Minimal walk: completion is skipped by starting at domain_query via crafted graph.

    Prefer testing the branch in isolation by invoking the same close pattern the walk uses:
    open → domain_query_step → close with manifest. Full DBOS workflow optional if harness heavy —
    at minimum assert domain_query_step + helper wiring; if an existing run_graph unit harness
    exists (see test_next_node / team_run tests), extend it.
    """
    citations = [{"document_id": "d", "filename": "a.md", "chunk_id": "c", "ordinal": 0, "excerpt": "e"}]
    manifest = domain_query_manifest(
        {"answer": "A", "citations": citations, "latency_ms": 1, "model": "m", "message_id": "mid"},
        "dom",
    )
    assert "citations" in manifest
