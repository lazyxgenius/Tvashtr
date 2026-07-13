"""M-ctx1 — the pure node-context compiler (deep-dive C2/C3/C4).

Extracted from ``control_plane/team_run.py``'s worker-node instruction assembly (the
``context = f"\\n\\n--- ORIGINAL IDEA ---\\n{idea}…"`` block through ``instruction = node_prompt +
context``): turns a worker node's inputs (its prompt + the run's idea/spec/revision/grounding) into
(a) an ordered list of **typed parts** — each ``{name, text, tokens}`` — and (b) the assembled
``instruction`` the ``AgentTask`` carries. On the small path the ``instruction`` is **byte-for-byte
identical** to the pre-refactor assembly (pinned by a golden-string test).

**Pure**: no DBOS, no DB, no network, **no filesystem** — deterministic given its inputs, so it is
unit-testable in isolation and stays inside ``team_run``'s openhands-free-at-import boundary (it
imports only the two plain string builders ``WORKER_PROTOCOL`` / ``worker_focus_directive`` from
``worktree``, which are stdlib-only, plus the ``Settings`` type for the resolvers). The behaviours
it adds over the moved assembly:

* **C2 input budget** — every part is token-measured; the caller (the executor) compares
  :attr:`CompiledContext.total_tokens` to the per-node budget and, on a breach
  (:attr:`CompiledContext.over_budget`), fails the node **pre-call** naming
  :attr:`CompiledContext.fattest` (the biggest part). The budget is measured over the **FULL inline
  content** — the true size the run wants to send — so the breach reason names the real fat part;
  the C4 handle below is a cache optimisation applied ONLY when the content is UNDER budget (a
  huge spec would otherwise be offloaded and never breach, and the breach could never name
  ``spec``).
* **C4 documents-as-handle** — when the ``spec`` part alone exceeds
  :data:`_SPEC_HANDLE_TOKEN_THRESHOLD` (~1500 tok) AND the whole context is under budget, the spec
  is offloaded: :attr:`CompiledContext.spec_doc` carries the full spec text for the caller to write
  to ``<workspace>/SPEC.md``, the inline spec is replaced by a one-line pointer, and the instruction
  is reordered **static-first** (stable prompt/protocol before the volatile idea/spec-pointer/
  revision) so a provider prefix-cache hits across loop iterations. At or below the threshold the
  spec stays **INLINE in the ORIGINAL order** — byte-identical to today.

**Token measure**: a documented ``len(text)//4`` heuristic (:func:`estimate_tokens`). No real
per-model tokenizer ships in the deps (the agent models are NIM/Llama, not tiktoken-covered) and
pulling one in would add import weight + provider coupling to a module that must stay pure and
light; the budget is a coarse safety ceiling, so the heuristic is sufficient and intentional.
"""

from dataclasses import dataclass

from tvashtr.config import Settings
from tvashtr.control_plane.worktree import WORKER_PROTOCOL, worker_focus_directive

# C4: the spec-as-handle trigger (estimated tokens). Above it the spec is written to SPEC.md and
# replaced inline by a pointer + the instruction is reordered static-first; at/below it the spec
# stays inline in the original order (byte-identical to the pre-refactor instruction). ~1500 tokens
# ≈ 6 KB — a mini-PRD stays inline; a grown spec is offloaded so it neither bloats every loop
# iteration's prompt nor busts the provider prefix cache.
_SPEC_HANDLE_TOKEN_THRESHOLD = 1500

# The file the offloaded spec is written to (relative to the agent workspace), shared with the
# executor (which does the actual write + the ship-exclusion), and the one-line inline pointer that
# replaces the spec body when the handle fires. One module constant so executor + tests agree.
SPEC_HANDLE_FILENAME = "SPEC.md"
_SPEC_POINTER = (
    f"The full current spec is in ./{SPEC_HANDLE_FILENAME} — read that file before you start."
)

