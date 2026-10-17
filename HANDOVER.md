# HANDOVER — Tvashtr

> Written by **Tvashtr Sidechat-24**, closing out on 2026-10-17 (~12:45 IST).
> Read this, then `PROJECTPLAN.md`: the header line (line 6), the §15 block "Sidechat-24 register"
> (just above §16) and the §17 entry "Tvashtr Sidechat-24" (the last entry, just above §18). Skip the
> giant archived banner (line 9). Older context: the Sidechat-23/-22 registers in §15 and their §17 entries.
> Briefs this chat wrote: `prompts/ship-desk-0.27.0.md`, `prompts/video-v3.md` (+ the approved script
> `prompts/video-v3-script.md`), `prompts/video-v3b.md` (each with a `.launch.md`). The film's own
> docs: `video/SCENES.md` and `video/README.md` (V3 and V3b sections).

---

## 1. Where we are (checked on disk and live)

- **Production = `origin/main` = `6b35addc`** → Fly **v46** (image `deployment-01M52DHZM26THGADX25RFFSG65`;
  rollback target v45 `deployment-01M4ZKH1935RAKWJS8QDF7ZY1Z`), alembic head **0053**, Desktop
  **`desktop-v0.27.0`** (M-desk-8: the P1–P6 on-camera wording fixes). Checked live 10-16: `/health` ok,
  `/healthz` 200, live asset `index-Cn8i20nt.js`, `releases/latest` → `desktop-v0.27.0`.
- `team_run.py` `9a22d313d5c9`; DBOS app versions `3011d7ac…` (local) / `c7320dd5…` (fly).
- **Local `main` is ahead of `origin/main` (not pushed):** film V3 (`03dac4b9`, merged) + V3b
  (`7ec86760`, FF merge handed to the operator at closeout) + the docs commit below. All of it goes
  public at the next ship (**the repo `lazyxgenius/Tvashtr` is PUBLIC**; media and model files are
  git-ignored).
- **Push guard ON** (`remote.origin.pushurl = DISABLED-no-push-during-video-work`). A ship needs step 0:
  the operator unsets it and runs `fly auth login`, then restores it after (see `prompts/ship-desk-0.27.0.md`).
- **Docs commit (operator, at closeout):** `HANDOVER.md`, `PROJECTPLAN.md` and every new `prompts/*.md`
  from Sidechat-23 and -24 (they were never committed). `STATE.md` is untracked on purpose.

| Branch | Tip | State |
|---|---|---|
| `video/v3b` | `7ec86760` | merge FF into `main` (handed over at closeout); then delete |
| `video/v3` | `03dac4b9` | merged; delete at cleanup |
| merged, keep until cleanup | — | `feat/m-desk-8`, `video/v2b-refilm`, `ship/desktop-0.27.0`, and the older list in the Sidechat-23 register |
| parked, never merge | — | `video/v1-pairs-wip` |

## 2. The film — PARKED before the edit (operator, 10-17)

The operator said "whatever's done is done… move on". Don't restart it unless he asks.
- **Done:** 35 narration lines in an open-source voice (VoxCPM2, cloned from `video/out/voice/reference.mp3`;
  the name is said "tuh-VAH-shter" everywhere), `video/v3/narration-timing.json`, every scene's take,
  title/end cards, the chapter-3 listen-through, and a **3-minute recruiter cut**
  (`video/out/recruiter/Tvashtr-demo-music.mp4`) he can share now.
- **Not done (in the §15 register):** V4, the edit of the whole film; 3.1 says "hole" for "Hull"
  (the voice can't say it); MAC-3 has no banner (macOS shows no banner for the app in front, and the
  camera keeps the Desktop in front); MAC-1/MAC-2 dropped.

## 3. Your job (Sidechat-25)

1. **Check the closeout landed:** `main` = `7ec86760` + one docs commit on top (read `.git/refs/heads/main`
   and `.git/logs/HEAD`); the working tree has no stray architect files left uncommitted.
2. **New product features — the operator's call.** He wants to move on from the film to features.
   Start by asking which feature he has in mind; if he wants a suggestion, propose one milestone at a
   time from the open items below and the roadmap (PROJECTPLAN §15/§16), decided from the vision
   (the live, versioned source-of-truth document + a light review gate that keeps long agent runs on
   intent; composability that visibly changes what ships).
