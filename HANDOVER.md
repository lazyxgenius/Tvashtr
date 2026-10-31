# HANDOVER — Tvashtr

> Written by **Tvashtr Sidechat-25**, closing out on 2026-10-26 (~13:30 IST).
> Read this, then `PROJECTPLAN.md`: the header line (line 6), the §15 block "Sidechat-25 register"
> (just above §16) and the §17 entry "Tvashtr Sidechat-25" (the last entry, just above §18). Skip the
> giant archived banner (line 9). Older context: the Sidechat-24/-23 registers in §15 and their §17 entries.
> Briefs this chat wrote (each with a `.launch.md`): `prompts/prune-1.md`, `prompts/reel-1.md`,
> `prompts/reels-features.md`.

---

## 1. Where we are (checked on disk)

- **Production unchanged = `origin/main` = `6b35addc`** → Fly **v46** (rollback target v45
  `deployment-01M4ZKH1935RAKWJS8QDF7ZY1Z`), alembic head **0053**, Desktop **`desktop-v0.27.0`**.
  `team_run.py` `9a22d313d5c9`; DBOS app versions `3011d7ac…` (local) / `c7320dd5…` (fly).
- **Local `main` = `8fe4d4e2`, not pushed:** film V3 + V3b, the Sidechat-23/24 docs commit `65d4b194`, and
  **Prune 1** (32 commits: dead code, one uncalled route `POST /api/domains/{id}/retrieve`, ten duplicate
  groups merged; audited PASS; branch deleted). All of it goes public at the next ship (the repo
  `lazyxgenius/Tvashtr` is PUBLIC). Push guard ON (`remote.origin.pushurl =
  DISABLED-no-push-during-video-work`); a ship's step 0 has the operator unset it and run `fly auth login`.
- **Docs commit at this closeout (operator):** `HANDOVER.md`, `PROJECTPLAN.md` and the six new
  `prompts/*.md` above. `STATE.md` stays untracked on purpose.
- **Marketing reels** — made with the operator's purchased **one-file-studio** skill
  (`~/.claude/skills/one-file-studio/`, personal-use license: its files must **never** enter the Tvashtr
  repo) in a separate folder **`/Users/adimac/Desktop/tvashtr-reel`** (not git; its own `STATUS.md` /
  `JOURNAL.md` let a fresh session continue):
  - **Reel 1, "what is Tvashtr"** — `out/cut-02.mp4` (= cut-01), 52.3 s, accepted by the operator as is.
  - **Feature reels f1–f5** — `out/f1-cut-01.mp4` … `out/f5-cut-01.mp4` delivered (+ phone copies,
    contact sheets, scripts): f1 Design your team · f2 Equip your agents (incl. Domains) · f3 Checks that keep
    runs on track · f4 Every run, saved · f5 Improve and share your team. At closeout the session was fixing
    four small frame items as cut-02 (f5's still "lanes" shot, one-frame kicker dips, f4's labels vanishing
    before the end card, one empty-panel frame in f1). Not yet watched by the architect.
  - The film itself stays **parked** before V4 (the edit).

## 2. Your job (Sidechat-26)

1. **Check the docs commit landed** (`.git/refs/heads/main`, `.git/logs/HEAD`): one commit on `8fe4d4e2`
   holding exactly HANDOVER.md, PROJECTPLAN.md and the six prompts.
2. **The reels** — ask the operator whether the f1–f5 fixes (cut-02) finished and whether he wants a
   frame check before posting. If yes: request access to `/Users/adimac/Desktop/tvashtr-reel`, extract
   frames with ffmpeg in the device VM, stage them and look (loudness: `ebur128=peak=true`; black/freeze
   detect).
3. **Next product work — the operator's call.** On the table: **M-desk-9, carry on when a plan runs out**
   (proposed by Sidechat-25, the operator's own 10-15 idea; first design question once he says go: switch
   plans automatically or always ask). Also **Prune 2** (the Prune 1 leftovers below), and the open items.
   Propose one milestone at a time, decided from the vision.
4. Docs closeout at the end (§17 as-built, §15 register, header bump; HANDOVER rewrite; the next chat's
   first message).

## 3. Open items — context, not an agenda (say each once)

1. 🟡 **Prune 1 leftovers (for a Prune 2):** 6 uncalled routes kept (`/spike/generate-doc` ×2, `GET
   /documents`, `GET /costs` — named in README.md; `/ab-runs` ×2 — a "compat" comment); 3 domains routes
   only `desktop-v0.11.0` calls (eval, eval/runs/latest, ingest); **41 drifted duplicate groups — money ×3
   and number ×11 formatters, cost precision `toFixed(2)` vs `(4)`, relative time ×5** (users can see the
   same amount or age written differently on two screens — the best first target), provider-name maps,
   error-to-sentence mappers; 13 same-behaviour groups; 6 uncalled scripts; ~19 proven-dead items held;
   20 `/simplify` suggestions. Full list in `STATE.md` (end) and the §15 register.