# M-memory S4: the agent-remember capture file (relative to the agent workspace), shared with the
# executor (which reads it at run-end + ship-excludes it) + tests. A TOP-LEVEL NON-HIDDEN sidecar
# (like SPEC.md / REPORT.md / REVIEW_VERDICT.json) DELIBERATELY: the docker greenfield
# container->host pull enumerates ``find . -type f -not -path '*/.*'``, which DROPS every hidden
# (dot) path — so a
# ``.tvashtr/`` capture would never reach the host in the DEFAULT (docker) + greenfield config. A
# non-hidden top-level file is pulled in every sandbox mode, then excluded from the diff + the ship
# commit (so the user's reviewed output stays clean). One module constant so all references agree.
REMEMBER_FILENAME = "TVASHTR_REMEMBER.jsonl"

# Part names, in their ORIGINAL (pre-refactor, byte-identical) assembly order.
_PART_NODE_PROMPT = "node_prompt"
_PART_IDEA = "idea"
_PART_SPEC = "spec"
_PART_REVISION = "revision"
_PART_GROUNDING = "grounding"
_PART_WORKER_PROTOCOL = "worker_protocol"
_PART_WORKER_FOCUS = "worker_focus"
# M-memory S3: the injected-memory part (the node's remembered facts). NOT part of the original
# assembly — inserted right after ``node_prompt`` (standing lessons first) ONLY when memory
# is present; absent by default so today's compiled instruction + manifest stay byte-identical.
_PART_MEMORY = "memory"
# M-unify U1 (D2.5): the report-only capability note — appended ONLY for an edits-OFF node. Its body
# is the brief's verbatim-close text; a ``--- REPORT-ONLY NODE ---`` header delimits it like every
# other typed part (each carries its own leading separator/header). The "do NOT build or implement"
# clarification of "report-only" was added after a live observation that an entry agent, given a
# build-shaped idea, implements the FEATURE (e.g. greeting.txt) instead of writing its report to
# REPORT.md — a faithful elaboration of "report-only", not a rewrite.
_PART_CAPABILITY_NOTE = "capability_note"
_CAPABILITY_NOTE_BODY = (
    "File changes you make in this run are not applied anywhere — this node is report-only: do NOT "
    "build or implement the feature, and create no code/feature files. Write your complete "
    "deliverable — a written report — to REPORT.md at the workspace root. Do not attempt "
    "workarounds to apply file changes."
)


def _capability_note_text() -> str:
    """The edits-off capability note part text (header + verbatim body). A module fn so the executor
    + tests reference the SAME string when asserting 'the note is present iff edits-off'."""
    return f"\n\n--- REPORT-ONLY NODE ---\n{_CAPABILITY_NOTE_BODY}"


# M-memory S4: the agent-remember capture protocol — a trailing part telling an edits-on worker how
# to deliberately record a durable, reusable lesson for a FUTURE run (append a JSON line to the
# ``TVASHTR_REMEMBER.jsonl`` sidecar via its file editor). GATED + default OFF (``remember_enabled``
# False), so every existing compile stays byte-identical; the executor turns it on only when the
# owner enabled the feature AND the node can write files (an edits-on worker). The control plane
# reads the file at run-end and routes each line through Consolidate (``memory_review``).
_PART_REMEMBER_PROTOCOL = "remember_protocol"
_REMEMBER_PROTOCOL_BODY = (
    "If during this run you learn a DURABLE, reusable lesson about this repository, "
    "this task, or how "
    "to work effectively here that a FUTURE run should remember, record it: "
    "using your file editor, "
    f"APPEND one JSON object per line to the file `{REMEMBER_FILENAME}` at the workspace root. "
    "Each line must be: "
    '{"content": "<a short, self-contained imperative lesson>", "polarity": "<one of: require, '
    'prefer, allow, context, avoid, forbid — default context>"}. Record only a few of your '
    "highest-value lessons, not routine narration. This file is PRIVATE: it never ships and is not "
    "part of your deliverable."
)


