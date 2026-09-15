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


def test_retrieve_top_k_coerce_bad_values(monkeypatch):
    """retrieve_domain_chunks must not raise on non-int top_k."""
    import uuid
    from tvashtr.control_plane.domain_retrieve import retrieve_domain_chunks

    class FakeSession:
        def execute(self, stmt):
            class R:
                def all(self):
                    return []

            return R()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(
        "tvashtr.control_plane.domain_retrieve.session_scope",
        lambda: FakeSession(),
    )
    out = retrieve_domain_chunks(uuid.uuid4(), [0.0] * 3, "oops")  # type: ignore[arg-type]
    assert out == []
    out2 = retrieve_domain_chunks(uuid.uuid4(), [0.0] * 3, None)  # type: ignore[arg-type]
    assert out2 == []
