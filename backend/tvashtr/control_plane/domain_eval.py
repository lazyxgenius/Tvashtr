"""Phase 6 — Domain eval golden sets + deterministic quality scores."""

from __future__ import annotations

MAX_EVAL_CASES = 50


def score_hit_at_k(
    expected_doc_ids: list[str] | None, citations: list[dict]
) -> bool | None:
    ids = [str(x).strip() for x in (expected_doc_ids or []) if str(x).strip()]
    if not ids:
        return None
    cited = {str(c.get("document_id") or "") for c in citations}
    return any(eid in cited for eid in ids)


def score_keyword_hit(
    expected_keywords: list[str] | None, citations: list[dict]
) -> bool | None:
    kws = [str(k).strip() for k in (expected_keywords or []) if str(k).strip()]
    if not kws:
        return None
    hay = " ".join(str(c.get("excerpt") or "") for c in citations).lower()
    return all(k.lower() in hay for k in kws)


def aggregate_eval_scores(
    per_case: list[dict], *, top_k: int, retrieval_mode: str
) -> dict:
    hit_vals = [p["hit"] for p in per_case if p.get("hit") is not None]
    kw_vals = [p["keyword_hit"] for p in per_case if p.get("keyword_hit") is not None]
    return {
        "cases_total": len(per_case),
        "cases_scored_hit": len(hit_vals),
        "cases_scored_keyword": len(kw_vals),
        "hit_at_k": (sum(1 for v in hit_vals if v) / len(hit_vals)) if hit_vals else None,
        "keyword_hit": (sum(1 for v in kw_vals if v) / len(kw_vals)) if kw_vals else None,
        "top_k": top_k,
        "retrieval_mode": retrieval_mode,
        "per_case": per_case,
    }
