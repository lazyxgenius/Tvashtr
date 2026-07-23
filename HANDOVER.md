# HANDOVER — for Tvashtr-82

> Read this **and** `PROJECTPLAN.md` (§1 vision, §15 register, §17 log) before doing anything. You are the ARCHITECT/PLANNER; ALL implementation goes through a Claude Code `/goal`. The disk audit is your control point.

---

## §1 — Where we are

- **`main` @ `e2e4a59`** (verified off `.git/refs/heads/main`). Working tree clean except the uncommitted doc-closeout (§2).
- **alembic head `0031`** (`0031_run_artifacts`; verified — there is no `0032` on disk). Floors: **1114 backend / 409 vitest**; lint + build clean.
- **LIVE at `tvashtr.fly.dev`** (2 Fly machines, suspend-when-idle). Hosted GitHub App integration live (`TVASHTR_HOSTED_MODE=true`) — repo discovery **CONFIRMED WORKING LIVE** this session.
- **Just shipped (Tvashtr-80, four branches over three sittings):** live-gate readback (`9ed45bd`, Claude Code) · hosted GitHub installation discovery (`ad6c695`, Grok) · frontend e2e ship-readback (`9163969`, Grok) · Docker build fix (`e2e4a59`, Grok). All zero-migration. Full as-built: §17 Tvashtr-80.
- **Tvashtr-81 wrote the Tvashtr-80 doc closeout** (the previous session could not — the Filesystem MCP was failing). It half-landed at `6b8d996` covering sittings 1–2 only; Tvashtr-81 corrected the header (tip + vitest floor) and appended sittings 3–4, the `.env` process note, the new Grok directive, and four §15 changes.

## §2 — Pending housekeeping (state once, don't nag)

The **doc-closeout is UNCOMMITTED** in the working tree — Tvashtr-81's `PROJECTPLAN.md` edits (§17 Tvashtr-80 completion + §15) plus this `HANDOVER.md` rewrite. Land them whenever with:
```
cd /Users/adimac/Desktop/Tvashtr
git add PROJECTPLAN.md HANDOVER.md
git commit -m "docs(tvashtr-80/81): complete the as-built entry (sittings 3-4) + §15 register + header date field"
```
(Explicit paths only — never `-A`; the ambient untracked noise `.claude/skills/`, `.grok/`, `AGENTS.md`, `CLAUDE.md`, `design/`, old `prompts/M-*.md`, and modified `.gitignore`/`frontend/.gitignore` stays out.) This blocks nothing.

