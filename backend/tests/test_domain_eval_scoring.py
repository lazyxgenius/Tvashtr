"""Phase 6 — deterministic eval scorers."""

from tvashtr.control_plane.domain_eval import (
    aggregate_eval_scores,
    score_hit_at_k,
    score_keyword_hit,
)


def test_hit_at_k_true_when_any_expected_doc_in_citations():
    cites = [{"document_id": "d2", "excerpt": "x"}, {"document_id": "d9", "excerpt": "y"}]
    assert score_hit_at_k(["d1", "d2"], cites) is True


def test_hit_at_k_false_when_none_match():
    cites = [{"document_id": "d9", "excerpt": "x"}]
    assert score_hit_at_k(["d1"], cites) is False


def test_hit_at_k_none_when_no_expected_docs():
    assert score_hit_at_k([], [{"document_id": "d1", "excerpt": "x"}]) is None
    assert score_hit_at_k(None, [{"document_id": "d1", "excerpt": "x"}]) is None


def test_keyword_hit_requires_all_keywords_case_insensitive():
    cites = [{"document_id": "d1", "excerpt": "Refunds take Five days"}]
    assert score_keyword_hit(["refunds", "five"], cites) is True
    assert score_keyword_hit(["refunds", "weeks"], cites) is False


def test_keyword_hit_none_when_no_keywords():
    assert score_keyword_hit([], [{"excerpt": "hi"}]) is None


def test_aggregate_means_and_null_when_unscored():
    per = [
        {
            "case_id": "c1",
            "question": "q1",
            "hit": True,
            "keyword_hit": None,
            "citation_doc_ids": ["d1"],
            "latency_ms": 1,
            "error": None,
        },
        {
            "case_id": "c2",
            "question": "q2",
            "hit": False,
            "keyword_hit": True,
            "citation_doc_ids": [],
            "latency_ms": 2,
            "error": None,
        },
        {
            "case_id": "c3",
            "question": "q3",
            "hit": None,
            "keyword_hit": False,
            "citation_doc_ids": [],
            "latency_ms": 3,
            "error": None,
        },
    ]
    scores = aggregate_eval_scores(per, top_k=8, retrieval_mode="dense")
    assert scores["cases_total"] == 3
    assert scores["cases_scored_hit"] == 2
    assert scores["cases_scored_keyword"] == 2
    assert scores["hit_at_k"] == 0.5
    assert scores["keyword_hit"] == 0.5
    assert scores["top_k"] == 8
    assert scores["retrieval_mode"] == "dense"
    assert len(scores["per_case"]) == 3


def test_aggregate_null_metrics_when_zero_scored():
    per = [
        {
            "case_id": "c1",
            "question": "q",
            "hit": None,
            "keyword_hit": None,
            "citation_doc_ids": [],
            "latency_ms": 1,
            "error": None,
        }
    ]
    scores = aggregate_eval_scores(per, top_k=4, retrieval_mode="hybrid")
    assert scores["hit_at_k"] is None
    assert scores["keyword_hit"] is None
    assert scores["cases_scored_hit"] == 0
    assert scores["cases_scored_keyword"] == 0
