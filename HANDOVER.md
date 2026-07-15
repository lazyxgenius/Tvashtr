# HANDOVER — Tvashtr-64 → Tvashtr-65

_Written at the close of Tvashtr-64 (2026-07-15). Read this **and** `PROJECTPLAN.md` before starting work._

---

## 1. Where we are

**`main` @ `a108e86`** — clean, all merged, nothing in flight.

| Fact | Value |
|---|---|
| Alembic head | `0027_memory_review_mode` (Tvashtr-64 added **no** migration) |
| Backend test floor | **648** passed |
| Vitest floor | **365** passed |
| Lint / FE build | clean (`make lint`, `make build-frontend`) |
| Branches | none — `feat/m-endpoint-editable` merged + deleted |
| Remote | **NONE configured** (`.git/config` has no `[remote]`) — see §4 |

**No `/goal` is queued.** The next chat picks the next milestone.

### Untracked files that MUST stay untracked (architect-owned)
`design/`, `DEEPDIVE-context-and-long-running-agents.md`, `Making Small Models Go the Distance.md`, `NVIDIA's Long-Running Agent Stack.md`, `prompts/M-memory-S5a-shelf.md`, `prompts/M-memory-S5b-views.md`. Every `/goal` must forbid `git add -A` and name these. (Tvashtr-64's `prompts/M-endpoint-editable.md` was committed at the docs closeout.)

---

## 2. What just shipped (Tvashtr-64)

**M-endpoint-editable** — a dropped Ship/Stop endpoint is now editable post-drop. `config["terminal_kind"]` is the single source of truth **and `role_name` is synced to it on every flip**, so a flipped endpoint is byte-identical to a freshly-dropped one. Edges survive; the next run honours the flip.

This **closes the §15 item "Gate/terminal post-drop config editing" outright** (the gate half was M-rails C8). **The canvas now has no non-editable node kind left.**

Full as-built + the audit + the design trap: `PROJECTPLAN.md` §17, entry dated 2026-07-15.

---

## 3. The Grok Build trial — result and what it does *not* prove

The operator trialled **xAI's Grok Build** (`grok --always-approve`, its own `/goal` mode) instead of Claude Code for this milestone. **It cleared the bar on all seven scorecard items**: self-decomposition · tests that bite · ran every gate itself and debugged to green · invariant discipline · **the trap (caught)** · branch hygiene · honest reporting.

**Do not over-read this.** It was ONE small, deterministic, zero-migration, zero-key slice **with a near-identical sibling to pattern-match** (`secret-gate-e2e`). It says nothing yet about Grok on a hard multi-file design milestone, a live-LLM debugging loop, or a genuine `NEEDS_HUMAN` judgement call. What it establishes is that **process compliance — the thing a tool swap actually risks — held.**

Either tool is now a defensible choice. **Ask the operator which to use** if it isn't stated.

---

## 4. ⚠️ THE GUARDRAIL FINDING — read this before launching any non-Claude-Code agent

`grok inspect` proved empirically:

- Grok Build **reads `~/.claude/CLAUDE.md`** and picks up the Claude-Code plugin/skill/MCP ecosystem (35 skills, claude-mem + superpowers, MCP stitch/playwright/sequential-thinking/context7).
- Grok Build does **NOT read `.claude/settings.json`** → **BOTH PreToolUse hooks are INERT**: `protect-migrations.sh` (migration freeze) and `protect-no-push.sh` (no-push guard).
- **`prompts/CLI-RULES.md` §3.11 still falsely asserts those guards are "hard walls."** Grok read it and correctly did *not* rely on it — a future agent might. **Fix that stale claim via a `/goal` when convenient** (it's product-adjacent config, not an architect-direct edit).

**What actually made the trial safe — and the thing to re-verify every time:**
> **`.git/config` has NO remote configured, so `git push` is structurally impossible.**

If a remote is ever added, that safety net vanishes and an unguarded agent becomes genuinely risky. **Re-read `.git/config` before trusting any agent that doesn't honour `.claude/settings.json`.**

Mitigations that worked and should be reused: pick a **zero-migration** slice; restate the guards as hard **textual invariants expressed AS on-disk evidence**; **audit the disk before merge**.

---

## 5. The standing strategic question (UNCHANGED — surfaced three sessions running)

**The rung-2 brownfield thesis has not been re-run on a real repo since Tvashtr-38**, where a 264-file monorepo defeated the proven path. Everything built since to beat it — context management, the DeepSeek go-forward, the whole memory system, scoped mounts — is now on `main` and **has never been tested against the thing it was built for.**

Per §13-S4 the honest next move is **probing the thesis directly on a real repo, not building another feature.** The operator has now chosen a feature three times (Tvashtr-63 warm-up, Tvashtr-64 tooling benchmark). **Surface it once, take the answer, move on** — do not nag.

**Mv — at least one non-founder shipping real value on their own repo — remains the real project value gate. No amount of shipping resolves it.**

---

## 6. Standing directives (carry these forward verbatim)

**Role.** Claude is **ARCHITECT / PLANNER ONLY.** Direct edits allowed: `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/*.md`, trivial doc/comment/typo fixes. **ALL implementation** — product code, diagnostic scripts, build/Makefile/config — goes through a CLI `/goal`. There is **no "diagnostics are architect-direct" carve-out**: diagnose yourself, but the *fix* goes through a `/goal`.

**The disk audit is the control point.** Never trust the agent's self-report. Read the changed files, diff "untouched" claims against a pre-image, confirm tests are mutation-real by reading the bodies, verify git state from the plumbing.

**Every CLI handoff = THREE fully copyable blocks, every single time, no exceptions, never "same as before":**
1. the shell launch command
2. the **full init prompt, verbatim**
3. the **full `/goal` command, verbatim**

Never tell the operator to retrieve text from `prompts/` or scroll back. (A detailed *brief* may live in `prompts/*.md` and be referenced by the `/goal` — but the init prompt and `/goal` text are always reproduced inline.)

**`/goal` character cap is 4000.** Keep it lean; push detail into a `prompts/*.md` brief.

**The CLI agent runs ALL verification itself** — `make test`, lint, FE build, AND the live smoke/e2e targets — debugging to green before reporting `READY_TO_MERGE`. Never hand the operator a list of commands to run. Only a genuine eyeball glance stays optional-human.

**Merges: FF-only, operator executes.** Always give ALL merge commands as copyable text (`cd`, `git checkout main`, `git merge --ff-only <branch>`, verify, optional `git branch -d`). State the expected tip sha and what to do if the FF fails.

**All git commands handed to the operator must be completely comment-free** — zsh runs inline `#` as a command in non-interactive mode.

**Design decisions:** derive from the §1 vision + the Tvashtr-25 pivot, **never** from effort-minimization. **One design question at a time**, decided (not an option menu — reserve menus for genuine strategic-direction calls). **Pair every decision with its concrete user-facing UX consequence on the canvas — every time.**

**Hand over proactively** as context fills; "handover" from the operator is an immediate trigger.

**Communication:** the operator is terse. "proceed"/"go"/"merged"/"done" = ratify and advance. **"By the way"** = a short answer is wanted. **Give multi-step procedures ONE step at a time.** Simple everyday language; analogies help. Two chat sequences: **Tvashtr-X** (main build loop) and **Tvashtr Sidechat-X** (planning/research) — state which on opening.

---

## 7. Gotchas (not all in PROJECTPLAN)

- **No `git` CLI in the Filesystem MCP.** Reconstruct git state from `.git/refs/heads/<branch>` and `.git/logs/refs/heads/<branch>`.
- **The DEEP audit pass** (worth it every time): copy the loose object from `.git/objects/xx/yyy…` via `copy_file_user_to_claude`, `zlib.decompress` it in bash, parse the tree. **An IDENTICAL subtree hash cryptographically proves that whole subtree byte-intact** — far stronger than a file-level diff. Tvashtr-64 proved every migration + the entire control plane untouched in two hashes, and proved nothing was swept via a zero-added-entries root-tree diff.
- **`copy_file_user_to_claude` caches by BASENAME.** Re-copying a *changed* file returns the STALE copy — this can falsely "prove" a file unchanged. Use `Filesystem:read_text_file` for fresh reads of recently-changed files. (Unchanged files and unique-sha git objects are safe to copy.)
- **`Filesystem:read_text_file` may ignore `view_range`** and return the whole file — expensive on big files. Prefer `head`/`tail`, or copy-then-`grep`/`sed` in the container when the file wasn't previously copied.
- **`PROJECTPLAN.md` is ~460KB with a giant single-line line-6 banner.** Copy to container → `grep -nE '^#{1,3} '` for a header index → `sed -n 'X,Yp'` for targeted reads → `Filesystem:edit_file` with `dryRun:true` first, anchored on multi-line unique text. **§17 is append-only** (prepend the new entry before `## 18. Glossary`).
- **The line-6 banner edit returns a "too large" diff.** Verify by grepping the stored tool-result for the new markers + confirming the hunk header reads `@@ -2,9 +2,9 @@`.
- **`edit_file` dry-run success does NOT guarantee anchor uniqueness** — read the returned diff.
- **Makefile: always surgical `edit_file`, NEVER `write_file`** — recipes are TAB-indented.
- **Playwright's full-page a11y snapshot wedges on the React Flow canvas.** Use targeted `data-id` selectors + `browser_evaluate` + screenshots, or the scripted headless path.
- **Filesystem MCP hangs intermittently** (multi-minute). Full Cmd+Q + reopen of Claude Desktop is the reliable recovery; verify writes landed afterward.
- **Container filesystem (`bash`, `/mnt/user-data/`) and the operator's disk (`/Users/…` via Filesystem MCP) are entirely separate.**
- **`DEFAULT_MODEL` must be a non-reasoning instruct model** — a reasoning model silently returns empty PRD content.
- **Cross-check §17's as-built log, not milestone text**, to determine what actually shipped.

---

## 8. Next step for Tvashtr-65

Nothing is in flight. Open by:
1. Asking the operator **which milestone** — and surface §5 (the brownfield-thesis probe) **once** as the honest alternative to another feature.
2. Asking **which CLI agent** (Claude Code or Grok Build) if they don't say.
3. Then: one design question at a time → the brief → the three copyable blocks → the disk audit → the merge commands.

---

## 9. Ready-to-paste opener for the next chat

> You are Tvashtr-65. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first; then pick up at choosing the next milestone. Don't start work until you've read both.
