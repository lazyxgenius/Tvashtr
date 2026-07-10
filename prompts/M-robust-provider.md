# M-robust — provider-response robustness (handle reasoning-content models)

## Mission
Make Tvashtr's agent execution handle **any** provider's response shape — specifically reasoning-content models (DeepSeek, qwen3, and future ones) that return `reasoning_content`, which currently crashes the OpenHands agent loop. After this, a user can assign DeepSeek (or any reasoning model) to any node and it runs cleanly. This is verified LIVE on DeepSeek.

This milestone branches **off U1's tip `0feae15`** (the main checkout is already there, with DeepSeek configured), so the live run ALSO serves as U1's live acceptance (skeleton ships + loop runs on DeepSeek). One live run verifies both.

## Diagnosis already done by the architect (confirm via reproduce-first; don't re-derive from scratch)
The crash is `TypeError: Object of type TextContent is not JSON serializable`, raised inside OpenHands' **Laminar/OTEL telemetry**, NOT in Tvashtr's code or OpenHands' real persistence:
- `conversation.run()` in the SDK is decorated `@observe(name="conversation.run")` (`openhands/sdk/conversation/impl/local_conversation.py`). When telemetry is ON, the `observe` wrapper (lmnr) does a naive `json.dumps` of the method's message I/O for the trace span. A reasoning model's `reasoning_content` becomes a `TextContent` object that stdlib `json.dumps` can't serialize → crash. Plain-string models (Llama, gpt-4o-mini) don't produce that shape, so they never trip it.
- Telemetry is **opt-in**: `openhands/sdk/observability/laminar.py::should_enable_observability()` returns True only if one of these env keys is set (non-empty): `LMNR_PROJECT_API_KEY`, `OTEL_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT`. One IS set in this environment (that's why it fires). When disabled, `@observe` is a pure pass-through — no serialization, no crash.
- OpenHands' OWN state persistence uses **pydantic** (`model_dump_json` / `model_dump`, e.g. local_conversation.py:101, :503) which serializes `TextContent` correctly — so nothing Tvashtr relies on is broken; the failure is confined to the unused telemetry path.
- **The model-config seam is in `backend/tvashtr/config.py::agent_llm_routing()`**, spread into `LLM(**agent_llm_routing(...))` at the FROZEN `engines/openhands_adapter.py:315`. So the fix belongs in `config.py` / Tvashtr's LLM+telemetry setup — NOT the frozen adapter.

## The fix (both parts; determine exact mechanism during implementation)
1. **Normalize reasoning-content at the model boundary (the robust fix).** Configure Tvashtr's OpenHands `LLM` / LiteLLM so that a model's `reasoning_content` is folded into or dropped from the message content, yielding a clean serializable string — so ANY reasoning model produces a normal response regardless of what's downstream (telemetry on/off, local or docker serialization). Prefer expressing this in `config.py::agent_llm_routing` (an LLM/LiteLLM param the adapter already spreads) or Tvashtr's LiteLLM setup module. Candidate mechanisms to investigate (pick the minimal robust one; verify it actually works): a LiteLLM param such as `merge_reasoning_content_in_choices` / `litellm.modify_params`, an OpenHands `LLM` config field for reasoning handling, or a LiteLLM response transform. Do NOT lose the model's actual answer/tool-calls — only the separate reasoning trace is folded/dropped.
2. **Disable the unused telemetry for agent runs (removes the broken serializer entirely).** Ensure the OTEL/LMNR enabling env key is NOT set in the environment Tvashtr's agent runs execute in. Find where it comes from (`.env`, a config default, docker env) and turn it off for Tvashtr — Tvashtr has its own event sink (`run_event_sink.py`), trajectory ledger (C5/C6), and STATE.md, so it does not use Laminar/OTEL. Do this in a way that survives (e.g. `.env` line removed/blanked, or an explicit unset in the agent-run env setup) — NOT by editing the frozen adapter.

## Hard invariants (checkable on disk)
1. `git diff main -- backend/tvashtr/engines/` is EMPTY. The frozen adapter stays byte-untouched. **If you conclude the fix genuinely requires an `engines/` change, STOP and write NEEDS_HUMAN to STATE.md with the reason — it's an architect design call, not yours to make.**
2. No new migration; `alembic upgrade head` stays at `0024`; frozen migrations `0001–0024` untouched (the freeze hook already covers them). This is runtime config, not schema.
3. Branch `feat/provider-robust` off the current HEAD (`0feae15` on `feat/m-unify-u1-core` — verify with `git log -1`). Never push. Never merge to main.
4. Commit ONLY the files you change for this fix (e.g. `config.py`, a LiteLLM setup module, `.env` is gitignored so it won't be committed anyway, and your new test). Do NOT stage HANDOVER.md or PROJECTPLAN.md or prompts/ — the architect has uncommitted edits there. STATE.md is your log (commit it if you like; you're on a new branch, so it won't disturb U1).
5. Offline suite stays green: `make test` ≥ 448 (+ your new regression test), all mutation-real; `make lint` clean. FE untouched → vitest unchanged.

## Acceptance / evidence (echo each into chat as it completes; reproduce-FIRST)
- **Reproduce:** with `.env` set to DeepSeek (`TVASHTR_AGENT_MODEL=deepseek/deepseek-chat`, `DEFAULT_MODEL=deepseek/deepseek-chat`; add the DeepSeek provider key via the BYOK flow if the dev DB doesn't have it), run `make skeleton-run` and confirm it FAILS today with `TextContent is not JSON serializable` on the entry node's first tool action. This proves the bug on pre-fix code. (deepseek-chat is the non-reasoning-*label* chat model but it emits `reasoning_content` — that's the whole point; do NOT use deepseek-reasoner.)
- **Fix applied** per both parts above, in `config.py` / LLM+telemetry setup, with `git diff main -- backend/tvashtr/engines/` still EMPTY.
- **Regression test (mutation-real):** a test that feeds a model response carrying `reasoning_content` (a `TextContent`-shaped content) through the normalization path and asserts the resulting message content is a plain serializable string (survives `json.dumps`) with the real answer/tool-calls intact — a test that genuinely FAILS on the pre-fix code and passes after. Keep it real, not a smoke assert.
- **LIVE (this is U1's live acceptance too):** on DeepSeek, `make skeleton-run` AND `make loop-run` complete GREEN end-to-end — skeleton ships, loop runs the review loop, the ENTRY node writes REPORT.md that becomes the spec version. Echo the WALL TIME of each entry-node invocation (spin-up → REPORT.md pulled) — the U2 latency baseline, finally captured (on DeepSeek).
- **No-regression on plain models:** run `make skeleton-run` on `openai/gpt-4o-mini` (via the existing OpenAI key — serialization-proven, plain-string) and confirm it still completes green — proving the normalization is a no-op for non-reasoning models. (NIM's Llama is down, so gpt-4o-mini is the plain-model check.)
- `make lint` clean; STATE.md maintained; final line `READY_TO_MERGE` + the branch tip sha.

## Stop conditions
- The fix would require touching the frozen `engines/` adapter, or the OpenHands SDK, or a schema change → STOP + NEEDS_HUMAN (design call).
- Reproduce does NOT crash (DeepSeek runs clean pre-fix, e.g. telemetry already off) → STOP + NEEDS_HUMAN so the architect re-scopes (the premise would be wrong).
- DeepSeek 429/5xx you can't clear after reasonable retries → NEEDS_HUMAN (offline suite green first).
- A second/unknown root cause needing a broad or unproven change → NEEDS_HUMAN; a contained config-level fix within scope → proceed.
- Hard cap: 30 turns. Write a DETAILED final report (files changed, exact commands + output, the wall times, the reproduce→fix→green arc, deviations, open questions).
