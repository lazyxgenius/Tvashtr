# Launch package — video V1 (re-issued by Tvashtr Sidechat-22, 2026-10-10, after M-desk-4's merge)

Brief: `prompts/video-v1.md`. Run in the Claude desktop app's Code tab, in the main checkout (the
filming stack needs the untracked `.env` and V0's ignored installs under `video/`). `main` is
`268ed099` (M-desk-4 fast-forwarded 2026-10-10).

## 0. Before you start (you, in a plain Terminal — not inside the Claude app)

```
claude auth status
```
It must say `"loggedIn": true`. If not: `claude auth login`. Keep the Mac on power; nothing else
running on :8000 / :5173; no Tvashtr Desktop open.

## 1. Start the session (Claude desktop app → Code tab)

- **+ New session** → **Local** → folder `/Users/adimac/Desktop/Tvashtr`
- Branch: `main` · worktree: **off**
- Mode: **Auto** (if Auto isn't listed: **Bypass permissions**)
- Model: **Opus**

## 2. Init prompt

```
You are the implementation agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout, and works on the demo film, not the product. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/video-v1.md — the brief for this session. It wins wherever it differs from CLI-RULES.
2. video/README.md — what V0 built and learned (the camera, the reel, the stack commands).
3. prompts/CLI-RULES.md — for the working discipline and the §4.7 final report (its numbers and milestone list are out of date).
4. The end of STATE.md
5. video/camera/desktop.mjs, video/camera/capture.mjs and desktop/scripts/live-desk-2-gate.mjs (the current Desktop flows)
6. scripts/design-parity/README.md, scripts/design-parity/scenarios/desk4.mjs and one other scenario file in scripts/design-parity/scenarios/

Then reply in at most 6 lines: main's sha and the current branch; the push guard (git config --get remote.origin.pushurl); the versions of node, python3 and ffmpeg; whether Docker is running; whether anything listens on :8000 or :5173; and the first thing you'll do. Then STOP and wait for my /goal.

When the /goal arrives, use the superpowers skills where they help (writing-plans, systematic-debugging, verification-before-completion). The brief's order, rules and gates always win over any skill's own workflow.
```

## 3. /goal

```
/goal Deliver video step V1 exactly as /Users/adimac/Desktop/Tvashtr/prompts/video-v1.md says: every scene of the demo film becomes a take script that re-records by name, on branch video/v1-camera from the current main (it must contain 268ed099, M-desk-4). Read the brief fully first and re-read it after any compaction or resume. No product change: only video/** and video ignore rules in .gitignore. No push (the guard must already be on; if not, stop). Never force, .env fenced, no secrets printed or filmed. Subscription budget: at most 2 real Desktop runs, 1 "Test this agent", 1 Ask; no compares, no task sets.

Deliver and echo, in order: (A) NO_PUSH_GUARD and PREFLIGHT; (B) the filming stack on a fresh tvashtr_film database, account shown as lazyx; (C) video/story.json and the story-rewritten fixtures; (D) the camera core: one script per scene, the take runner (make -C video take SCENE=<id>, with --dry), the pre-roll, the in-page cursor, take.json per take; (E) sample-data mode in the real Desktop window; (F) record-and-replay proven on one real run with matched live/replay screenshot pairs; (G) every LIVE-now, SAMPLE-now and WEB scene filmed, every run scene rehearsed --dry to its launch, the contact sheet and the chapter 2 preview; (H) video/SCENES.md with every scene's status and the operator's click-by-click MAC scripts; (I) what V2 needs; (J) video/README.md updated.

Then echo RUNS_USED, DIFF (git diff --stat main...video/v1-camera, showing only video/** and .gitignore), PRS (every trade_mcp PR url opened), READY_TO_MERGE video/v1-camera <sha>, and the eight-section FINAL REPORT of CLI-RULES §4.7. Leave the safe state: nothing running, branch committed, checkout on main.

Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names: write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
