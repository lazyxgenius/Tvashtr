# HANDOVER — Tvashtr-10 → Tvashtr-11

> Written 2026-06-17 by **Tvashtr-10** at the close of P1.3b. Read this, then **`PROJECTPLAN.md`** (the source of truth) in full before doing anything. The deep history lives in PROJECTPLAN §15 (roadmap + deferred register) and §17 (decision log); this file is the orientation + the P1.4 framing.

---

## 0. TL;DR — where we are
- **Phase 1:** P1.1 ✅, P1.2 ✅, **P1.3 ✅ COMPLETE (a + b parts 1 + 2 + 3).** The **Docker sandbox is now the DEFAULT execution mode** (Tvashtr-10's flip).
- **`main`** = the Tvashtr-10 doc-closeout commit (child of the P1.3b-part3 merge `9293e1c`). Clean tree, no open branches.
- **Next step: P1.4 — the LiteLLM proxy** (the agent-internal, mid-loop spend chokepoint). That's where you pick up.
- Still **invisible plumbing** (no UI); the first genuinely visible feature again is **P1.5** (the multi-node cyclic loop). So a per-step *visual* smoke-test mostly won't apply to P1.4 — the felt signal here is the live spend/cutoff behavior, not a screen.

## 1. What just landed — P1.3b part 3 (Tvashtr-10)
Flipped `Settings.agent_sandbox_mode` default `local`→`docker` (safety-by-default, now that part 2 proved two-layer containment): the product's default run (`POST /api/runs`) is now containerized, and *forgetting* to set the mode lands on the SAFE path. The four fast dev/test agent targets — `skeleton-run`, `skeleton-crash`, `hitl-demo`, `budget-demo` — are pinned explicitly `TVASHTR_AGENT_SANDBOX=local` (they test orchestration, not containment). Mechanism: sandbox mode is **process-global** (`engineer_run_step` reads `get_settings().agent_sandbox_mode`; env `TVASHTR_AGENT_SANDBOX`), **not** a per-run API field — "pin" = export the env at the target's launch point. One-line config default + comment + 4 pins + the config-sandbox test assertions; no product-logic change, no migration, no FE. Commit `9293e1c`, FF-merged. Live-verified: a default-mode run containerized (7 events over the container WebSocket, matching the P1.3a docker fingerprint); `make skeleton-crash` stayed local. Full detail in §17 (Tvashtr-10 entry).

**Consequence you'll feel:** because docker is now the default, `main.py`'s lifespan **boot-sweep runs on every non-pinned startup** (`make backend`, `make test`) — it shells to the `docker` CLI to reap orphan agent-server containers; exception-safe and a no-op when none exist. Not a bug — the gating was written for exactly this.

## 2. The immediate next step — P1.4 (LiteLLM proxy)

### What it is / why (from §15 roadmap + §17 Decision 2)
The agent's *own* LLM loop (OpenHands) bills through the SDK's own LiteLLM — **Decision 2**. Two problems that the proxy fixes:
1. **In-process caps can't interrupt the agent mid-step.** P1.2's budget gate is a *between-steps* checkpoint; it can't stop a runaway agent burning spend *inside* a single agent run. A LiteLLM **proxy with a per-key budget** can: when the agent's spend hits the key's budget, the proxy returns an error that cuts it off **mid-loop**.
2. **Metering is approximate (Decision 2).** Today the Gateway (D9) meters *direct* calls (the PM); the *agent's* calls are metered post-run, approximately. Routing all traffic through one proxy endpoint collapses that into **exact single-endpoint metering** (the §15 "LiteLLM proxy as the physical metering chokepoint" end-state), which also dissolves the agent-metering question.

P1.4 lands **before** the agent does long real work (P1.5).

### Before designing — audit these (the session-opening pattern)
- `backend/tvashtr/gateway/` — the current in-process Model Gateway: how direct/PM calls route + meter (the `default_model`/`model_fallbacks` failover, the `max_tokens` default).
- `backend/tvashtr/engines/openhands_adapter.py` **and** the docker adapter — **how the agent's LLM is configured** (base_url / api_key — currently pointed at OpenRouter directly). This is the wiring P1.4 redirects at the proxy.
- `backend/tvashtr/metering.py` + `models.py` (`cost_records`) — the current metering path the proxy will feed/replace.
- The P1.2 between-steps budget gate in `control_plane/` — how it **composes** with the proxy (complementary: proxy = hard mid-step cutoff, gate = between-steps checkpoint).
- §17 **Decision 2** + the three §15 metering items (exact spend-accounting across crashes; in-process unified metering / gateway-owned LiteLLM callback; the proxy itself).
- `docker-compose.yml` (Postgres lives here — the proxy may become a sibling service).

### Design questions to open with the operator (just-in-time, one at a time)
1. **Where the proxy runs + lifecycle** — a `docker-compose` service (sibling to Postgres) vs a subprocess; does `make backend` bring it up, and is it required or optional (skips cleanly without a key, like the live demos)?
2. **How the agent points at the proxy** — set the agent LLM's `base_url` → the proxy, with a **per-run virtual key** seeded from the run's remaining budget.
3. **⚠️ Container reachability — NEW, created by Tvashtr-10's flip.** The agent now runs **in a container by default**, so the proxy must be reachable **from inside the container** (`host.docker.internal:<port>` / the host IP), **not** `localhost`. In the old local default the agent reached `localhost` trivially; docker mode does not. This wrinkle exists *because* of the part-3 flip — handle it in the proxy/adapter wiring.
4. **Per-key budget = the hard mid-loop cutoff** — pick the LiteLLM mechanism (virtual key budget); decide what the agent sees on breach (error → the run surfaces an `over_budget`/blocker via P1.1/P1.2's path, not a silent hang) and how it reconciles with the existing between-steps gate.
5. **Metering collapse scope** — route the Gateway's *direct* calls through the proxy too, so **all** traffic is one metered endpoint (exact spend from the proxy's logs). Decide how much of this is P1.4 vs a follow-on, and whether it also closes "exact spend-accounting across crashes" (§15).

## 3. Working method (UNCHANGED — the prompt-based cycle)
Claude (architect) writes **one self-contained Claude Code prompt** → **save it as a `.md` in `/Users/adimac/Desktop/Tvashtr/prompts/`** (or give it as a single clean copyable block; **never bury it inline with separator lines** — that was a Tvashtr-10 mistake the operator corrected) so it runs via `/tvashtr-loop <path>` or a paste → operator runs it in Claude Code → pastes the report → **architect audits the disk against the report** (never trust the report over the disk) → operator smoke-tests → operator merges. Branch-per-step + operator-merges. **ALL implementation goes through the prompt** (product code, throwaway/diagnostic scripts, build/Makefile/config alike); the architect makes only living-doc edits + trivial doc/comment/typo fixes — when tempted to write code, write a prompt instead. Prompts must be **detailed / near-exhaustive**: exact paths + current snippets, a precise do-NOT-touch list, granular ordered tasks with anchors, the specific tests to write/run, and a report-back spec (files changed, commands run *with output* incl. `make test` + lint, deviations, open questions, next step). The `/tvashtr-loop` skill stays available for a purely mechanical step; the Playwright MCP is sanctioned for automated UI/E2E *inside* a prompt (complementing, never replacing, the operator's manual visual check).

## 4. Carried / open items (near-term; full register in §15)
- **Agent-native resume** *(Decision-1 restart; SHARPENED by Tvashtr-10)*. On crash, the restart re-runs the agent but **the workspace is NOT reset** → a re-run can ship a **different (e.g. empty)** deliverable, not just pay twice. Observed live in P1.3b-part3's `skeleton-crash`: the `kill -9` landed right after the agent created an empty `greeting.txt`; the restarted gpt-4o-mini saw the file present and shipped it empty (a re-roll passed — flaky on crash timing + LLM luck). Exactly-once still held (it's about *count*, not *content*). Fix = re-attach to the surviving container (no re-run); cheaper interim = **clean/reset the workspace on resume**. *Trigger: P1.5's long real-code loop.*
- **Exact spend-accounting across crashes** — **P1.4-adjacent** (the proxy could make spend exact incl. wasted retries).
- **In-process unified metering (gateway-owned LiteLLM success-callback)** — the stepping stone P1.4 may subsume entirely.
- **`scripts/` outside the ruff gate** — `make lint`/`fmt` scope ruff to `backend/`; the `.sh`/helper scripts aren't linted (known, low-risk).
- Per-run container targeting (image-based reaping is the correct serial-single-operator fallback); agent-server image **digest pinning**; **WebSocket transport** (P1.6); model catalog/picker UI; CRDT (Yjs) document concurrency (P1.7+).

## 5. Gotchas / environment
- **Project root `/Users/adimac/Desktop/Tvashtr`** (capital T — casing matters). **Filesystem MCP ONLY** for project file reads/writes (confirm via `list_allowed_directories` at session start). **Never** use the built-in bash/`str_replace`/`view`/`create_file` on project files — those hit Claude's own container, not the operator's machine.
- **Editing `PROJECTPLAN.md`:** `edit_file` with **`dryRun: true` first** — long multi-line anchors silently no-op on a whitespace mismatch. Anchor on sufficiently unique strings.
- **Stack:** DBOS Transact (durable workflows), LiteLLM (the gateway), React Flow (canvas), OpenHands via the Software Agent SDK (default engine), TipTap (doc editor), OpenRouter (default provider). Env: macOS Apple Silicon, Claude Code, uv, Node 24, Docker.
- **Tests/lint:** `make test` = **61** offline tests (needs `make db-up && make migrate` first — Postgres via docker compose). `make lint`/`fmt` = ruff over `backend/` only.
- **Docker is the default sandbox now:** `make backend`/`make test` run the boot-sweep at startup (shells to docker; no-op when clean). The 4 fast demos pin `TVASHTR_AGENT_SANDBOX=local`; `agent-smoke` + `containment-*` build their adapter directly (mode-immune).
- The git convention: feature work on a branch, **the operator merges** (usually FF); the architect commits the living-doc closeout.

## 6. First step for Tvashtr-11
Read this + PROJECTPLAN in full → confirm the Filesystem path + a clean git state (main = the Tvashtr-10 doc-closeout commit, child of `9293e1c`; P1.3b CLOSED) → audit the Gateway + the adapter's agent-LLM config + the metering path (§2 above) → open **P1.4** design with the operator one question at a time (recommended first: where the proxy runs + how the agent points at it, **including the container-reachability wrinkle**). Then write the single Claude Code prompt, saved to `prompts/`.
