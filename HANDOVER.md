# HANDOVER — for Tvashtr-82

> Read this **and** `PROJECTPLAN.md` (§1 vision, §15 register, §17 log — start with the **Tvashtr-81** entry at the end of §17) before doing anything. You are the ARCHITECT/PLANNER; ALL implementation goes through a Claude Code `/goal`. The disk audit is your control point.

---

## §1 — Where we are

- **`main` @ `e2e4a59`** (verified off `.git/refs/heads/main`). **NO code shipped in Tvashtr-81** — it was a docs + diagnosis session.
- **alembic head `0031`**. Floors **1114 backend / 409 vitest**. LIVE at `tvashtr.fly.dev`.
- **Hosted GitHub repo listing now WORKS** for the operator (both localhost and `.fly.dev`) — but only because they re-authenticated. See §3.
- **The hosted loop got further than ever on a real user run:** repo picked → PM wrote a PRD → operator approved the gate → **Engineer FAILED**. That failure is your first job.

## §2 — Pending housekeeping (state once, don't nag)

The **doc work is UNCOMMITTED**: `PROJECTPLAN.md` (the completed Tvashtr-80 entry, the new Tvashtr-81 entry, §15 additions, the new header date field) + this `HANDOVER.md`.
```
cd /Users/adimac/Desktop/Tvashtr
git add PROJECTPLAN.md HANDOVER.md
git commit -m "docs(tvashtr-80/81): complete as-built + Tvashtr-81 findings, §15 register, header date field"
```
(Explicit paths only — never `-A`.) Blocks nothing.

**Also open, stated once:** the commented `x-api-key=` line in `.env` still holds a real-looking `xai-…` key in plaintext. Inert for `make`, readable by any agent that opens the file. Rotate whenever convenient.

## §3 — Your job (Tvashtr-82), in order

### FIRST — diagnose the Engineer failure (run `6fd2c911`)

The operator's first real hosted run on localhost: `deepseek/deepseek-chat`, **Edits on**, OpenHands engine, cost **$0.0036**, branch `tvashtr/6fd2c911-ebb8-4047-9a7d-921d1c91972b`, node status **Failed**.

What is already ruled out by observation:
- **Not credentials** — the run started, so the DeepSeek key resolved.
- **Not sandbox boot** — the Activity feed shows real `file_editor` actions and observations (all stamped 13:48:39).
- **Not context overflow** — Round 1 totalled **1,029 / 110,000** tokens (node_prompt 97, idea 10, spec 441, grounding 139, worker_protocol 342).
- The last logged action reads **"All edits are com…"** — so the agent believed it had finished, and the node failed at or after that point. Suspect the post-agent path (outcome/verdict parsing, the ship step, or diff persistence), not the agent loop.

**Ask the operator for the backend terminal output around 13:48:39** — they had `run backend` open; the real exception is there and is not visible in the UI. Diagnose it yourself from the code before writing any `/goal`, and trace the called helpers, not just the top-level file.

⚠️ **Note the environment**: local `.env` has `TVASHTR_HOSTED_MODE=true`, so a localhost run takes the **hosted** path — server-side clone + a **Fly per-run microVM**, not a local sandbox. Factor that in.

### THEN — the error-legibility `/goal`

Tvashtr-81 found **four defects with one root cause** (full detail in §17 Tvashtr-81 and §15). The backend returns correct codes and structured, actionable `detail` payloads; the frontend throws them away and substitutes a wrong guess. Scope for the `/goal`:
1. `LaunchPanel.tsx:413` — read the already-returned `installation_count` and split the message: `0` ⇒ "sign in with GitHub again"; `>0` ⇒ "Add repositories on GitHub".
2. Render the backend's real `detail.message` on a failed launch instead of "Couldn't start the run — is the backend running?" (a 422/429 means the backend answered).
3. Add `deepseek` to `Dashboard.tsx` `PROVIDER_SUGGESTIONS` — it is the product's own default agent model and is missing.
4. **A backfill for GitHub installations** — discovery runs ONLY in `github_callback`, so every already-signed-in account is stranded with no row and no way to know why. Deploying does not help; only a fresh sign-in does.

This is ONE coherent, well-bounded milestone and it is the highest-value pre-launch work. It needs FE tests plus a live sign-off (Playwright, screenshot per check).

### THEN — finish the launch-planning pass

**Question 1 is DECIDED and recorded** (§17 Tvashtr-81): legibility before subsidy — make failures legible first because it costs nothing; hold the operator-funded token allowance as a later bet, only if a legible version still fails to convert. **Question 2 is still open:** the cost/ops posture for real users — are the M-h3 ceilings (per-owner 3 / fleet 25 / rolling-24h 20) right for a public front door, and what does the operator watch to know something is wrong?

## §4 — Standing directives (carry these forward verbatim)

