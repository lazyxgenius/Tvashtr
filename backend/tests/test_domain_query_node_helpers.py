"""Phase 4a — domain_query node pure helpers."""

import pytest

from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.control_plane.domain_query_node import (
    domain_query_manifest,
    format_domain_ask_error,
    render_domain_query_prompt,
    truncate_outcome_detail,
)


def test_render_replaces_idea_token():
    assert render_domain_query_prompt("Q: {idea}", "bulk discount") == "Q: bulk discount"


def test_render_leaves_other_braces_alone():
    # Must NOT use str.format — idea may contain braces.
    out = render_domain_query_prompt("look at {idea} and {not_a_field}", "x")
    assert out == "look at x and {not_a_field}"


def test_render_strips_and_rejects_empty():
    with pytest.raises(ValueError, match="empty"):
        render_domain_query_prompt("   ", "idea")
    with pytest.raises(ValueError, match="empty"):
        render_domain_query_prompt("{idea}", "   ")


def test_format_missing_providers_dict():
    exc = DomainAskError(
        "missing_providers",
        {
            "message": "you have no API key for: openai — needed to embed…",
            "missing_providers": ["openai"],
        },
    )
    text = format_domain_ask_error(exc)
    assert "openai" in text
    assert "API key" in text or "key" in text.lower()


def test_format_string_detail():
    assert "ingest" in format_domain_ask_error(
        DomainAskError("empty_corpus", "ingest documents before asking")
    )


def test_manifest_carries_citations():
    result = {
        "answer": "hi",
        "citations": [{"document_id": "d", "filename": "a.md", "chunk_id": "c", "ordinal": 0, "excerpt": "e"}],
        "latency_ms": 12,
        "model": "openai/gpt-4o-mini",
        "message_id": "m1",
    }
    m = domain_query_manifest(result, "dom-1")
    assert m["domain_id"] == "dom-1"
    assert m["citations"][0]["filename"] == "a.md"
    assert m["latency_ms"] == 12
    assert m["model"] == "openai/gpt-4o-mini"
    assert m["message_id"] == "m1"


def test_truncate_outcome_detail():
    long = "x" * 5000
    assert len(truncate_outcome_detail(long)) == 4000
