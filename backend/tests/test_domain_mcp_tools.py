"""Phase 4b — domain_ask / domain_retrieve MCP tool handlers."""

import json
import uuid
from unittest.mock import patch

import pytest

from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.control_plane.domain_mcp import (
    DomainMcpToolError,
    run_domain_ask_tool,
    run_domain_retrieve_tool,
)


def test_ask_tool_includes_citations():
    oid = uuid.uuid4()
    did = str(uuid.uuid4())
    fake = {
        "answer": "99.9%",
        "citations": [
            {
                "document_id": "d",
                "filename": "sla.md",
                "chunk_id": "c",
                "ordinal": 0,
                "excerpt": "SLA 99.9%",
            }
        ],
        "latency_ms": 10,
        "model": "openai/gpt-4o-mini",
        "message_id": "m1",
    }
    with patch("tvashtr.control_plane.domain_mcp.ask_domain", return_value=fake):
        raw = run_domain_ask_tool(oid, did, "What is the SLA?")
    body = json.loads(raw)
    assert body["answer"] == "99.9%"
    assert body["citations"][0]["filename"] == "sla.md"
    assert body["domain_id"] == did
    assert body["message_id"] == "m1"


def test_retrieve_tool_includes_citations_no_answer():
    oid = uuid.uuid4()
    did = str(uuid.uuid4())
    fake = {
        "citations": [
            {
                "document_id": "d",
                "filename": "a.md",
                "chunk_id": "c",
                "ordinal": 0,
                "excerpt": "e",
            }
        ],
        "latency_ms": 3,
    }
    with patch("tvashtr.control_plane.domain_mcp.retrieve_domain", return_value=fake):
        raw = run_domain_retrieve_tool(oid, did, "SLA")
    body = json.loads(raw)
    assert "answer" not in body
    assert body["citations"][0]["excerpt"] == "e"
    assert body["domain_id"] == did


def test_ask_tool_surfaces_byok():
    oid = uuid.uuid4()
    did = str(uuid.uuid4())
    exc = DomainAskError(
        "missing_providers",
        {
            "message": "you have no API key for: openai — needed to embed the question and generate an answer.",
            "missing_providers": ["openai"],
        },
    )
    with patch("tvashtr.control_plane.domain_mcp.ask_domain", side_effect=exc):
        with pytest.raises(DomainMcpToolError) as ei:
            run_domain_ask_tool(oid, did, "q")
    assert "openai" in ei.value.message
    assert "API key" in ei.value.message or "key" in ei.value.message.lower()


def test_bad_domain_id():
    with pytest.raises(DomainMcpToolError) as ei:
        run_domain_ask_tool(uuid.uuid4(), "not-a-uuid", "q")
    assert "domain_id" in ei.value.message.lower() or "uuid" in ei.value.message.lower()
