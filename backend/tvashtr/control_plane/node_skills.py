"""Per-node skills resolution (M-tools) — owned by the C7.B Skills milestone.

This is the SEAM the executor calls to turn a node's inline ``skills`` (the JSON array stored on
``AgentNode.skills``) into the runtime skill representation each capability needs:

* a WORKER node (engine-backed) gets a ``list`` of Skill objects passed to
  ``AgentContext(skills=…)`` in the adapters — :func:`build_skills`;
* a THINKER node (a direct-LLM completion — it never runs through OpenHands) gets the SAME resolved
  skills folded into its prompt instead — :func:`inject_skills_into_prompt` (the thin bridge).

ONE capability-agnostic resolver (:func:`_resolve_skills`) turns each source into SDK ``Skill``
objects; only DELIVERY differs (worker → ``AgentContext`` progressive disclosure; thinker → rendered
into the prompt). This bridge is thin — dropped when a "thinker" becomes "an agent with edits off"
and takes the identical ``AgentContext`` path (M-unify, amendment 1).

Each source object is one of (see :data:`SkillSource` in ``frontend/src/lib/api.ts`` for the twin):

* ``{"type": "inline", "name", "content", "mode": "always"|"trigger"|"agent", "triggers"?: [...]}``
* ``{"type": "repo", "url", "ref", "filter"?, "mode"?, "triggers"?, "resolved_sha"?}`` — a GitHub
  repo cloned at the PINNED ref (``resolved_sha`` wins when set; ``filter`` is comma-separated
  globs; ``mode`` sets how every loaded skill loads)
* ``{"type": "project_rules"}`` — adopt the run's own workspace rules (``CLAUDE.md`` etc. + the
  modern ``.cursor/rules/*.mdc`` files the SDK's ``load_project_skills`` does NOT read)
* ``{"type": "library", "id": "<uuid>", "mode"?, "triggers"?}`` — (C7.C) a LIVE ref to the owner's
  ``skill_library``; its stored source (inline/repo/project_rules) is fetched fresh + resolved one
  level at run time; an optional ``mode``/``triggers`` is this agent's load-mode override

A source that fails to resolve (bad repo, unreadable rules, unknown type) is SKIPPED — the run
continues — and records a warning through C7.A's recorder via the lazy shim
:func:`_emit_skill_warning`.

INVARIANT 1 (openhands-free import): this module is imported by ``team_run.py``, which must stay
``openhands``-free at import. So NO module-level ``openhands`` import here — every ``openhands.*``
import (``Skill``, ``KeywordTrigger``, ``load_public_skills``, ``load_project_skills``) is
FUNCTION-LOCAL inside the bodies below.
"""

from __future__ import annotations

import fnmatch
import glob
import os
import re

# =================================================================================================
# The resolution-warning recorder shim (SHARED CONTRACT S1 — owned by C7.A; C7.B emits through it)
# =================================================================================================


def _emit_skill_warning(run_id: str, name: str, reason: str) -> None:
    """Emit a skill resolution warning through C7.A's shared recorder (SHARED CONTRACT S1). Lazy +
    import-guarded because the recorder module lands with C7.A (merged A-first, then this session
    cherry-picked on top); a no-op in isolation. Tests patch THIS function to assert the emit."""
    try:
        from tvashtr.control_plane.resolution_warnings import record_resolution_warning
    except ImportError:
        return
    record_resolution_warning(run_id, "skill", name, reason)


# =================================================================================================
# The two seams the executor calls (signatures FIXED — keeps C7.B out of team_run.py)
# =================================================================================================


def build_skills(skills: list | None, workspace_dir: str, run_id: str) -> list:
    """Resolve a worker node's inline skill sources into the list for ``AgentContext(skills=…)``.

    ``workspace_dir`` is the worker's live workspace (so a ``project_rules`` source can adopt the
    repo the run OPERATES ON). ``None``/empty ``skills`` → ``[]`` — the adapter then passes
    ``agent_context=None`` (NOT an empty ``AgentContext``, which would inject a datetime), so a
    NULL-``skills`` node is byte-for-byte inert.
    """
    return _resolve_skills(skills, workspace_dir, run_id)


