# Brief — Landing 1: a better landing page, with the 2-minute demo

Architect: Tvashtr Sidechat-26, 2026-10-31. Path: `/Users/adimac/Desktop/Tvashtr/prompts/landing-1.md`.
Model: **Opus 5.5, effort high** (not ultracode), Claude desktop app Code tab, auto mode. The operator
is on the **Claude Pro plan**: keep the session lean (§12). Runs **after** Film D1
(`prompts/film-demo.md`, merged). Revised 10-31 after the operator's notes: the hero shows a clean
picture of a team built in code (not a real-run loop), and the main video is Reel 1 (52 s), with the
2-minute demo as a secondary link.

## 1. Outcome — what a visitor sees

The public landing page (`#/welcome`, and `/` when signed out) is redesigned into a page that looks
designed, not generated, in Tvashtr's own brand:
- **Hero:** a short headline, one sentence and the primary action, beside a **clean, animated picture
  of a Tvashtr team at work** — built in code (HTML/SVG + GSAP) in the brand, **not a screenshot**
  (operator, 10-31: the workflow picture must be neat and tidy; it need not be a real one). A task
  enters, the PM writes the spec, you approve it, the Engineer builds, **Tests pass** fails once and
  sends the work back, passes, the Reviewer approves, the checks pass, a pull request opens.
- **"Watch the demo":** a poster with a big play button; one click plays **Reel 1** (52 s, narrated,
  "what Tvashtr is") with sound, **served from Tvashtr's own site** — no YouTube or any other video host
  (operator, 10-31; the way heyclicky.com does it: plain MP4 files on its own domain, each with a
  poster). Under it, a quiet text link to the **2-minute demo** of one full run, played the same way.
  No video bytes download until the visitor presses play.
- **One thing to try:** the "the team is yours" idea made touchable, for example the visitor adds a
  Tests check or removes the Reviewer in the hero's team and watches the path change. It may be the
  hero picture itself. It never claims a result.
- Scroll motion that serves the story (GSAP), a calm version under reduced motion, a real phone layout.
- A **fast first screen** (the landing no longer waits for the whole app's code) and **link previews**
  (title, line and image) when the URL is shared.

## 2. Step 0 — install the three skills (you do it, for this user only)

Check `node -v` ≥ 22 and that Chrome is installed. Install **into `~/.claude/skills/`, never into the
repo**: `npx skills add https://github.com/Leonxlnx/taste-skill --skill design-taste-frontend -g`,
`npx skills add https://github.com/greensock/gsap-skills -g`, `npx skills add nutlope/hallmark -g`
(check `npx skills --help` for the right flags for Claude Code; fallback: shallow-clone each repo outside
the Tvashtr folder and symlink the skill folders into `~/.claude/skills/`). All three are MIT. **Don't**
run Hallmark's `install-hook.mjs` (it adds an edit-time hook beside our safety hooks), don't install them
as plugins, don't touch the project's `skills-lock.json`. Then read each SKILL.md straight from its
folder (and only the reference files its flow names when you reach that step); don't wait for the skill
list to refresh. The scripts write working folders `.taste-skill/` and `.hallmark/` at the repo root:
add both to `.gitignore` and never commit them. Prove: `git diff --stat` after install shows only
`.gitignore`.

## 3. Who does what

The two design skills overlap and disagree on motion, so each has one job:
- **taste-skill leads** the design: its redesign path (record the before; keep the stack, content and
  what works), `draw.mjs` with `--keep palette,type` (the brand is fixed, §4) and
  `--have product-ui,video`, the argument, the idea sentence, the one live thing, the look-and-fix loop,
  and its motion layer (step 9). Software shows its own interface: real frames from the film, and any UI
  fragment built as a real piece in the brand, never grey bars.
- **GSAP skills** write the motion: `useGSAP` with scoped cleanup, ScrollTrigger refresh and cleanup on
  route change, transform and opacity only, `prefers-reduced-motion` drops all travel. No content may stay
  hidden if GSAP fails to load.
- **Hallmark is the inspector at the end only:** `sloplint.mjs --render --url <dev server>/#/welcome`
  (8 widths) and its one fresh-context finish review. Don't run its deal, draw or scaffold (no second
  direction, no `tokens.css`/`base.css` into our styles). **Must-fix Floor rules:** 1 (every colour and
  font through our tokens), 2, 5, 6, 7 (reduced motion; animation never hides content), 8, 11, 12, 14,
  and 4 applied to the website's root element (not the app's `html`/`body`). **Advice only** (fix or
  waive with a one-line reason): 3, 9, 10, 13, 15 and its motion restraint. Where taste and Hallmark
  disagree, taste wins, recorded as a waiver.