**Also open, stated once:** the commented `x-api-key=` line in `.env` still holds a real-looking `xai-…` key in plaintext. Inert for `make` (it's commented), but readable by any agent that opens the file — and Grok Build demonstrated this session that it *will* open `.env` when a script won't source. Rotate whenever convenient.

## §3 — Your job (Tvashtr-82)

**The launch-planning direction pass** — deferred out of Tvashtr-78, -79 and -80, started in Tvashtr-81. Nothing is queued in front of it. This is a **strategic/direction call, NOT a `/goal`**. Two questions:

1. **Which pre-launch polish is actually worth doing?** Tvashtr is live and the hosted loop is proven end-to-end (real PRs). The question is what a first non-founder user hits that would make them bounce — not a general quality sweep. Ground every candidate in the §1 vision and the Tvashtr-25 pivot, never in "it's cheap to do."
2. **The cost/ops posture for real users.** BYOK means the user's key pays for tokens; the operator's exposure is a Fly microVM per in-flight run plus the always-on backend. M-h3's ceilings (per-owner 3 / fleet 25 / rolling-24h 20) already bound that — the question is whether those numbers are right for a public front door, and what the operator watches to know something is wrong.

Work it **one design question at a time**, decide directly (no option menus for vision calls), and pair every decision with its concrete user-facing UX consequence. Check the Tvashtr-81 chat for how far this got before writing anything new.

## §4 — Standing directives (carry these forward verbatim)

- **Role boundary (permanent):** you are ARCHITECT/PLANNER ONLY. ALL implementation — product code, diagnostic scripts, Makefile/build/config — goes through a Claude Code `/goal`. Your only direct edits: `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/*.md`, trivial typo/comment fixes. Diagnose bugs yourself (read code/logs/git), but the FIX goes through a `/goal`.
- **The `/goal` loop:** ONE lean `/goal` per bounded milestone (outcome + hard invariants-as-evidence + acceptance/evidence checklist Claude Code runs itself + stop conditions). Claude Code self-decomposes. `/goal` hard cap **4000 chars** — measure with `wc -c`. Claude Code runs EVERY gate itself (make test / lint / build / live smoke) and debugs to green — never hand the operator verification commands.
- **Every Claude Code handoff = THREE fully-copyable inline blocks, every time** (even if unchanged): (1) shell launch (`cd … && claude --dangerously-skip-permissions`), (2) the FULL init prompt verbatim, (3) the FULL `/goal` verbatim. Never say "same as before" or point at a `prompts/` file for the init/`/goal` text. The init prompt must: after a ≤5-line summary STOP + WAIT for the `/goal`; and when running the `/goal`, USE ultracode / dynamic-workflows / superpowers.
- **NEW (Tvashtr-80) — every Grok Build prompt must DEMAND a detailed, thorough final report, never a terse summary table.** Required, written into the prompt EVERY time: what changed **per file and why**; the decisive evidence **quoted verbatim** (failing line before, success line after); every command run with its result; any deviation from the brief with its justification; **anything touched outside the stated scope** (especially credentials/config files); what was deliberately NOT done and why; residual risks / follow-ons found.
- **NEW (Tvashtr-80) — fence `.env` explicitly in every Grok/bypass brief.** Under `--dangerously-skip-permissions` only PreToolUse hooks survive, and no hook covers `.env`. An agent blocked by a config file WILL edit the config file. Name it read-only-or-ask, or add a hook.
- **Merge handoff = ALL commands every time** (FF the first branch, `--no-ff --no-commit` the second, `alembic upgrade head` if a migration landed + FULL suite green on the MERGED tree BEFORE committing, then commit, then worktree/branch cleanup). Never assume the operator remembers them.
- **Do NOT nag (operator directive, Tvashtr-78):** never repeatedly prompt about seeking a first real user / the Mv gate — the operator pursues that in their own time. Same for acknowledged housekeeping — state once, then drop.
- **Design decisions:** decide from the §1 vision + the Tvashtr-25 pivot, never path-of-least-resistance; one question at a time; pair every decision with its user-facing UX consequence; don't present option menus for vision calls (reserve that for genuine strategic-direction calls).
- **Two chat sequences (permanent):** "Tvashtr-N" (main build) + "Tvashtr Sidechat-N" (open-ended/brainstorm). Shared project memory. State the sequence + number on opening.
- **Communication:** the operator is terse — "proceed"/"go"/"merged"/"done" = ratify + advance; "By the way" = wants a short answer; pasted terminal output = a confirmation signal. Give procedures one step at a time. Prefer analogies + plain language.

## §5 — Key gotchas & patterns (this session's, plus carried)

- **A green local build is NOT a deploy-safe green.** `.dockerignore` excludes `frontend/e2e`, `backend/tests`, `scripts`, `prompts`, `docs`, `design`, `.claude`. Anything under `frontend/src` importing across one of those boundaries compiles locally and dies inside the image — only `fly deploy` catches it. Registered §15; the cheap fix is a `make build-image` target.
- **A skipped gate reads as "not a failure" — that's the dangerous failure mode.** The 3 repaired e2e specs now hardcode deepseek while their shell wrappers still guard on `NVIDIA_BUILD_API_KEY`. `sandbox_reuse_check.py::_seed_provider` has the right pattern (derive the provider from the model slug). Registered §15.
- **Any residue sweeper MUST filter by AGE, not just the domain.** The repaired specs register `<gate>+${Date.now()}@tvashtr.local`, so a LIVE gate run is also an `@tvashtr.local` account. Domain-only cleanup kills running gates. Registered §15.
- **`TVASHTR_HOSTED_MAX_CONCURRENT_RUNS_GLOBAL=200` in local `.env` is LOCAL-DEV-ONLY** (the real default is 25). Never deploy it. Registered §15.
- **Reproduce-first caught an architect diagnosis error.** The live-gate bug was a RACE, not deterministic — the gates break their poll on run-status-terminal, which is set BEFORE the finally-reap, so they usually won. A static trace missed it. Require the failing-regression-first clause in every bug-fix `/goal`.
- **A half-written closeout is a real hazard.** The Tvashtr-80 docs commit `6b8d996` looked complete but covered only 2 of 4 sittings, and its header asserted a stale tip and vitest floor. Always reconcile the §17 headline against `.git/refs/heads/main` + the reflog before trusting it.
- **PROJECTPLAN.md editing:** ~665KB; **line 6 is an ~81K single-line banner — NEVER read it directly**, and note that even an `edit_file` on the ADJACENT lines echoes it in full as diff context. Tvashtr-81 added a small **"Last updated"** line just above it (lines 5–6 of the header) — **bump THAT from now on, not the banner.** Index by `grep -nE '^#{1,3} '` on a container copy; edit with a unique anchor + `dryRun:true` first; keep payloads small and split edits.
- **`copy_file_user_to_claude` caches by basename** — after you've changed a file, re-copying returns stale bytes. Use `read_text_file` / `read_multiple_files` for fresh reads.
- **Git audit without a git CLI:** `.git/refs/heads/<branch>` → tip; `.git/logs/refs/heads/<branch>` → the full create→merge chain (proves FF-eligibility, parentage, and that nothing was pushed). Worktrees are outside MCP file scope but their commits live in the SHARED object store — walk `.git/objects` and compare subtree/blob SHAs for byte-identity proofs.
- **Docker/DB:** `tvashtr-postgres` is a fixed-name container (host port 5433, user/pass/db `tvashtr`). Restart a stopped one with `docker compose start postgres` from the project root (not `up`).
- **Structural safety backstop:** `.git/config` has NO remote — nothing to push to. Verify before any unguarded/bypass run.

## §6 — Living docs

`PROJECTPLAN.md` + `HANDOVER.md` at the project root (you maintain both). `prompts/CLI-RULES.md` = the Claude Code operating contract. `STATE.md` = the CLI agent's scratch log (gitignored; you read, don't maintain). **Mv** (a non-founder shipping real value on their own repo) remains the real product-value gate — no milestone completion resolves it.
