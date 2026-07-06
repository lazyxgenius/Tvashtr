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
* ``{"type": "repo", "url", "ref", "filter"?}`` — a GitHub repo cloned at the PINNED ref
* ``{"type": "project_rules"}`` — adopt the run's own workspace rules (``CLAUDE.md`` etc. + the
  modern ``.cursor/rules/*.mdc`` files the SDK's ``load_project_skills`` does NOT read)

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
    contributes nothing (there is no workspace to adopt)."""
    resolved: list = []
    if not skills:
        return resolved
    for idx, source in enumerate(skills):
        label = _source_label(source, idx)
        try:
            if not isinstance(source, dict):
                raise ValueError("skill source must be an object")
            stype = source.get("type")
            if stype == "inline":
                resolved.append(_resolve_inline(source))
            elif stype == "repo":
                resolved.extend(_resolve_repo(source))
            elif stype == "project_rules":
                if workspace_dir:
                    resolved.extend(_resolve_project_rules(workspace_dir))
                # else: no workspace (a thinker) → project_rules yields nothing (expected, no warn)
            else:
                raise ValueError(f"unknown skill source type: {stype!r}")
        except Exception as exc:  # noqa: BLE001 — one bad source must never sink the run
            _emit_skill_warning(run_id, label, _reason(exc))
    return resolved


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


def _resolve_repo(source: dict) -> list:
    """repo → clone at the PINNED ref via the SDK loader, then apply ``filter``. Subsumes
    marketplaces (a marketplace is a repo + manifest). ``load_public_skills`` never raises — it
    returns ``[]`` on any failure — so an empty result is treated as a resolution failure."""
    from openhands.sdk.skills import load_public_skills

    url = source.get("url")
    ref = source.get("ref")
    if not url:
        raise ValueError("repo skill needs a url")
    if not ref:
        raise ValueError("repo skill needs a ref (pins reproducibility)")
    # marketplace_path=None → load ALL skills in the repo's skills/ dir (no manifest required).
    loaded = load_public_skills(repo_url=str(url), ref=str(ref), marketplace_path=None)
    filt = source.get("filter")
    if filt:
        loaded = [s for s in loaded if fnmatch.fnmatch(s.name, str(filt))]
    if not loaded:
        raise ValueError(f"repo produced no skills (url={url!r}, ref={ref!r}, filter={filt!r})")
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
