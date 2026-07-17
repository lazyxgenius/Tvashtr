"""M-wholerepo regression (harness): the rung-2 driver must be able to reach the WHOLE-REPO leg.

Before this fix ``trade_mcp_rung2_check.py`` ALWAYS put ``"subpath": _SUBPATH`` in the
``POST /api/runs`` body, so a BLANK ``TVASHTR_RUNG2_SUBPATH=`` sent ``subpath=""`` -> the backend
422'd ("subpath is not a tracked directory") and the whole-repo leg could not run at all. The fix
mirrors the FE (``LaunchPanel.tsx``: ``if (scope) opts.subpath = scope``): a blank subpath OMITS
the key entirely (whole repo); the proven scoped default (``core`` when UNSET) is unchanged.

Loads the ``scripts/`` driver BY FILE PATH — the ``test_model_bench`` pattern (``parents[2]``) —
the driver has lazy ``tvashtr`` imports inside ``main()``, so it loads cleanly with no live
backend/DB. Moved here from ``scripts/`` (M-h1b Task 2) so ``make test`` actually runs it (a
mutation-real regression under ``scripts/`` never ran, so it would rot).
"""

import importlib.util
from pathlib import Path

_RUNG2_PATH = Path(__file__).resolve().parents[2] / "scripts" / "trade_mcp_rung2_check.py"


def _load_rung2():
    spec = importlib.util.spec_from_file_location("rung2_under_test", _RUNG2_PATH)
    assert spec and spec.loader, "could not create a spec for scripts/trade_mcp_rung2_check.py"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rung2 = _load_rung2()


def test_blank_subpath_resolves_empty_and_is_omitted_whole_repo():
    """BLANK ``TVASHTR_RUNG2_SUBPATH=`` -> "" -> the payload OMITS subpath (whole-repo mount)."""
    resolved = rung2._resolve_subpath({"TVASHTR_RUNG2_SUBPATH": ""})
    assert resolved == ""
    body = rung2._create_run_body(rung2._IDEA, "/tmp/clone", "main", resolved)
    assert "subpath" not in body, f"a blank subpath must be omitted (whole repo); got {body!r}"


def test_unset_subpath_resolves_core_and_is_sent_scoped():
    """UNSET ``TVASHTR_RUNG2_SUBPATH`` -> "core" (proven default) -> subpath IS sent (scoped)."""
    resolved = rung2._resolve_subpath({})
    assert resolved == "core"
    body = rung2._create_run_body(rung2._IDEA, "/tmp/clone", "main", resolved)
    assert body["subpath"] == "core"


def test_explicit_subpath_is_sent_verbatim():
    """A non-empty explicit subpath is sent as-is (scoped to that path)."""
    body = rung2._create_run_body(rung2._IDEA, "/tmp/clone", "main", "servers/kline_cache")
    assert body["subpath"] == "servers/kline_cache"


def test_run_body_always_carries_the_review_loop_run_fields():
    """The body always carries the review_loop shape + idea + repo + base_ref, subpath aside."""
    body = rung2._create_run_body("the idea", "/tmp/clone", "feature-x", "core")
    assert body["team_shape"] == "review_loop"
    assert body["idea"] == "the idea"
    assert body["repo_path"] == "/tmp/clone"
    assert body["base_ref"] == "feature-x"
