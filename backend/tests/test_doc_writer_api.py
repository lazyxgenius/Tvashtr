"""End-to-end (no network): the generate_doc workflow + the read endpoints.

The gateway is monkeypatched to a canned result, so the whole flow — durable
DBOS workflow, idempotent metering, versioned document, and the HTTP surface —
is exercised deterministically without a live provider call.
"""

from dbos import DBOS

from tvashtr.control_plane import doc_writer
from tvashtr.gateway import CompletionResult

_MODEL = "openrouter/meta-llama/llama-3.1-8b-instruct"


def _canned_result() -> CompletionResult:
    return CompletionResult(
        text="PRD sentence one. Sentence two. Sentence three.",
        model_requested=_MODEL,
        model_used=_MODEL,
        prompt_tokens=20,
        completion_tokens=30,
        total_tokens=50,
        cost_usd=0.0,
        raw_provider="openrouter",
        latency_ms=5.0,
    )


def test_generate_doc_end_to_end(client, monkeypatch):
    # Patch the gateway call the workflow's llm_step resolves at call time.
    monkeypatch.setattr(doc_writer, "complete", lambda request: _canned_result())

    handle = DBOS.start_workflow(doc_writer.generate_doc, "a notes app")
    result = handle.get_result()
    wf_id = handle.workflow_id

    assert result["model_used"] == _MODEL
    assert result["total_tokens"] == 50
    document_id = result["document_id"]

    # Status endpoint: SUCCESS + the workflow result + exactly one cost row.
    body = client.get(f"/api/spike/generate-doc/{wf_id}").json()
    assert body["status"] == "SUCCESS"
    assert body["result"]["document_id"] == document_id
    assert len(body["costs"]) == 1
    assert body["costs"][0]["total_tokens"] == 50
    assert body["costs"][0]["model_used"] == _MODEL

    # Document endpoint: a single immutable version 1 by the agent.
    doc = client.get(f"/api/documents/{document_id}").json()
    assert doc["doc_type"] == "prd"
    assert len(doc["versions"]) == 1
    assert doc["versions"][0]["version_no"] == 1
    assert doc["versions"][0]["created_by"] == "agent:doc_writer"
    assert "PRD sentence one." in doc["versions"][0]["content"]

    # The document is listed, and costs are filterable by workflow_id.
    listed = client.get("/api/documents").json()["documents"]
    assert any(d["id"] == document_id for d in listed)
    # Revamp: /api/costs is owner-scoped to the caller's RUNS. The spike workflow is not a run, so
    # its row belongs to no account and is not listed (the status endpoint above still shows it).
    filtered = client.get(f"/api/costs?workflow_id={wf_id}").json()["costs"]
    assert filtered == []


def test_generate_doc_status_unknown_workflow(client):
    resp = client.get("/api/spike/generate-doc/does-not-exist")
    assert resp.status_code == 200
    assert resp.json()["status"] == "NOT_FOUND"
