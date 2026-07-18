# HANDOVER — Tvashtr-71 → Tvashtr-72

> Read this, then `PROJECTPLAN.md` (§17 Tvashtr-71 + Tvashtr-70 entries; §15 Fly-isolation group + the new reviewer-no-op item; §1 vision). Don't start work until you've read both.

---

## 1. State (verified on disk at handover, not reported)

- **`main` @ `87dff19`** · alembic head **`0030`** · floors **819 backend / 379 vitest** · **no remote** (this is what makes bypass mode safe).
- **M-h2b is SHIPPED, DEEP-AUDITED, and FF-merged.** No branch in flight, nothing to merge. `feat/m-h2b-fly-durability` was the branch (12 commits) — merged; the operator may have run `git branch -d` on it.
- **Untracked (mine, uncommitted):** `PROJECTPLAN.md` + `HANDOVER.md` edits, **`prompts/M-h2b.md`** (the M-h2b brief I authored — the operator was offered a snapshot commit; docs ride uncommitted across sessions by precedent, non-blocking), plus older `prompts/*.md`, `design/`. `STATE.md` is gitignored.
- **On the operator's laptop (NOT in the repo, needed for any live Fly gate):** the Fly CLI (`flyctl`); the WireGuard tunnel config at `~/tvashtr-wg.conf`; the App-Store WireGuard client with a tunnel named **tvashtr-wg** — **activate it before any live Fly gate** (dev-time cable only; vanishes at M-h4).
- **Open live-gate PRs to close (operator housekeeping):** `lazyxgenius/trade_mcp` **pull/3** (M-h2a) + **pull/5** (M-h2b's e2e), possibly pull/1–2 too. The gates are re-runnable; closing these is housekeeping, not blocking.

---

## 2. What this session (Tvashtr-71) did — M-h2b DESIGNED, SHIPPED, deep-audited, merged

Designed M-h2b on a full budget (three decisions, each researched + paired with its UX), wrote the brief `prompts/M-h2b.md`, handed the launch package, then **deep-audited the result on disk and merged**. Full as-built is the **§17 Tvashtr-71 entry** (authoritative — read it). In one line: a hosted (Fly) run now **survives the backend dying while parked at a gate** — on restart + approval it reconstructs its microVM handle (HMAC-derived key, no new app), resumes the **suspended** machine (storage-only billing while it waited), and ships; orphaned `tv-run-*` apps are reaped; **NO migration** (storage-free handle).

**The audit proved (cryptographically where possible):** the four Docker blobs byte-identical to `main`; `team_run.py` **additive-only** (0 deletions, +35 lines = only the fly-gated suspend step at both gates); no `0031`; the security-critical tests mutation-real; a clean 12-commit FF chain; 819/379/lint/build green; 2 live gates PASS (`fly-reaper-check`, `fly-reconstruct-probe`), the e2e proves every M-h2b claim but doesn't exit 0 — blocked by a **pre-existing reviewer no-op** (below), NOT by M-h2b.

---

## 3. THREE PERMANENT OPERATOR DIRECTIVES (carry forward forever)

They join the standing directives in §9:

1. **Take all the decisions** — from what's best for the user and the product. **Do not hand the operator option menus** (near-absolute; reserve "present both" for genuine strategic-direction calls only).
2. **Cost efficiency for BOTH the user AND the operator is a first-class design input** — weigh it in every call. (It drove M-h2b's suspend-on-gate + the reaper + the guest→1024 drop.)
3. **Do not shy away from too much work.** Decompose big scope across milestones; don't minimise effort.

---

## 4. Your immediate next job (Tvashtr-72): diagnose the reviewer no-op → then a `/goal` to fix it

**THE FINDING (registered §15, detailed in §17 Tvashtr-71): the hosted `review_loop` reviewer NO-OPS.** It completes in ~1.4s having spent **$0** with no agent-cost row — its agent never runs (no LLM call, no sandbox), so it rubber-stamps "approved" without actually reviewing. **Proven PRE-EXISTING, not M-h2b** (the review-loop routing in `team_run.py` is byte-identical to `main`; the no-op is upstream of the sandbox; identical with a fake restart ~1.348s and a genuine one ~1.550s; the PM/Engineer use the same boot path and ran fine). M-h2a's "did a PR open?" gate couldn't see it — a no-op reviewer approves → the PR still opens. **M-h2b's new e2e is the first gate that watches the reviewer actually work.**

**Why this is the recommended next slice (a vision call, per directive 1):** the product's core promise is agents that ship **reviewed** code — the review IS the differentiator. A reviewer that never calls the model is a rubber-stamp, so this is vision-critical; and it currently **blocks ANY end-to-end hosted-review-loop proof** (not just this gate). *(Alternative if the operator redirects: M-h3 egress/quota/cost — mandatory for public launch. But the reviewer defect undercuts the vision, so I'd fix it first.)*

**How to run it — diagnosis is YOURS (architect), the fix is a `/goal`:**
1. **Diagnose first (read, don't guess).** The reviewer's agent never dispatches, so the cause is in the review-loop routing / node dispatch — start in `team_run.py` (the `run_team` graph walk + the review-loop arm), then how a reviewer node is defined (is it a thinker `completion` or a worker `agent`? what's its `edits_allowed` / capability?), then `agent_run_step` and where it decides to (not) run. Cross-check `cost_records` (only PM + Engineer rows, none for the reviewer). Consider the cousin already in the notes: **a reasoning `DEFAULT_MODEL` silently returns empty content** — could the reviewer's model/config make its agent a no-op? Trace the *called helpers*, not just the top-level file.
2. **Reproduce-first.** The `/goal` must open with a failing test/gate that PROVES the reviewer no-ops (e.g. a hosted review_loop run where the reviewer is forced to revise, asserting a reviewer agent-cost row / a real LLM call exists) — confirmed RED on current code — before any fix.
3. **Then the `/goal`**, single milestone, CC runs all checks + debugs to green. Note: this slice legitimately touches `team_run.py` / the review path, so the "Docker path byte-identical" check still applies (the four Docker blobs, §6) but `team_run.py` will NOT be byte-identical this time — that's expected.

Resolve any design question directly, one at a time, paired with its UX consequence, sign-off before the `/goal`.

---

## 5. Fly facts (all now PROVEN live in M-h2a + M-h2b)

- **Org `personal`**; **default network id `75:f644`** (a run machine's `private_ip` must NOT contain it — the network fence, off the address); **the org's one pre-existing app is `cryptoground-data` — NEVER touch it** (the reaper's `tv-run-*` prefix filter spares it; by-name-asserted).
- **Token in `.env` as `TVASHTR_FLY_API_TOKEN`** — ambient in every `make` recipe **incl. `make test`**. **Any Fly unit test MUST fake the API** (`httpx.MockTransport` + a fake token — mirror the existing tests; a live-hitting test flakes + spends).
- **Fly lifecycle is all `httpx`, no CLI.** Suspend/resume PROVEN this session: suspend `POST /v1/apps/<app>/machines/<id>/suspend`; confirm `GET .../wait?state=suspended`; **resume = `POST .../machines/<id>/start`**. List apps (reaper): `GET /v1/apps?org_slug=<org>`. IP alloc is the one GraphQL mutation (`allocateIpAddress`, `private_v6`).
- **A suspended machine costs the SAME as a stopped one — storage only, no CPU/RAM.** Resume is BEST-EFFORT (can silently cold-boot on host migration/capacity); the design survives because durable state is the host workspace + DBOS checkpoints, never guest RAM (rootfs isn't reset on resume). **Suspend requires ≤2GB RAM** (guest default is now **1024**), no swap/schedule/GPU.
- **The per-run session key is DERIVED, not stored:** `HMAC-SHA256(TVASHTR_FLY_SESSION_SECRET, run_id)` — re-cut on any process, never logged/persisted (C8). New `.env` config `TVASHTR_FLY_SESSION_SECRET`.
- **`make fly-reconstruct-probe`** is the cheap, durable regression gate for the whole durable-handle mechanism (re-derive key + re-discover machine + resume + fence checks) — keep it; it's the primary Piece-3 proof.
- **Live Fly gate prerequisite:** the **tvashtr-wg** tunnel must be **Active**; token present but Flycast unreachable = an infra STOP, not a silent skip. Gates spend real money + skip cleanly without the token/keys.

---

## 6. The byte-identity audit technique (it worked twice — reuse it)

**git blob SHA identity** bypasses the `copy_file_user_to_claude` basename cache entirely. All objects in `.git/objects` are **loose** (`.git/objects/pack` empty), so decompress any commit/tree/blob with Python `zlib` in the container, OR (simpler, used this session) hash a working-tree file with git's own algorithm — `sha1(b"blob " + str(len(data)).encode() + b"\0" + data)` — and compare to the pin; identical SHA ⟺ byte-identical. **The four Docker-path pins (unchanged by M-h2b, still the baseline for any "Docker path unchanged" check):** `openhands_docker_adapter.py` = `a7db0684e84d…`, `docker_runtime.py` = `af15fca9041d…`, `sandbox_cache.py` = `e2645c855e64…`, `base.py` = `9593aa76ddb7…`. **Additive-only check** (used on `team_run.py` this session): diff a fresh copy vs the pre-image and grep `^-[^-]` — 0 = no deletions/modifications. (The container had my grounding-time `main` copies in `/mnt/user-data/uploads`; a fresh `copy_file_user_to_claude` after the Desktop restart came back un-stale — but verify freshness with a grep for a known-new token.)

---

## 7. Gotchas that will cost you turns

- **The Filesystem MCP intermittently HANGS (multi-minute timeout).** The reliable fix is a full **Cmd+Q and reopen of Claude Desktop** — ask the operator, then resume. (Hit once this session; the restart also seemed to clear the copy-cache.)
- **`copy_file_user_to_claude` CACHES BY BASENAME** — re-copying a changed file can return stale bytes. Use `read_multiple_files`/`read_text_file` for fresh reads, or pull git blobs (all loose). Verify freshness by grepping for a token you know is new.
- **`str_replace` and container tools write to CLAUDE's disk, not the operator's.** Edit the living docs with **`Filesystem:edit_file`** (surgical, `dryRun:true` first) or **`Filesystem:write_file`** (full rewrite; param is `content`).
- **No `git` CLI in the MCP.** Reconstruct git state from `.git/refs/heads/<branch>` + `.git/logs/refs/heads/<branch>`. Make the `/goal` produce hashes; you verify from plumbing.
- **`PROJECTPLAN.md` line 6 is a giant single-line banner (~81K chars).** NEVER read it directly (grep a copy). To edit it, anchor on a SHORT unique substring (e.g. the `**Tvashtr-NN.**` token) and `dryRun:true` first — worked cleanly this session. The file is ~560KB: copy → `grep -nE '^#{1,3} '` for a header index → `sed -n 'X,Yp'`. `/mnt/user-data/uploads` is READ-ONLY (copies land there; write scratch to `/tmp`).
- **`wc -c` counts BYTES; the `/goal` 4000 cap is CHARACTERS.** The `—/·/→/≥/≤` etc. are multi-byte, so `wc -c` over-counts — measure characters (`python3 -c "print(len(open(f).read()))"`). This session's `/goal` read "4005 bytes" but was 3953 chars.
- **The Makefile leaks `.env` into every recipe** — no test may depend on ambient posture; any Fly test fakes the API.
- **Bypass mode caveat (surface it every handoff):** `--dangerously-skip-permissions` makes `.claude/settings.json` allow/deny rules inert; only PreToolUse hooks survive (`protect-no-push.sh`, `protect-migrations.sh`). What makes it safe is `.git/config` having NO remote.
- **`/goal` detail → a `prompts/*.md` brief** (allowed architect edit), point the `/goal` at it — but reproduce the init-prompt + `/goal` INLINE in the handoff regardless. **`prompts/*.md` is UNTRACKED** ⇒ a `git worktree` never sees it (fine for a solo main-checkout session; commit the brief first for a parallel batch).
- **CLI-RULES.md is STALE** — the `/goal` must carry real ground truth, not point at it.
- **Playwright's full-page a11y snapshot HANGS** on the React Flow canvas — targeted `browser_evaluate` + screenshots only.
- **All git commands to the operator must be comment-free** (zsh runs inline `#` in non-interactive mode).
- **Live tokens never go in chat.** If one is pasted: `fly tokens list -o personal` → `fly tokens revoke <id>` → re-mint into `.env`.

---

## 8. Standing directives (carry forward; the 3 permanent operator ones are §3)

- **Claude is ARCHITECT/PLANNER ONLY.** Direct edits: `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/*.md`, trivial typo fixes. **ALL** implementation — product code, diagnostics, Makefile — goes through a `/goal`. No "diagnostics are architect-direct" carve-out. Diagnosing is yours; the *fix* is a `/goal`.
- **The disk audit is the control point.** Never rubber-stamp a report. Read the test bodies; check both failure modes; verify empirically (git blobs, the live gate output). Scrutinise every deviation by reading the real change.
- **Decide from the vision (§1 + the Tvashtr-25 pivot), never from effort.** Pair **every** decision with its concrete **UX consequence**. One design question at a time; no option menus for vision calls.
- **Every Claude Code handoff = THREE fully copyable blocks, every time:** (1) the shell launch (with `--dangerously-skip-permissions`), (2) the FULL init prompt verbatim (incl. stop-and-wait after its 5-line summary; use ultracode / dynamic-workflows / superpowers skills), (3) the FULL `/goal` verbatim. Never "same as before," never point at a file to retrieve text.
- **Merge handoff = ALL commands as copyable text, every time** (`cd`, `git checkout main`, `git merge --ff-only <branch>`, the verify line + expected tip, optional `git branch -d`). Never just "FF-merge it." Comment-free.
- **Visual sign-off = a NUMBERED, click-by-click script** — exact screen, node by its **visible label**, exact action, explicit pass/fail. Default to CC's Playwright self-sign-off with screenshots.
- **Every `/goal` instructs CC to run ALL checks itself** and debug to green before `READY_TO_MERGE`. Reproduce-first on fixes (regression confirmed RED on pre-fix code; use `pytest.raises((A, B))` so the *assertion* fails, not an error). Migration freeze-bump LAST, only if the slice adds one. Word stop clauses to split "second/unknown problem needing a broad/unproven change → NEEDS_HUMAN" from "code-proven, contained, regression-guarded fix → may proceed."
- **Operator style:** terse. "proceed"/"go"/"merged"/"done" = ratify + advance. "By the way" = short answer. **Procedures one step at a time.** Analogies help. Simple, everyday language.
- **Hand over proactively as context fills.** Don't half-scope a big milestone on a thin budget.

---

## 9. Open items

- **Diagnose + fix the reviewer no-op** — your immediate next job (§4). Recommended over M-h3 (vision-critical + blocks any end-to-end review-loop proof).
- **🔴 Close the M-h2a/M-h2b gate PRs** — `trade_mcp` pull/3 + pull/5 (+ maybe 1–2). Operator housekeeping; gates re-run.
- **🔴 Hosted mode's visible surface has never been rendered for a human eye** (M-h1b's Playwright screenshots deferred; logic proven in jsdom only). A Playwright pass or a numbered click-by-click glance needed **before M-h4**.
- **🔴 `set_session_cookie` hardcodes `secure=False`** — production over https MUST set True. **Blocks public launch (M-h4).**
- **🔴 `run_events` cannot see the condenser** (Tvashtr-67) — C1 has no durable artifact; fix before any further C1 claim (extend `_kind_of` in `openhands_adapter.py` with a `condensation` kind).
- **Milestone sequence to launch:** the reviewer-no-op fix (recommended) → **M-h3** (egress/quota/cost — mandatory for public launch) → **M-h4** (deploy: the `secure=False` cookie, TLS, domain, region-for-users, Tvashtr's runs in their own Fly org). **Mv** (a non-founder shipping real value on their own repo) remains the real gate.
- **Naming collision** ("Tvashtr" vs a Vedic deity + Indian companies) — operator deferred; revisit before M-h4 buys a domain.
- **New M-h2b-surfaced edges (in §15/§17):** a run needing >2GB RAM can't be suspended (guest is 1024; a >2GB workload would stay running at a gate) — an M-h3/M-h4 edge; the SLIM IMAGE half of the image/guest lever is still OPEN (M-h2b only dropped the guest, didn't rebuild the 1.37 GB image).
- Full register: **`PROJECTPLAN.md` §15** — incl. clone GC (M-h3), the installation-token-in-argv host-clone exposure (really M-h4 when the host becomes a public server), agent-native resume / conversation-id re-attach (Option B — M-h2b uses the safe re-run-from-host fallback instead), and the above.

---

## 10. Ready-to-paste opener for Tvashtr-72

> You are Tvashtr-72. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first (HANDOVER §4 + §17's Tvashtr-71 entry especially). Then pick up at the reviewer-no-op slice: **diagnose** why the hosted `review_loop` reviewer runs no agent (spends $0, no sandbox, ~1.4s — pre-existing, proven not M-h2b) by reading the review-loop routing in `team_run.py` and the reviewer node's execution path, reproduce-first, then write the `/goal` to fix it. Don't start work until you've read both docs.