def _remember_protocol_text() -> str:
    """The agent-remember capture-protocol part text (header + verbatim body). A module fn so the
    executor + tests reference the SAME string."""
    return f"\n\n--- REMEMBERING LESSONS FOR FUTURE RUNS ---\n{_REMEMBER_PROTOCOL_BODY}"


# M-memory S3 — the injected-memory part's rendering. The node's remembered facts (S1 substrate,
# retrieved by ``control_plane.memory_retrieval``) are grouped BY POLARITY into CAPS force-sections:
# an agent reads a MUST NOT list very differently from a neutral fact — that force framing is
# the whole point of the S1b polarity taxonomy. Only non-empty sections render, in a fixed force
# order; each fact becomes a ``- {content}`` bullet under its polarity's header.
_MEMORY_PREAMBLE = "You have learned these lessons in earlier runs on this work — honor them:"
# (``NodeMemory.polarity`` value → CAPS force-header) in render order: MUST → MUST NOT → SHOULD →
# SHOULD NOT → MAY → CONTEXT. The RFC-2119 force mapping is fixed in ``control_plane.memory``.
_MEMORY_FORCE_ORDER: tuple[tuple[str, str], ...] = (
    ("require", "MUST"),
    ("forbid", "MUST NOT"),
    ("prefer", "SHOULD"),
    ("avoid", "SHOULD NOT"),
    ("allow", "MAY"),
    ("context", "CONTEXT"),
)


def _render_memory(facts: list[dict]) -> str:
    """Render the injected memory facts into the memory part's text: a one-line preamble + the facts
    grouped into CAPS force-sections (only non-empty, in :data:`_MEMORY_FORCE_ORDER`), each fact a
    ``- {content}`` bullet under its polarity's header. Carries the leading ``--- REMEMBERED LESSONS
    ---`` separator/header so it concatenates into the instruction like every other typed part.
    Called only with a non-empty ``facts`` (compile_context skips the part when memory is empty)."""
    by_polarity: dict[str, list[str]] = {}
    for fact in facts:
        by_polarity.setdefault(fact["polarity"], []).append(fact["content"])
    blocks: list[str] = []
    for polarity, header in _MEMORY_FORCE_ORDER:
        items = by_polarity.get(polarity)
        if items:
            body = "\n".join(f"- {content}" for content in items)
            blocks.append(f"{header}:\n{body}")
    return f"\n\n--- REMEMBERED LESSONS ---\n{_MEMORY_PREAMBLE}\n\n" + "\n\n".join(blocks)


# C4 static-first partition (large-spec handle path only): the STABLE parts (fixed across every loop
# iteration of a run — the node prompt, the once-computed grounding, the constant worker protocol /
# focus) lead so a provider prefix-cache hits; the VOLATILE parts trail — the per-round ``revision``
# is the only truly per-iteration-changing block (the spec pointer text is constant), and ``idea``
# is grouped with them per the C4 spec. The small path keeps the original order untouched.
_STATIC_FIRST_NAMES = (
    _PART_NODE_PROMPT,
    # M-memory S3: remembered lessons are stable across a node's rework rounds (the query =
    # idea + node prompt + PRD title, none of which change per round) → group with the static prefix
    # so the provider prefix-cache still hits on the large-spec handle path. MUST be listed here or
    # ``_static_first`` KeyErrors when a big-spec node also carries a memory part.
    _PART_MEMORY,
    _PART_GROUNDING,
    _PART_WORKER_PROTOCOL,
    _PART_WORKER_FOCUS,
    _PART_IDEA,
    _PART_SPEC,
    _PART_REVISION,
    # M-unify U1: the edits-off capability note trails (edits-on nodes never reach the handle path
    # with a note — they have none). Present in the order so ``_static_first`` never KeyErrors when
    # a
    # report-only node with a large spec offloads.
    _PART_CAPABILITY_NOTE,
    # M-memory S4: the agent-remember capture protocol trails too (an edits-on worker with the
    # feature on + a large spec offloads through the handle path) — registered so ``_static_first``
    # never KeyErrors on it.
    _PART_REMEMBER_PROTOCOL,
)


