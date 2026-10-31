# Launch package — Landing 1 (handed to the operator by Tvashtr Sidechat-26, 2026-10-31)

Brief: `prompts/landing-1.md`. Code tab in `/Users/adimac/Desktop/Tvashtr`, auto mode, Opus 5.5 · High. $0.

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus 5.5 · effort High.

## 2. Init prompt
```
You are the Tvashtr Landing 1 agent. This session runs in the Claude desktop app's Code tab, in /Users/adimac/Desktop/Tvashtr, in auto mode. It redesigns Tvashtr's public landing page with three design skills (taste-skill leads, GSAP skills for motion, Hallmark as the final inspector), a clean animated picture of a team built in code, and two self-hosted videos. Read these fully, in order, and change nothing yet:
1. prompts/landing-1.md — the brief; it wins wherever it differs.
2. frontend/src/pages/website/LandingPage.tsx, LandingMobile.tsx, SiteRoot.tsx, sections.ts, copy.ts and Faq.tsx — the page as it is.
3. frontend/src/pages/website/LandingPage.test.tsx, LandingMobile.test.tsx, desktopRouting.test.tsx and frontend/e2e/website.spec.ts — the wiring the tests hold.
4. backend/tvashtr/main.py, the function mount_frontend — how production serves the built site.
5. prompts/CLI-RULES.md §4.7 — the final report.

Now reply in at most 6 lines: node version and whether Chrome is installed; whether /Users/adimac/Desktop/tvashtr-reel/out/cut-02.mp4 and video/out/demo/demo-2min.mp4 + demo-2min.en.vtt exist (sizes); how you'll install the three skills; anything in the brief that conflicts with the code; and the first thing you'll do. Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Deliver prompts/landing-1.md on branch feat/landing-1 from main bb124991: Tvashtr's public landing page redesigned with taste-skill leading the design (brand palette and type kept), the GSAP skills for motion and Hallmark as the final inspector; a hero with a clean, animated picture of a team built in code (not a screenshot); Reel 1 as the main video and the 2-minute demo as a secondary link, both self-hosted from frontend/public/media/ as native <video> with posters and nothing downloaded before play; a real phone layout; a code split so the landing doesn't wait for the app; and link-preview tags with og.png.

In order: step 0 install the three skills for this user only (brief §2) → record the before, write the argument, deal three directions as hero comps → post DIRECTIONS READY and wait for my pick → build the nav and hero in the app → post HERO READY and wait for my GO or notes → build the rest of the page, the videos, the code split and the previews → run every check in the brief's §11 → post PAGE READY.

Rules: every claim from the brief's §6 sources, never "open source"; product pictures faithful to the real product, no numbers or "Real run" labels on them; wiring and its tests kept (copy/layout tests rewritten at the same strength, each listed); only the paths in §13 change, design-system tokens untouched; dependencies only gsap and @gsap/react; nothing from the one-file-studio skill or the tvashtr-reel folder except the one finished video; no push, no deploy, no migration, no backend change; never print a key; don't run make test. I'm on the Claude Pro plan: Opus high, no ultracode, no workflows, one subagent only (Hallmark's finish review), screenshots only where a step needs them, STATE.md updated after each step so a usage-limit pause loses nothing; time box 8 hours of work, not counting waits at the stops.

Echo each step's evidence as it completes (install proof, the three directions with screenshots, test counts before/after, lint counts, each e2e result, the inspector and sloplint results, the JS-bytes and Lighthouse numbers, the 206 range proof and both videos playing in WebKit and Chromium, the before/after visible text, git diff --stat), then the eight-section FINAL REPORT (prompts/CLI-RULES.md §4.7). Done when every §11 check passes and all of that is in this chat. Also done, as a valid stop, on a blocker the brief's §11 names: write NEEDS_HUMAN: <reason> to STATE.md, say it here with the FINAL REPORT, and stop. Never call anything done without its evidence in this chat.
```
