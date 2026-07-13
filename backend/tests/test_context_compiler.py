"""M-ctx1 — pure unit tests for the node context compiler (C2/C4) + the per-node model resolvers.

These drive :func:`tvashtr.control_plane.context_compiler.compile_context` directly (no DBOS, no
DB):
the typed parts + token counts for greenfield / rework / brownfield inputs, the byte-equivalence
golden string (the small-greenfield instruction pinned against the pre-refactor literal), the C2
input-budget breach detection (over-budget names the fattest part; the C4 handle is applied only
when
under budget), and the C4 documents-as-handle (above-threshold spec → SPEC.md content + a pointer +
static-first order; below-threshold → inline in the ORIGINAL order). The executor-level proofs (the
run actually FAILS on a breach, ``max_tokens`` reaches ``CompletionRequest``, ``SPEC.md`` is written
then never shipped) live in ``test_context_budget_executor.py``.
"""

from tvashtr.config import Settings
from tvashtr.control_plane.context_compiler import (
    _SPEC_HANDLE_TOKEN_THRESHOLD,
    SPEC_HANDLE_FILENAME,
    compile_context,
    estimate_tokens,
    resolve_context_budget,
)
from tvashtr.control_plane.team_run import (
    _WORKSPACE_GITIGNORE,
    _remove_spec_handle,
    _write_spec_handle,
)
from tvashtr.control_plane.worktree import WORKER_PROTOCOL, worker_focus_directive

# A budget large enough to never bind in the layout tests (the breach tests set their own).
_BIG_BUDGET = 1_000_000


def _compile(**overrides):
    """compile_context with sane greenfield defaults; override per test."""
    kwargs = dict(
        node_prompt="You are the Engineer.",
        idea="Add a greeting.",
        spec="PRD: build greeting",
        iteration=1,
        reviewer_feedback=None,
        grounding=None,
        emits_outcome=False,
        subpath=None,
        budget=_BIG_BUDGET,
    )
    kwargs.update(overrides)
    return compile_context(**kwargs)


# ---- C2 typed parts + token counts: greenfield / rework / brownfield -----------------------------


def test_greenfield_typed_parts_and_tokens():
    c = _compile()
    assert [p.name for p in c.parts] == ["node_prompt", "idea", "spec"]
    # Each part's text carries its own separator/header, so they concatenate back to the
    # instruction.
    assert "".join(p.text for p in c.parts) == c.instruction
    assert c.parts[0].text == "You are the Engineer."
    assert c.parts[1].text == "\n\n--- ORIGINAL IDEA ---\nAdd a greeting."
    assert c.parts[2].text == "\n\n--- PRD ---\nPRD: build greeting"
    # Tokens are the documented len//4 heuristic — assert real, per-part values (mutation-real).
    assert [p.tokens for p in c.parts] == [estimate_tokens(p.text) for p in c.parts]
    assert c.total_tokens == sum(p.tokens for p in c.parts)
    assert c.handle_used is False and c.over_budget is False and c.spec_doc is None


def test_rework_round_adds_revision_part():
    c = _compile(iteration=2, reviewer_feedback="Handle the empty-name case.")
    assert [p.name for p in c.parts] == ["node_prompt", "idea", "spec", "revision"]
    rev = next(p for p in c.parts if p.name == "revision")
    assert rev.text.startswith("\n\n--- REVISION REQUESTED (round 2) ---\n")
    assert "Handle the empty-name case." in rev.text
    assert "revise it IN PLACE" in rev.text
    assert rev.tokens == estimate_tokens(rev.text)


# ---- M-memory S4: the agent-remember capture protocol part (gated, default OFF)
# -------------------


def test_remember_protocol_absent_by_default_is_byte_identical():
    """OFF (the default) ⇒ NO capture-protocol part; the compiled instruction is byte-identical to a
    pre-S4 compile (the inert-when-off invariant)."""
    baseline = _compile()
    off = _compile(remember_enabled=False)
    assert [p.name for p in off.parts] == [p.name for p in baseline.parts]
    assert off.instruction == baseline.instruction
    assert all(p.name != "remember_protocol" for p in off.parts)