def estimate_tokens(text: str) -> int:
    """Documented ``len(text)//4`` token estimate (see the module docstring for why a heuristic and
    not a real tokenizer). ~4 chars/token is the standard rough English/code ratio. Deterministic
    and dependency-free, so :func:`compile_context` stays pure + fast."""
    return len(text) // 4


@dataclass(frozen=True)
class ContextPart:
    """One typed slice of a worker node's compiled context: a stable ``name`` (``"idea"`` /
    ``"spec"`` / …), its exact ``text`` (INCLUDING the leading separator/header, so the parts
    concatenate back to the inline instruction), and its estimated ``tokens``."""

    name: str
    text: str
    tokens: int


@dataclass(frozen=True)
class CompiledContext:
    """The result of :func:`compile_context`.

    ``parts`` — the canonical typed parts over the FULL inline content, in the ORIGINAL order
    (``"".join(p.text for p in parts)`` is the inline assembly; the small-path ``instruction``
    equals it). ``instruction`` — the ACTUAL assembled instruction: inline in the original order on
    the small / over-budget path, or pointer + static-first when :attr:`handle_used`.
    ``total_tokens`` / ``fattest`` — measured over the FULL parts (what the budget is checked
    against + the part the breach names). ``budget`` — the per-node input budget. ``over_budget`` —
    the pre-call breach flag the executor acts on. ``handle_used`` — was the spec offloaded to
    SPEC.md + the instruction reordered? — and ``spec_doc`` — the full spec text to write to
    ``<workspace>/SPEC.md`` (``None`` when inline).
    """

    parts: list[ContextPart]
    instruction: str
    total_tokens: int
    budget: int
    over_budget: bool
    fattest: ContextPart
    handle_used: bool
    spec_doc: str | None
    # M-memory S3: the injected memory facts ({id, polarity, content}) — carried so :meth:`manifest`
    # can record which memories this node remembered. ``None`` when no memory was injected (the
    # inert-when-empty path), keeping the manifest byte-identical to the pre-S3 shape.
    memory: list[dict] | None = None

    def manifest(self) -> dict:
        """The ``context_manifest`` JSONB persisted per worker invocation (migration ``0019``):
        ``{parts: [{name, tokens}], total_tokens, budget, handle_used}`` — the FULL-content sizes
        (so a reader sees the true spec size even when :attr:`handle_used` offloaded it to a file).
        M-memory S3: when memory was injected, a ``memory: [{id, polarity}]`` key records the
        injected ids (the memory part already joins ``parts`` as ``{name: "memory"}``) so S5 can
        show 'what this node remembered'. Absent when no memory → byte-identical to the pre-S3
        manifest."""
        manifest = {
            "parts": [{"name": p.name, "tokens": p.tokens} for p in self.parts],
            "total_tokens": self.total_tokens,
            "budget": self.budget,
            "handle_used": self.handle_used,
        }
        if self.memory:
            manifest["memory"] = [{"id": f["id"], "polarity": f["polarity"]} for f in self.memory]
        return manifest


def _part(name: str, text: str) -> ContextPart:
    return ContextPart(name=name, text=text, tokens=estimate_tokens(text))


def _revision_text(iteration: int, reviewer_feedback: str) -> str:
    """The rework revision block — byte-identical to the pre-refactor inline literal (the Reviewer's
    requested changes + a revise-in-place directive), appended only on a rework round."""
    return (
        f"\n\n--- REVISION REQUESTED (round {iteration}) ---\n"
        "The Reviewer reviewed your previous attempt and requested these changes:\n"
        f"{reviewer_feedback}\n"
        "Your prior work is in your current working directory — revise it IN PLACE to "
        "address this feedback. Do not start over and do not delete unrelated files."
    )


