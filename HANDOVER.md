# HANDOVER — Tvashtr-1 → Tvashtr-2

> Structured snapshot to start the next chat. **Read this, then read `PROJECTPLAN.md` in full** (it's the source of truth; this file only adds what's not already there or needs emphasis).
> **Written:** 2026-06-09 by Tvashtr-1.

---

## 1. Where we are
**Planning (Steps 1–3) is complete and signed off by the operator.** `PROJECTPLAN.md` exists and is the agreed contract. Nothing has been built yet. The next chat (**Tvashtr-2**) begins **Phase 0**.

## 2. What's done
- Full vision interview completed; product thesis locked (painkiller = idea→working software; vitamin = "the team is mine", and it must *demonstrably* earn its keep at least once).
- Architecture **committed** (not just proposed): see `PROJECTPLAN.md` §6–§7. Headline: **Tvashtr owns orchestration; execution engines are pluggable commodities behind a uniform adapter.** Engine-adapter + **OpenHands as default engine**; deterministic **Control Plane** split from the LLM **Supervisor Agent**; **recursion is our primitive (arbitrary depth)**; **cyclic** team graph with enforced termination; **first-class versioned documents**; per-agent **MCP** tools; **Python backend / React frontend**; **durable workflow engine** + **model gateway**.
- Three top risks accepted with named mitigations (§13).
- `PROJECTPLAN.md` authored: 19 sections, 3 Mermaid diagrams (component, run-loop sequence, ER), prioritized feature breakdown, Phase 0→4 roadmap, decision log, glossary.

## 3. What's in flight
Nothing actively in progress. Clean boundary. No Claude Code prompt has been written yet (Tvashtr-1's mandate was planning only).

## 4. Immediate next steps (Phase 0) — in order
1. **Stack-lock research.** The architecture *patterns* are `DECIDED`; the *brand names* are `CANDIDATE`. Verify current (mid-2026) state and lock: **durable workflow engine** (Temporal vs Restate vs custom), **model gateway** (LiteLLM vs alternatives), **canvas library** (React Flow), **sandbox** (OpenHands built-in vs E2B), **document editor** (TipTap/ProseMirror vs CodeMirror). Use web search — this corner moves fast. Re-confirm the OpenHands + Claude Agent SDK facts (already verified once in Tvashtr-1: OpenHands is model-agnostic/self-hostable/MIT with built-in Docker/K8s sandbox; Claude Agent SDK native subagents are **depth-1**, which is *why* recursion is our primitive).
2. **Resolve the four `OPEN` items** (§13): (a) document-concurrency ladder depth — soft locks vs CRDT for v1; (b) document editor choice (tied to a); (c) **which engine backs the walking skeleton first** — OpenHands (sandbox included) vs Claude Agent SDK (lighter to call) to prove the loop fastest; (d) final durable-engine + model-gateway locks.
3. **Update `PROJECTPLAN.md`** — flip the resolved `CANDIDATE`/`OPEN` rows to `DECIDED`, add decision-log entries.
4. **Write the first Claude Code prompt** — the **Phase 0 walking skeleton**. Target deliverable (from §15 Phase 0): repo scaffold at `/Users/adimac/Desktop/Tvashtr` → minimal Control Plane on the durable engine → one engine adapter → minimal Model Gateway → a tiny 2-node graph (PM + Engineer) → one versioned document → minimal canvas render + doc view → **ship one trivial feature into a repo, resumable across a deliberate crash.** Prompt must follow the required structure (Objective / Context / Constraints / Tasks / Acceptance criteria / Report-back spec).

**Suggestion:** confirm the locked decisions with the operator *before* finalizing the first build prompt — don't burn a build cycle on an unverified stack choice.

## 5. Open questions
Exactly the four in §4.2 above (mirrored in `PROJECTPLAN.md` §13 "Open questions"). None block starting Phase 0 research.

## 6. Key decisions & rationale (condensed — full list in `PROJECTPLAN.md` §17)
- **Flexibility is the product.** Operator explicitly chose maximum flexibility over speed ("I don't care if it takes 2 team-years… I will manage it"). This is *why* we use the engine-adapter + model-gateway + our-own-recursion design instead of standardizing on one vendor runtime. Do not re-litigate this toward a "simpler/faster" single-vendor path — it's a settled, deliberate choice.
- **Control Plane (code) vs Supervisor Agent (LLM) split** — an LLM can't be both the brain and a reliable bus/budget enforcer. Most important robustness decision.
- **Walking-skeleton-first** — flexibility is designed in from day one, but we always keep something running end-to-end. Architecture is never compromised for speed; the *sequence* is disciplined.
- **Commercial priority b > a > d > c** — single-operator now, multi-user-ready architecture; auth/billing/sharing deferred but not precluded.

## 7. Gotchas / things to know that aren't obvious from the plan
- **Filesystem reality.** The architect chat has **direct read/write access to the project root `/Users/adimac/Desktop/Tvashtr` via the Filesystem MCP** (granted 2026-06-09). Maintain the living docs there directly: call `Filesystem:list_allowed_directories` once at the start of the chat, then use `read_text_file` / `write_file` / `edit_file`. (Note: Claude's own sandbox under `/mnt/...` is a *separate* computer; files the operator uploads land there, not in the project root.) Presenting files in chat is now optional, not a required save step.
- **Verify Claude Code's reports; don't trust "done."** Per project process: read the files Claude Code actually changed against the acceptance criteria, confirm tests really ran, flag deviations/risks, *then* write the next prompt.
- **Chat naming.** Each chat states its name on opening (e.g., "This is Tvashtr-2"). Number comes from the first message that starts the chat.
- **Operator preferences** (apply throughout): analogies help when explaining concepts; a message starting with **"By the way"** means *give a short answer*; **when giving a procedure, deliver one step at a time** and wait for the operator's report before the next step.
- **The success metric is a product requirement.** "Composability must demonstrably earn its keep" means Phase 2 must make a team/gate change *visible and attributable* — don't treat it as a soft goal.
- **One prompt per step.** Prefer several tightly-scoped Claude Code prompts over one sprawling one.

## 8. Pointers
- Source of truth: `PROJECTPLAN.md` (root) — esp. §6 architecture, §7 decisions, §9 data model, §13 risks, §15 roadmap.
- Working loop, prompt structure, and review discipline: project instructions.
