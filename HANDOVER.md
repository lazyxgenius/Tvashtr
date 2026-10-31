# HANDOVER — Tvashtr

> Written by **Tvashtr Sidechat-26**, closing out on 2026-10-31 (~22:05 IST).
> Read this, then `PROJECTPLAN.md`: the header line (line 6), the §15 block "Sidechat-26 register"
> (just above §16) and the §17 entry "Tvashtr Sidechat-26" (the last entry, just above §18). Skip the
> giant archived banner (line 9). Older context: the Sidechat-25/-24 registers in §15 and their §17 entries.
> Briefs this chat wrote (each with a `.launch.md`): `prompts/film-demo.md`, `prompts/landing-1.md`,
> `prompts/ship-landing-1.md`.

---

## 1. Where we are (checked on disk and live)

- **Production = `origin/main` = `main` = `8cf90334`** → Fly **v47** (image
  `deployment-01M69AGBH5GE81KC66970B4GM4`; rollback target v46 `deployment-01M52DHZM26THGADX25RFFSG65`),
  alembic head **0053**, Desktop **`desktop-v0.27.0`** (no Desktop release this time).
  `team_run.py` `9a22d313d5c9`; DBOS app versions `3011d7ac…` (local) / `c7320dd5…` (fly).
- **Live now:** the **new landing page** (taste-skill led, GSAP motion, Hallmark inspected; a clean
  animated team picture built in code with two switches whose ending follows the team; Reel 1 (52 s) as
  the main video and "Tvashtr in 2 minutes" as a lightbox link, both self-hosted MP4s in
  `frontend/public/media/`; `AuthGate` lazy-loads the app; preview tags + `og.png`; `robots.txt`),
  **Prune 1**, film **V3/V3b** and **Film D1** (`video/demo/`). Live Lighthouse mobile 57 → **71**
  (LCP 8.7 → 4.8 s), accessibility 100, SEO 100.
- **Push guard ON** (`remote.origin.pushurl = DISABLED-no-push-during-video-work`, checked). A ship's step 0
  has the operator unset it and run `fly auth login`.
- **Docs commit at this closeout (operator):** `HANDOVER.md`, `PROJECTPLAN.md` and the six new prompts
  above. Local only until the next ship pushes `main`. `STATE.md` stays untracked on purpose.
- The operator is on the **Claude Pro plan** (not Max) — see §4.

## 2. Your job (Sidechat-27)

1. **Check the docs commit landed** (`.git/refs/heads/main`, `.git/logs/HEAD`): one commit on `8cf90334`
   holding exactly HANDOVER.md, PROJECTPLAN.md and the six prompts.