def _static_first(parts: list[ContextPart]) -> list[ContextPart]:
    """Reorder present parts into :data:`_STATIC_FIRST_NAMES` order (each name appears at most
    once),
    stable-first for prefix-cache friendliness."""
    order = {name: i for i, name in enumerate(_STATIC_FIRST_NAMES)}
    return sorted(parts, key=lambda p: order[p.name])


def compile_context(
    *,
    node_prompt: str,
    idea: str,
    spec: str | None,
    iteration: int,
    reviewer_feedback: str | None,
    grounding: str | None,
    emits_outcome: bool,
    subpath: str | None,
    budget: int,
    edits_allowed: bool = True,
    memory: list[dict] | None = None,
    remember_enabled: bool = False,
    handle_threshold: int = _SPEC_HANDLE_TOKEN_THRESHOLD,
) -> CompiledContext:
    """Compile one node's typed context parts + assembled instruction (pure; see the module
    docstring). Preserves the EXACT pre-refactor conditional logic:

    * ``node_prompt`` + ``idea`` are always present; ``spec`` (the live PRD) is present when
    non-None
      — the ONLY None case is the ENTRY node's FIRST invocation, which has no spec yet (it CREATES
      it), so its part is omitted; every worker caller passes a real spec (byte-identical);
    * ``revision`` only on a rework round (``iteration > 1 and reviewer_feedback``);
    * ``grounding`` only for a brownfield run (``grounding`` truthy);
    * ``worker_protocol`` only for a brownfield WORKER (``grounding and not emits_outcome``);
    * ``worker_focus`` only for a brownfield worker on a sub-path scope (…``and subpath``).

    M-unify U1 (D2.5): ``edits_allowed=False`` appends ONE trailing ``capability_note`` part (the
    report-only instruction). ``edits_allowed`` defaults True (an edits-ON worker), so the worker
    compiled instruction + manifest are byte-identical to before — the golden test + every worker
    fixture never pass this arg and never see a note.

    The budget is checked over the FULL inline content; the C4 handle offloads a large spec only
    when under budget (see the module docstring). ``budget`` is the resolved per-node input budget
    (:func:`resolve_context_budget`)."""
    # 1. Build the FULL inline typed parts, in the ORIGINAL order, byte-identical to today's
    #    assembly: node_prompt + idea [+ spec] [+ revision] [+ grounding [+ protocol [+ focus]]].
    parts: list[ContextPart] = [_part(_PART_NODE_PROMPT, node_prompt)]
    # M-memory S3: the node's remembered facts, folded in right after its identity prompt (standing
    # lessons before the specific task). ONLY when non-empty — an empty/None ``memory`` appends NO
    # part, so the compiled instruction + manifest stay byte-for-byte today's output (the
    # inert-when-empty invariant). Budget-accounted like every other part (a memory-part overflow
    # names ``memory`` as the fattest).
    if memory:
        parts.append(_part(_PART_MEMORY, _render_memory(memory)))
    parts.append(_part(_PART_IDEA, f"\n\n--- ORIGINAL IDEA ---\n{idea}"))
    if spec is not None:
        parts.append(_part(_PART_SPEC, f"\n\n--- PRD ---\n{spec}"))
    if iteration > 1 and reviewer_feedback:
        parts.append(_part(_PART_REVISION, _revision_text(iteration, reviewer_feedback)))
    if grounding:
        parts.append(_part(_PART_GROUNDING, f"\n\n{grounding}"))
        if not emits_outcome:
            parts.append(_part(_PART_WORKER_PROTOCOL, f"\n\n{WORKER_PROTOCOL}"))
            if subpath:
                parts.append(_part(_PART_WORKER_FOCUS, f"\n\n{worker_focus_directive(subpath)}"))
    # M-unify U1 (D2.5): a report-only (edits-off) node gets ONE trailing part telling it its file
    # changes are not applied and to write its deliverable to REPORT.md. Edits-ON nodes get NO new
    # part (default), so their instruction + manifest stay byte-identical.
    if not edits_allowed:
        parts.append(_part(_PART_CAPABILITY_NOTE, _capability_note_text()))
    # M-memory S4: an edits-on worker with the agent-remember feature ON gets ONE trailing part
    # telling it how to record a durable lesson (append to ``TVASHTR_REMEMBER.jsonl``). Default OFF
    # ⇒ NO new part ⇒ byte-identical to today's compiled instruction + manifest.
    if remember_enabled:
        parts.append(_part(_PART_REMEMBER_PROTOCOL, _remember_protocol_text()))

    total_tokens = sum(p.tokens for p in parts)
    fattest = max(parts, key=lambda p: p.tokens)
    over_budget = total_tokens > budget

    # 2. Budget is over the FULL inline content (above). Only when UNDER budget do we apply the C4
    #    handle (a layout optimisation). Over budget ⇒ the caller fails pre-call naming ``fattest``;
    #    the instruction stays inline (it is never sent). Under budget + big spec ⇒ offload +
    #    reorder. The entry's first invocation has no spec part ⇒ ``spec_part`` None ⇒ handle never
    #    fires (nothing to offload).
    handle_used = False
    spec_doc: str | None = None
    spec_part = next((p for p in parts if p.name == _PART_SPEC), None)
    if spec_part is not None and not over_budget and spec_part.tokens > handle_threshold:
        handle_used = True
        spec_doc = spec  # the full spec text -> <workspace>/SPEC.md (the caller does the write)
        # Replace the inline spec with a one-line pointer (same "--- PRD ---" header) and reorder
        # STATIC-FIRST so the provider prefix-cache hits across loop iterations.
        pointer = _part(_PART_SPEC, f"\n\n--- PRD ---\n{_SPEC_POINTER}")
        instruction_parts = _static_first([pointer if p.name == _PART_SPEC else p for p in parts])
        instruction = "".join(p.text for p in instruction_parts)
    else:
        instruction = "".join(p.text for p in parts)  # inline, ORIGINAL order (byte-identical)

    return CompiledContext(
        parts=parts,
        instruction=instruction,
        total_tokens=total_tokens,
        budget=budget,
        over_budget=over_budget,
        fattest=fattest,
        handle_used=handle_used,
        spec_doc=spec_doc,
        # M-memory S3: empty list → None ⇒ manifest omits the ``memory`` key (inert-when-empty).
        memory=(memory or None),
    )


