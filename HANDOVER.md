# HANDOVER → Tvashtr-36

> Continuity snapshot. Read this, then the named `PROJECTPLAN.md` sections, then `prompts/CLI-RULES.md`, **before any work.** You are the **architect/planner** (Claude Code does all implementation — you design, write the `/goal`, hand over the copyable launch package, and audit on disk).

---

## Your first move
1. Verify `main` on disk: read `.git/refs/heads/main` — should be **`8a6faee`** (don't trust this number blindly; the prior handover carried a stale one once).
2. Read `PROJECTPLAN.md` — header banner; §1; §9 (data model — note there is **NO user/auth table yet**); §13 S3/S4; §15 (the deferred register, esp. **Brownfield** + **Production model layer**); §16 (the **M-accounts → BYOK** milestone); and the **2026-06-28 (Tvashtr-35)** §17 entry (it carries the full arc + the **Decision 1/2 → multi-user CORRECTION**).
3. Read `prompts/CLI-RULES.md`.
4. Then pick up at: **slice the M-accounts (auth + ownership) foundation** — the first decision is the **auth/ownership slicing** (see "Immediate next step" below). Don't start until you've read all three.

---

## Where we are
- **`main` @ `8a6faee`** (Slice 5 FF-merged). **Alembic head `0015`** (freeze covers `0001–0015`, enforced by `protect-migrations.sh`). **Test floors: 268 backend pytest / 144 vitest.** ruff/eslint/prettier clean.
- **Both PreToolUse hooks current + verified** (survive `--dangerously-skip-permissions`): `protect-migrations.sh` (blocks `0001–0015`) + `protect-no-push.sh` (blocks `git push`/`reset --hard`).
- **Uncommitted in the working tree** (intentional — the architect's to finalize): `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md` modified + `prompts/brownfield-4-review-gate.md` untracked. These are this session's doc edits (+ a Tvashtr-34 doc carryover). **Commit them as a `docs(tvashtr-35)` commit on `main` at the start of Tvashtr-36** (or now): `git add HANDOVER.md PROJECTPLAN.md STATE.md prompts/brownfield-4-review-gate.md && git commit`. They do NOT affect any branch merge.

## What happened this session (Tvashtr-35)
- **Slice 5 (brownfield worker dep-install nudge) SHIPPED + FF-merged (`8a6faee`, 268/144).** A conditional dep-install directive in `WORKER_PROTOCOL` (worker-only; fires only on a `ModuleNotFoundError`; installs `pip install -e .`/`.[dev]`/`-r requirements.txt`; no-op on dep-free repos). **Committed OFFLINE-only by operator directive** — the two live gates (`brownfield-check`, `brownfield-loop-check`) were SKIPPED because NIM was in a 13h+ degraded window AND the directive is **dormant** in the deps-free gate fixtures (so they give no behavioral signal). Its real validation rides on **rung 2 against `trade_mcp`**. (See §17 + §15 Brownfield.)
- **D4 (reviewer model) RESOLVED:** the model on any node is the **user's** choice (BYOK / hosted-OSS); `.env` keys are test-only. On free credits rung 2 runs the proven `nvidia_nim/meta/llama-3.3-70b-instruct` on **both** nodes (the only free credential that survives the OpenHands loop). So rung 2 tests the **machinery**, not the gate; the stronger-reviewer-gates-spec-met lever moves to the paid/hosted layer.
- **Strategic pivot → the production model layer** (NIM-independent; rung 2 is NIM-blocked). **Decision 1 (single-tenant) and Decision 2 (`.env`-fallback storage) were OVERRIDDEN by the operator** mid-session: a `.env`-fallback would **leak the operator's keys/spend to any keyless multi-user account**, and per-user keys are incoherent without accounts. → re-sequenced to **multi-user**.
- **PROJECTPLAN fully updated + corrected** to the multi-user direction (header, §15, §16, §17). **STATE.md** still shows the Slice-5 `READY_TO_MERGE` (the CLI agent owns it; a future CLI session overwrites it — fine).

## Parked (do NOT spend time on until unblocked)
- **Rung 2** (brownfield loop on `trade_mcp`, feature = add the **DEMA** indicator to `core/indicators.py` following the `IndicatorSpec` registry pattern; operator-run). **Blocked on NIM** — it was in a degraded window all session (8h overnight failure + repeated flakes). Resume when NIM recovers; the rung-2 runbook was never written (write it when NIM is healthy). `trade_mcp` is vetted: Python 3.11, git repo on `main`, ~500KB pytest, registry-based indicators — a strong rung-2 repo.

---

## The active milestone — M-accounts → BYOK (the full ratified shape)
**Goal:** the user picks the model per node — BYOK across a wide provider range, Tvashtr only *recommending* (e.g. heavier reviewer than worker), never enforcing — with **keys scoped per account** (one account's keys never touch another's run). Re-sequenced into two parts:

**(1) M-accounts — auth + ownership foundation (the cascade; build first):**
- A `users` table + **minimal email/password auth**: register / login / logout / current-user. **NOT** OAuth/SSO, email-verification, or password-reset (those are later).
- `provider_credentials` table (`provider`, `secret_encrypted`, `key_last4`, …) **with `owner_id`** — encrypted-at-rest (Fernet/AES-GCM via a `TVASHTR_SECRET_KEY`); plaintext decrypted only at run time; the API never returns it (reads expose only `provider + last4`).
- **`runs.owner_id`** — at run time the executor resolves a provider key per node, so it must know **whose run it is**: resolution = run's owner → that user's key for the provider, **NO `.env` fallback**.
- **`teams.owner_id`** — user-authored teams owned; **template/library teams stay globally shared, read-only** (runs/docs hang off `runs.owner_id`, so they're covered). *(Operator leaned YES on teams-ownership in v1 — confirm when slicing.)*
- A **seed** (migration or script) that creates the **operator's account** and imports the `.env` keys as **their** credentials → operator logs in and runs immediately.
- A **fresh account = zero providers** (the empty "add your first provider" state — operator wants this testable).
- **Playwright self-tests log in as the seeded account** (the harness needs a test-login path to the account holding working keys).

**(2) BYOK shelf + picker (on top of M-accounts):** the Providers settings shelf (add provider, paste key once → "•••• last4 · update · remove", never re-displayed) + the per-node model picker reading the account's configured providers + the dismissible recommendation hints. Resolution swap in `_direct_agent_api_key` (DB-first, per-owner). **Hosted-OSS serving/metering/billing is a later milestone** (§15).

**Why multi-user, not single-tenant (the override rationale, for grounding):** "my keys, not global" *requires* identity; the deferred-auth shortcut produced the exact key/cost leak the operator rejected. Auth + ownership is the right foundation, bounded (minimal auth only).

---

## Immediate next step for Tvashtr-36
**Decision: how to slice M-accounts** (one design question at a time, paired with UX consequence, operator sign-off before the `/goal`). Before presenting it, **diagnose on disk** (architect's job):
- `backend/tvashtr/models.py` — the 12 tables (no user/auth); where `owner_id` columns attach (`provider_credentials` is new; `runs`, `team_graphs` exist).
- `backend/tvashtr/config.py` — `_direct_agent_api_key` (the resolution chokepoint to swap) + settings (for `TVASHTR_SECRET_KEY`).
- `backend/pyproject.toml` — is `cryptography` (Fernet) already a dep, or does it need adding? Is there an auth/session lib, or do we add one (e.g. password hashing via `passlib`/`bcrypt`, sessions/JWT)?
- `backend/tvashtr/main.py` + `routers.py` — where auth middleware / `current_user` dependency would hook in; how endpoints are structured.
- Frontend entry (`App.tsx` / routing) — where a register/login screen gates the app.

Likely slicing (your call to confirm): **Slice A** = backend auth + `users` + session/`current_user` + the `.env`→operator-account seed (migration `0016`; bump the freeze to `0001–0016` as the LAST step). **Slice B** = ownership columns (`runs.owner_id`, `teams.owner_id`, `provider_credentials`) + per-owner resolution (no fallback). **Slice C** = the login/register FE + Playwright login. **Slice D** = the Providers shelf + per-node picker + hints. Each is one milestone-scoped `/goal`, disk-audited, FF-merged. These slices touch NIM **zero** (auth/ownership/UI), so they're unblocked.

**UX consequence to carry:** a register/login screen on entry; the operator's account pre-seeded with the `.env` providers (runs immediately); a new account lands on an empty Providers shelf; each node's picker shows only that account's configured providers; a run resolves its owner's keys; the global fallback is gone.

---

## Open questions
- **`teams.owner_id` in v1?** Operator leaned **YES** (a fresh account shouldn't see the operator's teams) with template/library teams globally read-only. Confirm at slicing.
- **Session mechanism:** cookie-session vs JWT — decide from the stack at slicing (lean: simplest server-side session/signed-cookie for a local-first app; not over-build).
- **Existing rows on migration `0016`:** existing `runs`/`team_graphs` have no owner. The seed backfills them to the operator's account (or leaves them NULL = operator-visible). Decide at slicing.

---

## Standing operator directives (carry forward — these persist)
- **Decide from the vision (§1) + the Tvashtr-25 pivot, never from effort.** If the operator asks "are you deciding from the vision and not shying from work?", that's the calibration signal. **One design question at a time**, decided directly (no option menus for vision calls; reserve "present both" for genuine strategic forks), **each paired with its concrete frontend/UX consequence**, explicit sign-off before the next.
- **ALL implementation via Claude Code** (product code, diagnostic scripts, Makefile/config alike). Architect-direct edits ONLY: `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/*.md`, trivial doc/comment/typo fixes. **No "diagnostics are architect-direct" carve-out** — diagnose yourself (read code/logs/git), but the *fix* goes through a `/goal`.
- **The disk audit is the real control point** — read the changed files, diff against pre-images, verify git state from `.git` plumbing (no git CLI in MCP), confirm tests are mutation-real, scrutinize any deviation. Don't trust agent self-reports.
- **Launch package = ALWAYS fully copyable inline, every time** — (1) shell launch (`cd … && claude --dangerously-skip-permissions`), (2) the FULL init prompt verbatim, (3) the FULL `/goal` verbatim. Never "same as before", never point to a file for the init/`/goal` text. The detailed brief MAY live in `prompts/*.md` (the `/goal` references it).
- **`/goal` = one bounded milestone** (outcome + invariants-as-checkable-evidence + acceptance/evidence checklist incl. live targets the agent runs itself to green + reproduce-first for bug-fixes + stop conditions). Claude Code runs every check itself and echoes decisive lines; never hand the operator commands to run, never defer a live gate to a human.
- **Merge handoff = ALL commands every time** (`cd`, `git checkout main`, `git merge --ff-only <branch>`, verify `git log`, what the verify should print, what to do if FF fails, optional `git branch -d`). Operator always FF-merges.
- **Visual/manual sign-off = detailed, NUMBERED, click-by-click** (exact team by rail name, node by visible label, exact action, explicit pass/fail) — never an abstract checklist. Default to Claude Code's Playwright self-sign-off (targeted `browser_evaluate` on selectors + screenshots, NOT a full-tree snapshot — it chokes on the React Flow canvas).
- **Operator communicates tersely:** "proceed"/"go"/"merged"/"done" = ratify + continue. "By the way" = wants a short answer. **Procedures one step at a time** (give step 1, wait for the report, then step 2). **Analogies help.** Always hand over copyable artifacts.
- **Bound live-gate retries by WALL-CLOCK, not only attempt count** (a single hung NIM attempt ate 30+ min this session; a self-bounding script still needs a per-attempt time cap in the `/goal`).

## Gotchas (not already in PROJECTPLAN/CLI-RULES)
- **NIM is in an extended degraded window** as of 2026-06-28 (8h overnight + all-day flakes: container-unreachable / completes-without-editing / `str_replace` no-match / stuck). Anything needing the OpenHands live loop (rung 2, brownfield gates) will flake — do NIM-independent work (M-accounts) until it recovers.
- **Working-tree edits survive a terminal kill** — a killed Claude Code session loses no on-disk work; recover by reading `.git` + `STATE.md`, then a tight bounded finish `/goal` (don't blindly resume an 8h/multi-`/clear` session — start fresh pointing at the on-disk state).
- **`PROJECTPLAN.md` is ~110KB** with a single massive banner at line 6. Edit via `Filesystem:edit_file` with `dryRun:true` first + exact multi-line anchors (the §17-append anchor: the prior entry's closing text + `---` + `## 18. Glossary`). To read it lean: `copy_file_user_to_claude` → bash `grep -nE '^#{1,3} '` for the header index → `sed -n` targeted ranges. Never read the whole file.
- **`reviewer_model()` (teams.py:114) is already a seam** separate from `engineer_model()`; per-node `model` is honored end-to-end (`run_graph` → `AgentTask`). So a heavier reviewer later = config/authoring, not a rewrite.
- **`_direct_agent_api_key` (config.py)** currently routes `gemini/`/`groq/`/`nvidia_nim/` to their keys, else→`OPENROUTER`. `openai/`+`cerebras/` are NOT wired (fall to the exhausted OpenRouter key). This is the resolution function the BYOK milestone swaps to per-owner DB lookup.
