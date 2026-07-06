"""M-tools C7.B — the per-node skills resolver (``control_plane/node_skills.py``).

Mutation-real coverage of the ONE capability-agnostic resolver + the thinker bridge:

* inline sources in all three disclosure modes (always / trigger / agent) map to the EXACT SDK
  ``Skill`` fields (``trigger`` / ``is_agentskills_format``), not a smoke check;
* a ``repo`` source clones a LOCAL git fixture repo at a pinned ref (NO network) and ``filter``
  narrows it;
* a ``project_rules`` source reads the repo's own ``CLAUDE.md`` (via the SDK's
  ``load_project_skills``) AND the modern ``.cursor/rules/*.mdc`` files (the C7.B glue the SDK
  misses) — and yields nothing when no workspace is available (the thinker path);
* the thinker bridge (``inject_skills_into_prompt``) renders the SAME resolver output into a prompt;
* a source that fails to resolve is SKIPPED and emits a warning through the lazy recorder shim;
* the inert path (NULL skills) is byte-for-byte unchanged;
* INVARIANT 1: the module has NO module-level ``openhands`` import.

Offline throughout — no NIM, no network (the repo test uses a local ``git init`` fixture).
"""

import ast
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

from tvashtr.control_plane import node_skills
from tvashtr.control_plane.node_skills import build_skills, inject_skills_into_prompt
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import Run, RunWarning, User

_RUN = "run-123"


# ---------------------------------------------------------------------------------------------
# Fixtures — local git skill repo + a project-rules workspace (all offline)
# ---------------------------------------------------------------------------------------------


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def _make_skill_repo(tmp_path: Path, skills: dict[str, str]) -> tuple[str, str]:
    """A local git repo laid out as ``skills/<name>/SKILL.md`` (the public-skills layout).

    Returns ``(repo_path, commit_sha)`` — resolving at the sha proves the pinned-ref path with NO
    network.
    """
    repo = tmp_path / "skillrepo"
    (repo / "skills").mkdir(parents=True)
    for name, body in skills.items():
        d = repo / "skills" / name
        d.mkdir()
        (d / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: the {name} skill\n---\n{body}\n",
            encoding="utf-8",
        )
    _git(repo, "init", "-q")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")
    sha = _git(repo, "rev-parse", "HEAD")
    return str(repo), sha


def _make_project_rules_workspace(tmp_path: Path) -> str:
    """A workspace dir carrying BOTH a ``CLAUDE.md`` (the SDK reads it) and a
    ``.cursor/rules/style.mdc`` (only the C7.B glue reads it)."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    (ws / "CLAUDE.md").write_text("CLAUDE_RULE_SENTINEL: always write tests.\n", encoding="utf-8")
    rules = ws / ".cursor" / "rules"
    rules.mkdir(parents=True)
    (rules / "style.mdc").write_text(
        "---\nname: house-style\nalwaysApply: true\n---\nCURSOR_MDC_SENTINEL\n",
        encoding="utf-8",
    )
    return str(ws)


def _make_user() -> uuid.UUID:
    """A fresh User row to own a seeded Run (mirrors test_mcp_tools._make_user)."""
    uid = uuid.uuid4()
    with session_scope() as session:
        session.add(User(id=uid, email=f"skills-{uid.hex}@tvashtr.local", password_hash="x"))
    return uid


def _make_owned_run(owner_id: uuid.UUID) -> str:
    """A minimal owned Run with a VALID-UUID id (mirrors test_mcp_tools._make_owned_run) so the
    recorder's uuid.UUID(run_id) parses and the run_warnings -> runs FK resolves."""
    run_id = str(uuid.uuid4())
    team_graph_id = build_two_node_team()
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=owner_id,
                idea="x",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


@pytest.fixture
def _isolated_skills_cache(tmp_path, monkeypatch):
    """A FRESH on-disk skills clone-cache per test. ``load_public_skills`` reuses ONE
    ``~/.openhands/cache/skills/public-skills`` dir for ALL repo URLs, so without this fixture one
    test's clone leaks into the next (a bogus ref falls back to the prior checkout)."""
    cache = tmp_path / "skills-cache"
    cache.mkdir()
    monkeypatch.setattr("openhands.sdk.skills.skill.get_skills_cache_dir", lambda: cache)
    monkeypatch.setattr("openhands.sdk.skills.skill._PUBLIC_SKILLS_CACHE", {}, raising=False)
    return cache