2. 🟠 **S4b** (lock Grok's own `~/.grok`): its own milestone; never live-probe credential folders.
3. 🟡 **Product notes:** a test replay doesn't carry the Tests check's result (a Reviewer test can fail on
   "no test result was supplied"); Claude Opus 5.5 isn't a model-picker preset; compare/set headers "$0.00 in
   all" beside subscription cards; Now bar / Activity name checks by kind; the run drawer's lower area is
   short; Import lists "Add a key for anthropic" twice; e2e flakes (steering@1280×720, work_brief); no in-app
   notice when a run stalls while the Desktop is the front app; the "1 library tool(s)" banner on every
   Desktop run (Desktop subscription agents don't use library tools/MCP yet).
4. 🟡 From earlier: subscription limit → carry on with another plan (= M-desk-9); resuming after a check
   doesn't re-seed its note; a Query domain step with no reading key fails mid-run; AI checks need server
   checks-model secrets; `protect-no-push.sh` not registered; the Desktop runner's env leak
   (`harness/spawnEnv.cjs`); prod providers (OpenAI out of credit, Gemini 400); `make lint` 38 baseline.
5. 🟢 **Cleanup (when he asks):** trade_mcp PRs #50–#71 (none merged; #70/#71 from Prune 1's proofs);
   merged branches; Code-tab worktrees (never prune from the VM); throwaway DBs; Docker image
   `tvashtr-ship`; `video/voice-venv` + the Hugging Face cache; the reel folder's `cache/` (big, rebuildable).

## 4. Things you most need to know

1. **Sessions run from the Claude desktop app's Code tab.** A launch package = (0) any Terminal step,
   (1) Code-tab setup (Local, the folder, branch `main`, worktree off, Auto, Opus), (2) the full init prompt,
   (3) the full `/goal` (< 4,000 chars, requiring the CLI-RULES §4.7 eight-section FINAL REPORT) — always
   inline, every time. Briefs go in `prompts/` (architect-direct).
2. **One stack, one Desktop on this Mac**; sessions that need them run one at a time.
3. `/goal` loops keep going until satisfied; at a valid NEEDS_HUMAN stop a session may keep re-checking —
   the operator ends it with `/goal clear`.
4. **Evidence or nothing:** open screenshots and frames yourself; measure loudness; read diffs.
5. **Claims about the product must match the code**, not the plan: on the web each **run** gets its own
   throwaway Fly microVM (not each agent); on the Desktop each agent step works on its own temporary repo
   copy; Desktop subscription agents don't use library tools / MCP yet; stalled runs do show in Needs you.
6. **DBOS hashes only workflow source**; keep `@DBOS.`-decorated code untouched in cleanup work (75
   decorators today); drain live runs before deploying a walk change anyway.
7. **macOS shows no notification banner for the app in front.**

## 5. Gotchas that cost turns

- Reaching the Mac: `device_bash` (`$HOME/mnt/Tvashtr`, `$HOME/mnt/tvashtr-reel` once granted);
  `device_stage_files` only from connected folders (stage the source file, then run ffmpeg in your own
  container — the device VM's own scratch can't be staged). Read-only git only (`show`, `log`,
  `rev-parse`, `diff` with explicit revisions, `ls-files`, `config --get`, ref files) — **never `git
  status`** (it rewrites `.git/index`; the reel session did it once, harmless but against its brief).
- Writing docs: python read-modify-write on a unique anchor, backup in the VM's `$HOME` first.
  `PROJECTPLAN.md` is huge: index with `grep -nE '^#{1,3} '`; line 6 is the header.
- Briefs for sessions working **outside** the repo must say "no git commands in the Tvashtr folder".
- Speech-to-text can't judge a made-up name — use the phoneme check (`video/v3/phonemes.py`; the reel
  folder's `tools/name_check.py`).
- `.env` is fenced. Never run tests next to a live stack; never `make test` on `tvashtr_film`.

## 6. Standing operator directives (carry these forward)

- Decide from the **product vision**, never from effort. **One design question at a time**; explanation
  above any picker, short labels. **Pair every decision with its user-facing UX.**
- **Cost efficiency** for user and operator is a design input. **Don't shy from large scope**; he runs
  sessions in parallel when they don't collide.
- **Claude Design first** for unbuilt screens. **Additive only** for the product (Prune 1 removed only
  what nothing uses, proven by an empty visible-text diff).
- Two chat sequences: "Tvashtr-N" and "Tvashtr Sidechat-N". State the name on opening.
- Terse operator: "Proceed"/"Go"/"yes"/"done"/"merged" = ratification. "By the way" = short answer.
  "handover" = wrap up now. **When he's lost, stop and explain in two or three plain sentences what is
  happening and the one thing he needs to do.**
- **Procedures one step at a time.** **Complete copyable artifacts inline.** Merge commands always include
  `git checkout main`; `--ff-only` when FF-able, else `--no-ff`; say what the verify line prints.
- Plain, everyday language; analogies help. **Evidence or nothing.**
- **Videos:** $0, no new recording, the film's narrator; for an overview, explain *what Tvashtr is* (its
  features), not one run's story; the architect writes the script from approved, fact-checked narration and
  checks the session's SCRIPT READY against the footage before the operator's GO.
- Security: the agent never pushes (ship sessions push only `main` + the tag, on the operator's approval);
  never `--force`/`reset --hard`; no Fly secrets changes; never print secrets; never open the CLI credential
  files; don't delete his files without asking.
- He likes to close a chat once nothing urgent is pending — say plainly what (if anything) is.

## 7. First message for the next chat

> You are Tvashtr Sidechat-26. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first — in
> `PROJECTPLAN.md` the header line, the §15 block "Sidechat-25 register" and the §17 entry "Tvashtr
> Sidechat-25"; skip the giant banner. Then: (1) check on disk that the Sidechat-25 docs commit landed;
> (2) ask me whether the feature reels' fixes are done and whether I want them frame-checked; (3) then
> the next product work — ask me which, or propose one milestone (M-desk-9 is on the table). Don't start
> work until you've read them.