def inject_skills_into_prompt(skills: list | None, base_prompt: str, run_id: str) -> str:
    """The THINKER BRIDGE (amendment 1): render the SAME resolved skills into a thinker's prompt.

    A thinker is one completion with no tool loop — no progressive disclosure — so it resolves the
    sources with NO workspace (``project_rules`` is skipped) and renders skill content inline:
    ``always`` skills are prepended in full; ``trigger`` skills are prepended only when the prompt
    matches their trigger words; an ``agent``-mode skill degrades to a prepended reference (there is
    no loop to invoke it). ``None``/empty → ``base_prompt`` unchanged (byte-for-byte inert).
    """
    resolved = _resolve_skills(skills, None, run_id)
    blocks = [s.content for s in resolved if _should_prepend_for_thinker(s, base_prompt)]
    if not blocks:
        return base_prompt
    return _render_thinker_prompt(blocks, base_prompt)


# =================================================================================================
# The ONE capability-agnostic resolver
# =================================================================================================


def _resolve_skills(skills: list | None, workspace_dir: str | None, run_id: str) -> list:
    """Turn each source into SDK ``Skill`` objects. A source that raises / can't resolve is SKIPPED
    and warned (the run continues). With ``workspace_dir=None`` (a thinker) ``project_rules``
    contributes nothing (there is no workspace to adopt).

    C7.C: a ``{"type":"library","id":…}`` source is expanded ONE level from the owner's library (a
    LIVE lookup); the FINAL list is then de-duped by skill NAME (first-in-list wins) — the only
    precedence rule for skills, applied uniformly to inline/repo/library-expanded results."""
    resolved: list = []
    if not skills:
        return resolved
    for idx, source in enumerate(skills):
        label = _source_label(source, idx)
        try:
            if not isinstance(source, dict):
                raise ValueError("skill source must be an object")
            if source.get("type") == "library":
                resolved.extend(_resolve_library_source(source, workspace_dir, run_id))
            else:
                resolved.extend(_resolve_source_one_level(source, workspace_dir))
        except Exception as exc:  # noqa: BLE001 — one bad source must never sink the run
            _emit_skill_warning(run_id, label, _reason(exc))
    return _dedup_by_name(resolved)


def _resolve_source_one_level(source: dict, workspace_dir: str | None) -> list:
    """Resolve ONE non-library source (inline / repo / project_rules) into a list of ``Skill``
    objects. A ``library`` type reaching here is a NESTED reference (unsupported — a library item's
    source is only ever inline/repo/project_rules); it raises so the caller skips + warns."""
    stype = source.get("type")
    if stype == "inline":
        return [_resolve_inline(source)]
    if stype == "repo":
        return _resolve_repo(source)
    if stype == "project_rules":
        # No workspace (a thinker) → project_rules yields nothing (expected, no warn).
        return _resolve_project_rules(workspace_dir) if workspace_dir else []
    if stype == "library":
        raise ValueError("nested library skill source is unsupported")
    raise ValueError(f"unknown skill source type: {stype!r}")


def _resolve_library_source(source: dict, workspace_dir: str | None, run_id: str) -> list:
    """C7.C: expand a ``{"type":"library","id":…}`` reference — fetch the owner's library skill
    SOURCE fresh (a LIVE lookup) and resolve it ONE level. A dangling / foreign
    / unparseable ref is SKIPPED + warned (the run continues). ``node_library`` is imported
    FUNCTION-LOCAL to keep this module's import surface minimal (INVARIANT 1 style)."""
    from tvashtr.control_plane import node_library

    lib_id = source.get("id")
    owner_id = node_library.owner_for_run(run_id)
    lib_source = node_library.resolve_owner_skill_source(owner_id, lib_id) if owner_id else None
    if not isinstance(lib_source, dict):
        _emit_skill_warning(run_id, f"library:{lib_id}", "referenced library skill not found")
        return []
    resolved = _resolve_source_one_level(lib_source, workspace_dir)
    # Revamp: the ref may carry a PER-AGENT load-mode override ({"type":"library","id","mode"?,
    # "triggers"?}) — "Each agent can change this in its own Skills & tools tab". It replaces the
    # library skill's own mode for this node only.
    if source.get("mode"):
        resolved = [_with_mode(s, source.get("mode"), source.get("triggers")) for s in resolved]
    return resolved


