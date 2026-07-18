# HANDOVER — Tvashtr-70 → Tvashtr-71

> Read this, then `PROJECTPLAN.md` (**§1 vision**, **§15 deferred register**, **§17 as-built log — authoritative + append-only; read §17, NOT the line-6 banner**). Don't start work until you've read both.

---

## 1. State (verified on disk at handover, not reported)

| | |
|---|---|
| `main` | **`5bc2c25`** — M-h2a FF-merged here this session (verified: `.git/refs/heads/main`) |
| Branches | **none** (`feat/m-h2a-fly-sandbox` FF-merged; optional `-d` cleanup was offered) |
| Remote | **NONE in `.git/config`** ⇒ pushing Tvashtr's own repo is *structurally impossible* (this is what makes bypass mode safe) |
| Alembic head | **`0030_hosted_github_run`** — UNCHANGED (M-h2a added no migration) |
| Freeze hook | blocks **`0001`–`0030`**, allows `0031` (M-h2b's migration bumps it LAST) |
| Floors | **776 backend / 379 vitest** (was 737/379; +39 backend from the Fly + flake tests) |
| Agent model | **DeepSeek** — `.env` `TVASHTR_AGENT_MODEL=deepseek/deepseek-chat` |
| `.env` | `TVASHTR_HOSTED_MODE=true` + five `GITHUB_APP_*` + **`TVASHTR_FLY_API_TOKEN=FlyV1…`** (org-scoped, `tvashtr-mh2-2`) + the six `TVASHTR_FLY_*` knobs M-h2a added (see `.env.example`) |
| Deployed? | **NO.** `localhost:8000` + Vite `:5173` on the operator's MacBook. No server, no domain, no TLS. |

**Untracked (mine, uncommitted):** `PROJECTPLAN.md` + `HANDOVER.md` edits, `prompts/M-h2a.md` (+ older `prompts/*.md`), `design/`. `STATE.md` is gitignored. **Nothing to merge — the M-h2a code is already on `main`.** (An optional copyable command to snapshot the doc/prompt changes was offered to the operator; they ride uncommitted across sessions by precedent — non-blocking.)

**On the operator's laptop (NOT in the repo, needed for any live Fly gate):** the Fly CLI (`flyctl`); the WireGuard tunnel config at `~/tvashtr-wg.conf` (holds a private key, deliberately outside the repo); the App-Store WireGuard client with a tunnel named **tvashtr-wg** — **activate it before any live Fly gate** (dev-time cable only; vanishes at M-h4).

---

## 2. What this session (Tvashtr-70) did — M-h2a SHIPPED, deep-audited, merged

**M-h2a shipped end-to-end.** The M-h2 `/goal` was split (per §8 of the last handover) into **M-h2a** (*the Fly sandbox works at all*) — done this session — and **M-h2b** (durability + economics) — next. Full as-built is the **§17 Tvashtr-70 entry** (authoritative; read it).

- **Wrote the M-h2a launch package** — a brief at `prompts/M-h2a.md` + the three copyable blocks; the `/goal` measured under 4000 chars.
- **Claude Code shipped it** on `feat/m-h2a-fly-sandbox` (5 commits, tip `5bc2c25`): new `engines/fly_machines.py` (pure `httpx` Fly lifecycle) + `engines/openhands_fly_adapter.py` (the third adapter) + 33 unit tests + the Task-A probe + a live PR gate; `registry.py`/`team_run.py`/`config.py`/`.env.example` touched; the cookie flake fixed; **NO migration**.
- **Deep on-disk audit — verdict PASS.** The headline invariant (**the Docker path stays byte-identical**) was **cryptographically proven** by walking both commits' git trees and comparing blob SHAs (all objects loose, decompressed with Python zlib): `openhands_docker_adapter.py` / `docker_runtime.py` / `sandbox_cache.py` / `base.py` byte-identical to `main`; the local `openhands_adapter.py` too. Also verified: clean linear FF-able chain, nothing pushed, both fences real off the address/off the live door, the flake fix reproduce-first + mutation-real, every Fly unit test fakes the API (no socket, no spend), the reuse-not-copy proof (the sync helpers left unpatched).
- **FF-merged** → `main` @ `5bc2c25` (verified on disk). **Doc closeout done:** §17 Tvashtr-70 entry appended, §15 Fly-isolation group updated (reaper + tuning lever + durable-handle registered), the line-6 banner bumped.

**Live-proven:** a real PR (`lazyxgenius/trade_mcp` **pull/3**) whose agent work ran inside a Fly microVM; `private_ip` = `fdaa:9e:cfa6:…` (NOT `75:f644` → network fence PASS); unkeyed request → 401 (key fence PASS); app gone post-run (no leak). **Cost lever MEASURED:** image 1.37 GB compressed → 83.7s cold-host boot / 99.3s to serving; peak guest memory 570 MB vs a 2048 MB default.

---

## 3. THREE PERMANENT OPERATOR DIRECTIVES (carry forward forever)

Given explicitly in Tvashtr-69; they join the standing directives in §9:

1. **Take all the decisions** — from what's best for the user and the product. **Do not hand the operator option menus** (near-absolute; reserve "present both" for genuine strategic-direction calls only).
2. **Cost efficiency for BOTH the user AND the operator is a first-class design input** — weigh it in every call. (It shaped M-h2's org choice and the per-run-vs-per-node call.)
3. **Do not shy away from too much work.** Decompose big scope across milestones; don't minimise effort.

---

## 4. Your immediate next job (Tvashtr-71): design M-h2b, THEN write its `/goal` — on a full budget

M-h2a made hosted runs genuinely isolated + demoable. **M-h2b is the durability + economics layer** and it needs a **short design pass FIRST** (like M-h2 got in Tvashtr-69), then a single-transcript `/goal`. It is a real milestone (a migration + suspend wiring + a reaper + a restart-survival proof) — **do not half-scope it on a thin budget; that's exactly the failure the rules forbid.** M-h2b has THREE pieces + a migration:

- **D3 — suspend-on-gate.** When a run parks at a human-approval gate, **SUSPEND** its Fly machine (Fly *suspend*, **NOT** *stop* — stop resets the machine to its original state and throws the agent's conversation away; suspend snapshots memory). On approval, resume. *Design question:* where in the gate path (`run_graph`'s `wait_at_gate` arm) does suspend fire, and does Fly's suspend/resume survive the round-trip cleanly? *UX:* click Approve in the morning → the team resumes mid-thought → you weren't billed while it waited.
- **The orphan REAPER.** M-h2a guarantees only no *self*-leak (teardown in a `finally` + the run-end `close_run_sandboxes` hook); a backend crash mid-run can still orphan a `tv-run-*` app that bills forever. The reaper lists `tv-run-*`, deletes any with **no live/active run row** — and **NEVER touches `cryptoground-data`** (a written invariant; it doesn't match `tv-run-*`). *Design question:* boot-sweep + periodic? (mirror the Docker reaper's shape.) *UX:* none — the cost story ("no orphaned VMs").
- **Durable handle across a BACKEND restart** — the crux. Today the per-run key + per-node conversation ids live in the in-process `_RUNS` cache; a backend restart loses them, so a suspended run can't be resumed by a fresh process. The `.flycast` host is already derived from run_id (free). *Design question:* persist the per-run key + conversation ids (a new `run_sandboxes` table / columns → the migration) **OR** re-derive the key deterministically (e.g. `HMAC(server-secret, run_id)` — fresh-per-run AND storage-free) and persist/re-discover the conversation ids (`RemoteConversation` attaches by id — but the id is minted by the agent server, so decide: persist it, or re-list it from the machine). This is what makes "the team works while you sleep" survive the *backend*, not just the browser.
- **Migration `0031`** — whatever the durable handle needs. **Freeze-bump LAST**, and only if the slice actually adds a migration.

Resolve each design question directly, one at a time, paired with its UX consequence, and get sign-off before the `/goal`. Full context: §17 (Tvashtr-70 + Tvashtr-69 entries) and §15 (the Fly-isolation group).

---

## 5. Fly facts that carry into M-h2b (all proven in M-h2a / Tvashtr-69)

- **Org slug is `personal`** (one org — Flycast's cross-network door is documented within one org only).
- **Default network id is `75:f644`** — every Fly private address is `fdaa:<network-id>:…`, so a run machine's `private_ip` MUST NOT contain it (the network fence, checkable straight off the address). M-h2a's live gate confirmed a run machine landed on `9e:cfa6`.
- **The org's one pre-existing app is `cryptoground-data`** — the reaper's `tv-run-*` filter is safe; **never touch it** (written invariant).
- **Token in `.env` as `TVASHTR_FLY_API_TOKEN`** — the Makefile does `include .env` + `export`, so it's ambient in every `make` recipe **including `make test`**. **Any Fly unit test MUST fake the API and never reach it** (M-h2a's tests bind `httpx.MockTransport` + a fake token — mirror that; a live-hitting test flakes and spends money).
- **Fly lifecycle is REST** (`POST /v1/apps`, `POST …/machines`, `wait?state=started`, `DELETE /v1/apps/<name>`); IP allocation is the one GraphQL mutation (`allocateIpAddress`, `private_v6`) at `api.fly.io/graphql`. **No CLI shell-out** — all `httpx`. (For M-h2b: confirm the suspend/resume endpoints — likely `POST …/machines/<id>/suspend` + `.../start`.)
- **Live Fly gate prerequisite:** the WireGuard **tvashtr-wg** tunnel must be **Active** so the laptop backend can reach a `.flycast` address; if the token is present but Flycast is unreachable, that's an infra STOP, not a silent skip.

---

## 6. The byte-identity audit technique (it worked — reuse it)

The strongest audit this project has: **git blob SHA identity**, which bypasses the `copy_file_user_to_claude` basename cache entirely. All objects in `.git/objects` are **loose** (`.git/objects/pack` is empty), so you can decompress any commit/tree/blob with Python `zlib` in the container and walk the tree yourself. Compare a file's blob SHA at two commits: identical SHA ⟺ byte-identical content (git is content-addressed). Walk root → `backend` → `tvashtr` → `engines` and compare the entries.

**Baseline for M-h2b's "Docker path unchanged" check** (these must stay byte-identical while M-h2b touches the *fly* files + adds a migration + a reaper): `openhands_docker_adapter.py` = `a7db0684e84d…`, `docker_runtime.py` = `af15fca9041d…`, `sandbox_cache.py` = `e2645c855e64…`, `base.py` = `9593aa76ddb7…`. The current (post-merge) **`engines/` subtree hash is `21ec2bab6b626dcc22ccbfe4f2224805006a3057`** — but note M-h2b WILL modify `fly_machines.py` + `openhands_fly_adapter.py` (suspend/durable handle), so the *subtree* hash will change; check the four Docker blobs individually, not the whole subtree.

---

## 7. Gotchas that will cost you turns

- **`str_replace` and other container tools write to CLAUDE's disk, not the operator's.** To edit the living docs use **`Filesystem:edit_file`** (surgical, always `dryRun:true` first) or **`Filesystem:write_file`** (full rewrite; the param is `content`, not `file_text`).
- **`copy_file_user_to_claude` CACHES BY BASENAME** — re-copying a changed file returns stale bytes. Use `read_multiple_files` for fresh reads, or pull git blobs to bypass entirely (objects are all loose).
- **No `git` CLI in the MCP.** Reconstruct git state from `.git/refs/heads/<branch>` + `.git/logs/refs/heads/<branch>`. You cannot run `git diff`/`git merge` — make the `/goal` produce hashes; you verify from plumbing.
- **`PROJECTPLAN.md` line 6 is a giant single-line banner (~80K+ chars).** NEVER read it directly (grep a copy in the container instead). To edit it, anchor on a SHORT unique substring (the `> **Last updated:**` prefix) and `dryRun:true` first — this worked cleanly this session.
- **`PROJECTPLAN.md` is ~535KB.** Copy it to the container → `grep -nE '^#{1,3} '` for a header index → `sed -n 'X,Yp'` for targeted reads. `/mnt/user-data/uploads` is READ-ONLY (copy targets land there; write scratch scripts to `/tmp`).
- **The Makefile leaks `.env` into every recipe** — no test may depend on ambient posture; pin with `monkeypatch`, and any Fly test fakes the API.
- **Bypass mode caveat (surface it every handoff):** `--dangerously-skip-permissions` makes `.claude/settings.json` allow/deny rules inert; only PreToolUse hooks survive (`protect-no-push.sh`, `protect-migrations.sh`). What makes it safe is `.git/config` having NO remote.
- **`/goal` cap is 4000 chars — MEASURE with `wc -c`.** Move detail to a `prompts/M-h2b.md` brief (allowed architect-direct edit) and point the `/goal` at it — but reproduce the init-prompt + `/goal` text INLINE in the handoff regardless.
- **`prompts/*.md` is UNTRACKED** ⇒ a `git worktree` never sees it. Fine for a solo main-checkout session; commit the brief first for a parallel batch.
- **CLI-RULES.md is STALE** in several sections — the `/goal` must carry real ground truth, not point at it.
- **Playwright's full-page a11y snapshot HANGS** on the React Flow canvas — targeted `browser_evaluate` + screenshots only.
- **All git commands to the operator must be comment-free** (zsh runs inline `#` in non-interactive mode).
- **Live tokens never go in chat.** If one is pasted: `fly tokens list -o personal` → `fly tokens revoke <id>` → re-mint into `.env` (never through the clipboard).

---

## 8. How to write the M-h2b `/goal` (recommendation, yours to override)

**One `/goal`, one milestone, one verifiable transcript.** Non-negotiables to bake in (standing rules + this session):
- **CC runs every check itself and debugs to green before `READY_TO_MERGE`** — `make test`, lint, FE build/vitest, AND the live target (a suspend→restart-backend→resume proof + a reaper proof). Never hand the operator commands to run.
- **The Docker path stays byte-identical** — the `/goal` diffs the four Docker blobs (§6) against `main` and echoes the result; only the *fly* files change.
- **Reproduce-first** on any bug it fixes (quote the failing assertion RED).
- **A Fly unit test fakes the API** (never spends money / never flakes) — mirror M-h2a's `httpx.MockTransport` pattern.
- **Suspend not stop** — assert the API call is *suspend*; assert resume carries the conversation forward (not a cold boot).
- **The reaper NEVER touches `cryptoground-data`** — assert it by name in a test.
- **The durable handle is proven by a real backend-restart** — kill the process while a run is suspended at a gate, restart, resume → the run completes (the whole point).
- **Migration `0031` freeze-bump LAST**, only if the slice adds one.
- **Word the stop clauses** to distinguish "a second/unknown problem needing a broad or unproven change → `NEEDS_HUMAN` + stop" from "a code-proven, contained, regression-guarded fix → may proceed."

Then, **after M-h2b: M-h3** (egress/quota/cost — mandatory for public launch), then **M-h4** (deploy).

---

## 9. Standing directives (unchanged — carry forward; the 3 permanent operator ones are in §3)

- **Claude is ARCHITECT/PLANNER ONLY.** Direct edits: `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/*.md`, trivial typo fixes. **ALL** implementation — product code, diagnostics, Makefile — goes through a `/goal`. No "diagnostics are architect-direct" carve-out. Diagnosing is yours; the *fix* is a `/goal`.
- **The disk audit is the control point.** Never rubber-stamp a report. Read the test bodies; check both failure modes; verify empirically when you can (git blobs, the live gate output).
- **Decide from the vision (§1 + the Tvashtr-25 pivot), never from effort.** Pair **every** decision with its concrete **UX consequence** on the canvas/UI. One design question at a time.
- **Every Claude Code handoff = THREE fully copyable blocks, every time:** (1) the shell launch command (with `--dangerously-skip-permissions`), (2) the FULL init prompt verbatim (incl. the stop-and-wait after its 5-line summary; use ultracode / dynamic-workflows / superpowers skills), (3) the FULL `/goal` verbatim. Never "same as before," never point at a file to retrieve text.
- **Merge handoff = ALL commands as copyable text, every time** (`cd`, `git checkout main`, `git merge --ff-only <branch>`, the verify line + expected tip, optional `git branch -d`). Never just "FF-merge it."
- **Visual sign-off must be a NUMBERED, click-by-click script** — exact screen, node by its **visible label**, exact action, explicit pass/fail. Never an abstract checklist. (Default to CC's Playwright self-sign-off with screenshots.)
- **Every `/goal` instructs CC to run ALL checks itself** and debug to green before `READY_TO_MERGE`. Only the human eyeball is theirs, and only when genuinely un-automatable.
- **Reproduce-first on bug fixes:** the regression must be **confirmed RED on pre-fix code** (quote the failing assertion); use a tuple in `pytest.raises((A, B))` so the *assertion* fails rather than the test erroring out.
- **Operator style:** terse. "proceed"/"go"/"merged"/"done" = ratify and advance. "By the way" = short answer. **Procedures one step at a time.** Analogies help. Simple, everyday language — avoid jargon.
- **Hand over proactively as context fills.** Don't half-scope a big milestone on a thin budget.

---

## 10. Open items

- **Design M-h2b, then write its `/goal`** — your immediate next job, on a full budget (§4, §8).
- **~~The `test_auth.py` flake~~ — FIXED** this session (reproduce-first, deterministic). No longer a rider.
- **🔴 Close the M-h2a gate PR** — `lazyxgenius/trade_mcp` **pull/3** (open + close on GitHub; the gate is re-runnable). Older pull/1, pull/2 may also still be open — operator housekeeping.
- **The orphan reaper does not exist yet** — M-h2a guarantees no *self*-leak only; a backend crash mid-run can orphan a `tv-run-*` app. **This is M-h2b** (§4).
- **🔴 Hosted mode's visible surface has never been rendered for a human eye** (M-h1b's Playwright screenshots deferred; logic proven in jsdom only). A Playwright pass or a numbered click-by-click glance is needed **before M-h4**.
- **🔴 `set_session_cookie` hardcodes `secure=False`** — its own comment says production over https MUST set True. **Blocks public launch (M-h4).**
- **🔴 `run_events` cannot see the condenser** (Tvashtr-67) — C1 has no durable artifact; fix before any further C1 claim (extend `_kind_of` in `openhands_adapter.py` with a `condensation` kind).
- **§15 "Hosted launch — Fly isolation" group** — now carries: the rejected pre-warmed pool (evidence-armed: cold-boot 83.7s measured), the orphan reaper (M-h2b), the slim-image + guest-downsize tuning lever (measured numbers), the durable handle (M-h2b), Tvashtr's runs in their own org (M-h4), the users'-machine region (M-h4), the dev tunnel is dev-time only.
- **Naming collision** ("Tvashtr" vs a Vedic deity + Indian companies) — operator deferred; revisit before M-h4 buys a domain.
- Full register: **`PROJECTPLAN.md` §15** — incl. clone GC (M-h3), the installation-token-in-argv exposure (the backend still clones/pushes on the host; the microVM isolated the *agent*, so this is really M-h4 when the host becomes a public server), and the above.