# ---------------------------------------------------------------------------------------------
# 1. Inertness backstop — NULL/empty skills is byte-for-byte unchanged
# ---------------------------------------------------------------------------------------------


def test_build_skills_none_and_empty_yield_empty_list():
    assert build_skills(None, "/w", _RUN) == []
    assert build_skills([], "/w", _RUN) == []


def test_inject_none_and_empty_return_prompt_unchanged():
    assert inject_skills_into_prompt(None, "hello", _RUN) == "hello"
    assert inject_skills_into_prompt([], "hello", _RUN) == "hello"


# ---------------------------------------------------------------------------------------------
# 2. Inline resolver — the three disclosure modes map to exact SDK Skill fields
# ---------------------------------------------------------------------------------------------


def test_inline_always_mode_is_repo_context_skill():
    """always => full content always active: trigger=None, is_agentskills_format=False (the SDK's
    ``<REPO_CONTEXT>`` / always-on partition)."""
    out = build_skills(
        [{"type": "inline", "name": "greet", "content": "SAY_HI", "mode": "always"}],
        "/w",
        _RUN,
    )
    assert len(out) == 1
    skill = out[0]
    # class-name (not isinstance): the suite clears openhands from sys.modules, so the Skill class
    # object can differ across that reload boundary — the field values are the real assertion.
    assert type(skill).__name__ == "Skill"
    assert skill.name == "greet"
    assert skill.content == "SAY_HI"
    assert skill.trigger is None
    assert skill.is_agentskills_format is False


def test_inline_trigger_mode_is_keyword_gated():
    """trigger => a KeywordTrigger carrying the trigger words (SDK auto-injects on a substring
    match)."""
    out = build_skills(
        [
            {
                "type": "inline",
                "name": "sql",
                "content": "USE_INDEXES",
                "mode": "trigger",
                "triggers": ["database", "query"],
            }
        ],
        "/w",
        _RUN,
    )
    assert len(out) == 1
    skill = out[0]
    assert type(skill.trigger).__name__ == "KeywordTrigger"
    assert skill.trigger.keywords == ["database", "query"]


def test_inline_agent_mode_is_progressive_disclosure():
    """agent => listed in <available_skills>, invoked on demand: is_agentskills_format=True,
    trigger=None, and NOT disable_model_invocation (the model may call invoke_skill)."""
    out = build_skills(
        [{"type": "inline", "name": "deploy", "content": "HOW_TO_DEPLOY", "mode": "agent"}],
        "/w",
        _RUN,
    )
    assert len(out) == 1
    skill = out[0]
    assert skill.is_agentskills_format is True
    assert skill.trigger is None
    assert skill.disable_model_invocation is False


def test_inline_defaults_to_always_when_mode_omitted():
    out = build_skills([{"type": "inline", "name": "n", "content": "C"}], "/w", _RUN)
    assert len(out) == 1
    assert out[0].trigger is None and out[0].is_agentskills_format is False


# ---------------------------------------------------------------------------------------------
# 3. Repo resolver — a LOCAL git fixture at a pinned ref, + filter narrowing (NO network)
# ---------------------------------------------------------------------------------------------


def test_repo_source_loads_from_local_fixture_at_pinned_ref(tmp_path, _isolated_skills_cache):
    repo, sha = _make_skill_repo(tmp_path, {"greet": "REPO_GREET_BODY"})
    out = build_skills([{"type": "repo", "url": repo, "ref": sha}], "/w", _RUN)
    names = {s.name for s in out}
    assert "greet" in names, f"expected the repo's 'greet' skill, got {names}"
    greet = next(s for s in out if s.name == "greet")
    assert "REPO_GREET_BODY" in greet.content


