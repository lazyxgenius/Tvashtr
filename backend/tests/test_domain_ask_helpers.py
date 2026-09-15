"""Phase 3 — ask prompt + generation model resolve."""

import uuid
from unittest.mock import patch

import pytest

from tvashtr.control_plane.domain_ask import (
    build_ask_messages,
    coerce_retrieval_top_k,
    missing_ask_providers,
    resolve_domain_generation_model,
)


def test_build_ask_messages_numbers_excerpts():
    chunks = [
        {
            "chunk_id": "c1",
            "document_id": "d1",
            "filename": "a.txt",
            "ordinal": 0,
            "text": "Alpha facts",
            "score": 0.9,
        },
        {
            "chunk_id": "c2",
            "document_id": "d2",
            "filename": "b.txt",
            "ordinal": 1,
            "text": "Beta facts",
            "score": 0.8,
        },
    ]
    msgs = build_ask_messages("What is alpha?", chunks)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert "[1]" in msgs[0]["content"]
    assert "Alpha facts" in msgs[0]["content"]
    assert "[2]" in msgs[0]["content"]
    assert msgs[1]["role"] == "user"
    assert msgs[1]["content"] == "What is alpha?"


def test_resolve_uses_config_generation_model():
    oid = uuid.uuid4()
    model = resolve_domain_generation_model(
        oid, {"generation": {"model": "openai/gpt-4o-mini"}}
    )
    assert model == "openai/gpt-4o-mini"


def test_resolve_falls_back_to_account_default(monkeypatch):
    oid = uuid.uuid4()
    with patch(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        return_value={"openai"},
    ), patch(
        "tvashtr.control_plane.domain_ask.account_default_model",
        return_value="openai/gpt-4o-mini",
    ):
        model = resolve_domain_generation_model(oid, {"generation": {"model": None}})
    assert model == "openai/gpt-4o-mini"


def test_resolve_raises_when_none(monkeypatch):
    oid = uuid.uuid4()
    with patch(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        return_value=set(),
    ), patch(
        "tvashtr.control_plane.domain_ask.account_default_model",
        return_value=None,
    ), patch(
        "tvashtr.control_plane.domain_ask.get_settings",
    ) as gs:
        gs.return_value.default_model = ""
        with pytest.raises(ValueError, match="generation model"):
            resolve_domain_generation_model(oid, {"generation": {"model": None}})


def test_missing_ask_providers_reports_both():
    oid = uuid.uuid4()
    with patch(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        return_value=set(),
    ):
        missing = missing_ask_providers(
            oid,
            "openai/text-embedding-3-small",
            "anthropic/claude-3-5-sonnet-20241022",
        )
    assert missing == ["anthropic", "openai"]


def test_coerce_retrieval_top_k_defaults_on_bad_config():
    assert coerce_retrieval_top_k({}) == 8
    assert coerce_retrieval_top_k({"retrieval": {"top_k": 12}}) == 12
    assert coerce_retrieval_top_k({"retrieval": {"top_k": "oops"}}) == 8
    assert coerce_retrieval_top_k({"retrieval": {"top_k": None}}) == 8
    assert coerce_retrieval_top_k({"retrieval": {"top_k": 0}}) == 8
    assert coerce_retrieval_top_k({"retrieval": {"top_k": -3}}) == 8
    assert coerce_retrieval_top_k({"retrieval": "dense"}) == 8
    assert coerce_retrieval_top_k(None) == 8