# ---- Per-node model-policy resolver (setting default + optional per-node override) ---------------
# The override lives in the node's EXISTING ``config`` JSONB under a ``model_config`` sub-object
# (``agent_nodes.config`` — additive, NO migration), e.g.
# ``{"model_config": {"worker_context_token_budget": 60000}}``. Pure + importable so it is
# unit-tested directly and the executor sources the effective value from it (policy resolved in the
# workflow body, mechanism — the budget check — applied in the step).


def _node_model_config(node_config: dict | None) -> dict:
    """The per-node model-override JSON: the ``model_config`` sub-object of a node's ``config``
    JSONB. ``None`` / absent / non-dict ⇒ ``{}`` (no override → the Settings default wins)."""
    if not node_config:
        return {}
    mc = node_config.get("model_config")
    return mc if isinstance(mc, dict) else {}


def _positive_int_override(value: object) -> int | None:
    """A per-node override is honored only when it is a genuine positive int (``bool`` is a subclass
    of ``int`` — exclude it, so a stray ``true`` never reads as ``1``)."""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value > 0 else None


def resolve_context_budget(settings: Settings, node_config: dict | None) -> int:
    """C2: the per-worker-node INPUT budget — the per-node override
    (``config.model_config.worker_context_token_budget``, a positive int) when set, else the
    ``settings.worker_context_token_budget`` default."""
    override = _positive_int_override(
        _node_model_config(node_config).get("worker_context_token_budget")
    )
    return override if override is not None else settings.worker_context_token_budget
