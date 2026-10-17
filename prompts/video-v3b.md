# Brief — Video V3b: fix two spoken words, record MAC-3

Architect: Tvashtr Sidechat-24, 2026-10-17. Path: `/Users/adimac/Desktop/Tvashtr/prompts/video-v3b.md`.
`prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md`, `design/` belong to the architect: never stage
or commit them. Where this brief and `prompts/CLI-RULES.md` differ, this brief wins. Also read
`prompts/video-v3.md` (V3's brief: its rules, budget and stop list still apply unless this brief
changes them), `video/SCENES.md` (its V3 section and "MAC-3"), `video/README.md`, and the end of
`STATE.md` (the V3 session's lines).

## Where things are (checked by the architect on disk, 2026-10-17)

- `main` = **`03dac4b9`** (V3 merged, fast-forward). `origin/main` = `6b35addc` = production (Fly v46,
  Desktop 0.27.0). Push guard ON (`DISABLED-no-push-during-video-work`).
- V3 delivered: 35 narration lines in `video/out/v3/lines/` (VoxCPM2, cloned from
  `video/out/voice/reference.mp3`), `video/v3/narration-timing.json`, the re-shoots in
  `video/takes/v3/`, the cards, `video/out/v3/ch3-narrated.mp4`. Only two things are left before the
  rough cut (V4), and this session does both.
- **Two lines say a wrong word** — the architect checked them sound by sound with a phoneme
  recogniser (`facebook/wav2vec2-lv-60-espeak-cv-ft`, Apache-2.0):
  - **3.1** "add a **Hull** moving average" is spoken as **"hole"**: the word's phonemes read
    `h oʊ l` (Hull is `h ʌ l`). All three V3 renders did it.
  - **4.2** "waits for you **in** Needs you" is spoken as **"and"**: from "you" to "Needs" the line
    reads `j uː æ n d n iː d z`. All three V3 renders did it.
  - The name "Tvashtr" is **fine** in all ten places: every one reads `t ə v ɑː ʃ t ɚ`, the same as
    the reference clip. The odd spellings in V3's report were the speech-to-text guessing at an
    unknown word. Do not re-render any other line.
- **MAC-3 is owed:** the operator's Recordly shot of the macOS banner "Indicator sprint team stalled"
  (SCENES.md "MAC-3"). V3 gave the GO and turned the bell on, but no file was saved. The +1 spare
  Claude run from V3's budget is still unused. Run #8 (`d4159fe6`, Failed) and run #9 (`ae65f353`,
  Done, PR #67) stay as they are.

## Decisions (final — architect, 2026-10-17)

- **D1 The words on screen never change.** `video/v3/script.json` stays byte-identical to `main`
  (its test keeps proving it matches the approved export). The voice instead reads a **spoken form**
  for these two lines only, kept in a new file `video/v3/say.json`: the same words in the same
  order; only spelling, capitals and punctuation may differ, and every changed spelling is declared
  (e.g. `{"Hul": "Hull"}`). A new test proves it (a tamper — an extra or missing word — fails).
  `voice.py` uses the spoken form when a line has one; the transcript gate still compares against
  the script's words.
- **D2 A sound check decides these two words**, because speech-to-text can't hear the difference
  (V3's gate heard "whole" even for good audio, and "Hull" when hinted). Add `video/v3/phonemes.py`:
  the phoneme model above on this Mac (the Hugging Face cache; `Wav2Vec2PhonemeCTCTokenizer` with
  `do_phonemize=False` loads without espeak), word times from the existing transcriber.
  - **3.1 passes** when the word between "a" and "moving" reads with `ʌ` and without `oʊ`.
  - **4.2 passes** when, between "for you" and "Needs", there is no `æ` and no `d`.
  - **Reproduce first:** run the check on V3's kept `3.1.wav` and `4.2.wav` and show it FAILS on both
    (`h oʊ l`; `æ n d`) before rendering anything.
  - The line must also pass V3's normal transcript gate for every other word.
- **D3 Render budget:** at most 4 spoken forms × 3 seeds per line, same VoxCPM2 settings as V3
  (`video/v3/voice-manifest.json`). Suggested order to try — 3.1: `Hul`, `Huhl`, `Hull,` (a comma
  after it), then your own; 4.2: `waits for you, in Needs you.`, `waits for you in "Needs you".`,
  `waits for you — in Needs you.`, then your own. Keep the first render that passes both checks.
  V3's kept files are saved first as `lines/renders/3.1-v3.wav` and `lines/renders/4.2-v3.wav`. 4.2's
  `{resume_minutes}` is "Seven", as in V3.
- **D4 Everything that uses those two lines is refreshed:** `narration-timing.json` (only the 3.1 and
  4.2 entries and their `narrationMap` entries change), `voice-manifest.json`, and the chapter-3
  listen-through re-rendered with the new 3.1 (`video/v3/listen.py`, same rules, −16 LUFS) to
  `video/out/v3/ch3-narrated.mp4` (V3's copy kept as `ch3-narrated-v3.mp4`).
- **D5 MAC-3 with a free check first.** Before spending the run, prove a macOS banner from the dev
  Desktop reaches the screen: from the camera, show one test notification in the dev Desktop's page
  (`new Notification("Tvashtr test", { body: "If you can see this, MAC-3 will work." })` — camera
  code under `video/`, no product change), post exactly
  `MAC-3 CHECK: look at the top-right of your screen, then reply SEEN or NOT SEEN` and wait.
  - If macOS asks "“Electron” Would Like to Send You Notifications", that click is the operator's,
    never yours.
  - On NOT SEEN, post: `MAC-3 CHECK: open System Settings → Notifications → Electron, turn on Allow
    notifications (style: Banners), make sure Focus / Do Not Disturb is off, then reply READY` —
    and check again. Three NOT SEEN in a row → NEEDS_HUMAN, run not spent.
- **D6 The MAC-3 run** (the spare Claude run): the stall stack as in V3 (`QUIET=20 STALLED=60
  FAIL=180`), a 4.1-style run on the chapter-6 team under its plain name "Indicator sprint team"
  (spec approved, the Engineer's Claude CLI paused by the camera as in 4.1). Film it under its own take
  id (e.g. `4.1-mac3`) so V3's `takes/v3/4.1` stays byte-identical (sha256 of its `take.mp4` before
  and after). Before launching, post exactly
  `MAC-3: open Recordly, record the top-right of the screen, then reply GO` and wait for GO (no
  reply in 60 minutes → NEEDS_HUMAN, run not spent). After the run shows **Stalled** and at least
  20 s have passed, post `MAC-3: the banner should be on screen now — click it if you can, then stop
  recording and save it as video/out/mac/MAC-3.mov, then reply SAVED`. Let the run go on to Failed;
  leave it (no resume, no delete).
- **D7 Check the recording yourself:** the file exists; `ffprobe` duration and size; pull frames
  around the banner and **open them**; SMOKE passes only if a frame shows the banner titled
  "Indicator sprint team stalled". No banner in the file → NEEDS_HUMAN (no run left to retry).

## The sittings (in order; a checkpoint commit after each)

1. **Branch `video/v3b` from `main` `03dac4b9`.** Preflight: push guard ON; Docker; ports
   :8000/:5173 free; the voice venv `video/voice-venv` and VoxCPM2 load on MPS; sha256 of
   `video/takes/v3/4.1/take.mp4` recorded.
2. **The sound check** (`phonemes.py`) + its reproduce-first FAIL on V3's two files.
3. **`say.json`** + its test; `voice.py` reads it.
4. **Re-render 3.1 and 4.2** (D3), both checks per render, then timing + manifest (D4).
5. **The listen-through** re-rendered (D4).
6. **MAC-3** (D5, D6, D7): stack with the stall knobs, the free check, GO, the run, SAVED, your own
   check of the file. Stack down after.
7. **Docs:** a "V3b" section in `video/SCENES.md` (the phoneme check and its results, each render
   tried with its spoken form, seed and phonemes, the kept files, MAC-3's run and file) and
   `video/README.md`.

## Real-work budget

| Claude runs | Grok jobs / Asks | test replays | voice renders |
|---|---|---|---|
| 1 (the spare, MAC-3 only) | 0 | 0 | ≤ 12 per line (4 forms × 3 seeds), only 3.1 and 4.2 |

## Rules

V3's rules 1–9 (`prompts/video-v3.md`), with `video/v3b` in place of `video/v3`. In particular: only
`video/**` and video ignore rules in your commits; no product code; no push, force, `reset --hard` or
merge into `main`; `.env` fenced; never open the claude/grok credential files; audio, video and model
files never in git; one stack, one Desktop; leave the installed Tvashtr.app alone;
`caffeinate -dimsu`. Never click a macOS permission prompt.

## Evidence lines (echo each as it completes)

`PREFLIGHT: main=03dac4b9 guard=ON 4.1_take_sha=<sha>` ·
`REPRO: 3.1 FAIL <phonemes> · 4.2 FAIL <phonemes>` (on V3's files) ·
`TESTS: <n> passed` (`python3 -m unittest discover -s video/v3 -v`, incl. the say.json tamper) ·
`RENDER: <scene> form=<…> seed=<n> phonemes=<…> transcript=<pass|fail> → <PASS|FAIL>` (each) ·
`LINES: 3.1 <kept|owed> · 4.2 <kept|owed>` · `TIMING: only 3.1, 4.2 changed (<diff summary>)` ·
`CH3_NARRATED: <file> <s> <LUFS>` · `NOTIFY_CHECK: SEEN | NOT SEEN ×<n>` ·
`MAC3_RUN: run=<id> <outcome, wall clock>` · `SMOKE: MAC-3 PASS|FAIL <frame you opened>` ·
`TAKE_4.1_UNCHANGED: <sha before> == <sha after>` · `SCRIPT_UNCHANGED: git diff main -- video/v3/script.json empty` ·
`RUNS_USED: claude_runs <n>/1, grok 0` · `DIFF: <git diff --stat main...video/v3b>` ·
`READY_TO_MERGE video/v3b <sha>`, then the eight-section FINAL REPORT (CLI-RULES §4.7).

## Stop with NEEDS_HUMAN (written to STATE.md and echoed, with the FINAL REPORT) when

- the push guard is off; a sign-in expired or a usage cap is hit; VoxCPM2 or the phoneme model can't
  run on this Mac;
- the notification check is NOT SEEN three times, no GO within 60 minutes, or MAC-3's file has no
  banner;
- a fix would need product code; a second, unknown problem needs a broad or unproven change; a
  safeguards notice stops a response.

**Not a stop:** a line with no passing render after 12 tries — keep V3's file for it, list the best
three renders (form, seed, phonemes) as `LINES: <scene> owed`, and carry on to MAC-3; the final
outcome is then NEEDS_HUMAN with everything else delivered. A contained, code-proven fix inside
`video/` (e.g. the camera's notification check) may proceed.
