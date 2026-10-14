# HANDOVER — Tvashtr

> Written by **Tvashtr Sidechat-22**, closing out on 2026-10-13 (~11:40 IST).
> Read this, then `PROJECTPLAN.md`: the header line (line 6), the §15 block "Sidechat-22 register"
> (just above §16) and the §17 entry "Tvashtr Sidechat-22" (the last entry, just above §18). Skip the
> giant archived banner (line 9). Older context: the Sidechat-21/-20 registers in §15 and their §17 entries.
> Briefs this chat wrote: `prompts/video-v1.md` (updated), `prompts/m-desk-5-v2.md`, `prompts/m-desk-6.md`
> (each with a `.launch.md`). The film's own docs: `video/README.md`, `video/SCENES.md` (on `main`).

---

## 1. Where we are (checked on disk at ~11:35 IST, 10-13)

- **Local `main` = `dac9afc4`**; `origin/main` = `e30b8bd9` (Fly v44, Desktop 0.25.0). Alembic head
  **0053**, freeze hook 0001–0053. `team_run.py` blob on `main` `94eda1bb9fbb`; DBOS app version locally
  `3011d7ac…`, production's fly-mode set `c7320dd5…`.
- **Push guard ON:** `remote.origin.pushurl = DISABLED-no-push-during-video-work`. The operator unsets it
  when he ships: `git config --local --unset remote.origin.pushurl`.
- **Merged this chat (each verified on disk, all fast-forwards):** M-desk-4 `268ed099` → video V1
  `1bf725be` → M-desk-5 `6b63af86` → video V2 `dac9afc4`.
- **Handed to the operator at closeout — merge M-desk-6** (disk-checked: scope, invariants, the
  `team_run.py` diff; the report's tests not re-run; its live screenshots sit in the session's scratchpad,
  outside the connected folder):
  ```
  cd /Users/adimac/Desktop/Tvashtr
  git checkout main
  git merge --ff-only feat/m-desk-6
  git log --oneline -1
  ```
  Expect `Updating dac9afc4..77f4b4f7`, `Fast-forward`, `36 files changed, 1992 insertions(+), 60
  deletions(-)`, then `77f4b4f7 fix(backend): a failed Tests check names where the walk sends it, through a
  Rework loop too (M-desk-6 T1)`. **First thing to check:** did he run it? (`git rev-parse main` =
  `77f4b4f7…`; `.git/logs/HEAD` last line "merge feat/m-desk-6: Fast-forward".)
- **The main checkout is free** (on `main`, nothing running; the M-desk-6 session ended in the safe state).
  The only container is `tvashtr-postgres`.

