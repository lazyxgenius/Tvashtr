"""Idempotency of side-effecting writes — the at-least-once-safe convention.

DBOS guarantees a *completed* step is exactly-once, but a crash *mid-step*
re-runs that step, so DB writes inside steps are at-least-once. Both
side-effecting writes in this layer (``DocumentVersion`` and ``CostRecord``)
must therefore be idempotent on a deterministic key: a second write with the
same key returns the existing row instead of inserting a duplicate.

These tests prove that convention directly and deterministically — no network,
no DBOS, just the service/metering helpers against Postgres.
"""

from uuid import uuid4

from sqlalchemy import func, select

from tvashtr.db import session_scope
from tvashtr.documents.service import add_version, create_document
from tvashtr.gateway import CompletionResult
from tvashtr.metering import record_cost
from tvashtr.models import CostRecord, DocumentVersion


def _count_versions(idempotency_key: str) -> int:
    with session_scope() as session:
        return session.execute(
            select(func.count())
            .select_from(DocumentVersion)
            .where(DocumentVersion.idempotency_key == idempotency_key)
        ).scalar_one()


def _count_costs(idempotency_key: str) -> int:
    with session_scope() as session:
        return session.execute(
            select(func.count())
            .select_from(CostRecord)
            .where(CostRecord.idempotency_key == idempotency_key)
        ).scalar_one()


def test_add_version_is_idempotent_on_key():
    doc = create_document(title="Idempotency Doc", doc_type="prd")
    key = f"test:{uuid4().hex}:v1"

    first = add_version(doc.id, content="hello", created_by="human", idempotency_key=key)
    assert first.version_no == 1
    assert _count_versions(key) == 1

    # Same key again (simulating an at-least-once step re-run) -> same row, no dup.
    second = add_version(doc.id, content="hello", created_by="human", idempotency_key=key)
    assert second.id == first.id
    assert _count_versions(key) == 1


def test_record_cost_is_idempotent_on_key():
    key = f"test:{uuid4().hex}:llm"
    result = CompletionResult(
        text="a tiny PRD",
        model_requested="openrouter/meta-llama/llama-3.1-8b-instruct",
        model_used="openrouter/meta-llama/llama-3.1-8b-instruct",
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        cost_usd=0.0,
        raw_provider="openrouter",
        latency_ms=12.3,
    )

    first = record_cost(result, workflow_id="wf-test", idempotency_key=key)
    assert first.total_tokens == 15
    assert _count_costs(key) == 1

    second = record_cost(result, workflow_id="wf-test", idempotency_key=key)
    assert second.id == first.id
    assert _count_costs(key) == 1


def test_add_version_builds_an_ordered_immutable_chain():
    """Distinct versions on one document increment version_no 1, 2, 3 …"""
    doc = create_document(title="Chain Doc", doc_type="prd")

    v1 = add_version(doc.id, content="v1", created_by="human", idempotency_key=f"{uuid4().hex}")
    v2 = add_version(doc.id, content="v2", created_by="agent:pm", idempotency_key=f"{uuid4().hex}")
    v3 = add_version(doc.id, content="v3", created_by="human", idempotency_key=f"{uuid4().hex}")

    assert [v1.version_no, v2.version_no, v3.version_no] == [1, 2, 3]
    # Earlier content is immutable — each version keeps its own snapshot.
    assert v1.content == "v1"
    assert v2.content == "v2"
