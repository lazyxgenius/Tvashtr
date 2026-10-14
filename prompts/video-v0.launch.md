# Launch package — video V0 (as handed to the operator by Tvashtr Sidechat-19, 2026-10-03)

Brief: `prompts/video-v0.md`. Run in the Claude desktop app's Code tab (the operator's choice). The
Code tab can't pass `--settings`, so the no-push guard is structural: the session's first action sets
`remote.origin.pushurl` to a dummy value and proves a dry-run push fails (brief §A).

## 1. Start the session (Claude desktop app → Code tab)

- **+ New session** → **Local** → folder `/Users/adimac/Desktop/Tvashtr`
- Branch: `main` · worktree: **off** (the stack needs the untracked `.env` and installed `node_modules`)
- Mode: **Auto** (if Auto isn't listed: **Bypass permissions**)
- Model: **Opus**

## 2. Init prompt

```
You are the implementation agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout, and works on the demo film, not the product. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/video-v0.md — the brief for this session. It wins wherever it differs from CLI-RULES.
2. prompts/CLI-RULES.md — for the working discipline and the §4.7 final report (its numbers and milestone list are out of date).
3. The end of STATE.md
4. desktop/README.md and desktop/scripts/live-subscription-gate.mjs
5. scripts/design-parity/README.md

Then reply in at most 5 lines: main's sha and the current branch; your Claude Code version; the versions of node, python3 and ffmpeg; whether Docker is running; and the first thing you'll do. Then STOP and wait for my /goal.

When the /goal arrives, use the superpowers skills where they help (writing-plans, systematic-debugging, verification-before-completion). The brief's order, rules and gates always win over any skill's own workflow.
```

## 3. /goal

```
/goal Deliver video step V0 exactly as /Users/adimac/Desktop/Tvashtr/prompts/video-v0.md says: prove the demo-film toolchain end to end, on branch video/v0-toolchain from main. Read the brief fully first and re-read it after any compaction or resume. No product change: only video/** and video ignore rules in .gitignore. No push: your first action turns on the brief's push guard and proves a dry-run push fails. Never force, .env fenced, no secrets printed, at most three real Desktop runs on my subscriptions.

Deliver and echo, in order: (A) NO_PUSH_GUARD: ON and the preflight; (B) Product Demo Director cloned into video/vendor at a pinned sha, with the ./pdd doctor summary; (C) desktop/scripts/live-subscription-gate.mjs run → PASS with a real PR url, on the local stack; (D) a Playwright camera for the Desktop app that passes the sharpness gate (SSIM ≥ 0.97, full frame and crop, against a lossless screenshot), and a ~60 s take of a real run's live view with its take.json; (E) a 20 s 1920×1080 test reel made with Product Demo Director, with one zoom and one caption, and its QA result; (F) the stall probe verdict (PASS or FINDING, with screenshots); (G) the key probe table (provider and OK/FAIL only); (H) video/README.md.

Then echo DIFF (git diff --stat main...video/v0-toolchain, showing only video/** and .gitignore), PRS (every trade_mcp PR url opened), READY_TO_MERGE video/v0-toolchain <sha>, and the eight-section FINAL REPORT of CLI-RULES §4.7. Leave the safe state: nothing running, branch committed, checkout on main.

Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names: write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
