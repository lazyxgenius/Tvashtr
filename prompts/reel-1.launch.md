# Launch package — Reel 1 (handed to the operator by Tvashtr Sidechat-25, 2026-10-22)

Brief: `prompts/reel-1.md`. Code tab in `/Users/adimac/Desktop/tvashtr-reel`, auto mode. $0.

## 0. Before you start (Terminal)
```
mkdir -p ~/.claude/skills && cp -R ~/Downloads/one-file-studio ~/.claude/skills/one-file-studio && mkdir -p ~/Desktop/tvashtr-reel && ls ~/.claude/skills/one-file-studio/SKILL.md
```

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/tvashtr-reel` · Auto · Opus.

## 2. Init prompt
```
You are the Tvashtr reel agent. This session runs in the Claude desktop app's Code tab, in /Users/adimac/Desktop/tvashtr-reel (not the Tvashtr repository), in auto mode. It makes one 50-second 16:9 reel about Tvashtr with the one-file-studio skill, from the film's real screen footage and its open-source narrator voice. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/reel-1.md — the brief; it wins wherever it differs from the skill.
2. ~/.claude/skills/one-file-studio/SKILL.md, then the references its video flow points to: quality-bar.md, ideas-and-scripts.md, video-engine.md, voice.md, sound.md, video-render-qa.md.
3. /Users/adimac/Desktop/Tvashtr/video/SCENES.md and video/README.md — the footage and how the film's voice was made.
4. /Users/adimac/Desktop/Tvashtr/video/v3/voice.py, say.json, script.json and phonemes.py.
5. /Users/adimac/Desktop/Tvashtr/prompts/CLI-RULES.md §4.7 — the final report.

Treat /Users/adimac/Desktop/Tvashtr as read-only.

Now reply in at most 6 lines: the skill's setup check (bash ~/.claude/skills/one-file-studio/scripts/check_setup.sh, names only, never key values); Node and ffmpeg versions; how many takes you found and their total length; whether VoxCPM2 loads from the film's voice-venv; and the first thing you'll do. Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/reel-1.md: one reel of about 50 seconds (47–53 s), 16:9, 1920×1080, 30 fps, built in /Users/adimac/Desktop/tvashtr-reel with the one-file-studio skill's video flow, from the film's real screen takes and its open-source narrator (VoxCPM2 from Tvashtr's video/voice-venv, cloned from video/out/voice/reference.mp3). It shows: the team is yours to compose; it works on a real repository; a Tests check fails, the work goes back to the Engineer and then passes; it ends in a real pull request; end card with the Tvashtr mark, github.com/lazyxgenius/Tvashtr and "Built by Aditya Sharma". Tvashtr's own look (cream, one coral accent, Newsreader/Inter/IBM Plex Mono).

In order: footage index (plan/footage.md, strips you looked at) → the skill's ideas survey and script versions → post SCRIPT READY and wait for my GO or notes → voice (VoxCPM2 takes in the skill's takes.json shape, scored and assembled into plan/vo_words.json; "Tvashtr" passes the phoneme check) and 6–8 style frames → post SAMPLE READY (voice MP3 for the first two lines + a contact sheet) and wait for my GO or notes → build, sound (synthesized or CC0 effects, an optional synthesized bed under the voice), render, QA → out/cut-01.mp4 plus the skill's phone-size copy.

Gates: first frame works as a thumbnail; first word by 1.3 s; every line's ending intact; burned-in word-synced captions readable at phone size; a sound on every cut; -14 LUFS and ≤ -1.5 dBTP; no black or frozen frames except deliberate holds; every sped-up shot labelled with its speed, sample-data shots labelled or left out; numbers on screen only where the footage shows them; no em dash on screen; every frame used looked at, nothing private in it.

Rules: auto mode; spend $0 (no ElevenLabs, no image or video generation, no paid service, no new Tvashtr runs); /Users/adimac/Desktop/Tvashtr is read-only (no writes, no git changes, no stack); no skill file, template or engine code ever goes into the Tvashtr repo or anywhere public; no git remote for the reel folder; never print a key; caffeinate -dimsu while rendering; time box 6 hours of work, not counting waits at the stops; keep STATUS.md, JOURNAL.md and credits.json current.

Echo each step's evidence as it completes (footage index, idea scores, chosen script, take scores, the QA numbers, the full path of every file you hand me), then the eight-section FINAL REPORT (Tvashtr's prompts/CLI-RULES.md §4.7). Done when out/cut-01.mp4 passes every gate and all of that is in this chat. Also done, as a valid stop, on a blocker the brief names (skill not installed, VoxCPM2 won't load, a needed take missing, a frame showing something private, a step needing a paid service or a write inside the Tvashtr folder, a safeguards notice): write NEEDS_HUMAN: <reason> to STATUS.md, say it here with the FINAL REPORT, and stop. Never call anything done without its evidence in this chat.
```