2. **Next product work — the operator's call.** On the table, in the architect's order:
   - **M-desk-9, carry on when a plan runs out** (proposed twice; the operator's own idea). Today a
     subscription hitting its usage limit fails the step, the server drops that step's changes and the run
     fails (checked in code: `desktop/electron/runner/streamEvents.cjs` turns the CLI's `rate_limit_event`
     into a feed line; `runner.cjs` posts `failed`; `engines/desktop_runner_adapter.py` returns `_failed`
     without applying the patch). Proposed UX: the step pauses, its work kept; a Needs-you card offers
     "carry on with another plan / resume at reset / use an API key"; an in-app banner when Tvashtr is in
     front; resume re-seeds the last check's note; the run shows which plan ran each step. **First design
     question once he says go: switch plans automatically or always ask.** It touches the run engine →
     drain before shipping; check what each CLI (Claude, Codex, Grok) reports at its limit.
   - **Landing follow-ups (one small session, rides the next ship):** `/media/*.webp` served as
     `application/octet-stream` (add `mimetypes.add_type("image/webp", ".webp")` in the backend); mobile
     performance 71 < 85 (LCP: the hero and web fonts); the next Desktop release leaves out
     `dist-fe/media/` (22 MB it never shows — `desktop/package.json` packs `dist-fe/**/*`).
   - **Prune 2** (Prune 1's leftovers; best first target: money ×3 / number ×11 / relative-time ×5
     formatters that show the same amount or age differently on two screens) and **S4b**.
   Propose one milestone at a time, decided from the vision.
3. Docs closeout at the end (§17 as-built, §15 register, header bump; HANDOVER rewrite; the next chat's
   first message).

## 3. Open items — context, not an agenda (say each once)

1. 🟡 `make test-frontend` exits non-zero on one unhandled error at `CompareView.tsx:96` (on `main` before
   this chat too; every test passes). `make lint` stops at the 38-error ruff baseline (identical set since
   `6b35addc`). Brief gates as "no new finding; exit code may stay non-zero from these".
2. 🟡 `make demo-proof-prod` needs `make demo-proof-login` first (its saved session went stale).
3. 🟡 The full ~7½-min film (V4) stays parked; it could become a "Full walkthrough" link under the demo.
4. 🟡 Product notes carried from Sidechat-25: a test replay doesn't carry the Tests check's result;
   Claude Opus 5.5 isn't a model-picker preset; "$0.00 in all" beside subscription cards; Now bar /
   Activity name checks by kind; the run drawer's lower area is short; Import lists "Add a key for
   anthropic" twice; e2e flakes (steering@1280×720, work_brief); no in-app notice when a run stalls while
   the Desktop is in front; the "1 library tool(s)" banner on every Desktop run; resuming after a check
   doesn't re-seed its note; a Query domain step with no reading key fails mid-run; AI checks need server
   checks-model secrets; `protect-no-push.sh` not registered; the Desktop runner's env leak
   (`harness/spawnEnv.cjs`); prod providers (OpenAI out of credit, Gemini 400).
5. 🟢 Cleanup (when he asks): trade_mcp PRs #50–#73 (none merged); merged branches (`video/demo-2min`,
   `feat/landing-1`, older); Code-tab worktrees (never prune from the VM); throwaway DBs; Docker image
   `tvashtr-ship`; `video/voice-venv` + the Hugging Face cache; the reel folder's `cache/`;
   `.taste-skill/` and `.hallmark/` (gitignored working folders, big screenshots).

## 4. Things you most need to know

1. **Sessions run from the Claude desktop app's Code tab.** A launch package = (0) any Terminal step,
   (1) Code-tab setup (Local, the folder, the branch, worktree off, Auto, model + effort), (2) the full init
   prompt, (3) the full `/goal` (< 4,000 chars, requiring the CLI-RULES §4.7 eight-section FINAL REPORT) —
   always inline, every time. Briefs go in `prompts/` (architect-direct).
