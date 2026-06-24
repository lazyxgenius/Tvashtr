"""Pure unit tests for the agent-Reviewer's stdlib helpers (P1.5c) — NO DBOS, NO LLM, NO
openhands, NO Docker. They exercise the verdict harvest's defensive parsing + file removal,
the workspace ``.gitignore`` writer, and the review-instruction builder. Importing
``team_run`` here must stay openhands-free (guarded by ``test_registry`` /
``test_cap_tests_import_no_openhands``)."""

import json

from tvashtr.control_plane.team_run import (
    _harvest_verdict,
    _write_workspace_gitignore,
)
from tvashtr.control_plane.teams import REVIEWER_PROMPT

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


def test_reviewer_prompt_template_contains_command_filename_and_rules():
    # P1.8a: the Reviewer's review mechanics moved OUT of team_run.py (the deleted
    # ``_build_review_instruction``) and INTO the node's ``prompt`` (teams.REVIEWER_PROMPT); the
    # executor appends the idea + PRD at run time. The template MUST still pin the exact test
    # command, the exact sidecar filename, the verdict label vocabulary, and the do-not-edit
    # clause — ``_harvest_verdict`` + the views + the smoke assertions all depend on these.
    assert "python -B -m unittest" in REVIEWER_PROMPT
    assert "REVIEW_VERDICT.json" in REVIEWER_PROMPT
    assert "approved" in REVIEWER_PROMPT
    assert "changes_requested" in REVIEWER_PROMPT
    # The do-not-edit clause is present (reviewing, not editing).
    assert "Do NOT modify" in REVIEWER_PROMPT
    # The idea/PRD are NOT baked into the template — the executor appends them uniformly now.
    assert "--- PRD ---" not in REVIEWER_PROMPT
    assert "--- ORIGINAL IDEA ---" not in REVIEWER_PROMPT
