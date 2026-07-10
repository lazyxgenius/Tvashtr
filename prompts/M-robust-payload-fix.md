# M-robust phase 2 — mode-agnostic fix in `_payload_of` (replaces the local-only wrapper)

## Context
Phase 1 (the current commit `041fa76` on `feat/provider-robust`) fixed the reasoning-content crash with a host-side LiteLLM wrapper — but that only covers the **local** sandbox mode. The docker adapter (`openhands_docker_adapter.py`) imports and uses the SAME frozen `_payload_of`, so the real, mode-agnostic fix belongs there. The operator has RATIFIED touching the frozen adapter for this — the first sanctioned `engines/` change in the project. Keep it surgical.

## The bug (confirmed on disk)
`backend/tvashtr/engines/openhands_adapter.py::_payload_of` does, for an action event:
```python
"thought": (getattr(event, "thought", "") or "")[:1000],
```
For a reasoning-model tool-call turn, the ActionEvent `thought` is a `Sequence[TextContent]` (a truthy list), so `(list or "")` keeps the raw list → the `EngineEvent.payload` carries raw `TextContent` objects → the `run_events` JSON-column write (stdlib `json.dumps`) raises `TypeError: Object of type TextContent is not JSON serializable`. Plain models return `thought=[]` (empty, falsy → `""`), so they never trip it. BOTH the local and docker adapters call `_payload_of`, so fixing it here covers BOTH modes.

## The fix
1. **Stringify the thought in `_payload_of`** before it goes into the dict. Handle every shape: a plain `str` → keep it; a `Sequence[TextContent]` → concatenate the parts' `.text` (defensive: `str(part)` fallback if a part has no `.text`); `None`/empty → `""`. Keep the `[:1000]` truncation and keep it inside the existing `try/except` (so any oddity still degrades to `{"unparsed": ...}`). Result: the payload's `"thought"` is ALWAYS a plain string → JSON-serializable for any provider, in any mode. Do NOT change any other behavior of `_payload_of` or anything else in `engines/`.
2. **Drop the now-redundant local-only wrapper**: remove the `install_response_transform()` call AND its import from `backend/tvashtr/main.py`; DELETE `backend/tvashtr/llm_response_normalization.py`.
3. **Rework the regression test to target `_payload_of` directly** (`backend/tests/test_llm_response_normalization.py` → rename/rewrite, e.g. `test_payload_thought_serialization.py`): drive the REAL path (SDK `Message.from_llm_chat_message` → the `Sequence[TextContent]` thought → `_payload_of` → `json.dumps`). Assert: (a) on the pre-fix `_payload_of`, a TextContent thought (empty-text, and a non-empty preamble) makes `json.dumps(payload)` RAISE `TextContent is not JSON serializable` — this anchors the bug and makes the test mutation-real (it must fail against the old `_payload_of`); (b) after the fix, the payload serializes with the thought as the joined string and the tool-call `action` intact; (c) a plain-`str` thought is preserved verbatim; (d) an empty/`[]` thought → `""`. Delete the wrapper-specific tests (`normalize_response_in_place`, `install_response_transform`).
4. **Keep the still-valid phase-1 supporting changes**: the `conftest.py` DeepSeek dummy credential (keeps the offline suite green under the DeepSeek `.env`) and the `scripts/loop_run.py` stale-assertion correction. Don't revert those.

## Invariants (checkable on disk)
1. `git diff main -- backend/tvashtr/engines/` shows ONLY the `_payload_of` thought-stringify (a few lines in `openhands_adapter.py`). NOTHING else in `engines/` changes — not `run_event_sink.py`, not the docker adapter, not `base.py`. This is the sanctioned first `engines/` touch; keep it minimal. If you find you need any other `engines/` change, STOP + NEEDS_HUMAN.
2. No new migration; `alembic upgrade head` stays `0024`; frozen migrations `0001–0024` untouched.
3. Never push. The FINAL `feat/provider-robust` branch must be EXACTLY ONE M-robust commit on top of U1's `0feae15` — soft-reset/amend the phase-1 wrapper commit `041fa76` into a single clean commit (NOT a wrapper-commit-then-revert stack). Verify with `git log --oneline 0feae15..HEAD` showing one commit.
4. Commit only: `openhands_adapter.py`, `main.py`, the reworked test file (+ the deleted `llm_response_normalization.py`), and keep `conftest.py` + `scripts/loop_run.py` + `STATE.md`. Never stage HANDOVER.md / PROJECTPLAN.md / prompts/.

## Acceptance / evidence (echo each into chat)
- **Reproduce (unit):** on the PRE-fix `_payload_of`, a `Sequence[TextContent]` thought makes `json.dumps(payload)` raise `TextContent is not JSON serializable` (the test's pre-fix assertion — run it against old code first to prove it fails).
- **Fix applied:** `git diff main -- backend/tvashtr/engines/` is ONLY the `_payload_of` thought-stringify.
- **`make test`** all green (report the count) including the reworked mutation-real `_payload_of` tests.
- **LIVE local on DeepSeek** (`.env`: `TVASHTR_AGENT_MODEL=deepseek/deepseek-chat`, `DEFAULT_MODEL=deepseek/deepseek-chat`; add the DeepSeek key via BYOK if the dev DB lacks it): `make skeleton-run` AND `make loop-run` complete GREEN end-to-end — now via the `_payload_of` fix with the wrapper removed (proves the fix works end-to-end, not just in a unit test). Echo each entry-node invocation wall time.
- **No-regression:** `make skeleton-run` on `openai/gpt-4o-mini` still GREEN (plain model unaffected).
- **DOCKER confirmation (best-effort, NOT a hard gate):** attempt a docker-sandbox-mode DeepSeek `make skeleton-run` to empirically confirm docker is now covered by the shared-`_payload_of` fix. If the docker daemon / agent-server image isn't readily available or fails for infra reasons UNRELATED to the fix, capture that as a note and CONTINUE — the fix is already proven at the shared choke point by the unit test + the local run. Echo whether docker was confirmed live or left as a construction-proof.
- **`make lint`** clean; STATE.md maintained; final line `READY_TO_MERGE` + the branch tip sha.

## Stop conditions
- Any `engines/` change needed beyond `_payload_of`'s thought-stringify → STOP + NEEDS_HUMAN.
- Docker confirmation blocked by infra → note it + CONTINUE (this is NOT a stop; the fix stands on the unit test + local run).
- DeepSeek 429/5xx you can't clear after reasonable retries → NEEDS_HUMAN (offline suite green first).
- A second/unknown root cause needing a broad or unproven change → NEEDS_HUMAN; a contained fix within this scope → proceed.
- Hard cap: 25 turns. Write a DETAILED final report (files changed, exact commands + output, the wall times, the reproduce→fix→green arc, whether docker was confirmed, deviations, open questions).
