"""Pure unit tests for the agent-Reviewer's stdlib helpers (P1.5c) — NO DBOS, NO LLM, NO
openhands, NO Docker. They exercise the verdict harvest's defensive parsing + file removal,
the workspace ``.gitignore`` writer, and the review-instruction builder. Importing
``team_run`` here must stay openhands-free (guarded by ``test_registry`` /
``test_cap_tests_import_no_openhands``)."""

import json

from tvashtr.control_plane.team_run import (
    _build_review_instruction,
    _harvest_verdict,
    _write_workspace_gitignore,
)

_VERDICT_FILE = "REVIEW_VERDICT.json"


def _write_verdict(tmp_path, content: str) -> None:
    (tmp_path / _VERDICT_FILE).write_text(content, encoding="utf-8")


def test_harvest_approved_json(tmp_path):
    _write_verdict(tmp_path, json.dumps({"verdict": "approved", "reasons": "looks good"}))
    result = _harvest_verdict(str(tmp_path))
    assert result == {"outcome": "approved", "reasons": None}
    # Removed after harvest — never ships, never seeds the next iteration.
    assert not (tmp_path / _VERDICT_FILE).exists()


def test_harvest_changes_requested_json_carries_reasons(tmp_path):
    _write_verdict(
        tmp_path, json.dumps({"verdict": "changes_requested", "reasons": "missing tests"})
    )
    result = _harvest_verdict(str(tmp_path))
    assert result["outcome"] == "changes_requested"
    assert result["reasons"] == "missing tests"
    assert not (tmp_path / _VERDICT_FILE).exists()


def test_harvest_missing_file_safe_default(tmp_path):
    # No file written: must NOT raise and must default to changes_requested.
    result = _harvest_verdict(str(tmp_path))
    assert result["outcome"] == "changes_requested"
    assert result["reasons"]  # a non-empty explanatory string


def test_harvest_malformed_json_containing_approved_text_fallback(tmp_path):
    # Invalid JSON, but contains "approved" and not "changes" -> the text fallback approves.
    _write_verdict(tmp_path, '{"verdict": "approved"  <- truncated, not valid json')
    result = _harvest_verdict(str(tmp_path))
    assert result["outcome"] == "approved"
    assert result["reasons"] is None
    assert not (tmp_path / _VERDICT_FILE).exists()


def test_harvest_malformed_json_no_verdict_word_safe_default(tmp_path):
    _write_verdict(tmp_path, "this is not json and has no verdict word")
    result = _harvest_verdict(str(tmp_path))
    assert result["outcome"] == "changes_requested"
    assert not (tmp_path / _VERDICT_FILE).exists()


def test_harvest_unrecognized_verdict_value_safe_default(tmp_path):
    _write_verdict(tmp_path, json.dumps({"verdict": "maybe", "reasons": "unsure"}))
    result = _harvest_verdict(str(tmp_path))
    assert result["outcome"] == "changes_requested"
    assert not (tmp_path / _VERDICT_FILE).exists()


def test_harvest_changes_requested_empty_reasons_uses_fallback(tmp_path):
    _write_verdict(tmp_path, json.dumps({"verdict": "changes_requested"}))
    result = _harvest_verdict(str(tmp_path))
    assert result == {"outcome": "changes_requested", "reasons": "(no reasons given)"}
    assert not (tmp_path / _VERDICT_FILE).exists()


def test_harvest_bare_json_string_approved_does_not_approve(tmp_path):
    # Safety property: valid JSON but a bare string (not an object) — a non-object "approved"
    # must NOT be treated as an approval (the harvest fails toward more review).
    _write_verdict(tmp_path, json.dumps("approved"))
    result = _harvest_verdict(str(tmp_path))
    assert result["outcome"] == "changes_requested"
    assert not (tmp_path / _VERDICT_FILE).exists()


def test_write_workspace_gitignore(tmp_path):
    _write_workspace_gitignore(str(tmp_path))
    content = (tmp_path / ".gitignore").read_text(encoding="utf-8")
    assert "__pycache__/" in content
    assert "*.pyc" in content
    assert "REVIEW_VERDICT.json" in content


def test_build_review_instruction_contains_idea_prd_command_and_rules():
    instruction = _build_review_instruction("PRD: build a calculator", "a calculator app")
    assert "a calculator app" in instruction
    assert "PRD: build a calculator" in instruction
    assert "python -B -m unittest" in instruction
    assert "REVIEW_VERDICT.json" in instruction
    # The do-not-edit clause is present (reviewing, not editing).
    assert "Do NOT modify" in instruction
