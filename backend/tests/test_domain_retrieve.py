"""Phase 3 — dense retrieve + excerpt truncate."""

from tvashtr.control_plane.domain_retrieve import truncate_excerpt


def test_truncate_excerpt_short_unchanged():
    assert truncate_excerpt("hello", 400) == "hello"


def test_truncate_excerpt_long():
    s = "x" * 500
    out = truncate_excerpt(s, 400)
    assert len(out) == 400
    assert out == "x" * 400


def test_retrieve_domain_chunks_callable():
    from tvashtr.control_plane import domain_retrieve as dr

    assert callable(dr.retrieve_domain_chunks)