## 4. The brand — fixed

Tokens in `frontend/src/design-system/tokens/` (colours, fonts, spacing, typography, extend) and the
`Logo` component: the warm cream page, coral `#d97757` as the one signal, Newsreader / Inter / IBM Plex
Mono. The direction decides composition, scale, rhythm and motion, not new colours or faces. No literal
colours or font families outside tokens; new page styles go in `frontend/src/pages/website/website.css`.
`git diff main -- frontend/src/design-system` must be empty.

## 5. Material — product pictures are clean rebuilds, not screenshots

- **Every picture of the product on the page is built in code** (HTML/SVG, the brand's tokens), tidy
  and readable at every width: no cut-off labels, no warning banners, no empty minimap or zoom buttons,
  no tangled lines, no cursor. Use the real app as the reference for what exists and what things are
  called (read the canvas and run-view components, and look at a few frames in
  `video/takes/v3/*/shots/*.png` and `video/takes/v2b/*/poster.png`), then draw it cleaner than the real
  screen. Don't use an image generator (it garbles interface text, can't animate, and costs money).
- **Faithful, not invented:** show only node kinds, labels and behaviours the product has (§6). No
  times, costs, counts or run results on these pictures, and no "Real run" label (they aren't one).
- **Videos (self-hosted, committed in `frontend/public/media/`):**
  - `reel-1.mp4` from `/Users/adimac/Desktop/tvashtr-reel/out/cut-02.mp4` (the finished Reel 1; its
    licence: "the finished video is the operator's to publish"). Read that one file only; never write,
    list beyond it, or run git in `/Users/adimac/Desktop/tvashtr-reel`. Nothing else from that folder or
    the one-file-studio skill enters the repo.
  - `demo-2min.mp4` + `demo-2min.en.vtt` from `video/out/demo/` (Film D1, merged).
  - Re-encode both: H.264 High, yuv420p, AAC 128k, `-movflags +faststart` (playback starts before the
    file finishes), 1920×1080, quality chosen so Reel 1 ≤ 8 MB and the demo ≤ 15 MB with the UI text
    still sharp (look at three frames of each). Posters: `reel-1-poster.webp` (Reel 1 at ~1 s) and
    `demo-2min-poster.webp`, 1920×1080, < 300 KB each.
  - Every file name and path in one constants file (`frontend/src/pages/website/media.ts`).
- Nothing else: no stock or library photos, no invented logos, numbers or quotes.

## 6. What the page may say (checked against the code by the architect)

Start from the current copy (`LandingPage.tsx`, `LandingMobile.tsx`, `Faq.tsx`, `copy.ts` — already
checked) and the film's approved narration (`video/v3/script.json`). Tighten freely; any claim not in
those two sources goes in the report for the architect to check before merge. Hard limits:
- The repo has no licence: say "source on GitHub", **never "open source"** (`copy.ts`).
- Web runs: each **run** gets its own throwaway cloud machine (not each agent). Desktop: each agent step
  works on its own temporary copy of the repo; Desktop plan-run agents **don't use library tools or MCP
  yet** — never imply they do. Desktop is Mac only. Keep the `TWO_WAYS` facts and the "not affiliated with
  Anthropic or xAI" note.
- Models: any provider with your own API keys (stored encrypted, shown masked), or your Claude or Grok
  plan on the Mac app. The FAQ's model answer stays driven by `config` (OQ-11).
- The hero's team uses the product's real pieces and names: agents (Product manager, Engineer,
  Reviewer, Fixer), gates (PRD approval — you approve the spec —, Tests pass — Tvashtr runs your tests; a failure goes back to
  the Engineer with the last 12 lines —, Secret scan, No edits to a folder you name), the Reviewer
  sending work back ("changes requested"), a failure path to the Fixer, and Ship opening a pull request.
  Agent cards may name the model they run on, as the product's cards do; no brand logos.
- The GitHub star count only when the site facts load (OQ-13). No testimonial until a real, permitted
  quote exists (OQ-12). No speed, success-rate or user-count claims.
The old layout rules in `docs/superpowers/specs/2026-09-25-revamp-analysis/website.md` §2 "Landing" are
replaced by this redesign; its honesty decisions (§6 OQ-4, 11, 12, 13, 21) still hold.

## 7. Wiring that must survive

Every address and link: `#/welcome`, `#/welcome?s=product|how|domains|two-ways|faq` (each id still on the
page, `sections.ts` behaviour kept), `#/signin`, `#/download` (every Download control via the download
page, WEB-37), signed-in labels go to `#/home` (OQ-21), `SiteHeader`/`SiteFooter` links, the star fetch
(`getSiteInfo`), the phone experience below 720 px (`LandingMobile`, or one responsive page that keeps its
behaviours), and **no public page ever renders inside Tvashtr Desktop** (`desktopRouting.test.tsx`).
Tests: wiring tests keep passing unchanged. Tests that pin old copy or layout are rewritten to the new
page **at the same strength** (each removed assertion replaced by an equivalent one) — list every changed
test with its before/after assertion. Never delete a test to make the page pass.

## 8. The demo videos — specs

- **Reel 1 (main):** a native `<video>` with `poster`, `preload="none"`, `playsinline`, our own large
  play button over the poster (keyboard operable, labelled "Play the 1-minute demo, with sound"). On
  play: sound on, the browser's own controls shown. Reel 1 has captions burned in.
- **2-minute demo (secondary):** a plain text link ("See one full run · 2 min") that plays it in the same
  player (or a lightbox — your design's call), with `<track kind="captions" srclang="en" default>` from
  `demo-2min.en.vtt`. Escape or a close button returns to the page.
- Nothing downloads before a play press (prove it from the network log: no `.mp4` request on load).
  One player plays at a time; it pauses when scrolled out of view.
- **Hero animation** (§1): `prefers-reduced-motion` shows its finished state, still. It pauses when off
  screen. Built with the GSAP skills' rules (scoped `useGSAP`, cleanup, transform/opacity only).

## 9. Speed and link previews

- **Code split:** the public pages load without downloading the signed-in app's code (load the app's
  screens lazily behind their routes). Measure on `vite build` + `vite preview` with Playwright's network
  log: gzip JS transferred before the hero is visible — report before and after; target ≤ 250 KB. Report
  CSS bytes too. Every app route still works (e2e below).
- **Lighthouse** (mobile, on `vite preview`, `/#/welcome`): report Performance, Accessibility, Best
  practices, SEO. Targets: Accessibility ≥ 95, Best practices ≥ 90, Performance ≥ 85 (if Performance
  misses, report what holds it back; don't game it).
- **Link previews** in `frontend/index.html`: `description`, `og:title`, `og:description`, `og:url`,
  `og:image` (absolute `https://tvashtr.fly.dev/og.png`), `twitter:card=summary_large_image`. Make
  `frontend/public/og.png` (1200×630, < 300 KB) from the new hero with Playwright, words matching the page.

## 10. Stops

1. **DIRECTIONS READY** — the before (taste's inspector screenshots + a 4-line read), the argument (one
   line per section: claim → proof), and **three dealt directions as hero comps** (quick static pages in
   `.taste-skill/`, not in the app), each with a 1440 and a 390 screenshot, its idea sentence and its one
   live thing. Wait for the operator's pick.
2. **HERO READY** — the nav and hero built in the app on the branch, with the team animation and the
   demo button: screenshots at 1440, 1280×800 and 390, plus a Playwright recording of one full cycle of
   the animation. Wait.
3. **PAGE READY** — the whole page and every check below; then the FINAL REPORT.

## 11. Checks (you run them all; echo each result with its real line)

1. `make test-frontend`: pass count before and after; changed tests listed (§7).
2. `make build-frontend`: green. `make lint`: no finding that `main` doesn't already have (print both counts).
3. Bring up the stack (`make db-up`, `make backend`, `make frontend`) and run the Playwright specs that
   touch public pages: `frontend/e2e/website.spec.ts`, `auth.spec.ts`, `revamp-shell.spec.ts` — all green.
   Backend is untouched, so don't run `make test`.
4. taste's inspector at its three widths: pass (and its motion count). Hallmark's sloplint at 8 widths:
   0 FAIL on the must-fix rules; every other finding fixed or waived with a reason. One fresh-context
   Hallmark finish review: its verdict and what you did about it.
5. No sideways scroll from 320 to 1920 px. Reduced motion: screenshots with all content visible.
6. §8's network proof and §9's numbers (JS before/after, Lighthouse four scores).
   **Safari needs byte ranges:** build the frontend, run the backend with its `frontend_dist` pointed at
   that build (`mount_frontend` in `backend/tvashtr/main.py` serves it as production does), and show
   `curl -sI -H "Range: bytes=0-1023" <backend>/media/reel-1.mp4` returns `206 Partial Content` with
   `Content-Range` and `Content-Type: video/mp4`. Then play both videos in Playwright's WebKit and
   Chromium (a screenshot of each playing, `currentTime` > 2 s).
7. The page's visible text, before and after, desktop and phone, in the report: every changed line, so
   the architect can check each claim.
8. `git diff --stat main..HEAD` (§13).
9. Report (don't fix — `desktop/` is off-limits): the Desktop app packs `dist-fe/**/*`
   (`desktop/package.json`), so state how many MB `frontend/dist/media/` would add to it. The architect
   schedules excluding it in the next Desktop release.

**Stop with `NEEDS_HUMAN: <reason>` in `STATE.md`** if: a skill can't be installed or run; a must-fix
rule can't be met without changing the brand tokens; the code split needs a change outside §13's paths;
a fact the page needs isn't in §6's sources; anything would need a push, deploy, backend change or a new
dependency beyond `gsap` and `@gsap/react`.

## 12. Working rules (Pro plan)

- Opus 5.5 high, no ultracode, no workflows; **one** subagent only (Hallmark's finish review).
- Screenshots: look at what each round needs (taste's three widths); Hallmark's 8-width render once at
  the end, plus one confirming round. Don't re-read big files you've already read.
- Update `STATE.md` after each step so a usage-limit pause loses nothing. Time box: 8 hours of work, not
  counting waits at the stops.
- Branch `feat/landing-1` from the `main` sha in the `/goal`. Commit only your own paths; no push, no
  deploy, no migration, never print a key.

## 13. Paths you may change (everything else stays byte-identical)

`frontend/src/pages/website/**` (and its tests), `frontend/src/App.tsx` / `frontend/src/main.tsx` /
`frontend/src/components/AuthGate.tsx` only for the code split, `frontend/index.html` (meta),
`frontend/public/media/*`, `frontend/public/og.png`, `frontend/package.json` + `package-lock.json`
(`gsap` and `@gsap/react` only, exact versions in the report), `frontend/e2e/website.spec.ts`,
`.gitignore` (two lines), `STATE.md`. Not `backend/`, `desktop/`, `video/`, the design-system tokens or
components, or any other app screen.
