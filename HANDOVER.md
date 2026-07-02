# HANDOVER — Tvashtr-41 → Tvashtr-42

**You are Tvashtr-42**, the architect/planner chat for Tvashtr. Read this file **and** `PROJECTPLAN.md` (the line-6 header banner, §1 vision, §14, §15, §16, and the newest §17 "2026-07-02 (Tvashtr-41)" entry) before doing any design work. Then read `prompts/CLI-RULES.md` (the CC operating contract, incl. §4.7). You are ARCHITECT/PLANNER ONLY — design, write CC `/goal`s + `prompts/` briefs, audit results on disk, maintain the living docs. All implementation goes through Claude Code.

---

## Where we are (ground truth)
- **`main` @ `6f08253`.** Alembic head **`0018`**. Test floors: **328 backend pytest / 167 vitest** (F1a raised vitest 165→167).
- **Active milestone: M-frontend** — a premium reskin of the existing warm cream-paper frontend (KEEP-WARM identity: cream `#faf9f5` + coral `#d97757` + Newsreader/Inter/IBM-Plex-Mono; NO dark pivot), the canvas emulating **n8n's advanced AI-agent canvas**. Decomposed **F0 → F1 → F2 → F3 → F4**, reskinned onto the live/tested app. The design export is the target LOOK, not a rebuild. **The backend contract is the WALL** (no new endpoints, `api.ts` byte-untouched, no migration past `0018`).
- **Ordering LOCKED: canvas-first.** **F1 split into three slices: F1a (node cards) → F1b (canvas chrome + edges/handles + authoring affordances) → F1c (config drawer + drawer/modal toggle + model picker + run-view).**
- **SHIPPED + merged this session:** **F0** (`b43a0d0`) = the extend-token layer + the shared `.tv-*` primitive lift. **F1a** (`e861b4c`) = the node-card reskin + the entry-node treatment + the `deriveNodeStatus` never-reached fix. Both disk-audited and clean.
- **Brownfield thesis verdict: UNCONFIRMED + DEFERRED** — do NOT queue it. **Wizard-of-Oz demand probe (≥1 non-founder paying user): still the open value gate.**

## The design export (already reviewed — reuse it, don't re-review)
- Lives at `design/Tvashtr Frontend Overhaul.zip` (2.12 MB). Extract to a scratch dir OUTSIDE the repo.
- **KEY finding:** its `_ds/tokens/{colors,fonts,typography,spacing,base}.css` are **BYTE-IDENTICAL** to the live `frontend/src/design-system/tokens/*` (the Claude Design tool was seeded with the real tokens). The ONLY genuinely-new token material is **`tvashtr-extend.css`** (the premium refinement layer — F0 ported it). The `.dc.html` mockups (Canvas / Dashboard / AuthWizard / Landing) style everything with **inline token-recipes (no CSS classes)** — read them as the target look for each surface.
- Canvas mockup = `Canvas.dc.html`. Node anatomy ~lines 190–242; the JS `glyphFor`/node-def logic ~lines 807–950. The design's **entry-node glyph is `#i-zap`** (a spark) — F1a matched it with lucide `Zap`.

