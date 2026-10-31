# Launch package — Film D1 "Tvashtr in 2 minutes" (handed to the operator by Tvashtr Sidechat-26, 2026-10-31)

Brief: `prompts/film-demo.md`. Code tab in `/Users/adimac/Desktop/Tvashtr`, auto mode, Sonnet 5.5 · High. $0.

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Sonnet 5.5 · effort High.

## 2. Init prompt
```
You are the Tvashtr Film D1 agent. This session runs in the Claude desktop app's Code tab, in /Users/adimac/Desktop/Tvashtr, in auto mode. It cuts a ~2-minute narrated demo of Tvashtr, plus a silent hero loop and posters for the landing page, from the film's existing footage and voice lines. Nothing new is recorded. Read these fully, in order, and change nothing yet:
1. prompts/film-demo.md — the brief; it wins wherever it differs.
2. video/README.md — the toolchain (V0 toolchain and reel, V3 voice and cards, V3b).
3. video/SCENES.md — the Status table, then "V3" and its "What V4 needs".
4. video/v3/script.json and video/v3/narration-timing.json — the approved lines and their timings.
5. prompts/CLI-RULES.md §4.7 — the final report.

Now reply in at most 6 lines: whether the toolchain still runs (Product Demo Director's doctor, the voice venv, ffmpeg); whether every take and voice file the brief's §3 names is on disk; anything in the script you think can't be shown honestly from the footage; and the first thing you'll do. Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Deliver prompts/film-demo.md: "Tvashtr in 2 minutes", a 1:50–2:10 narrated demo (1920×1080, 30 fps, -14 LUFS, true peak ≤ -1.5 dBTP) cut only from the film's existing takes, using the 11 passed voice lines in video/out/v3/lines/ as they are plus the 2 new lines the brief scripts (d.task, d.compare), in the film's look; with its captions (.vtt + .srt), YouTube thumbnail and description with chapters, a demo poster, and the landing page's silent 8–12 s hero loop (webm + mp4, ≤ 2 MB each) with its poster and hero-loop.json. All files in video/out/demo/; build scripts in video/demo/ on branch video/demo-2min from main.

In order: shot list (take, in, out, speed, label for all 13 lines) → render the 2 new lines through video/v3/voice.py's gates → build the cut, captions, thumbnail, description, posters and hero loop → run every check in the brief's §6 → post DEMO READY with the path of every file, the QA numbers, the cuts table and the contact sheet, and wait for my notes or GO. Notes come back as one list: make cut-02, keeping cut-01's files.

Rules: the brief's words are final (no rewording; trims only between lines); every speed-up labelled with its factor; no number on screen the footage doesn't show; no burned-in captions; nothing private in any frame; nothing from ~/Desktop/tvashtr-reel or the one-file-studio skill; no new recording, no paid service, no push, no deploy; commit only your own paths; files in video/out/v3/lines/, video/v3/script.json and video/v3/narration-timing.json byte-identical (sha256 before and after); never run the voice model beside Chrome or ffmpeg work; caffeinate while rendering. I'm on the Claude Pro plan: look at contact sheets and the frames either side of each cut rather than every frame, no subagents or workflows, update STATE.md after each step so a usage-limit pause loses nothing; time box 4 hours of work, not counting the wait at the stop.

Echo each step's evidence as it completes (the shot list, each new line's render verdicts, every §6 check with its real numbers and the ffprobe lines, the full path of every file), then the eight-section FINAL REPORT (prompts/CLI-RULES.md §4.7). Done when every §6 check passes and all of that is in this chat. Also done, as a valid stop, on a blocker the brief's §6 names: write NEEDS_HUMAN: <reason> to STATE.md, say it here with the FINAL REPORT, and stop. Never call anything done without its evidence in this chat.
```