def _trigger_words(value: object) -> list[str]:
    """Trigger words from a list or a comma-separated string, trimmed, empties dropped."""
    items = value.split(",") if isinstance(value, str) else value if isinstance(value, list) else []
    return [str(t).strip() for t in items if str(t).strip()]


def _with_mode(skill, mode: object, triggers: object):
    """A copy of ``skill`` loading in ``mode`` — the same three SDK disclosure behaviours as an
    inline source (always → always active; trigger → keyword-gated; agent → progressive
    disclosure). An unknown mode raises, so the caller skips the source + warns."""
    from openhands.sdk.skills import KeywordTrigger

    if mode == "always":
        return skill.model_copy(update={"trigger": None, "is_agentskills_format": False})
    if mode == "trigger":
        trigger = KeywordTrigger(keywords=_trigger_words(triggers))
        return skill.model_copy(update={"trigger": trigger, "is_agentskills_format": False})
    if mode == "agent":
        return skill.model_copy(update={"trigger": None, "is_agentskills_format": True})
    raise ValueError(f"unknown skill mode: {mode!r}")


def _dedup_by_name(resolved: list) -> list:
    """De-dup the FINAL resolved skills by NAME, FIRST occurrence wins (drawer/list order — the row
    higher in the section wins, which is what the user sees). Benign (no warning)."""
    seen: set = set()
    out: list = []
    for skill in resolved:
        name = getattr(skill, "name", None)
        if name is not None:
            if name in seen:
                continue
            seen.add(name)
        out.append(skill)
    return out


def _resolve_inline(source: dict):
    """inline → one Skill honoring ``mode`` (the three SDK disclosure behaviors)."""
    from openhands.sdk.skills import KeywordTrigger, Skill

    name = source.get("name")
    content = source.get("content")
    if not name:
        raise ValueError("inline skill needs a name")
    if content is None:
        raise ValueError("inline skill needs content")
    mode = source.get("mode") or "always"
    if mode == "always":
        # Always active: full content in every system prompt (the SDK's <REPO_CONTEXT> partition).
        return Skill(name=name, content=content, trigger=None, is_agentskills_format=False)
    if mode == "trigger":
        # Auto-injected when a trigger word appears (case-insensitive substring match).
        keywords = [str(t) for t in (source.get("triggers") or [])]
        return Skill(
            name=name,
            content=content,
            trigger=KeywordTrigger(keywords=keywords),
            is_agentskills_format=False,
        )
    if mode == "agent":
        # Progressive disclosure: listed in <available_skills>, the agent calls invoke_skill.
        return Skill(name=name, content=content, trigger=None, is_agentskills_format=True)
    raise ValueError(f"unknown inline mode: {mode!r}")


_FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


def _resolve_repo(source: dict) -> list:
    """repo → clone at the PINNED ref via the SDK loader, then apply ``filter``. Subsumes
    marketplaces (a marketplace is a repo + manifest). ``load_public_skills`` never raises — it
    returns ``[]`` on any failure — so an empty result is treated as a resolution failure.

    Revamp: ``resolved_sha`` (a full commit SHA recorded when the skills were added from GitHub)
    wins over ``ref`` so runs stay repeatable ("Skills update when you change the version");
    ``filter`` is a comma-separated list of globs (any match keeps a skill); an optional
    ``mode``/``triggers`` sets how every loaded skill loads (default: each file's own format)."""
    from openhands.sdk.skills import load_public_skills

    url = source.get("url")
    ref = source.get("ref")
    if not url:
        raise ValueError("repo skill needs a url")
    if not ref:
        raise ValueError("repo skill needs a ref (pins reproducibility)")
    sha = source.get("resolved_sha")
    pin = sha if isinstance(sha, str) and _FULL_SHA.match(sha) else str(ref)
    # marketplace_path=None → load ALL skills in the repo's skills/ dir (no manifest required).
    loaded = load_public_skills(repo_url=str(url), ref=pin, marketplace_path=None)
    filt = source.get("filter")
    patterns = [p.strip() for p in str(filt).split(",") if p.strip()] if filt else []
    if patterns:
        loaded = [s for s in loaded if any(fnmatch.fnmatch(s.name, p) for p in patterns)]
    if not loaded:
        raise ValueError(f"repo produced no skills (url={url!r}, ref={pin!r}, filter={filt!r})")
    if source.get("mode"):
        loaded = [_with_mode(s, source.get("mode"), source.get("triggers")) for s in loaded]
    return loaded