def test_repo_filter_narrows_the_subset(tmp_path, _isolated_skills_cache):
    repo, sha = _make_skill_repo(tmp_path, {"greet": "G_BODY", "farewell": "F_BODY"})
    out = build_skills([{"type": "repo", "url": repo, "ref": sha, "filter": "greet"}], "/w", _RUN)
    names = {s.name for s in out}
    assert names == {"greet"}, f"filter should keep only 'greet', got {names}"


# ---------------------------------------------------------------------------------------------
# 4. project_rules — CLAUDE.md (SDK) + .cursor/rules/*.mdc (glue); skipped without a workspace
# ---------------------------------------------------------------------------------------------


def test_project_rules_reads_claude_md_and_cursor_mdc(tmp_path):
    ws = _make_project_rules_workspace(tmp_path)
    out = build_skills([{"type": "project_rules"}], ws, _RUN)
    blob = "\n".join(s.content for s in out)
    # CLAUDE.md is read by the SDK's load_project_skills...
    assert "CLAUDE_RULE_SENTINEL" in blob, f"CLAUDE.md not read; skills={[s.name for s in out]}"
    # ...and .cursor/rules/*.mdc is read ONLY by the C7.B glue (the SDK alone would miss it).
    assert "CURSOR_MDC_SENTINEL" in blob, ".cursor/rules/*.mdc glue did not read the rule file"


def test_sdk_alone_misses_cursor_mdc_so_the_glue_is_load_bearing(tmp_path):
    """Proof the .mdc glue is necessary: the SDK's own load_project_skills does NOT read
    .cursor/rules/*.mdc, so without the glue the CURSOR sentinel would be absent."""
    ws = _make_project_rules_workspace(tmp_path)
    from openhands.sdk.skills import load_project_skills

    sdk_only = "\n".join(s.content for s in load_project_skills(ws))
    assert "CLAUDE_RULE_SENTINEL" in sdk_only  # the SDK does read CLAUDE.md
    assert "CURSOR_MDC_SENTINEL" not in sdk_only  # ...but NOT the modern .cursor/rules/*.mdc


def test_project_rules_yields_nothing_without_workspace():
    """The thinker path resolves with workspace=None => project_rules contributes nothing (there is
    no workspace to adopt)."""
    # inject_skills_into_prompt resolves with workspace=None internally.
    out = inject_skills_into_prompt([{"type": "project_rules"}], "BASE_PROMPT", _RUN)
    assert out == "BASE_PROMPT"


# ---------------------------------------------------------------------------------------------
# 5. The thinker bridge — the SAME resolver output, rendered into a prompt
# ---------------------------------------------------------------------------------------------


def test_thinker_bridge_prepends_always_skill_content():
    out = inject_skills_into_prompt(
        [{"type": "inline", "name": "n", "content": "ALWAYS_BODY", "mode": "always"}],
        "BASE_PROMPT",
        _RUN,
    )
    assert "ALWAYS_BODY" in out
    assert out.rstrip().endswith("BASE_PROMPT")  # skill content is PREPENDED, base kept intact
    assert out.index("ALWAYS_BODY") < out.index("BASE_PROMPT")


def test_thinker_bridge_includes_trigger_skill_only_on_match():
    src = [
        {
            "type": "inline",
            "name": "sql",
            "content": "SQL_GUIDANCE",
            "mode": "trigger",
            "triggers": ["database"],
        }
    ]
    # No trigger word in the prompt => not injected.
    assert inject_skills_into_prompt(src, "write a poem", _RUN) == "write a poem"
    # Trigger word present => injected.
    hit = inject_skills_into_prompt(src, "design the DATABASE schema", _RUN)
    assert "SQL_GUIDANCE" in hit


def test_same_resolver_output_feeds_both_build_and_inject():
    """Capability-agnostic: the content of the Skill objects build_skills produces is exactly what
    the thinker bridge renders — one resolver, two deliveries."""
    src = [{"type": "inline", "name": "n", "content": "SHARED_BODY", "mode": "always"}]
    built = build_skills(src, "/w", _RUN)
    injected = inject_skills_into_prompt(src, "BASE", _RUN)
    assert [s.content for s in built] == ["SHARED_BODY"]
    assert "SHARED_BODY" in injected


