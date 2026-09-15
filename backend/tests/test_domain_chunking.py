"""Phase 2 — fixed chunking with overlap."""

import pytest

from tvashtr.control_plane.domain_chunking import chunk_text


def test_chunk_text_basic_overlap():
    text = "abcdefghijklmnopqrstuvwxyz"  # 26 chars
    parts = chunk_text(text, size=10, overlap=2)
    assert parts[0] == "abcdefghij"
    assert parts[1].startswith("ij")
    assert all(len(p) <= 10 for p in parts)
    assert len(parts) >= 3


def test_chunk_text_empty():
    assert chunk_text("", size=100, overlap=10) == []
    assert chunk_text("   ", size=100, overlap=10) == []


def test_chunk_text_rejects_bad_params():
    with pytest.raises(ValueError):
        chunk_text("hi", size=0, overlap=0)
    with pytest.raises(ValueError):
        chunk_text("hi", size=5, overlap=5)