3. Docs closeout at the end of your chat (§17 as-built, §15 register, header bump; HANDOVER rewrite;
   the next chat's first message).

## 4. Open items — context, not an agenda (say each once)

1. 🟠 **S4b** (lock Grok's own `~/.grok` folder): deferred to its own milestone; the M-desk-8 session's
   evidence is in `STATE.md`. Claude's safeguards stopped probing there twice — a future brief should
   avoid live probing of credential folders.
2. 🟡 **Product notes** (Sidechat-24 register): (a) a test replay doesn't carry the Tests check's result,
   so a Reviewer test can fail on "no test result was supplied"; (b) Claude Opus 5.5 isn't a model-picker
   preset; (c) compare/set headers read "$0.00 in all" beside subscription cards; (d) the Now bar and the
   Activity filters still name checks by kind ("Secret leak scan", "Diff touches forbidden paths");
   (e) the run drawer's lower area is short (Ask answer, Raw log below the fold); (f) Import lists
   "Add a key for anthropic" twice; (g) e2e flakes: steering@1280×720, work_brief, thinker_chain;
   (h) no in-app notice when a run stalls while the Desktop is the front app (macOS hides the banner);
   plus the "1 library tool(s)" banner on every Desktop run.
3. 🟡 From earlier (still open): when a subscription hits its limit, offer to continue on another one;
   resuming after a check doesn't re-seed its note; a team whose Query domain step has no reading key
   fails mid-run; AI checks need server checks-model secrets before the film goes public;
   `protect-no-push.sh` not registered; the Desktop runner's env leak (`harness/spawnEnv.cjs`); prod
   providers (OpenAI out of credit, Gemini 400); `make lint` 38 baseline; Grok Build on the free plan.
4. 🟢 **Cleanup** (when he asks): trade_mcp PRs #50–#67 (none merged); merged branches; Code-tab
   worktrees (never prune from the VM); throwaway DBs `tvashtr_gate_desk*`, `tvashtr_desk*`; Docker image
   `tvashtr-ship`; `video/voice-venv` + the Hugging Face cache (VoxCPM2 weights, a 1.26 GB phoneme model).

## 5. The things you most need to know

1. **Sessions run from the Claude desktop app's Code tab.** A launch package = (0) the operator's
   Terminal checks, (1) Code-tab setup (Local, the Tvashtr folder, branch `main`, worktree off, Auto,
   Opus), (2) the full init prompt, (3) the full `/goal` (< 4,000 chars, requiring the CLI-RULES §4.7
   eight-section FINAL REPORT) — always inline, every time.
2. **One stack, one Desktop on this Mac**; sessions that need them run one at a time.
3. `/goal` loops keep going until satisfied; a session at a valid NEEDS_HUMAN stop may keep re-checking
   — the operator ends it with `/goal clear`.
4. **Live proof is mandatory** where truth depends on real data; open screenshots yourself.
5. **Desktop agents have file tools only**; tests run through the Tests pass check in Tvashtr's sandbox.
6. **DBOS hashes only `run_team`'s source**; drain live runs before deploying a walk change anyway.
7. **Grok on the Desktop runs under a per-job Seatbelt profile** (`grokLock.cjs`).
8. **macOS shows no notification banner for the app in front.**

## 6. Gotchas that cost turns

- Reaching the Mac: `device_bash` (`$HOME/mnt/Tvashtr`); `device_stage_files` for files you need to
  open in the VM (paths inside the connected folder only). Read-only git only (`show`, `log`, `diff`,
  `config --get`, ref files); never `status`, `fetch`, config writes or commits from the bridge.
- Writing docs: python read-modify-write on a unique anchor, backup in the VM's `$HOME` first.
  `PROJECTPLAN.md` is huge: index with `grep -nE '^#{1,3} '`; line 6 is the header.
- Speech-to-text can't judge a made-up name or a one-vowel difference — use the phoneme check
  (`video/v3/phonemes.py`) for spoken words.
- The operator doesn't have Recordly set up; for screen recordings use macOS's own recorder
  (Shift + Command + 5 → Record Entire Screen → Record; it saves to the Desktop).
- `.env` is fenced. Never run tests next to a live stack; never `make test` on `tvashtr_film`.

## 7. Standing operator directives (carry these forward)

- Decide from the **product vision**, never from effort. **One design question at a time**; explanation
  above any picker, short labels. **Pair every decision with its user-facing UX.**
- **Cost efficiency** for user and operator is a design input. **Don't shy from large scope**; he runs
  sessions in parallel when they don't collide.
- **Claude Design first** for unbuilt screens. **Additive only** (wording corrections aren't removals).
- Two chat sequences: "Tvashtr-N" and "Tvashtr Sidechat-N". State the name on opening.
- Terse operator: "Proceed"/"Go"/"yes"/"done"/"merged" = ratification. "By the way" = short answer.
  "handover" = wrap up now. **When he's lost, stop and explain in two or three plain sentences what is
  happening and the one thing he needs to do** — he said "I don't understand what is happening" this
  chat when sessions asked him for steps he hadn't been told how to do.
- **Procedures one step at a time.** **Complete copyable artifacts inline.** Merge commands always
  include `git checkout main`; `--ff-only` when FF-able, else `--no-ff`; say what the verify line prints.
- Plain, everyday language; analogies help. **Evidence or nothing.**
- Security: the agent never pushes (ship sessions push only `main` + the tag, on the operator's
  approval); never `--force`/`reset --hard`; no Fly secrets changes; never print secrets; never open
  the CLI credential files; don't delete his files without asking.
- He likes to close a chat once nothing urgent is pending — say plainly what (if anything) is.

## 8. First message for the next chat

> You are Tvashtr Sidechat-25. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first — in
> `PROJECTPLAN.md` the header line, the §15 block "Sidechat-24 register" and the §17 entry "Tvashtr
> Sidechat-24"; skip the giant banner. Then: (1) check on disk that the V3b merge and the docs commit
> landed; (2) the film is parked — we're moving on to new product features: ask me which one, or
> propose the next milestone from the open items. Don't start work until you've read them.
