# Launch package — Video V3b (handed to the operator by Tvashtr Sidechat-24, 2026-10-17)

Brief: `prompts/video-v3b.md`. Main checkout, auto mode.

## 0. Before you start
- Terminal: `cd /Users/adimac/Desktop/Tvashtr && git config --get remote.origin.pushurl && git rev-parse --short HEAD` → `DISABLED-no-push-during-video-work` and `03dac4b9`.
- Docker Desktop open; Mac on power; Focus / Do Not Disturb off; Recordly ready (Screen Recording allowed).
- The session does the voice fix first (no need for you), then asks for you for MAC-3: a check ("reply SEEN or NOT SEEN"), then "reply GO", then "reply SAVED". If macOS asks "“Electron” Would Like to Send You Notifications", click Allow.

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus.

## 2. Init prompt
```
You are the video V3b agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout, in auto mode. It fixes two wrongly spoken words in the film's narration and records MAC-3 (the Mac's stall notification) with the operator — only under video/, on a new branch video/v3b; no product code. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/video-v3b.md — the brief; it wins wherever it differs from the others.
2. prompts/video-v3.md — V3's brief: its rules, budget and stop list still apply unless V3b changes them.
3. video/SCENES.md (its V3 section and "MAC-3") and video/README.md.
4. video/v3/voice.py, video/v3/test_script.py, video/v3/listen.py, video/camera/scenes/4.1.mjs and video/camera/take.mjs.
5. prompts/CLI-RULES.md — the working discipline and the §4.7 final report.
6. The end of STATE.md.

Then reply in at most 6 lines: main's sha and the push guard's value; whether Docker runs and :8000/:5173 are free; whether video/voice-venv loads VoxCPM2 on MPS; the sha256 of video/takes/v3/4.1/take.mp4; and the first thing you'll do. Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/video-v3b.md on a new branch video/v3b from main 03dac4b9, sitting by sitting with a checkpoint commit after each: the phoneme sound check (video/v3/phonemes.py) shown FAILING first on V3's 3.1.wav ("h oʊ l") and 4.2.wav ("æ n d"); video/v3/say.json (same words, declared respellings only) with a test that a tamper fails, and voice.py reading it while video/v3/script.json stays byte-identical to main; 3.1 and 4.2 re-rendered with VoxCPM2's V3 settings (≤ 4 spoken forms × 3 seeds a line) until a render passes both the sound check and the transcript gate; narration-timing.json and voice-manifest.json updated for those two lines only; the chapter-3 listen-through re-rendered; then MAC-3 — the free notification check first ("MAC-3 CHECK: … reply SEEN or NOT SEEN"), then "MAC-3: open Recordly, record the top-right of the screen, then reply GO" and wait for my GO, the one stall run (the spare Claude run) under its own take id so V3's 4.1 take stays byte-identical, "… save it as video/out/mac/MAC-3.mov, then reply SAVED", and your own check of the file with a frame you open showing "Indicator sprint team stalled"; SCENES.md (a V3b section) + README.

Rules: only video/** and video ignore rules in your commits; no product code; no push, force, reset --hard or merge into main; .env fenced; never open credential files; audio, video and model files never in git; one stack, one Desktop; budget 1 Claude run, 0 Grok, 0 test replays; caffeinate -dimsu; never click a macOS permission prompt; leave my installed Tvashtr.app alone.

Echo every evidence line the brief lists as it completes, then READY_TO_MERGE video/v3b <sha> and the eight-section FINAL REPORT (CLI-RULES §4.7). Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names (push guard off, an expired sign-in or a usage cap, VoxCPM2 or the phoneme model unable to run, the notification check NOT SEEN three times, no GO within 60 minutes, no banner in MAC-3's file, a fix needing product code, a second unknown problem needing a broad change, a safeguards notice): write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. A line with no passing render after 12 tries is not a stop — keep V3's file, list it as owed and carry on. Never call anything done without its evidence in this chat.
```