def _resolve_project_rules(workspace_dir: str) -> list:
    """project_rules → the run's OWN workspace rules: the SDK's ``load_project_skills``
    (``CLAUDE.md`` / ``.cursorrules`` / ``AGENTS.md`` / ``GEMINI.md`` / ``.agents/skills``) PLUS the
    modern ``.cursor/rules/*.mdc`` files it does NOT read (the C7.B glue)."""
    from openhands.sdk.skills import load_project_skills

    resolved = list(load_project_skills(workspace_dir))
    resolved.extend(_load_cursor_rules(workspace_dir))
    return resolved


def _load_cursor_rules(workspace_dir: str) -> list:
    """The glue: read ``<workspace>/.cursor/rules/*.mdc`` (markdown-with-frontmatter) — the modern
    Cursor rules format the SDK's ``load_project_skills`` skips (it reads only legacy
    ``.cursorrules``). Each file becomes a Skill; ``alwaysApply: true`` → always active, else an
    agent-invokable reference."""
    from openhands.sdk.skills import Skill

    out: list = []
    for path in sorted(glob.glob(os.path.join(workspace_dir, ".cursor", "rules", "*.mdc"))):
        try:
            with open(path, encoding="utf-8") as fh:
                raw = fh.read()
        except OSError:
            continue
        name, content, always = _parse_mdc(raw, os.path.splitext(os.path.basename(path))[0])
        out.append(
            Skill(
                name=name,
                content=content,
                source=path,
                trigger=None,
                is_agentskills_format=not always,
            )
        )
    return out


def _parse_mdc(raw: str, default_name: str) -> tuple[str, str, bool]:
    """Minimal, dependency-free parse of a ``.mdc`` rule file's optional YAML-ish frontmatter.

    Returns ``(name, body, always_apply)``. Reads only the two keys the resolver needs (``name``,
    ``alwaysApply``); the body is everything after the frontmatter fence (or the whole file)."""
    name, body, always = default_name, raw, False
    stripped = raw.lstrip()
    if stripped.startswith("---"):
        rest = stripped[3:]
        end = rest.find("\n---")
        if end != -1:
            frontmatter = rest[:end]
            body = rest[end + 4 :].lstrip("\n")
            for line in frontmatter.splitlines():
                key, sep, val = line.partition(":")
                if not sep:
                    continue
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key == "name" and val:
                    name = val
                elif key == "alwaysApply" and val.lower() in ("true", "yes", "1"):
                    always = True
    return name, body, always


# =================================================================================================
# Thinker-bridge rendering (no tool loop → decide inclusion + prepend content directly)
# =================================================================================================


def _should_prepend_for_thinker(skill, base_prompt: str) -> bool:
    """A thinker has no progressive disclosure. ``always`` (trigger=None) and ``agent`` (also
    trigger=None, degraded to a reference) are prepended unconditionally; a triggered skill is
    prepended only when one of its trigger words appears in the prompt (case-insensitive)."""
    trigger = getattr(skill, "trigger", None)
    if trigger is None:
        return True
    words = getattr(trigger, "keywords", None) or getattr(trigger, "triggers", None) or []
    low = base_prompt.lower()
    return any(str(w).lower() in low for w in words)


def _render_thinker_prompt(blocks: list[str], base_prompt: str) -> str:
    """Prepend the selected skill contents (in resolver order) to the thinker's base prompt."""
    prefix = "\n\n".join(blocks)
    return f"{prefix}\n\n{base_prompt}"


# =================================================================================================
# Small helpers
# =================================================================================================


def _source_label(source, idx: int) -> str:
    """A human label for a source in a warning (name → url → type → positional)."""
    if isinstance(source, dict):
        return str(source.get("name") or source.get("url") or source.get("type") or f"skill[{idx}]")
    return f"skill[{idx}]"


def _reason(exc: Exception) -> str:
    return str(exc) or type(exc).__name__
