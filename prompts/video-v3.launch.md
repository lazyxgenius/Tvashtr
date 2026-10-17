# Launch package — Video V3 (handed to the operator by Tvashtr Sidechat-24, 2026-10-16)

Brief: `prompts/video-v3.md` (+ the approved script `prompts/video-v3-script.md`). Main checkout, auto mode.

## 0. Before you start
- Terminal: `cd /Users/adimac/Desktop/Tvashtr && git config --get remote.origin.pushurl && git rev-parse --short HEAD` → `DISABLED-no-push-during-video-work` and `6b35addc`.
- Docker Desktop open; Mac on power; nothing on :8000/:5173.
- Recordly installed, with macOS Screen Recording allowed for it (System Settings → Privacy & Security → Screen Recording).
- Be reachable: for MAC-3 the session posts "MAC-3: open Recordly…" and waits for you to reply GO. If macOS asks "Electron would like to send notifications", click Allow.

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus.

## 2. Init prompt
```
You are the video V3 agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout, in auto mode. It renders the film's narration with an open-source voice on this Mac, re-shoots a few scenes on the shipped 0.27.0, and builds the title and end cards — only under video/, on a new branch video/v3; no product code. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/video-v3.md — the brief; it wins wherever it differs from the others.
2. prompts/video-v3-script.md — the approved narration; its text is final.
3. video/SCENES.md and video/README.md — the film's status, the camera, the MAC-3 script.
4. prompts/m-desk-8-v2b2.md Part B (K8, K9), and video/vendor/product-demo-director/SKILL.md + its docs/PRODUCTION_CONTRACT.md ("Global narration and thought-safe picture").
5. prompts/CLI-RULES.md — the working discipline and the §4.7 final report.
6. The end of STATE.md.

Then reply in at most 6 lines: main's sha and the push guard's value; whether Docker runs and :8000/:5173 are free; the sha256 of video/out/voice/reference.mp3 against the brief's; your Python version and whether torch can use MPS; and the first thing you'll do. Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/video-v3.md on a new branch video/v3 from main 6b35addc, sitting by sitting with a checkpoint commit after each: the approved script into video/v3/script.json (text byte-identical, proven by a test); VoxCPM2 on this Mac cloning every line from video/out/voice/reference.mp3 and its exact text, each line passing the transcript gate (≤ 3 renders a line), plus voice-sample.wav; narration-timing.json with per-line speech times and the Product Demo Director narrationMap; the replays 3.2, 3.3, 3.4, 3.4-verdict, 3.6 and 3.7's Changes + Ask part re-shot on 0.27.0; 4.1 + 4.2 on the chapter-6 team under the plain name, with MAC-3 — post "MAC-3: open Recordly, record the top-right of the screen, then reply GO" and wait for my GO; never click a macOS permission prompt — then 4.2's line rendered with the real resume time; the 0.2 and 8.2 cards (Newsreader/Inter, #F7F4EE/#2B2622/#C8674A); the chapter-3 listen-through; SCENES.md + README.

Rules: only video/** and video ignore rules in your commits; no product code; no push, force, reset --hard or merge into main; .env fenced; never open credential files; audio, video and model files never in git; one stack, one Desktop; budget 1 Grok Ask, ≤ 2 Claude runs (+1 spare), 0 test replays; caffeinate -dimsu; leave my installed Tvashtr.app alone.

Echo every evidence line the brief lists as it completes (every SMOKE line with a screenshot you open), then READY_TO_MERGE video/v3 <sha> and the eight-section FINAL REPORT (CLI-RULES §4.7). Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names (push guard off, an expired sign-in or a usage cap other than 3.7's fallback, VoxCPM2 unable to run or more than 5 lines failing the gate, a fix needing product code, a second unknown problem needing a broad change, a safeguards notice, a FAIL smoke line at the end): write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
