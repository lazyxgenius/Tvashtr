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

# Part names, in their ORIGINAL (pre-refactor, byte-identical) assembly order.
_PART_NODE_PROMPT = "node_prompt"
_PART_IDEA = "idea"
_PART_SPEC = "spec"
_PART_REVISION = "revision"
_PART_GROUNDING = "grounding"
_PART_WORKER_PROTOCOL = "worker_protocol"
_PART_WORKER_FOCUS = "worker_focus"

# C4 static-first partition (large-spec handle path only): the STABLE parts (fixed across every loop
# iteration of a run — the node prompt, the once-computed grounding, the constant worker protocol /
# focus) lead so a provider prefix-cache hits; the VOLATILE parts trail — the per-round ``revision``
# is the only truly per-iteration-changing block (the spec pointer text is constant), and ``idea``
# is grouped with them per the C4 spec. The small path keeps the original order untouched.
_STATIC_FIRST_NAMES = (
    _PART_NODE_PROMPT,
    _PART_GROUNDING,
    _PART_WORKER_PROTOCOL,
    _PART_WORKER_FOCUS,
    _PART_IDEA,
    _PART_SPEC,
    _PART_REVISION,
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

    def manifest(self) -> dict:
        """The ``context_manifest`` JSONB persisted per worker invocation (migration ``0019``):
        ``{parts: [{name, tokens}], total_tokens, budget, handle_used}`` — the FULL-content sizes
        (so a reader sees the true spec size even when :attr:`handle_used` offloaded it to a
        file)."""
        return {
            "parts": [{"name": p.name, "tokens": p.tokens} for p in self.parts],
            "total_tokens": self.total_tokens,
            "budget": self.budget,
            "handle_used": self.handle_used,
        }


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
    spec: str,
    iteration: int,
    reviewer_feedback: str | None,
    grounding: str | None,
    emits_outcome: bool,
    subpath: str | None,
    budget: int,
    handle_threshold: int = _SPEC_HANDLE_TOKEN_THRESHOLD,
) -> CompiledContext:
    """Compile one worker node's typed context parts + assembled instruction (pure; see the module
    docstring). Preserves the EXACT pre-refactor conditional logic:

    * ``node_prompt`` + ``idea`` + ``spec`` (the live PRD) are always present;
    * ``revision`` only on a rework round (``iteration > 1 and reviewer_feedback``);
    * ``grounding`` only for a brownfield run (``grounding`` truthy);
    * ``worker_protocol`` only for a brownfield WORKER (``grounding and not emits_outcome``);
    * ``worker_focus`` only for a brownfield worker on a sub-path scope (…``and subpath``).

    The budget is checked over the FULL inline content; the C4 handle offloads a large spec only
    when under budget (see the module docstring). ``budget`` is the resolved per-node input budget
    (:func:`resolve_context_budget`)."""
    # 1. Build the FULL inline typed parts, in the ORIGINAL order, byte-identical to today's
    #    assembly: node_prompt + idea + spec [+ revision] [+ grounding [+ protocol [+ focus]]].
    parts: list[ContextPart] = [
        _part(_PART_NODE_PROMPT, node_prompt),
        _part(_PART_IDEA, f"\n\n--- ORIGINAL IDEA ---\n{idea}"),
        _part(_PART_SPEC, f"\n\n--- PRD ---\n{spec}"),
    ]
    if iteration > 1 and reviewer_feedback:
        parts.append(_part(_PART_REVISION, _revision_text(iteration, reviewer_feedback)))
    if grounding:
        parts.append(_part(_PART_GROUNDING, f"\n\n{grounding}"))
        if not emits_outcome:
            parts.append(_part(_PART_WORKER_PROTOCOL, f"\n\n{WORKER_PROTOCOL}"))
            if subpath:
                parts.append(_part(_PART_WORKER_FOCUS, f"\n\n{worker_focus_directive(subpath)}"))

    total_tokens = sum(p.tokens for p in parts)
    fattest = max(parts, key=lambda p: p.tokens)
    over_budget = total_tokens > budget

    # 2. Budget is over the FULL inline content (above). Only when UNDER budget do we apply the C4
    #    handle (a layout optimisation). Over budget ⇒ the caller fails pre-call naming ``fattest``;
    #    the instruction stays inline (it is never sent). Under budget + big spec ⇒ offload +
    #    reorder.
    handle_used = False
    spec_doc: str | None = None
    spec_part = next(p for p in parts if p.name == _PART_SPEC)
    if not over_budget and spec_part.tokens > handle_threshold:
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
    )


# ---- Per-node model-policy resolvers (setting default + optional per-node override) --------------
# The override lives in the node's EXISTING ``config`` JSONB under a ``model_config`` sub-object
# (``agent_nodes.config`` — additive, NO migration), e.g. ``{"model_config": {"thinker_max_output_
# tokens": 4096, "worker_context_token_budget": 60000}}``. Pure + importable so they are unit-tested
# directly and the executor sources the effective values from them (policy resolved in the workflow
# body, mechanism — the CompletionRequest / the budget check — applied in the step).


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


def resolve_thinker_max_tokens(settings: Settings, node_config: dict | None) -> int:
    """C3: the thinker OUTPUT ceiling for one completion node — the per-node override
    (``config.model_config.thinker_max_output_tokens``, a positive int) when set, else the
    ``settings.thinker_max_output_tokens`` default. The executor passes the result as
    ``CompletionRequest.max_tokens`` for ``pm_step`` / ``thinker_refine_step`` (no longer the
    hardcoded 400)."""
    override = _positive_int_override(
        _node_model_config(node_config).get("thinker_max_output_tokens")
    )
    return override if override is not None else settings.thinker_max_output_tokens


def resolve_context_budget(settings: Settings, node_config: dict | None) -> int:
    """C2: the per-worker-node INPUT budget — the per-node override
    (``config.model_config.worker_context_token_budget``, a positive int) when set, else the
    ``settings.worker_context_token_budget`` default. Mirrors :func:`resolve_thinker_max_tokens`."""
    override = _positive_int_override(
        _node_model_config(node_config).get("worker_context_token_budget")
    )
    return override if override is not None else settings.worker_context_token_budget
