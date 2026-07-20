# HANDOVER — Tvashtr-77 → Tvashtr-78

> Read this, then `PROJECTPLAN.md` (§17 Tvashtr-77 = the M-h4 as-built + audit; §17 Tvashtr-75/76 = the M-h4 design + setup; §15 the launch register; §1 the vision). Don't start work until you've read both.

---

## 1. State (verified on disk)

- **`main` @ `7bfd180`** · alembic head **`0030`** · floors **904 backend / 379 vitest** · **no remote** (`.git/config` confirmed — this is what makes bypass mode safe).
- **🟢 TVASHTR IS LIVE, PUBLIC, HTTPS at `https://tvashtr.fly.dev`.** M-h4 (deploy) SHIPPED + FF-merged. Backend on Fly (off the laptop, no WireGuard tunnel), one-origin SPA, Neon Postgres, **sign-in works end-to-end** (the operator clicked "Continue with GitHub" on the live site → signed in), machine sleeps when idle. **This was the last code milestone before public launch.**
- **Tvashtr-77 was: write the M-h4 `/goal` → audit M-h4 (cryptographically) → merge → close out the docs.** The `/goal` + brief (`prompts/M-h4.md`) drove Claude Code; the merge was a plain FF `857d9b2..7bfd180`; the branch is deleted.
- **Untracked (mine, uncommitted):** `PROJECTPLAN.md` + `HANDOVER.md` edits + `prompts/M-h4.md` (the brief). `STATE.md` is CC's (gitignored). **These need committing — see §2.**
- **⚠️ The line-6 banner is ONE CHAT STALE** (it still leads with Tvashtr-76). I did NOT bump it: line 6 is a single ~80K-char blob and any `edit_file` echoes the whole line back, which is a context hazard (the Tvashtr-65 wall). **§17 is authoritative and IS updated.** Tvashtr-78 can bump the banner early with a fresh budget if it wants (prepend a Tvashtr-77→78 segment via the short anchor `**Last updated:** 2026-07-20 — **Tvashtr-76.**`), or just leave it — the banner self-describes as non-authoritative.
- **🔴 OPERATOR HOUSEKEEPING (not blocking):** close `lazyxgenius/trade_mcp` PRs **pull/7 + pull/8 + pull/3 + pull/5** (test PRs from prior live gates).
- **🟡 STANDING OPS CHORE:** the deployed `TVASHTR_FLY_API_TOKEN` is a **short-expiry** org token (`-x 720h` ≈ 30 days). When it nears expiry, re-mint (`fly tokens create org -o personal -x 720h -n tvashtr-deploy`) + re-`fly secrets import` that ONE key, or the live backend loses Fly-API access (can't spawn `tv-run-*` machines).

---

## 2. FIRST — commit the doc closeout (give the operator these commands)

My living-doc edits (this handover + the §17/§15 updates) + the M-h4 brief are uncommitted. They don't affect anything running, but commit them so the record is durable. Hand the operator:

```
cd /Users/adimac/Desktop/Tvashtr
git add PROJECTPLAN.md HANDOVER.md prompts/M-h4.md
git commit -m "docs(m-h4): as-built + launch register + M-h4 brief; handover to Tvashtr-78"
```

(`.gitignore` / `frontend/.gitignore` also show as modified in the working tree — those are pre-existing untracked-tooling edits, not mine; leave them or the operator can add them separately. Do NOT `git add -A` blindly.)

---

## 3. Your job (Tvashtr-78): the launch-planning strategic pass — NOT a `/goal`

Tvashtr is live and works. The milestone ladder (M-h2 → M-h3 → M-h4) is complete. **What's next is a direction decision, not code** — the same shape as the M-h4 design pass (Tvashtr-75): surface ONE question at a time, grounded in §1 + the standing directives, each paired with its concrete UX consequence, explicit sign-off before the next. **This is a genuine strategic-direction call, so here "present the options and let the operator choose" IS warranted** (the rare exception to "no option menus").

The live open questions (sequence them WITH the operator, don't assume):
1. **The `tvashtr.online` cutover** — the registered deferred rider (DNS + `fly certs add tvashtr.online` + swap the GitHub App callback + `TVASHTR_FRONTEND_ORIGIN`/`TVASHTR_PUBLIC_BASE_URL` + the cookie domain from `.fly.dev` to the real domain). This is a small, well-scoped code/config `/goal` when the operator decides to show real users on a real domain. **UX consequence:** users land on `tvashtr.online`, not a `.fly.dev` URL — the difference between "a demo" and "a product" to a stranger.
2. **Seek the first real users? (= attack Mv).** The operator's build-first stance was "no demand validation until a real feature-shipping Tvashtr exists" — and now it EXISTS *and is deployed*. So the door to Mv (a non-founder shipping real value on their own repo) is finally open. This is the real gate; no milestone resolved it. **This is the biggest strategic question** — is now the moment to put it in front of someone?
3. **Pre-launch polish** — anything that would embarrass a first impression (the hosted visible surface is now proven, but there may be rough edges); vs. shipping to a first user as-is and learning.
4. **Cost watch** — the deploy is ~$0 standing (2 HA machines both suspend idle; Neon scale-to-zero). Watch items only: the short-token rotation (§1), the DBOS-holds-Neon-awake question (revisit if compute-hours climb), the optional `fly scale count 1`.

Small ride-along `/goal`s that exist but aren't the headline: the plain-`Mock`→`autospec` test-sweep (§15); the flake fix is already done (M-h2a).

**Don't half-scope this on a thin budget** — if the launch conversation gets deep, it deserves its own room (that's why M-h4's design + `/goal` each got a fresh chat).

---

## 4. How M-h4 was audited (so you trust the "LIVE" claim)

The disk audit was cryptographic (all git objects are loose → decompress with `zlib` + compare subtree/blob SHAs):
- `main` untouched @ `857d9b2`; branch a clean linear 3-commit FF (`efab8d0` D1–D7 → `69c8f35` review fixes → `7bfd180` screenshot); no remote.
- **`frontend/src` subtree byte-identical** (FE source untouched); **`backend/alembic` byte-identical** (NO migration, head `0030`, `models.py`/`alembic.ini`/`uv.lock`/`.claude` all SAME → freeze not bumped, no schema change); **in `engines/`, ONLY `fly_machines.py`+`openhands_fly_adapter.py` changed** (docker/local adapters + `base.py` + `registry.py` byte-identical); **`HANDOVER.md`/`PROJECTPLAN.md`/`.gitignore` blobs SAME** (CC didn't sweep my doc edits).
- The reproduce-first suite (`test_m_h4_deploy.py`) is mutation-real. An adversarial pre-deploy review caught 3 real defects (all fixed + guarded) — chiefly a stale `region=` kwarg that would have silently disabled the orphan reaper. Live smoke 7/7 + the operator's sign-in PASS.

Full detail: §17 Tvashtr-77.

---

## 5. Standing directives (carry forward)

**THREE PERMANENT OPERATOR DIRECTIVES:** (1) **Take all the decisions** — from what's best for the user + product; no option menus (reserve "present both" for genuine strategic-direction calls — and the launch pass IS one). (2) **Cost efficiency for BOTH the user AND the operator is first-class** — near-zero standing budget is HARD-binding (it drove Neon/sleep-when-idle/`.fly.dev`-first/no-2nd-org). (3) **Don't shy from too much work** — decompose big scope across milestones.

**Architect directives:**
- **Claude is ARCHITECT/PLANNER ONLY.** Direct edits: `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/*.md`, trivial typos. ALL implementation (product code, diagnostics, Makefile, config, Dockerfile, fly.toml) goes through a `/goal`. Diagnosing is yours; the *fix* is a `/goal`.
- **The disk audit is the control point.** Never rubber-stamp a report — read the changed files, diff "untouched" claims against a pre-image (git blob/subtree SHAs), read test bodies for mutation-realness, verify git state from `.git` plumbing, scrutinise every deviation.
- **Decide from the vision (§1 + the Tvashtr-25 pivot), never from effort. Pair EVERY decision with its concrete UX consequence.** One design question at a time; explicit sign-off before the next.
- **Every Claude Code handoff = THREE fully copyable blocks, every time:** (1) shell launch (`cd /Users/adimac/Desktop/Tvashtr && claude --dangerously-skip-permissions`), (2) FULL init prompt verbatim (5-line summary then STOP-and-WAIT for the operator to paste `/goal`; use ultracode / dynamic-workflows / superpowers skills when running `/goal`), (3) FULL `/goal` verbatim. Never "same as before," never point at a file to retrieve text. `/goal` under 4000 chars (measure with `python3 -c "print(len(open(f).read()))"`, not `wc`); push detail into a `prompts/*.md` brief the `/goal` points at.
- **Merge handoff = ALL commands as copyable text, every time**, comment-free (zsh runs inline `#`): `cd` to root, `git checkout main`, `git merge --ff-only <branch>`, `git log --oneline -N`, optional `git branch -d <branch>`. State the expected tip; if FF fails → stop (divergence).
- **Visual sign-off = a NUMBERED, click-by-click script** (exact screen, node by its VISIBLE label, exact action, explicit pass/fail); default to CC's Playwright self-sign-off with screenshots.
- **Every `/goal` has CC run ALL checks itself** (tests, lint, live smoke) and debug to green before `READY_TO_MERGE`. Reproduce-first on fixes (RED on pre-fix code). Migration freeze-bump LAST, only if the slice adds one.
- **Operator style:** terse. "proceed"/"go"/"merged"/"done" = ratify + advance. "By the way" = short answer. **Procedures one step at a time.** Analogies help. Simple, everyday language. **LIVE SECRET VALUES NEVER IN CHAT** (a partial value is a leak — never screenshot `.env`; keep the two genuinely-reaching secrets — the Fly token that spends money + the GitHub key that acts on repos — off the wire).
- **Hand over proactively as context fills. Don't half-scope a big milestone/decision on a thin budget.**

---

## 6. Gotchas that will cost you turns (carry-forward)

**Fly / deploy facts:** the deployed app runs **2 machines** (HA default) — both suspend idle → ~$0; `fly scale count 1 -a tvashtr` if strictly one is wanted (operator call). `fly deploy -a tvashtr` builds via Fly's **remote builder** (the local Docker pre-check is flaky on Docker Desktop registry timeouts — don't block on it). `release_command` runs `alembic upgrade head` on a temp machine WITH the staged secrets BEFORE serving (a failed migration aborts the deploy). `bom` (Mumbai) is a KNOWN high-demand region (`insufficient_capacity`) → the ladder is `sin→iad→fra`, `bom` excluded. Org `personal`; `cryptoground-data` is the operator's app, suspended — **NEVER touch it**. `TVASHTR_FLY_API_TOKEN` is ambient in every `make` recipe incl. `make test` — any Fly unit test MUST fake the API (`httpx.MockTransport` + fake token). `.fly.dev` is free HTTPS, no dedicated IPv4. `fly secrets import --stage` stores without deploying; staged secrets auto-apply on the next `fly deploy` (incl. the release machine).

**Filesystem-MCP / tooling:** intermittent multi-minute HANGS — full Cmd+Q + reopen Claude Desktop clears it (and the copy-cache). **`copy_file_user_to_claude` CACHES BY BASENAME** — use `read_text_file`/`read_multiple_files` for fresh reads of changed files, or pull git blobs (all loose, no packs). **`str_replace`/container tools write to CLAUDE's disk** — edit the operator's files with `Filesystem:edit_file` (`dryRun:true` first, SHORT unique anchor) or `Filesystem:write_file` (its param is `content`, NOT `file_text`; both are deferred — `tool_search` to load them). **No `git` CLI in the MCP** — reconstruct from `.git/refs/heads/<b>` + `.git/logs/refs/heads/<b>`; objects loose → `zlib.decompress` a commit/tree/blob; **subtree-SHA identity is the strongest "untouched" proof** (equal subtree SHA between two commit trees = byte-identical subtree in one comparison). **`PROJECTPLAN.md` line 6 is a giant ~80K-char single line** — NEVER read it directly; copy to container, `grep -nE '^#{1,3} '` for a header index, `sed -n 'X,Yp'` a window, edit by a SHORT unique anchor; **and editing it echoes the whole line back (context hazard) — bump the banner early in a session or skip it (§17 is authoritative).** **Playwright full-page a11y snapshot HANGS on React Flow** — targeted `browser_evaluate` + screenshots only. **`--dangerously-skip-permissions`** makes `.claude/settings.json` allow/deny rules inert; only PreToolUse hooks survive (`protect-no-push.sh`, `protect-migrations.sh`) — safe because `.git/config` has no remote. **`web_fetch` only accepts URLs from a prior search/fetch result** — you can't independently curl `tvashtr.fly.dev` from the architect chat (a fresh `.fly.dev` app isn't indexed); rely on CC's live smoke + the operator's eyeball.

---

## 7. Open items / register

- **M-h4 (deploy) — SHIPPED + LIVE (§17 Tvashtr-77).** M-h2 + M-h3 also COMPLETE. The hosted "ships reviewed code" loop is PROVEN GREEN LIVE ON FLY (PR #8, Tvashtr-74).
- **DEFERRED / watch (§15):** the `tvashtr.online` domain cutover (a small `/goal` when showing real users); the slim agent-image lever (cold-boot tuning, measure-then-tune); the plain-`Mock`→`autospec` test-sweep (ride-along); the 2-machine HA posture (`fly scale count 1`, operator call); the short-token rotation chore (operator cadence); the DBOS-holds-Neon-awake watch (revisit if compute-hours climb); the org-isolation-via-separate-org residual (a leaked token can still hit `cryptoground-data`, accepted for $0).
- **🔴 Close `trade_mcp` PRs** pull/7 + pull/8 + pull/3 + pull/5 (operator housekeeping).
- **Mv** (a non-founder shipping real value on their own repo) remains the real gate — no milestone completion resolves it, and with Tvashtr now live-and-deployed the door to attacking it is finally open (§3.2).
- Full register: `PROJECTPLAN.md` §15.

---

## 8. Ready-to-paste opener for Tvashtr-78

> You are Tvashtr-78. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first (HANDOVER §3 = your job; §17 Tvashtr-77 = the M-h4 as-built + audit; §1 = the vision). **Tvashtr is now LIVE, public, HTTPS at `https://tvashtr.fly.dev` — M-h4 (deploy) shipped + merged, sign-in works end-to-end, `main` @ `7bfd180`, head `0030`, floors 904/379.** M-h2 → M-h3 → M-h4 (the whole hosted ladder) is COMPLETE; that was the last code milestone before public launch. **Your job is the launch-planning strategic pass — a direction decision, NOT a `/goal`** (the shape of the M-h4 design pass): surface ONE question at a time, grounded in the vision + the standing directives, each paired with its concrete UX consequence, explicit sign-off before the next — and here "present the options and let me choose" IS warranted (this is a genuine strategic-direction call). The live open questions: the `tvashtr.online` domain cutover (a deferred rider), whether now is the moment to put Tvashtr in front of a first real user (= attack the Mv gate, finally open now that a feature-shipping build is deployed), any pre-launch polish, and the cost/ops watch items. FIRST, though: hand me the doc-closeout commit commands (HANDOVER §2), then also flag whether to bump the stale line-6 banner. Don't start until you've read both docs.

