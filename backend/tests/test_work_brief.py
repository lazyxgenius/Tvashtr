"""Unit tests for the per-node work-brief helpers (Option A) — the deterministic, NO-LLM
"what I did last run" line each thinker/worker node writes into ``AgentInvocation.outcome_detail``.

Pure functions, no DB / no LLM: ``_thinker_brief`` (first vs later thinker) and ``_worker_brief``
(a NON-emitting worker's files-changed summary, capped). The EMITTING worker (the Reviewer) does
NOT use these — its ``outcome_detail`` stays the verdict reasons (asserted at the executor level in
``test_work_brief_executor`` + ``test_review_loop``).

These pin the EXACT strings the FE "Last run" panel + the live ``work-brief-e2e`` assert on; a drift
in either helper's wording goes RED here.
"""

from tvashtr.control_plane.team_run import _thinker_brief, _worker_brief


def test_thinker_brief_first_root():
    assert _thinker_brief(True, 1) == "Drafted the spec from the idea."


def test_thinker_brief_later_uses_version():
    # A later thinker's line carries the spec version == its contribution order (n).
    assert _thinker_brief(False, 2) == "Refined the spec (version 2)."
    assert _thinker_brief(False, 5) == "Refined the spec (version 5)."


def test_worker_brief_no_files():
    assert _worker_brief([]) == "Ran but changed no files."


def test_worker_brief_single_file():
    assert _worker_brief(["x.py"]) == "Built the feature — changed 1 file(s): x.py"


def test_worker_brief_lists_changed_files():
    assert (
        _worker_brief(["greeting.txt", "main.py"])
        == "Built the feature — changed 2 file(s): greeting.txt, main.py"
    )


def test_worker_brief_caps_at_five_then_plus_n_more():
    # Exactly the cap: all five listed, no "+N more".
    five = ["a", "b", "c", "d", "e"]
    assert _worker_brief(five) == "Built the feature — changed 5 file(s): a, b, c, d, e"
    # Over the cap: first five listed, the remainder elided as "+N more"; the COUNT stays honest.
    seven = ["a", "b", "c", "d", "e", "f", "g"]
    assert _worker_brief(seven) == "Built the feature — changed 7 file(s): a, b, c, d, e, +2 more"