## IMMEDIATE NEXT STEP — scope F1b, then hand the CC launch package
**F1b = the canvas chrome + edges/handles + the n8n inline authoring affordances.** In scope:
- **Canvas chrome:** the board surface (consume F0's `--surface-board`), the React Flow zoom controls, the minimap, the background dots — restyled to the design.
- **Edges:** the forward/branch edges + the **rework loop-back arc** (`ReworkEdge`), the coral **"work flowing"** animation on active edges (F0's `tv-flow` keyframe), edge draw-in, and the **edge delete (×)** affordance.
- **Authoring affordances (the n8n `+`/hover-delete):** the hover **"+"** to insert/add a node on an edge and the hover **"×"** to delete — **including the operator's edge `+`/delete placement tweak** (in `Canvas.dc.html`). Over the existing node/edge CRUD.
- **Handles/connection UX** (the drag-to-connect dots).

**Do this to scope it (same method as F1a):**
1. Read the live source: `frontend/src/canvas/TeamCanvas.tsx` (edge rendering + the `<Controls>`/`<MiniMap>`/`<Background>` + the CRUD handlers), `frontend/src/canvas/NodePalette.tsx`, `frontend/src/canvas/EdgeRoleEditor.tsx`, `frontend/src/canvas/ReworkEdge.tsx`, and the **chrome/edge rules in `frontend/src/canvas.css`** (F1a touched ONLY the node rules — `.rf-node/.rf-gate/.rf-terminal`; the `.react-flow__*`, `.rf-edge*`, handle rules are untouched and are F1b's).
2. Read the design's edge/chrome/authoring recipe in `Canvas.dc.html` (the edge delete button, the palette "+", the "How do they connect?" edge-role editor modal, the hover +/× controls, the zoom/minimap chrome).
3. **Surface the one real design decision, paired with its UX consequence:** how the inline **"+" insert-a-node affordance behaves** — does it open the node palette (pick a kind), or drop a default node then let the user edit it? Decide from the §1 vision (the user authors their own topology), present it with what the user sees/does, get the operator's nod.
4. Then write `prompts/F1b-*.md` (the detailed brief) + a **lean `/goal`** (see the hard length limit below), and hand the operator the full 3-block launch package.

**Known F1b-relevant facts (from this session's reads):**
- `nodeTypes = { agentNode: AgentNodeCard }` (one node type, dispatched by `kind` inside the card). `edgeTypes = { rework: ReworkEdge }`.
- Edges are built from `graph.edges`; each edge `e` has `source_node_id`, `target_node_id`, `conditions`. **Loop-back/rework edges carry `conditions.loop_limit`** (a forward edge has `loop_limit == null`); a rejection branch carries `conditions.when === "rejected"`. (F1a's `entryNodeIds` already uses this: entry = no forward edge targets it.)
- **F1a left the model footer row INERT** (`<button className="rf-node__model">` with no handler) — **F1c** wires its click to open the model picker. Don't wire it in F1b.
- The operator's two canvas tweaks: **edge `+`/delete placement → F1b**; **drawer↔modal toggle → F1c**.

After F1b: **F1c** (the premium right config drawer + the drawer↔modal toggle + the model picker the inert footer opens + the run-view: inspector/verdict/EventFeed/PRD; folds in the §15 gate/terminal post-drop config editing), then **F2** (dashboard), **F3** (auth wizard), **F4** (landing).

## GOTCHAS specific to right now (read these)
- **⚠️ PARALLEL CHAT SHARES THE WORKING TREE.** A second sequence, **Tvashtr Sidechat-1**, runs in this same project and edits the SAME files. This session it **added two entries to the §15 deferred register** (a per-node fallback model; a per-node typed-output schema + multimodal toggle — both from a CrewAI deck review). **When editing `PROJECTPLAN.md`, use `edit_file` with surgical anchors — NEVER `write_file` (a full overwrite would clobber Sidechat-1's edits).** `HANDOVER.md` is the main-sequence doc (safe to rewrite).
- **⚠️ DOCS ARE UNCOMMITTED.** The working tree carries: Sidechat-1's two §15 additions + Tvashtr-41's §17/header/§16 edits + untracked `prompts/F0-tokens-primitives.md` and `prompts/F1a-node-cards.md`. All roll into the **next docs commit** (offer the operator a docs-commit at the next handover; the established pattern defers it). F1a/F0's code is already committed+merged — only the docs float.
- **⚠️ `/goal` HARD LIMIT: 4000 characters.** CC rejects a longer `/goal` ("Goal condition is limited to 4000 characters"). Put the detail in `prompts/<name>.md` and keep the `/goal` lean + pointing at it. Verify length with `wc -c` before handing it over (F0's `/goal` was 3054, F1a's 3884).
- **F1a deviation (accepted):** CC self-signed-off via a Vite-served component harness (real `TeamCanvas`+`canvas.css`, deleted after) instead of a live run — accepted because the harness renders the real components/CSS and the status fix is proven by the mutation-real unit regression. **Minor open:** `entryNodeIds` has NO unit test of its own (nice-to-have; fold into F1b or a cleanup).
- **Desktop Code tab is UNUSABLE** (OS-level EPERM crash) → run CC in the **terminal** with `--dangerously-skip-permissions`.
- **The MCP timed out a couple of times this session** (transient, ~4-min hangs on `read_multiple_files`/`read_text_file`); it recovered. If a batch read hangs, fall back to single `read_text_file` / `copy_file_user_to_claude` (copies stayed reliable).

## STANDING OPERATOR DIRECTIVES (carry these forward — inherited every session)
- **The CC `/goal` loop is the build method.** You write ONE lean `/goal` per bounded milestone; CC self-decomposes + runs to green; you audit on disk; operator FF-merges. Scope each `/goal` to a full milestone verifiable in one transcript.
- **The launch package is ALWAYS three copyable blocks inline, verbatim, every time** — (1) shell cmd `cd /Users/adimac/Desktop/Tvashtr && claude --dangerously-skip-permissions`, (2) the full init prompt, (3) the full `/goal`. NEVER "same as before"; NEVER tell the operator to fetch text from a file. (The brief MAY live in `prompts/*.md`, referenced by the `/goal`; the init-prompt + `/goal` text are always reproduced inline.)
- **Every `/goal`'s acceptance makes CC run ALL verification itself** — `make test` / lint / build + all live smoke/e2e targets — and debug to green before `READY_TO_MERGE`. Never hand the operator commands to run. Bug-fix `/goals` are **reproduce-first** (a regression that genuinely fails on the pre-fix code). Visible slices get a **Playwright self-sign-off with screenshots** (targeted `browser_evaluate` + screenshots — the whole-canvas a11y snapshot HANGS on React Flow). End every `/goal` with the §4.7 8-section FINAL REPORT; a recorded `NEEDS_HUMAN` WITH the report is a valid terminal.
- **The disk audit is your main control point.** Never trust CC's self-report: read the changed files, diff "untouched" claims byte-for-byte against pre-images (copy files BEFORE a `/goal` runs), reconstruct git state from `.git` plumbing (`.git/refs/heads/<branch>`, `.git/logs/refs/heads/<branch>` — confirm FF-ability + not-pushed), confirm tests are mutation-real by reading the bodies, and scrutinize (don't rubber-stamp) any deviation.
- **Design decisions: from the vision, one at a time, paired with the UX consequence.** Decide from §1 + the Tvashtr-25 pivot, NEVER from effort-minimization. One design question per exchange, explicit sign-off before the next. Don't present option menus for vision calls — decide (reserve "you choose" for genuine strategic-direction calls). Every decision states what the user sees/does on the canvas/UI.
- **"Extend never replaces"** for the design system: the base token files are frozen; new material is additive (a separate file).
- **Merge handoff = ALL commands every time** (cd, checkout main, `merge --ff-only <branch>`, verify log, expected tip sha, FF-fail instruction, optional cleanup). **Visual sign-off (when a human check is genuinely needed) = a detailed NUMBERED click-by-click script** naming nodes by their VISIBLE label — never abstract.
- **Guardrails survive bypass only as PreToolUse hooks:** the no-push hook (`.claude/hooks/protect-no-push.sh`) + the migration-freeze hook (`protect-migrations.sh`, covers `0001–0018`). A deny rule in settings does NOT survive `--dangerously-skip-permissions`.
- **Operator comms:** terse — "proceed"/"go"/"merged"/"done" = ratify + continue; "by the way" = wants a short answer. Procedures one step at a time. Analogies help. Always hand copyable artifacts. Simple everyday language, minimal jargon.
- **zsh inline comments break commands** — all git/shell blocks must be comment-free (zsh in non-interactive mode runs `#` as a command).
- **PROJECTPLAN.md is large (~782 lines / ~180KB).** Always: `copy_file_user_to_claude` → `grep -nE '^#{1,3} '` for the header index → `sed -n 'START,ENDp'` for targeted sections. Never read it whole. The line-6 header banner is one giant single line — bump it by anchoring on `> **Last updated:** ... — **Tvashtr-N.**` and demoting the old summary to `_Prior:_`. New §17 entries go before the `---` preceding `## 18. Glossary`.

## Tools / resources
- **Filesystem MCP** — all project reads/writes at `/Users/adimac/Desktop/Tvashtr`. `bash_tool` runs only in Claude's container (`/mnt/...`), NOT the operator's machine — use it for diffs/greps on files brought over via `copy_file_user_to_claude` (which land at `/mnt/user-data/uploads/<basename>`, are **read-only from bash**, and **silently overwrite same-named copies** — stash pre-images to `/tmp/` first).
- **`edit_file`** — always `dryRun:true` first with unique multi-line anchors; the apply diff is the verifier.
- **Proven agent model:** `nvidia_nim/meta/llama-3.3-70b-instruct` (`.env TVASHTR_AGENT_MODEL`; ~1.4s/call). `DEFAULT_MODEL` must be a non-reasoning instruct model (e.g. `openai/gpt-4o-mini`) — a reasoning model silently returns empty PRD content.
- **Claude Code** — CLI agent, terminal + `--dangerously-skip-permissions`. `/tvashtr-loop` skill + Playwright MCP available.

## Ready-to-paste first message for Tvashtr-42
> You are Tvashtr-42. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first (HANDOVER first); then pick up at scoping **F1b** — the canvas chrome + edges/handles + the n8n inline authoring affordances. Read the live edge/authoring source and the `design/` Canvas mockup, surface the "+" insert-a-node behavior decision, then hand me the full Claude Code launch package. Don't start work until you've read both docs.