- **Role boundary (permanent):** you are ARCHITECT/PLANNER ONLY. ALL implementation — product code, diagnostic scripts, Makefile/build/config — goes through a Claude Code `/goal`. Your only direct edits: `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/*.md`, trivial typo/comment fixes. Diagnose bugs yourself (read code/logs/git), but the FIX goes through a `/goal`.
- **The `/goal` loop:** ONE lean `/goal` per bounded milestone (outcome + hard invariants-as-evidence + acceptance/evidence checklist Claude Code runs itself + stop conditions). `/goal` hard cap **4000 chars** — measure with `wc -c`. Claude Code runs EVERY gate itself (make test / lint / build / live smoke) and debugs to green — never hand the operator verification commands.
- **Every Claude Code handoff = THREE fully-copyable inline blocks, every time** (even if unchanged): (1) shell launch (`cd … && claude --dangerously-skip-permissions`), (2) the FULL init prompt verbatim, (3) the FULL `/goal` verbatim. Never say "same as before" or point at a `prompts/` file for the init/`/goal` text. The init prompt must: after a ≤5-line summary STOP + WAIT for the `/goal`; and when running the `/goal`, USE ultracode / dynamic-workflows / superpowers.
- **Every Grok Build prompt must DEMAND a detailed, thorough final report** (Tvashtr-80), never a terse table: per-file what and why; decisive evidence quoted verbatim; every command + result; deviations with justification; anything touched outside scope (especially credentials/config); what was deliberately NOT done; residual risks.
- **Fence `.env` explicitly in every Grok/bypass brief** (Tvashtr-80). Under `--dangerously-skip-permissions` only PreToolUse hooks survive and none covers `.env`. An agent blocked by a config file WILL edit it.
- **Merge handoff = ALL commands every time** (FF the first branch, `--no-ff --no-commit` the second, `alembic upgrade head` if a migration landed + FULL suite green on the MERGED tree BEFORE committing, then commit, then cleanup).
- **Do NOT nag (Tvashtr-78):** never repeatedly prompt about the first real user / the Mv gate. Same for acknowledged housekeeping — state once, then drop.
- **Design decisions:** decide from the §1 vision + the Tvashtr-25 pivot, never path-of-least-resistance; one question at a time; pair every decision with its user-facing UX consequence; no option menus for vision calls.
- **Two chat sequences (permanent):** "Tvashtr-N" (main build) + "Tvashtr Sidechat-N". State the sequence + number on opening.
- **Communication:** the operator is terse — "proceed"/"go"/"merged"/"done" = ratify + advance; "By the way" = wants a short answer; pasted terminal output = a confirmation signal. Procedures **one step at a time**. Prefer analogies + plain language.

## §5 — Key gotchas & patterns

- **DRIVE THE PRODUCT — it is the cheapest bug-finder you have.** Tvashtr-81 found four real defects in one hour by watching the operator do a normal first run. None was caught by 1114 backend + 409 vitest tests plus every live gate, because they are all *legibility* defects: the system was correct and the human was misinformed. Green gates do not mean a usable product.
- **A correct fix can still be invisible.** The Tvashtr-80 GitHub fix was properly implemented and still looked broken for a full session, because it only fires at OAuth-callback time and there is no backfill. Always ask "what makes this take effect for accounts that already exist?"
- **Keys are PER-ACCOUNT, not from `.env`** (since M-accounts). `.env` holding `DEEPSEEK_API_KEY` does nothing for a run — the run resolves credentials from the signed-in account. Signing in as a different identity means no keys.
- **`.dockerignore` asymmetry:** a green `make build-frontend` does NOT prove the Docker build is green (`frontend/e2e`, `backend/tests`, `scripts`, `prompts`, `docs`, `design`, `.claude` are excluded). Only an image build catches it.
- **A skipped gate reads as "not a failure"** — the 3 e2e specs hardcode deepseek while their shell wrappers still guard on `NVIDIA_BUILD_API_KEY`. `sandbox_reuse_check.py::_seed_provider` has the right pattern.
- **Any residue sweeper MUST filter by AGE** — live gate runs are also `@tvashtr.local` accounts. Domain-only cleanup kills running gates.
- **`TVASHTR_HOSTED_MAX_CONCURRENT_RUNS_GLOBAL=200` in local `.env` is LOCAL-DEV-ONLY** (real default 25). Never deploy it.
- **PROJECTPLAN.md editing:** ~670KB; **line 6 is an ~81K single-line banner — never read it**, and note an `edit_file` on ADJACENT lines still echoes it as diff context. A **"Last updated"** line now sits just above it — bump THAT. Index with `grep -nE '^#{1,3} '` on a container copy; unique anchor + `dryRun:true` first; keep payloads small and split edits.
- **`copy_file_user_to_claude` caches by basename** — re-copying a changed file returns stale bytes. Use `read_text_file` for fresh reads.
- **Git audit without a git CLI:** `.git/refs/heads/<branch>` → tip; `.git/logs/refs/heads/<branch>` → the full merge chain. Worktrees are outside MCP scope but their commits are in the SHARED object store — walk `.git/objects` and compare subtree/blob SHAs for byte-identity proofs.
- **When grepping a long function for its failure paths, read the WHOLE function.** Tvashtr-81 truncated a grep window on `create_run`, enumerated two 422 candidates, and the real one was a third path below the cut.
- **Docker/DB:** `tvashtr-postgres` is fixed-name (host port 5433, user/pass/db `tvashtr`). Restart with `docker compose start postgres` from the project root (not `up`).
- **Structural safety backstop:** `.git/config` has NO remote. Verify before any bypass run.

## §6 — Living docs

`PROJECTPLAN.md` + `HANDOVER.md` at the project root (you maintain both). `prompts/CLI-RULES.md` = the Claude Code operating contract. `STATE.md` = the CLI agent's scratch log (gitignored). **Mv** (a non-founder shipping real value on their own repo) remains the real product-value gate — no milestone completion resolves it.
