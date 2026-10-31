# Brief — Reel 1: one 50-second Tvashtr reel, made with the one-file-studio skill

Architect: Tvashtr Sidechat-25, 2026-10-22. Path: `/Users/adimac/Desktop/Tvashtr/prompts/reel-1.md`.
Where this brief and the skill differ, this brief wins. Where the skill says "ask the user", ask the
operator in this chat.

## What to make

**One reel, about 50 seconds (47–53 s), 16:9, 1920×1080, 30 fps,** for LinkedIn first. If the operator
likes it, later reels will each explain one feature — so build it so a new reel can reuse its look,
voice setup, sound library and footage index.

The story the reel must carry (from the product's vision — the order and words are yours to propose):
1. **The team is yours:** you compose your own team of AI agents on a canvas (who does what, where the
   checks sit, which model each one runs).
2. **It works on a real repository**, not a toy.
3. **The checks keep it honest:** a Tests check fails, the work goes back to the Engineer with the
   failing lines, then it passes and the Reviewer approves. This is the heart of the product: long
   agent runs stay on what you asked for.
4. **It ends in a real pull request.**
End card: the Tvashtr mark, one line saying what it is, `github.com/lazyxgenius/Tvashtr`, and
"Built by Aditya Sharma". No other call to action (the hosted site's providers are unreliable right now,
so don't send viewers there).

## Direction v2 (operator, 2026-10-22 evening) — REPLACES the story and end-card lines above

The operator watched draft-08 (cache/draft-08.mp4) and said: it describes **one particular run**, not
**what Tvashtr is**. Keep draft-08 untouched as a record. The reel becomes a **"what is Tvashtr"
overview**: an AI team orchestration platform where you build a team of AI agents, wire them together,
give them tools and MCP servers, and run them on your GitHub repo from a task you describe, each run in
its own sandbox. The one run (b98f6fcc) now supplies only the "check" and "ship" beats.

**The idea is set, so skip the 15-idea survey.** Write at most three versions of the script below,
cross-check them with the skill's table, then post SCRIPT READY again. Keep every claim below as
written (they are checked against the code); you may cut, shorten or reorder words for timing. A new
claim needs the operator's OK at SCRIPT READY.

Starting script (about 108 words, about 50 s with the end card):

| # | Line | On-screen kicker | Shot (from the film's takes) |
|---|---|---|---|
| 1 | Tvashtr lets you build your own team of AI agents, and run it on real code. | AI team orchestration | The finished film team on the canvas (2.7), the Tvashtr mark |
| 2 | Add agents, give each one a job, and wire how the work flows. | Build | 2.1 a template, 2.2 an agent's instructions, 2.4 the wiring and the checks |
| 3 | Pick the model for every agent, even your own Claude and Grok plans. | Models | 2.5 the model picker, 1.2 the Engines page (subscriptions) |
| 4 | Give them tools: MCP servers, skills and memory. | Tools | 1.3 the Toolkit (tools, secrets by name, a skill imported from GitHub), 2.6 "remember what it learns" |
| 5 | Then hand the team a task on your GitHub repo. | Run | 3.1 the task, repo, branch and folder, up to Launch |
| 6 | Every run gets its own sandbox: a throwaway cloud machine on the web, or its own copy of your repo on your Mac. | Sandboxed | A motion-graphic diagram (one run → one sandbox; web: a cloud machine, deleted after; Desktop: a temporary copy per agent step), then 8.1-web (the web app) |
| 7 | A planner writes the spec you approve. Tvashtr runs your tests, and a reviewer on another model checks the work. | Checked | 3.3 the spec and Approve, 3.4 "Tests failed" then round 2, the 665 passing, 3.4-verdict "Approved" |
| 8 | Then it opens a real pull request. | Shipped | 3.6 "Shipped: pull request #57", 0.1 PR #57 on GitHub |
| 9 | Change the team, and compare which version does better. | Improve | 6.3 the compare, "v2 did better" |
| 10 | Tvashtr. Your team. Your rules. | — | End card: the mark, "AI team orchestration: agents you design, on your code, with checks you set.", github.com/lazyxgenius/Tvashtr, "Built by Aditya Sharma" |

Facts behind the claims (checked by the architect on disk — don't stretch them):
- Line 6: on the web, each run gets its own throwaway cloud machine (a Firecracker microVM on Fly, its own
  app, network-limited, deleted after the run). On the Desktop, every agent step works on its own
  temporary copy of the repo on the Mac. Don't say "each agent has its own cloud machine".
- Line 4: tools and MCP servers are used by agents on web / API-key runs. Desktop subscription agents
  don't use library tools yet (that's the pink band). So never imply the run shown in lines 7–8 used
  tools; line 4's shots are the Toolkit and the agent's settings, not a run.
- Line 3: subscriptions run through the Desktop app; on the web, models run on the user's API keys.
- Line 7–8: the run b98f6fcc (Claude Sonnet 5 engineer, Grok reviewer, 2 rounds, 665 tests, PR #57).
- The pace is a feature tour: about 4–6 s a beat, a new transition each beat, kicker labels in the paper
  margin (one coral accent). Sped-up shots keep their small speed label; sample-data takes stay out.
- Cut the new version as `cut-02` (draft-08 stays as it is). The three stops repeat: SCRIPT READY,
  SAMPLE READY, FINAL.

## Where things live

- **The reel's project folder:** `/Users/adimac/Desktop/tvashtr-reel` (the session's working folder; the
  skill's project layout: `STATUS.md`, `JOURNAL.md`, `credits.json`, `plan/`, `assets/`, `src/`,
  `cache/`, `out/`). It is **not** a git repository with a remote, and never becomes one.
- **The skill:** `~/.claude/skills/one-file-studio/` (installed by the operator before launch). Its
  license allows personal use only: **no skill file, template or engine code ever goes into the Tvashtr
  repository** (it is public) or anywhere public. The finished video is the operator's to publish.
- **Tvashtr (`/Users/adimac/Desktop/Tvashtr`) is read-only for this session.** Read footage, the voice
  setup and the film docs from it; never write, move or delete anything there, never run git commands
  that change it, never start its stack. Copy what you need into the reel folder.

## Inputs (all already on disk)

- **Footage:** `video/takes/v*/<scene>/` — 101 real screen takes from the film (V1–V3b). The scene
  list and what each take shows: `video/SCENES.md`. The 3-minute recruiter cut
  (`video/out/recruiter/Tvashtr-demo-music.mp4`) used 0.1, 2.4, 3.1, 3.3, 3.4, 3.4-verdict, 3.6 and 6.3 —
  a good starting set. Build a footage index first (`plan/footage.md`: take, length, what happens, the
  best moments with times, and a contact strip you looked at).
- **The narrator:** the film's open-source voice. VoxCPM2 in `video/voice-venv` (run it with
  `video/voice-venv/bin/python`, `HF_HUB_OFFLINE=1`), cloned from `video/out/voice/reference.mp3`
  (+ `reference.txt`), settings as in `video/v3/voice.py`. The name is said "tuh-VAH-shter": use the
  spoken-form approach of `video/v3/say.json` and check the name with the phoneme check
  (`video/v3/phonemes.py`) — speech-to-text can't judge a made-up name. The film's 35 approved lines
  (`video/v3/script.json`, rendered files listed in `video/v3/voice-manifest.json`) may be reused where
  a line fits; new lines are rendered the same way.
- **The look:** Tvashtr's own, not the skill's default: cream paper, one coral accent (`#d97757`),
  Newsreader / Inter / IBM Plex Mono (all under the SIL Open Font License), the mark
  `frontend/public/mark-coral.png` / `mark-charcoal.png`, and the film's title/end cards
  (`video/v3/cards/cards.html`) as reference.

## How the skill's flow changes here

- **Voice — no ElevenLabs.** Replace only the take-recording step: a small script in the reel folder
  renders each line with VoxCPM2 (3 seeds per line) and writes the same files and `takes.json` shape the
  skill's scoring and assembly tools expect, so `score_takes.py`, `vo_assemble.py` and `plan/vo_words.json`
  work as written. Tone tags don't exist in VoxCPM2: carry tone with punctuation and line breaks, and pick
  takes by the numbers (match, tail, pitch). Install the word-timing model the skill expects in the reel
  folder's own venv, or adapt to `mlx-whisper` (already used by the film) — say which.
- **Sound — no ElevenLabs.** Make the effects in code (synthesized, like the recruiter cut's music bed),
  or use sounds with a free-for-any-use licence (CC0), each logged in `credits.json`. Check every effect
  has real content. An optional quiet music bed, also synthesized, ducked under the voice.
- **Images — none needed.** Real screen footage is the picture. No Pinterest sourcing, no image or video
  generation, no paid service. A free-licence photo (e.g. a laptop) only if a shot truly needs one,
  logged in `credits.json`.
- **Spend: $0.** No paid API, no new Tvashtr runs, no Desktop sign-ins.
- **No new recording of any kind (operator, 10-22).** No camera takes, no replays, no screen recording, no re-shoots. The picture is cut only from the takes already on disk: trim, crop, zoom, speed up or slow down, freeze, reorder, and frame them in code-built shots. If a beat has no footage, carry it with type and motion graphics instead.

## Honesty and privacy (stop and ask if something doesn't fit)

- Every product shot is real footage. Anything sped up carries a small label with its speed ("Real run ·
  8×"); sample-data takes (1.4, 1.5, 3.5, 8.1) carry "Illustration · sample data" or stay out.
- Numbers on screen only where the footage shows them (a run's time, a test count, a PR number). No
  invented users, results or claims.
- Look at every frame you use: no email address, key, token, cookie or private path beyond what the film
  already shows. If in doubt, leave it out.
- No em dash in on-screen text or captions (the skill's rule).

## Quality bar (the skill's gates, plus two)

First frame works as a thumbnail; first spoken word by 1.3 s; every line's ending intact; **burned-in,
word-synced captions readable at phone size (LinkedIn plays muted first)**; a sound on every cut;
-14 LUFS and ≤ -1.5 dBTP; no black or frozen frames except deliberate holds (screen footage has still
moments: hold them on purpose, or cut them); "Tvashtr" passes the phoneme check every time it's spoken.

## Three stops for the operator

1. **SCRIPT READY** — after the footage index, the skill's ideas survey and script versions: post the
   final script (one line per beat, its tone, its shot, the take and time it comes from, the speed
   label) and the runner-up idea in one line. Wait for "GO" or notes.
2. **SAMPLE READY** — the voice for the first two lines (one MP3) and a contact sheet of 6–8 style
   frames at the key words. Wait for "GO" or notes.
3. **FINAL** — `out/cut-01.mp4` (+ the skill's phone-size copy), its QA numbers, a contact sheet, the
   script, `credits.json`. Then the eight-section FINAL REPORT (Tvashtr's `prompts/CLI-RULES.md` §4.7).

The operator opens files from Finder, so give each one's full path.

## Stop with NEEDS_HUMAN (say why in the chat) when

the skill isn't installed at `~/.claude/skills/one-file-studio/`; VoxCPM2 won't load from the film's
venv; a needed take is missing or unreadable; a frame you need shows something private; a step would
need a paid service or writing inside the Tvashtr folder; or a safeguards notice.

## Rules

Auto mode. Never write inside `/Users/adimac/Desktop/Tvashtr`. Never copy skill files anywhere public.
Never print a key or token. `caffeinate -dimsu` while rendering. Time box: 6 hours of work, not counting
the time spent waiting at the stops. Leave the skill's trail: `STATUS.md` (where the job stands, enough
for a fresh session to pick up), `JOURNAL.md` (each decision and why), numbered cuts.
