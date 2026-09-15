"""Phase 6 — DomainEvalCase / DomainEvalRun ORM smoke."""

from tvashtr.models import DomainEvalCase, DomainEvalRun


def test_domain_eval_case_tablename_and_columns():
    assert DomainEvalCase.__tablename__ == "domain_eval_cases"
    cols = {c.name for c in DomainEvalCase.__table__.columns}
    assert {
        "id",
        "domain_id",
        "question",
        "expected_answer",
        "expected_citation_doc_ids",
        "expected_keywords",
        "ordinal",
        "created_at",
    } <= cols


def test_domain_eval_run_tablename_and_columns():
    assert DomainEvalRun.__tablename__ == "domain_eval_runs"
    cols = {c.name for c in DomainEvalRun.__table__.columns}
    assert {
        "id",
        "domain_id",
        "status",
        "scores",
        "error_message",
        "created_at",
        "completed_at",
    } <= cols