# ---------------------------------------------------------------------------------------------
# 6. Skip + warn — an unresolvable source is skipped AND emits through the recorder shim
# ---------------------------------------------------------------------------------------------


def test_unreachable_repo_is_skipped_and_warns_via_build_skills(
    tmp_path, monkeypatch, _isolated_skills_cache
):
    warnings: list[tuple] = []
    monkeypatch.setattr(
        node_skills,
        "_emit_skill_warning",
        lambda run_id, name, reason: warnings.append((run_id, name, reason)),
    )
    bogus = str(tmp_path / "does-not-exist")  # a local nonexistent repo => git clone fails, no net
    out = build_skills([{"type": "repo", "url": bogus, "ref": "deadbeef"}], "/w", _RUN)
    assert out == []  # skipped, run continues
    assert warnings, "an unreachable repo must emit a skill warning"
    assert warnings[0][0] == _RUN
    assert warnings[0][1]  # a non-empty source label


def test_unreachable_repo_is_skipped_and_warns_via_inject(
    tmp_path, monkeypatch, _isolated_skills_cache
):
    warnings: list[tuple] = []
    monkeypatch.setattr(
        node_skills,
        "_emit_skill_warning",
        lambda run_id, name, reason: warnings.append((run_id, name, reason)),
    )
    bogus = str(tmp_path / "nope")
    out = inject_skills_into_prompt([{"type": "repo", "url": bogus, "ref": "x"}], "BASE", _RUN)
    assert out == "BASE"  # nothing resolved -> prompt unchanged
    assert warnings, "the bridge must emit through the SAME recorder shim"


def test_unknown_source_type_is_skipped_and_warns(monkeypatch):
    warnings: list[tuple] = []
    monkeypatch.setattr(
        node_skills,
        "_emit_skill_warning",
        lambda run_id, name, reason: warnings.append((run_id, name, reason)),
    )
    # A typeless / unknown-type source (the scaffold's sample shape) must be skipped, not defaulted.
    out = build_skills([{"name": "AGENTS.md", "content": "x"}], "/w", _RUN)
    assert out == []
    assert warnings


def test_emit_skill_warning_reaches_the_recorder_and_records_a_skill_warning(client):
    """POST-MERGE reality: C7.A's recorder IS present now, so the lazy shim reaches the REAL
    record_resolution_warning and records a run-scoped SKILL warning (not an inert no-op).

    Seeds a real owned Run (valid-UUID id) so the recorder's uuid.UUID(run_id) and the
    run_warnings FK resolve, then asserts exactly one row landed with source_kind="skill" and the
    emitted label/reason. Mutation-real: a shim that did NOT reach the recorder (import-guard
    swallow / no-op / wrong kind) leaves zero matching rows and fails."""
    run_id = _make_owned_run(_make_user())
    node_skills._emit_skill_warning(run_id, "some-label", "some reason")
    with session_scope() as session:
        rows = (
            session.execute(select(RunWarning).where(RunWarning.run_id == uuid.UUID(run_id)))
            .scalars()
            .all()
        )
    assert len(rows) == 1, f"want exactly one recorded warning, got {rows}"
    assert rows[0].source_kind == "skill"  # C7.B emits through the recorder as the 'skill' kind
    assert rows[0].name == "some-label"
    assert rows[0].reason == "some reason"


# ---------------------------------------------------------------------------------------------
# 7. INVARIANT 1 — no module-level openhands import
# ---------------------------------------------------------------------------------------------


def test_node_skills_has_no_module_level_openhands_import():
    src = Path(node_skills.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in tree.body:  # only TOP-LEVEL statements
        if isinstance(node, ast.Import):
            for alias in node.names:
                assert not alias.name.startswith("openhands"), (
                    f"module-level 'import {alias.name}' violates INVARIANT 1"
                )
        elif isinstance(node, ast.ImportFrom):
            assert not (node.module or "").startswith("openhands"), (
                f"module-level 'from {node.module} import ...' violates INVARIANT 1"
            )
