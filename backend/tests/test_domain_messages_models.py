"""Phase 3 — DomainMessage ORM smoke."""

from tvashtr.models import DomainMessage


def test_domain_message_tablename():
    assert DomainMessage.__tablename__ == "domain_messages"


def test_domain_message_has_citations_and_latency():
    cols = {c.name for c in DomainMessage.__table__.columns}
    assert "domain_id" in cols
    assert "role" in cols
    assert "content" in cols
    assert "citations" in cols
    assert "latency_ms" in cols
    assert "cost_usd" in cols
