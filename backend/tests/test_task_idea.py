"""P1.5c capstone: the pinned ``TASK_LIST_IDEA`` brief + the ``Run.idea`` seeding rule.

Pure config/text assertions — NO openhands import, NO DB — so it stays in the offline suite.
The idea is a *brief* for the agent team to build; these tests assert the brief pins the
contract the agent-Reviewer will judge against (operations, priority sort, status filter, the
time-stable pure ``overdue_check``, and a discoverable unittest suite), and that the seeding
rule routes either the skeleton or the feature idea into ``Run.idea`` with no migration.
"""

import importlib

from tvashtr.config import TASK_LIST_IDEA
from tvashtr.routers import DEFAULT_IDEA, resolve_run_idea


def test_task_idea_covers_the_core_operations():
    low = TASK_LIST_IDEA.lower()
    # The CRUD-ish operations the build (and the Reviewer's tests) must cover.
    for op in ("add", "list", "complete", "delete"):
        assert op in low, f"TASK_LIST_IDEA must mention the {op!r} operation"


def test_task_idea_pins_priority_status_and_stdlib():
    low = TASK_LIST_IDEA.lower()
    # Priority levels, sortable high->low.
    for level in ("high", "medium", "low"):
        assert level in low, f"TASK_LIST_IDEA must name priority level {level!r}"
    assert "priority" in low and "sort" in low
    # Status filter.
    assert "pending" in low and "done" in low
    assert "filter" in low
    # Stdlib-only, no third-party deps.
    assert "standard library" in low
    assert "no third-party" in low


def test_task_idea_specifies_a_pure_time_stable_overdue_check():
    # The exact pure signature so the build's own tests are clock-stable (not datetime.now()).
    assert "overdue_check(due_date: str, reference_date: str) -> bool" in TASK_LIST_IDEA
    low = TASK_LIST_IDEA.lower()
    assert "pure function" in low
    # The brief must FORBID reading the clock (the whole point: time-stable tests).
    assert "datetime.now()" in TASK_LIST_IDEA
    assert "must not" in low
    # The boundary case is pinned (equal dates -> not overdue).
    assert "due_date == reference_date" in TASK_LIST_IDEA


def test_task_idea_requires_a_discoverable_unittest_suite():
    # The agent-Reviewer judges by running EXACTLY ``python -B -m unittest`` — the brief must
    # require tests that command discovers, else the review has nothing real to gate on.
    assert "python -B -m unittest" in TASK_LIST_IDEA
    assert "test_*.py" in TASK_LIST_IDEA
    assert "unittest" in TASK_LIST_IDEA.lower()


def test_task_idea_is_substantial_and_distinct_from_the_skeleton():
    # It is the real multi-file capstone, not the one-line greeting skeleton.
    assert TASK_LIST_IDEA != DEFAULT_IDEA
    assert len(TASK_LIST_IDEA) > 600
    assert "greeting.txt" not in TASK_LIST_IDEA


def test_task_idea_is_env_overridable(monkeypatch):
    # Mirrors DEFAULT_IDEA's override: TVASHTR_TASK_IDEA replaces the pinned brief at import.
    monkeypatch.setenv("TVASHTR_TASK_IDEA", "a custom override idea")
    cfg = importlib.import_module("tvashtr.config")
    try:
        importlib.reload(cfg)
        assert cfg.TASK_LIST_IDEA == "a custom override idea"
    finally:
        # Restore the module to the un-overridden constant so test ordering is unaffected.
        monkeypatch.delenv("TVASHTR_TASK_IDEA", raising=False)
        importlib.reload(cfg)


def test_resolve_run_idea_seeds_explicit_idea_else_default():
    # The Run.idea seeding rule: an explicit idea (the capstone POSTs TASK_LIST_IDEA) wins;
    # absent one, the skeleton DEFAULT_IDEA is used. One rule seeds either into Run.idea.
    assert resolve_run_idea(None) == DEFAULT_IDEA
    assert resolve_run_idea("") == DEFAULT_IDEA  # empty -> falsy -> default
    assert resolve_run_idea(TASK_LIST_IDEA) == TASK_LIST_IDEA
    assert resolve_run_idea("anything else") == "anything else"