def test_remember_protocol_present_when_enabled():
    c = _compile(remember_enabled=True)
    assert [p.name for p in c.parts][-1] == "remember_protocol"  # trailing part
    prot = next(p for p in c.parts if p.name == "remember_protocol")
    assert "TVASHTR_REMEMBER.jsonl" in prot.text  # the capture channel the agent writes
    assert "polarity" in prot.text  # tells the agent the optional polarity field
    assert prot.text in c.instruction  # folded into the compiled instruction


def test_remember_protocol_survives_static_first_on_large_spec():
    """A large-spec node (the C4 handle/static-first path) with the protocol ON must not KeyError in
    ``_static_first`` — the part is registered in the static-first order."""
    big_spec = "PRD: " + ("lorem ipsum " * (_SPEC_HANDLE_TOKEN_THRESHOLD // 2))
    c = _compile(spec=big_spec, remember_enabled=True)
    assert c.handle_used is True  # the spec offloaded
    assert any(p.name == "remember_protocol" for p in c.parts)  # and no exception was raised


def test_iteration_one_or_no_feedback_has_no_revision():
    # iteration==1 (even with feedback) and iteration>1 without feedback both omit the revision.
    assert all(p.name != "revision" for p in _compile(iteration=1, reviewer_feedback="x").parts)
    assert all(p.name != "revision" for p in _compile(iteration=3, reviewer_feedback=None).parts)


def test_brownfield_worker_parts_include_grounding_protocol_focus():
    grounding = "--- REPO GROUNDING (repo) ---\nfiles are present"
    c = _compile(grounding=grounding, emits_outcome=False, subpath="pkg")
    assert [p.name for p in c.parts] == [
        "node_prompt",
        "idea",
        "spec",
        "grounding",
        "worker_protocol",
        "worker_focus",
    ]
    assert c.parts[3].text == f"\n\n{grounding}"
    assert c.parts[4].text == f"\n\n{WORKER_PROTOCOL}"
    assert c.parts[5].text == f"\n\n{worker_focus_directive('pkg')}"
    # The action directives + the sub-path focus really are in the assembled instruction.
    assert "str_replace" in c.instruction and "--- FOCUS: pkg ---" in c.instruction


def test_brownfield_reviewer_gets_grounding_but_not_protocol_or_focus():
    grounding = "--- REPO GROUNDING (repo) ---\nfiles are present"
    c = _compile(grounding=grounding, emits_outcome=True, subpath="pkg")
    # A reviewer (emits_outcome) gets orientation only — never implement-the-change steps.
    assert [p.name for p in c.parts] == ["node_prompt", "idea", "spec", "grounding"]
    assert "str_replace" not in c.instruction and "--- FOCUS" not in c.instruction


def test_brownfield_worker_without_subpath_has_no_focus():
    grounding = "--- REPO GROUNDING (repo) ---\nx"
    c = _compile(grounding=grounding, emits_outcome=False, subpath=None)
    assert [p.name for p in c.parts] == [
        "node_prompt",
        "idea",
        "spec",
        "grounding",
        "worker_protocol",
    ]
    assert "--- FOCUS" not in c.instruction


# ---- Byte-equivalence: the small-greenfield instruction is byte-identical to the pre-refactor code


def test_small_greenfield_instruction_is_byte_identical_golden():
    """Pin the EXACT pre-refactor instruction literal (``node_prompt`` + the idea/PRD context) for a
    small greenfield case (tiny spec, iteration==1, no grounding). ``compile_context`` MUST
    reproduce
    it byte-for-byte — the whole point of the extraction."""
    node_prompt = "You are the Engineer. Build the feature."
    idea = "Add a greeting.txt that says hi."
    spec = "PRD: create greeting.txt containing 'hi'."
    # The golden literal, exactly as the old ``instruction = node_prompt + context`` produced it.
    golden = (
        "You are the Engineer. Build the feature."
        "\n\n--- ORIGINAL IDEA ---\nAdd a greeting.txt that says hi."
        "\n\n--- PRD ---\nPRD: create greeting.txt containing 'hi'."
    )
    c = compile_context(
        node_prompt=node_prompt,
        idea=idea,
        spec=spec,
        iteration=1,
        reviewer_feedback=None,
        grounding=None,
        emits_outcome=False,
        subpath=None,
        budget=_BIG_BUDGET,
    )
    assert c.instruction == golden
    assert c.handle_used is False  # small spec stays inline


# ---- C2 input-budget breach detection ------------------------------------------------------------


def test_over_budget_flags_breach_and_names_fattest_spec():
    """A spec far larger than the budget → ``over_budget`` with ``fattest`` = the spec part (the
    executor's reason NAMES it). The handle is NOT applied when over budget (so a huge spec is
    caught
    here rather than silently offloaded — which is what lets the breach reason name ``spec``)."""
    big_spec = "S" * 40_000  # 10_000 tok — dwarfs the prompt/idea
    c = _compile(spec=big_spec, budget=1_000)
    assert c.over_budget is True
    assert c.fattest.name == "spec"
    assert c.fattest.tokens == estimate_tokens("\n\n--- PRD ---\n" + big_spec)
    assert c.total_tokens > c.budget
    assert c.handle_used is False and c.spec_doc is None  # never offloaded while over budget
    # The full spec is still inline in the (never-sent) instruction — the breach fails pre-call.
    assert big_spec in c.instruction


def test_under_budget_is_not_flagged():
    c = _compile(spec="a small spec", budget=_BIG_BUDGET)
    assert c.over_budget is False


# ---- C4 documents-as-handle (bounded to the large-spec path) -------------------------------------


def test_c4_above_threshold_offloads_spec_to_handle_with_pointer_and_static_first():
    # A spec above the ~1500-tok handle threshold but comfortably UNDER budget.
    big_spec = "S" * (4 * (_SPEC_HANDLE_TOKEN_THRESHOLD + 500))  # > threshold tokens
    grounding = "--- REPO GROUNDING (repo) ---\norientation"
    c = _compile(spec=big_spec, grounding=grounding, emits_outcome=False, budget=_BIG_BUDGET)
    assert c.over_budget is False
    assert c.handle_used is True
    assert c.spec_doc == big_spec  # the full spec goes to <workspace>/SPEC.md
    # The inline spec body is replaced by a one-line pointer; the full text is NOT in the prompt.
    assert f"./{SPEC_HANDLE_FILENAME}" in c.instruction
    assert big_spec not in c.instruction
    # STATIC-FIRST: the stable node_prompt / worker_protocol precede the volatile idea /
    # spec-pointer.
    instr = c.instruction
    assert instr.startswith("You are the Engineer.")
    assert instr.index("HOW TO MAKE THE CHANGE") < instr.index("--- ORIGINAL IDEA ---")
    assert instr.index("--- ORIGINAL IDEA ---") < instr.index("--- PRD ---")
    # The manifest still records the TRUE spec size (not the pointer) + the offload flag.
    spec_tokens = next(p.tokens for p in c.parts if p.name == "spec")
    assert spec_tokens == estimate_tokens("\n\n--- PRD ---\n" + big_spec)
    assert c.manifest()["handle_used"] is True


def test_c4_below_threshold_stays_inline_in_original_order():
    # A spec at/below the threshold → inline, ORIGINAL order (byte-identical to today).
    small_spec = "S" * (4 * (_SPEC_HANDLE_TOKEN_THRESHOLD - 100))  # just under threshold tokens
    c = _compile(spec=small_spec, budget=_BIG_BUDGET)
    assert c.handle_used is False and c.spec_doc is None
    assert small_spec in c.instruction  # inline
    assert "".join(p.text for p in c.parts) == c.instruction  # original order, no reorder
    assert c.instruction.index("--- ORIGINAL IDEA ---") < c.instruction.index("--- PRD ---")


def test_manifest_shape_records_parts_total_budget_and_handle():
    c = _compile(spec="a spec", budget=99_999)
    m = c.manifest()
    assert m["parts"] == [{"name": p.name, "tokens": p.tokens} for p in c.parts]
    assert m["total_tokens"] == c.total_tokens
    assert m["budget"] == 99_999
    assert m["handle_used"] is False


# ---- C2 per-node resolver (setting default + optional per-node override) -------------------------


def test_resolve_context_budget_default_and_override():
    s = Settings(worker_context_token_budget=110_000)
    assert resolve_context_budget(s, None) == 110_000
    assert resolve_context_budget(s, {"model_config": {}}) == 110_000
    assert (
        resolve_context_budget(s, {"model_config": {"worker_context_token_budget": 60_000}})
        == 60_000
    )


def test_resolvers_ignore_non_positive_and_bool_overrides():
    s = Settings(worker_context_token_budget=110_000)
    # Zero / negative / bool / non-int are NOT valid overrides → the setting default stands.
    for bad in (0, -5, True, "4096", 3.5, None):
        assert (
            resolve_context_budget(s, {"model_config": {"worker_context_token_budget": bad}})
            == 110_000
        )
    # A non-dict model_config is ignored too.
    assert resolve_context_budget(s, {"model_config": "nope"}) == 110_000


# ---- C4 SPEC.md never ships: the gitignore belt + the write/remove suspenders --------------------


def test_workspace_gitignore_includes_spec_md():
    # Greenfield ship excludes SPEC.md via the workspace .gitignore (git add -A honors it).
    assert f"{SPEC_HANDLE_FILENAME}\n" in _WORKSPACE_GITIGNORE
    assert "REVIEW_VERDICT.json\n" in _WORKSPACE_GITIGNORE  # the existing sidecar still listed


def test_write_and_remove_spec_handle_roundtrip(tmp_path):
    ws = str(tmp_path)
    _write_spec_handle(ws, "the full spec body")
    assert (tmp_path / SPEC_HANDLE_FILENAME).read_text(encoding="utf-8") == "the full spec body"
    _remove_spec_handle(ws)
    assert not (tmp_path / SPEC_HANDLE_FILENAME).exists()
    # Idempotent: removing an absent handle is a no-op (never raises).
    _remove_spec_handle(ws)


# ---- M-memory S3: the injected-memory part (polarity-grouped CAPS force-sections) ----------------

# The 6 CAPS force-headers in their required render order (MUST → MUST NOT → SHOULD → SHOULD NOT →
# MAY → CONTEXT). Each maps from a NodeMemory.polarity value (require/forbid/prefer/avoid/allow/
# context). "MUST:" (with the colon) never substring-collides with "MUST NOT:".
_FORCE_HEADERS = ("MUST:", "MUST NOT:", "SHOULD:", "SHOULD NOT:", "MAY:", "CONTEXT:")


def _facts(*pairs):
    """[(polarity, content), …] → the retrieval fact-dict shape compile_context injects."""
    return [
        {"id": f"id-{i}", "polarity": pol, "content": txt} for i, (pol, txt) in enumerate(pairs)
    ]


def test_memory_none_or_empty_is_byte_identical_no_part_no_manifest_key():
    """The inert-when-empty invariant: memory None OR [] compiles byte-for-byte as today — no memory
    part, no ``memory`` manifest key. (Every existing caller passes no memory ⇒ this is what keeps
    the whole offline suite green.)"""
    base = _compile()  # today's output (no memory arg)
    for empty in (None, []):
        c = _compile(memory=empty)
        assert [p.name for p in c.parts] == ["node_prompt", "idea", "spec"]
        assert c.instruction == base.instruction  # byte-identical
        assert "memory" not in c.manifest()
        assert all(p["name"] != "memory" for p in c.manifest()["parts"])


def test_memory_part_inserted_after_node_prompt_and_concatenates():
    facts = _facts(("require", "Run the tests before you finish."))
    c = _compile(memory=facts)
    # Injected right after the node's identity prompt, before the idea (standing lessons first).
    assert [p.name for p in c.parts] == ["node_prompt", "memory", "idea", "spec"]
    # The part carries its own leading separator so parts still concatenate to the instruction.
    assert "".join(p.text for p in c.parts) == c.instruction
    mem = next(p for p in c.parts if p.name == "memory")
    assert mem.text.startswith("\n\n--- REMEMBERED LESSONS ---")
    assert mem.tokens == estimate_tokens(mem.text)
    assert "Run the tests before you finish." in c.instruction


def test_memory_renders_polarity_groups_as_caps_sections_in_required_order():
    # One fact per polarity, supplied OUT of render order to prove the render re-orders it.
    facts = _facts(
        ("context", "The repo ships with pytest."),
        ("allow", "You may add helper modules."),
        ("avoid", "Avoid global mutable state."),
        ("prefer", "Prefer small pure functions."),
        ("forbid", "Never edit production config."),
        ("require", "Always run black before committing."),
    )
    mem = next(p for p in _compile(memory=facts).parts if p.name == "memory").text
    # All six force-headers present…
    for h in _FORCE_HEADERS:
        assert h in mem, f"missing section header {h}"
    # …in exactly MUST → MUST NOT → SHOULD → SHOULD NOT → MAY → CONTEXT order.
    positions = [mem.index(h) for h in _FORCE_HEADERS]
    assert positions == sorted(positions)

    # Each fact renders as a bullet under EXACTLY its mapped force-header — ALL 6 bindings. A swap
    # polarity→header mapping keeps the header ORDER + presence but inverts the RFC-2119 force, so
    # bullet PLACEMENT (not mere presence) is what pins the taxonomy. ("SHOULD:" never substring-
    # collides with "SHOULD NOT:"; each header appears once.)
    def _section(header: str) -> str:
        body = mem[mem.index(header) + len(header) :]
        end = body.find("\n\n")  # up to the next blank-line-separated section
        return body if end == -1 else body[:end]

    assert "- Always run black before committing." in _section("MUST:")  # require
    assert "- Never edit production config." in _section("MUST NOT:")  # forbid
    assert "- Prefer small pure functions." in _section("SHOULD:")  # prefer
    assert "- Avoid global mutable state." in _section("SHOULD NOT:")  # avoid
    assert "- You may add helper modules." in _section("MAY:")  # allow
    assert "- The repo ships with pytest." in _section("CONTEXT:")  # context


def test_memory_only_nonempty_sections_are_emitted():
    facts = _facts(
        ("forbid", "No network in unit tests."),
        ("forbid", "No sleeps in tests."),
        ("context", "CI runs on Linux."),
    )
    mem = next(p for p in _compile(memory=facts).parts if p.name == "memory").text
    assert "MUST NOT:" in mem and "CONTEXT:" in mem
    # Absent polarities emit NO header (MUST:/SHOULD:/SHOULD NOT:/MAY: never appear).
    assert "MUST:" not in mem  # "MUST NOT:" contains "MUST" but not "MUST:"
    assert "SHOULD:" not in mem and "SHOULD NOT:" not in mem and "MAY:" not in mem
    # Both forbid facts group under the single MUST NOT header.
    assert "- No network in unit tests." in mem and "- No sleeps in tests." in mem


def test_memory_manifest_records_injected_ids_and_polarity():
    facts = _facts(("require", "x"), ("context", "y"))
    facts[0]["id"], facts[1]["id"] = "mem-aaa", "mem-bbb"
    m = _compile(memory=facts).manifest()
    # The memory part joins the existing parts array…
    assert any(p["name"] == "memory" for p in m["parts"])
    # …AND the injected ids (+ polarity) are recorded under the manifest's ``memory`` key (S5 reads
    # this to show "what this node remembered").
    assert m["memory"] == [
        {"id": "mem-aaa", "polarity": "require"},
        {"id": "mem-bbb", "polarity": "context"},
    ]


def test_memory_part_survives_large_spec_handle_static_first_reorder():
    """A memory part must not break the C4 static-first reorder (it must be in _STATIC_FIRST_NAMES,
    else ``_static_first`` KeyErrors when a big-spec node also has memory)."""
    big_spec = "S" * (4 * (_SPEC_HANDLE_TOKEN_THRESHOLD + 500))
    facts = _facts(("require", "Keep the change minimal."))
    c = _compile(spec=big_spec, memory=facts, budget=_BIG_BUDGET)
    assert c.handle_used is True
    assert any(p.name == "memory" for p in c.parts)
    assert "--- REMEMBERED LESSONS ---" in c.instruction
    assert "Keep the change minimal." in c.instruction