| Branch | Tip | State |
|---|---|---|
| `feat/m-desk-6` | `77f4b4f7` | Ready → merge (handed over) |
| `video/v1-pairs-wip` | `9d1b6414` | Parked V1 experiment — never merge; delete at cleanup |
| merged, keep until cleanup | — | `video/v0-toolchain`, `fix/desktop-subs-gate-current-ui`, `feat/m-desk-routes`, `feat/m-desk-2`, `feat/m-desk-3`, `feat/m-desk-4`, `fix/dbos-scheduled-latest-version`, `video/v1-camera`, `feat/m-desk-5`, `video/v2-runs` |
| Code-tab helpers | — | `claude/m-desk-routes-043046`, `claude/tvashtr-implementation-c32e22` (+ any `claude/*` from M-desk-4's worktree) — delete at cleanup |

- **Worktrees (Mac paths; the VM calls them "prunable" — never prune from the VM):**
  `.claude/worktrees/m-desk-routes-043046` (`feat/m-desk-2`), `…/tvashtr-implementation-c32e22`
  (`feat/m-desk-3`), `…/tvashtr-implementation-268513` (`feat/m-desk-4`, holds `artifacts/m-desk-4/`).
  Remove after the ship, with the operator.
- **Uncommitted on `main`'s working tree (architect-owned):** `HANDOVER.md`, `PROJECTPLAN.md`,
  `prompts/CLI-RULES.md` (an old operator edit from 2026-09-26: the revamp-e2e Ship Protocol exception —
  harmless history; commit as is), and ~45 untracked `prompts/*.md` from this and earlier chats. Commit
  them in one docs closeout on `main` once M-desk-6 is merged and no session holds the checkout (give the
  operator `git add HANDOVER.md PROJECTPLAN.md prompts/` + a `docs:` commit; check `git status` output he
  pastes shows only those paths). `STATE.md` stays ignored.
- **Throwaway databases left:** `tvashtr_gate_desk5`, `tvashtr_gate_desk6` (+ older `tvashtr_gate_desk*`,
  `tvashtr_desk*`). The film DB `tvashtr_film` holds V2's runs. Drop the gate/desk ones at cleanup.
- **trade_mcp PRs opened by sessions (none merged; close at cleanup):** #50 (V0), #51 (V1 proof), #52
  (M-desk-5 proof), #53 (hero, Hull MA), #54 (TRIX resume), #55 (DEMA), #56 (M-desk-6 proof, TEMA).

## 2. Your job (Sidechat-23), in order

### 2a. Confirm the M-desk-6 merge, then the docs closeout commit
Check on disk (§1). If not run, hand it again (one step, with what the verify line prints). Then the docs
commit (one step).

### 2b. Rule on S4 — the Grok CLI reads outside its job copy (one design question)
Evidence (M-desk-6 report): V2 saw Grok read Tvashtr's source, `~/Desktop/trade_mcp` and `~/.grok/sessions`.
Grok Build's `--sandbox workspace` confines writes only; `--sandbox strict` (reads: the CWD + system paths)
refuses to start on a Mac with Docker Desktop ("could not resolve runtime-socket deny path
/var/run/docker.sock: endpoint is a symlink … Refusing to start"); `--allow 'Read(<job>/**)'` does not gate
reads; custom profiles need a `sandbox.toml`. Claude's `--restricted` confines its file tools (confirmed).
The session's proposal: the Desktop runner writes a job-local `.grok/sandbox.toml` profile and passes
`--sandbox <it>` (prompt file inside the job dir) — a `cliCommand.cjs` (+ maybe `runner.cjs`) change, desktop
tests, a Desktop release; also report the symlink refusal to xAI. Decide from the vision (users' private
files on their own Mac are at stake; `~/.grok/sessions` can hold their other conversations), pair it with the
UX (what a Desktop user sees: nothing, or a Grok card note if confinement can't be guaranteed), then brief it
(it can join the film follow-up session as its Part A, the pattern the operator liked).

### 2c. The film follow-up (V2b) — and one ruling first
Owed from V2: **6.1** (tests from a round + CSV + the AI check — no checks key locally → sample, G7), **6.2**
(live, Save as v2), **6.3** (compare v1/v2 + the "Indicators" set + Restore — with the **H4 queued-lane, H5
turns and D8 smoke**), the **2.7 re-take** (its test line's first second), ch5/ch6 previews. Budget left from
V2 didn't carry over — set a new one. **Ruling to make first:** re-film **2.4** (add the Tests check on
camera) and **chapter 3** (hero + replays + 3.7 + 0.1) with the Tests check? Recommendation: yes — the
story gets better and cheaper (live proof: Tests failed → rework → 661 passed → Reviewer approved round 1,
"Done in 6m 50s", vs ~35 min + Escalation), and the storyboard's "round 1 back, round 2 approved" becomes
real. Chapters 4–5 can stay (honest as filmed) or re-take later. Also decide whether 6.3's lanes should use
the Tests check (they'd stop escalating, so 6.3 can run unattended).

### 2d. Ship (operator-approved; after V2b's 6.3 smoke, or earlier if the operator chooses)
One ship for M-desk-routes + M-desk-2 + M-desk-3 + M-desk-4 + the DBOS cron fix + M-desk-5 + M-desk-6 (+ S4
if done): unset the push guard → push → Neon snapshot (check the branch count; the plan's limit is 10,
trimmed to 3 on 10-03) → **drain live production runs** (M-desk-6's gate-arm change; replay-safe but drain
anyway) → `fly deploy` (runs 0053) → a `desktop-v*` tag (frontend changed) → smoke. Production steps only on
the operator's pasted approval; a deploying session runs in **Auto** mode, never bypass. The DBOS app
versions are unchanged (`c7320dd5` in production), so queued sweeps survive.

### 2e. Docs closeout at the end of your chat
§17 as-built, §15 open items, header bump; HANDOVER rewrite; the next chat's first message.

## 3. Audits done this chat (details in §15 "Sidechat-22 register")

- **M-desk-4 merge** verified (ff). **V1 — PASS** (only `video/**`; story/fixtures; no secrets; contact
  sheet + ch2 preview + replay pairs opened; 53/74 exact pairs accepted on the operator's wrap-up). V1's
  claim that PR #51 shipped scratch files was false (the architect fetched the branch: only README.md).
- **M-desk-5 — PASS** (L1 `ran_on` excludes Desktop-job usage rows; L2 `shipping.hidden_own_files`; L3
  Changes from GitHub via the owner's installation, once per tab open; L4 own clone per (url, pin);
  `team_run.py`/`runner.cjs` unchanged; no migration). **V2 — PASS-partial** (only `video/**`; smoke shots
  opened: hero Done/banner/chip/summary "on your Claude and Grok subscriptions", Changes = PR #53's files,
  4.1 "Failed after 4m 17s · on your Claude subscription", 4.2 confirm H2 words; contact sheet v2 opened).
- **M-desk-6 — disk-checked** (scope, invariants, `team_run.py` +12/−1 in `run_graph`'s gate arm — a plain
  helper, `run_team` unchanged → app versions unchanged). Read the code of `guardrails.tests_pass`,
  `context_compiler`'s check note and `GateBody` in the next audit pass if anything looks off live.

## 4. Open items — context, not an agenda (say each once)

1. 🟠 S4 (above). 2. 🟡 M-desk-6 open notes: resuming after a check doesn't re-seed its note; a gate switched
to Tests pass keeps the title "Approve before continuing?"; a running Desktop run's toolbar wraps to 3 rows;
the Reviewer template still says "Run the repository's tests"; Grok jobs list the user's own MCP tools.
3. 🟡 A team whose Query domain step has no reading key/files fails mid-run — launch should warn first.
4. 🟡 No working embeddings key on this Mac (V2 used `READING_KEY = none`: no domain step in the hero team;
1.5 SAMPLE; 2.3 flagged for V4). 5. 🟡 AI checks need a server checks model (Fly secrets
`TVASHTR_CHECKS_MODEL`/`_API_KEY` before the film goes public; locally none). 6. 🟡 L3/L4 residuals: renames
show as "modified"; compare caps at 300 files; per-pin skill clones never pruned (~18 MB each); private skill
repos cloned without credentials; underscored/capitalised skill names dropped silently; branch/tag pins
without a SHA fall back silently; LOCAL dev mode still shows Tvashtr's files to the Reviewer. 7. 🟡 The
Engines "N to fix" badge counts Claude/Grok teams as website-not-ready (by design, noisy on the Desktop).
8. 🟡 trade_mcp `main` fails test collection with unpinned `mcp` 2.x (the live command pinned `'mcp<2'`).
9. 🟡 From earlier: `protect-no-push.sh` not registered in `.claude/settings.json`; the Desktop runner leaks
`ANTHROPIC_BASE_URL`/`CLAUDE_*` into the CLI env (`harness/spawnEnv.cjs`); R17a backup switch ~18.5 min;
prod providers (OpenAI out of credit, Gemini 400); `make lint` 38 pre-existing errors in 12 untouched files.
10. 🟢 Operator items for the film: MAC-1/-2/-3 shots (scripts in `video/SCENES.md`), a throwaway API key for
1.2, ElevenLabs commercial plan before V3.

## 5. The things you most need to know

1. **Sessions run from the Claude desktop app's Code tab.** A launch package = (0) the operator's Terminal
   checks, (1) Code-tab setup (folder, branch, worktree on/off, mode, model), (2) the full init prompt, (3)
   the full `/goal` (< 4,000 chars, requiring the CLI-RULES §4.7 eight-section FINAL REPORT) — always inline.
2. **One stack, one Desktop on this Mac.** Sessions that need a live stack (filming, live proofs) own
   :8000/:5173 and the Desktop; run them one at a time.
3. **`/goal` loops keep going until the evaluator is satisfied.** To stop one: `/goal clear` (don't press Esc
   while a real run's take is recording). A wrap-up prompt after `/goal clear` works well.
4. **Record-and-replay freezes the server's words.** Fix server-side text before recording a run you'll
   replay; frontend text re-renders from current code.
5. **Live proof is mandatory for anything whose truth depends on real data** — M-desk-4's fixture-only proof
   missed the $0 usage rows; M-desk-5/-6 each ended with one real Desktop run.
6. **Desktop agents have file tools only** (by design). Tests run through the Tests pass check in
   Tvashtr's sandbox (Fly in production, docker locally).
7. **DBOS hashes only the decorated workflow's source** (`run_team`), not `run_graph` or steps; still drain
   live runs before deploying a walk change.
8. **The Claude CLI sign-in can expire silently.** Truth is `claude auth status` from a plain Terminal.

## 6. Gotchas that cost turns

- **Reaching the Mac:** `device_request_folder_access` for `/Users/adimac/Desktop/Tvashtr`, then `device_bash`
  (folder at `$HOME/mnt/Tvashtr`). Read-only git only (`rev-parse`, `log`, `diff`, `show`, `for-each-ref`,
  `merge-base`, `.git/logs/*`, `git --no-optional-locks diff`); never `status`, `fetch`, config writes or commits.
- **Staging files to look at them:** `device_stage_files` only takes paths inside the connected folder — copy
  scratch images into an ignored path first (e.g. `video/out/v1/architect-audit/`), then stage and Read.
- **Writing docs:** python read-modify-write on a unique anchor with a backup in `$HOME`, or write in the
  container under `/mnt/user-data/outputs/` and `device_commit_files` into place.
- **trade_mcp is private:** `add_repo` (read) then a shallow clone + `fetch --depth=3 origin <branch>` to
  check what a PR really changed.
- `PROJECTPLAN.md` is huge (~830 KB): index with `grep -nE '^#{1,3} '`; line 6 is the header.
- `.env` is fenced: never open, copy or print it.
- Never run tests next to a live stack from the same checkout; never `make test` against `tvashtr_film`.

## 7. Standing operator directives (carry these forward)

- Decide from the **product vision**, never from effort or the path of least resistance.
- **One design question at a time** — decide it; no option menus except for genuine strategic calls. When a
  choice is offered, the explanation goes above the picker and option labels stay short.
- **Pair every decision with its user-facing UX consequence.**
- **Cost efficiency for both the user and the operator** is a first-class design input.
- **Don't shy from large scope** — decompose it; he runs sessions **in parallel** when they don't collide, and
  likes combining a product fix with the filming that depends on it in **one session, two branches**.
- **Claude Design first:** any unbuilt screen is designed in Claude Design before code.
- **Additive only:** never remove anything from any screen (wording corrections are not removals).
- **Two chat sequences:** "Tvashtr-N" and "Tvashtr Sidechat-N". State the name on opening.
- Terse operator: "Proceed" / "Go" / "yes" / "done" / "merged" = ratification. "By the way" wants a short answer.
  "handover" = wrap up now.
- **Procedures one step at a time** — one step, wait for the result, then the next.
- **Always hand over complete copyable artifacts inline** (setup, init prompt, `/goal`, merge commands,
  wrap-up prompts).
- **Merge commands always include `git checkout main`** before the merge line; FF-able branches `--ff-only`,
  otherwise `--no-ff`. Say what the verify line should print and what to do if it fails.
- **Plain, everyday language; analogies help.**
- **Evidence or nothing** — keep verified results apart from assumptions; open screenshots yourself.
- He runs sessions this chat didn't brief; audit their reports on disk like any other.
- Security: the agent never pushes; never `--force` or `reset --hard`; no Fly secrets changes by sessions;
  never print or screenshot secrets; never open the claude/grok CLI credential files; don't delete files in
  his folder without asking.
- He likes to close a chat once nothing urgent is pending — say plainly what (if anything) is.

## 8. First message for the next chat

> You are Tvashtr Sidechat-23. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first — in
> `PROJECTPLAN.md` the header line, the §15 block "Sidechat-22 register" and the §17 entry "Tvashtr
> Sidechat-22"; skip the giant banner. Then: (1) check whether I merged M-desk-6 and give it again if not,
> then the docs closeout commit; (2) rule on S4 (the Grok CLI reads outside its job copy); (3) rule on
> re-filming 2.4 and chapter 3 with the Tests check, then brief the film follow-up (6.1–6.3 with the H4/H5/D8
> smoke, the 2.7 re-take — with S4 as its Part A if you rule to fix it); (4) then plan the ship. Don't start
> work until you've read them.