2. **Claude Pro plan:** run sessions **one at a time** (they share one allowance). **Sonnet 5.5 high** for
   procedural work (film cuts, small fixes, ships); **Opus 5.5 high** for design and hard engineering; never
   ultracode or workflows; at most one subagent; `STATE.md` after each step (a usage-limit pause then waits
   and continues by itself if the session stays open and the Mac awake; an "Opus limit" message can be
   worked around with `/model sonnet`, session/weekly limits can't). Tell him to close finished sessions —
   his "keepwarm" plugin keeps a finished session's cache warm for hours.
3. **One stack, one Desktop on this Mac.** `/goal` loops keep going until satisfied; at a valid
   NEEDS_HUMAN stop the operator ends it with `/goal clear`. Word gates with known baseline failures as
   "no new finding; the exit code may stay non-zero" or the checker loops (it did this chat).
4. **Evidence or nothing:** open screenshots and frames yourself; read diffs; re-hash invariants.
5. **Claims about the product must match the code**: on the web each **run** gets its own throwaway Fly
   microVM (not each agent); on the Desktop each agent step works on its own temporary repo copy; Desktop
   subscription agents don't use library tools / MCP yet; stalled runs show in Needs you; never "open
   source" (no licence — "source on GitHub").
6. **The landing page's rules** (in `prompts/landing-1.md`): product pictures are clean rebuilds in code,
   faithful to real node kinds, no numbers or "Real run" labels; videos self-hosted (no YouTube — operator);
   the team picture's ending must stay true for every switch state.
7. **DBOS hashes only workflow source**; keep `@DBOS.`-decorated code untouched in cleanup work (75
   decorators); drain live runs before deploying anyway.
8. **Licences:** the one-file-studio skill (Reel 1 / f1–f5) is personal-use — its files never enter the
   repo; the finished videos are the operator's to publish. taste-skill, gsap-skills and hallmark are MIT,
   installed for the user only (`~/.claude/skills/`); GSAP itself is free for websites.

## 5. Gotchas that cost turns

- Reaching the Mac: `device_bash` (`$HOME/mnt/Tvashtr` once granted — request it at the start);
  `device_stage_files` only from connected folders. Read-only git only (`show`, `log`, `rev-parse`, `diff`
  with explicit revisions, `ls-files`, `config --get`, `merge-base`, ref files) — **never `git status`**
  (it rewrites `.git/index`; this chat slipped once, harmless).
- Writing docs: python read-modify-write on a unique anchor, backup in the VM's `$HOME` first.
  `PROJECTPLAN.md` is huge: index with `grep -nE '^#{1,3} '`; line 6 is the header.
- PUSH_SCAN flags our own briefs' pattern lists (`prompts/ship-*.md`) and one 33-char test placeholder in
  `EnginesStep.sheets.test.tsx:56` (public since before) — known false positives.
- `.env` is fenced. Never run tests next to a live stack; never `make test` on `tvashtr_film`.

## 6. Standing operator directives (carry these forward)

- Decide from the **product vision**, never from effort. **One design question at a time**; explanation
  above any picker, short labels. **Pair every decision with its user-facing UX.**
- **Cost efficiency** for user and operator is a design input. **Don't shy from large scope**; he runs
  sessions in parallel only when they don't collide — and on Pro, one at a time.
- **Claude Design first** for unbuilt app screens (this chat's landing page went straight to Claude Code
  because its skills run there — a reasoned exception). **Additive only** for the product.
- Two chat sequences: "Tvashtr-N" and "Tvashtr Sidechat-N". State the name on opening.
- Terse operator: "Proceed"/"Go"/"yes"/"done"/"merged" = ratification. "By the way" = short answer.
  "handover" = wrap up now. **When he's lost, stop and explain in two or three plain sentences what is
  happening and the one thing he needs to do.**
- **Procedures one step at a time.** **Complete copyable artifacts inline.** Merge commands always include
  `git checkout main`; `--ff-only` when FF-able, else `--no-ff`; say what the verify line prints. Before he
  pastes an approval line for a production step, have him paste the request to you first.
- Plain, everyday language; analogies help. **Evidence or nothing.**
- **Videos:** $0, the film's narrator, no new recording unless he asks; the architect writes scripts from
  approved, fact-checked narration.
- Security: the agent never pushes (ship sessions push only `main`, on the operator's approval); never
  `--force`/`reset --hard`; no Fly secrets changes; never print secrets; never open the CLI credential
  files; don't delete his files without asking.
- He likes to close a chat once nothing urgent is pending — say plainly what (if anything) is.

## 7. First message for the next chat

> You are Tvashtr Sidechat-27. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first — in
> `PROJECTPLAN.md` the header line, the §15 block "Sidechat-26 register" and the §17 entry "Tvashtr
> Sidechat-26"; skip the giant banner. Then: (1) check on disk that the Sidechat-26 docs commit landed;
> (2) the next product work — ask me which, or propose one milestone (M-desk-9 is on the table, plus a
> small landing follow-up). I'm on the Claude Pro plan. Don't start work until you've read them.
