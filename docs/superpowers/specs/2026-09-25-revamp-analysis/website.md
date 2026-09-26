# Website — gap analysis (area `website`, prefix `WEB-`)

Screens covered (the 25 artboards under `website` in `design/revamp-export/render/areas.json`):
`Web-Landing`, `Web-Mobile`, `Web-SignIn`, `Web-Download`, `Web-Download2`, `Web-DownloadWin`,
`WbF-Index`, `WbF-Start-1`, `WbF-Start-2`, `WbF-Start-3`, `WbF-Err-1`, `WbF-Mac-1`, `WbF-Mac-2`,
`WbF-Mac-3`, `WbF-Mac-4`, `WbF-Win-1`, `WbF-Win-2`, `WbF-Two-1`, `WbF-Two-2`, `WbF-Faq-1`,
`WbF-Faq-2`, `WbF-Signed-1`, `WbF-Mob-1`, `WbF-Mob-2`, `WbF-Mob-3`. Read for context only (Desktop app
area, not analysed here): `DT-Welcome`, `DT-Waiting`, `DT-Handoff`, `DtF-Index`, `DtF-Sign-1`,
`DtF-Sign-2`, `DtF-Hand-1`, `DtF-Hand-2`.

Code read: `frontend/src/components/LandingPage.tsx`, `AuthGate.tsx`, `AuthWizard.tsx`,
`lib/desktopDownload.ts`, `lib/nav.ts`, `lib/api.ts` (`Config`, `getConfig`, `getMe`,
`rewriteGithubInstallUrlForDesktop`), `vite-env.d.ts` (bridge types), `main.tsx` (Desktop dataset
flag), `design-system/components/{index,primitives,overlays,utils}` (exports), `pages/shell/`
(file list), `pages/Workspace.tsx` (entry); backend `auth.py` (session cookie, `UserOut`,
`/api/auth/*`, GitHub callback), `control_plane/github_app.py` (`build_install_url`,
`build_manage_url`), `main.py` (`/api/config`, router registration, SPA catch-all), `config.py`
(`hosted_mode`, `frontend_origin`), `routes/__init__.py`, `control_plane/teams.py`
(`PROVIDER_CATALOGUE` seats), `models.py` (`User`); Desktop `electron/main.cjs` (in-window GitHub
OAuth, protocol registration, navigation guards), `preload.cjs`, `deepLink.cjs`,
`scripts/local-server.cjs` (OAuth proxy header), `desktop/package.json`; contracts
`docs/superpowers/plans/api/desktop-bridge.md`, `api/engines.md` and `api/teams.md` (config and
identity sections); `frontend/e2e/auth.spec.ts` (selector contract); `scripts/design-parity/`
(`README.md`, `shoot-app.mjs`, `scenarios/shell.mjs`).

Facts that shape the decisions below:
- `Web-Landing` is a 1440×6640 artboard with `overflow: hidden`, so its footer exists in the HTML but
  is cut off in the PNG. `Web-Mobile` (390×2300) clips its footer the same way. Both footers are
  specified here from the HTML.
- The repo has **no `LICENSE` file** (the only one is the vendored
  `backend/tvashtr/skills/caveman/LICENSE`) and no `license` field in any package manifest. The
  design says "open source" seven times.
- The Mac build is **arm64 only** (`desktop/package.json` `build.mac.target[0].arch: ["arm64"]`),
  unsigned (`identity: null`, `hardenedRuntime: false`), artifact name `Tvashtr-mac.${ext}`, Electron
  `^35.1.2`. There is no Intel build and no versioned file name.
- The backend sends **no email** of any kind: no SMTP or provider client, no settings.
- Today `AuthGate` shows the old `LandingPage` to a signed-out **Desktop** window too. The design
  forbids that (DtF-Index: "It never shows the website’s marketing page").
- Today's hosted "Continue with GitHub" is a plain link to the OAuth authorize URL
  (`github_app.build_install_url`) with no `state`. The callback ignores GitHub's `?error=`. A
  cancelled sign-in lands on the app root, signed out, with no message. A failed code exchange shows
  a raw JSON 400 page ("GitHub sign-in failed.").
- `lib/nav.ts` has no public addresses, and unknown hashes fall back to Home. The old landing's
  in-page anchors (`href="#how"`) collide with hash routing.

---

## 1. Screens

**Surface: every screen in this area is website only.** Tvashtr Desktop never shows the public
site. DtF-Index says "What the Mac app shows when it opens. It never shows the website’s marketing
page". WbF-Index says "It is not what the desktop app shows (see Desktop first run)". The Desktop
equivalents belong to the Desktop app area:
- a signed-out Desktop opens `DT-Welcome`;
- Desktop sign-in waits on `DT-Waiting` and `DtF-Sign-*`;
- a Desktop opened from the website offers `DT-Handoff`;
- a signed-in Desktop goes straight to Home.

The Desktop-mode check for each screen below is therefore a routing check (WEB-3): the page never
renders inside Desktop. There is no Desktop parity render.

**Site header (every 1440 page except sign-in).** The header is 72 px tall, with a translucent paper
background (`rgba(250,249,245,0.9)`) and a bottom rule. It holds:
- the Logo (26);
- `nav aria-label="Site"`: **Product**, **How it works**, **Domains**, **Desktop**, **GitHub** with an
  external-link icon. On the three download pages **Desktop** is drawn ink-900 (current page); the
  others are ink-600.
- on the right, ghost sm **Sign in** and primary sm **Start building**.

**Web-Landing: the landing page, full length (1440).** Sections, top to bottom:
1. **Hero:** pill "Open source · Your keys, or your own Claude or Grok plan"; h1 "Compose your own
   team of AI agents, *not just use one.*" (the last phrase italic coral); lede; primary lg **Start
   building — sign in with GitHub** (GitHub icon); secondary lg **Download for Mac** (download icon);
   meta line "Free and open source · No card needed · Desktop: Mac only for now".
2. **Product mock (1120 wide):** a window titled "Docs team" with a **Running** badge and
   "lazyxgenius/trade_mcp · $0.41". Its canvas shows START · ENTRY Product manager (Done,
   `xai/grok-4.7`), QUERY DOMAIN "Look up support docs" (Answered), AGENT Engineer (Running · 4 min,
   `anthropic/claude-sonnet-5`, coral ring), AGENT Reviewer (Waiting) and a round "Gate: you approve
   the PR". A 360 px spec panel shows "Spec · refund button v3" with citations 1 and 2 and a
   struck-out "Partial refunds for monthly plans — removed by you".
3. **Proof strip:** four icon items. The last is "Open source on GitHub · [stars]", a placeholder.
4. **The gap:** h2, lede, and two cards, "// without Tvashtr" (four × lines) and "// with Tvashtr"
   (four ✓ lines).
5. **Why Tvashtr:** h2 "Composable. Legible. Steerable." and four alternating feature rows, each an
   eyebrow + h3 + body + three ✓ bullets + a mock:
   - team canvas (Product manager → Architect → Engineer → Reviewer, a "changes requested" loop);
   - spec card "v4 · you" with "Added by you mid-run" and "Engineer read v4 · 12 seconds ago";
   - Domains answer card "Support docs · 14 files" with citation 2 highlighted and a
     `billing-faq.pdf · page 4` quote;
   - gate card "Waiting for you · Approve the spec" with **Approve** / **Request changes** (DS
     Buttons inside a mock) and a PR card "Pull request #42 · Add self-serve refunds" + "Approved by
     Reviewer" + "+214 −38 · 6 files · 2 review rounds".
6. **How it works:** three numbered cards.
7. **Two ways to run:** h2, lede, and a comparison table. The header row holds "Website" (globe) +
   secondary md **Start on the web**, and "Desktop app" + a "Mac" pill + primary md **Download for
   Mac**. Five rows follow, then a small disclaimer.
8. **Who it’s for:** three cards (Engineers, Founders, Solo builders) and a dashed testimonial
   figure. Its copy is a placeholder: "“[A quote from an early user about what changed for their
   team.]”" / "[Name] · [Role], [Company] — add once you have permission".
9. **Questions:** five accordion buttons (`aria-expanded`). The first is open and shows an arrow-up
   icon. The rest are closed with chevron-down.
10. **Closing:** a dark rounded panel with "Start weaving.", a lede, primary lg **Start building —
    sign in with GitHub** and secondary lg **Download for Mac**. In the render the secondary button's
    label is invisible (dark text on the dark panel), which is a design defect (OQ-22).
11. **Footer (clipped in the PNG):** Logo, tagline and "© 2026 Tvashtr", plus three link columns:
    Product, Resources, Legal.

**Web-Mobile: the landing page on a phone (390).** It has its own copy, not a reflow.
- **Header:** Logo (22) + IconButton "Open menu".
- **Hero:** pill "Open source · your keys or your plan"; the same h1; a shorter lede; full-width lg
  **Start building** and **Download for Mac**; the note "Tvashtr is built for a computer screen."; a
  three-node canvas mock.
- **Why Tvashtr:** four text cards.
- **Two ways to run:** "Website or Mac app" as two cards.
- **Questions:** four collapsed rows (no "Is it open source?"). In the design these rows are plain
  divs, not buttons.
- **Closing:** a dark panel with "Start weaving." and full-width primary **Email me a link for my
  computer**.
- **Footer (clipped):** "Composed teams that ship reviewed code." and "GitHub · Docs · Privacy ·
  Terms".

**Web-SignIn: sign in (1440).** Two columns, with no site header.
- **Left (820, soft coral wash):** Logo; display line "Your team. Your process. A reviewed pull
  request at the end."; a 540-wide canvas mock (PM, Architect, Engineer, Reviewer, "changes
  requested"); "← Back to the website" at the bottom.
- **Right (620, a 420 column, vertically centred):** h1 "Sign in to Tvashtr"; lede; primary lg
  full-width **Continue with GitHub**; a cream checklist card with two ✓ lines; a small foot note
  about the Mac app.
- There is no email/password form anywhere in the design.

**Web-Download: download, Mac detected.** Site header with **Desktop** current.
- **Badge (success, check icon):** "We detected a Mac with Apple silicon".
- **Heading and lede:** h1 "Tvashtr for Mac" and a lede.
- **Download button:** primary lg **Download for Mac · Apple silicon**.
- **Meta line:** coral link "Intel Mac? Get that version" followed by "· [version] · [minimum
  macOS]" (placeholders).
- **Requirements card (640):** "WHAT YOU NEED ON YOUR MAC" with three icon lines (terminal, key,
  power).

**Web-Download2: download started, install steps.**
- **Badge (success, download icon):** "Your download has started".
- **Heading:** h1 "Three steps and you’re in.".
- **Steps (640):** a ruled ordered list with coral number discs, each a bold title and a grey
  detail line.
- **Actions:** secondary md **I’ve installed it — open Tvashtr** (external-link icon) and ghost md
  **Download again**.

**Web-DownloadWin: download on Windows.**
- **Badge (info, info icon):** "We detected Windows".
- **Heading and lede:** h1 "The desktop app is Mac-only for now." and a lede ending "Want to know
  when Windows is ready?".
- **Primary action:** primary lg **Use the website** (globe).
- **Notify row:** an Input (placeholder `you@studio.dev`, 320 wide) + secondary md **Tell me** (mail
  icon).
- **Mac link:** a coral link "I’m on a Mac — show the Mac download".

**WbF-Index: not a screen.** An index board: "Website flows" with an intro, 8 flows (18 screens) and
the legend "A coral ring marks what you click on that screen." Its intro confirms the website/Desktop
split: "The public website is for people who haven’t signed in … It is not what the desktop app shows
(see Desktop first run)."

**WbF-Start-1 (1 · Click Start building).** The top 900 px of the landing, with a coral ring on the
hero **Start building — sign in with GitHub**. The ring is annotation, not UI. It is the same screen
as Web-Landing.

**WbF-Start-2 (2 · Sign-in page: Continue with GitHub).** Web-SignIn with a ring on **Continue with
GitHub**.

**WbF-Start-3 (3 · Back from GitHub: signing in, then Home).** The sign-in layout. The right panel
shows:
- a coral tile with a spinner;
- h1 "Signing you in…";
- "GitHub sent you back. Setting up your workspace; this takes a few seconds.";
- a three-line status list: ✓ "Signed in as lazyxgenius", ✓ "Account ready", spinner "Opening
  Home…".

The frame title says the next screen is Home's first-time state (home-teams area).

**WbF-Err-1 (1 · GitHub was cancelled: Try again).** The sign-in layout. The right panel shows:
- a warn tile with a warning triangle;
- h1 "Sign-in didn’t finish";
- "GitHub said the request was cancelled. Nothing was changed. You can try again.";
- primary lg full-width **Try again** (refresh icon, ringed);
- "Still stuck? Check that pop-ups aren’t blocked, or *read the sign-in help*." The last phrase is
  a coral link.

**WbF-Mac-1 (1 · Click Download for Mac).** The landing top with a ring on the hero **Download for
Mac**. This proves the hero button goes to the download page, not straight to the file.

**WbF-Mac-2 (2 · Mac detected: click Download).** Web-Download with a ring on **Download for Mac ·
Apple silicon**.

**WbF-Mac-3 (3 · Download started: 3 install steps).** Web-Download2 with a ring on **I’ve installed
it — open Tvashtr**.

**WbF-Mac-4 (4 · The app opens on its own welcome).** Web-Download2 under a grey scrim. On top is the
website's own dialog (`role=dialog`, aria-label "Open Tvashtr?", 500 wide):
- title "Open Tvashtr?";
- "Your browser asks before opening the app. Tvashtr then shows its own welcome and signs you in
  with the same GitHub account.";
- ghost sm **Cancel** and primary sm **Open Tvashtr** (ringed).

The frame title points to Desktop first run (`DT-Welcome` / `DT-Handoff`).

**WbF-Win-1 (1 · Clicked Download on Windows).** The landing top with a ring on **Download for Mac**.
It is the same pixels as Mac-1: the download page decides by platform.

**WbF-Win-2 (2 · Mac-only for now: use the website, or get told).** Web-DownloadWin with a ring on
**Use the website**.

**WbF-Two-1 / WbF-Two-2 (Two ways to run: Start on the web / Download for Mac).** The site header
with the "Two ways to run" section scrolled directly under it. The ring is on **Start on the web**
(1) or **Download for Mac** (2). This confirms a sticky header and section-scroll targets.

**WbF-Faq-1 / WbF-Faq-2 (Click a question / The answer opens under it).** The header with the
Questions section scrolled under it.
- In frame 1 **all five items are closed**, even the first, which is open on Web-Landing. The ring is
  on "Does Tvashtr see my code or my Claude login?".
- In frame 2 that item is open with the arrow-up icon and its answer. The first item stays closed.

**WbF-Signed-1 (1 · Top bar says Open app).** The landing top for a signed-in visitor. The header's
right side reads "Signed in as **lazyxgenius**" (13 px), then an accent Avatar "L" (sm), then primary
sm **Open app** (arrow icon, ringed). The rest of the page is unchanged, including the hero's "Start
building — sign in with GitHub".

**WbF-Mob-1 (1 · Tap the menu).** The Web-Mobile top (390×844) with a ring on the hamburger.

**WbF-Mob-2 (2 · Menu: links, then Start building).** A full-screen menu. The header holds the Logo
and an IconButton "Close menu" (×). Five large ruled links follow: **Product**, **How it works**,
**Domains**, **Desktop for Mac**, **GitHub**. Then primary lg full **Start building** (GitHub icon,
ringed) and secondary lg full **Sign in**.

**WbF-Mob-3 (3 · Tap Start building: email yourself a link).** The mobile landing under a scrim,
with a bottom sheet (`role=dialog`, aria-label "Best on a computer", 20 px top radius):
- title "Tvashtr works best on a computer";
- "The canvas needs a big screen. We’ll email you a sign-in link to open on your computer.";
- Input label "Email" (value `you@studio.dev`);
- primary lg full **Email me the link** (mail icon, ringed);
- ghost md full **Continue on this phone anyway**.

**Website flow summary**
- **Start building:** landing → sign-in page → GitHub → "Signing you in…" → Home (first time).
- **Download for Mac:** landing → download page. On a Mac it shows the Mac variant, then the install
  steps, then "Open Tvashtr?", then the app. On Windows it shows the Mac-only page.
- **Signed in:** the header swaps Sign in / Start building for "Signed in as … · Open app".
- **Phone:** Start building doesn't sign in. It offers to move to a computer first.

---

## 2. Behaviour requirements

### Addresses, surfaces and the signed-in variant
- **WEB-1** Public pages get hash addresses (spec §3.2 style), so refresh, back/forward and shared
  links work:
  - `#/welcome` is the landing. An optional `?s=product|how|domains|two-ways|faq` scrolls to a
    section.
  - `#/download` shows the download page by detected platform. `?os=mac|windows|linux` overrides
    the detection.
  - `#/download/started` shows the install steps.
  - `#/signin` is the sign-in page. It takes `?error=cancelled|failed|expired`, `?app=desktop` and
    `?next=<app address>`.
  - `#/signin/done` is the "Signing you in…" screen.
- **WEB-2** The empty hash and `#/` show the landing when signed out and Home when signed in (Home is
  unchanged). An app address opened while signed out (e.g. `#/teams/<id>`) shows `#/signin` and
  returns to that address after sign-in (`next`). `#/home` while signed out shows the landing.
- **WEB-3** In Tvashtr Desktop (`document.documentElement.dataset.tvashtrDesktop === "true"`) no
  public page ever renders. Signed out goes to the Desktop welcome (the `DT-Welcome` route owned by
  the Desktop app area). Signed in goes to `#/home` (replace). This applies to every public address
  and to the empty hash. A vitest pins it in Desktop mode.
- **WEB-4** Signed-in visitors on a public page:
  - the header's right side shows "Signed in as **<github_login, else display_name>**" (13 px,
    ink-600, name 600 weight), then Avatar (sm, accent, `name = display_name`), then primary sm
    **Open app** (arrow-right icon), which goes to `next`, else `#/home`;
  - `#/signin` redirects to `#/home` (replace);
  - "Start building — sign in with GitHub", "Start on the web" and "Use the website" go straight to
    `#/home`, with their labels unchanged (OQ-21).
- **WEB-5** While `/api/auth/me` is in flight, a public page still renders at once. The header's
  right side keeps its width but shows nothing until the answer arrives, so it never flashes the
  wrong variant. Only the empty hash waits for the answer (landing vs Home), on a blank paper
  background with no "Loading…" text.

### Site header and footer (1440)
- **WEB-6** Header: 72 px, `position: sticky; top: 0`, paper at 0.9 alpha, bottom border
  `--line-200`, padding 0 56, gap 40.
  - Logo (26) goes to `#/welcome`.
  - Nav links (14 px/500, ink-600): **Product** (`#/welcome?s=product`, the "Why Tvashtr" section),
    **How it works** (`?s=how`), **Domains** (`?s=domains`, the Domains feature row), **Desktop**
    (`#/download`) and **GitHub** (the repo, new tab, `rel="noopener noreferrer"`, 13 px
    external-link icon).
  - The current page's link is ink-900: Desktop on every `#/download*` page.
  - Right side: ghost sm **Sign in** and primary sm **Start building**, both to `#/signin` (gap 6).
- **WEB-7** Section targets use `scroll-margin-top: 72px`, so a section lands exactly under the
  header, as Two-1 and Faq-1 show. The scroll is smooth, or a jump under `prefers-reduced-motion`. It
  must not change the route (use `navigate(..., {replace:true})` plus `scrollIntoView`, never a raw
  `#id` anchor).
- **WEB-8** Footer (from the HTML; clipped in the PNG): a top rule, padding 56 0 40, margin-top 96.
  - Left: Logo (26), "Composed teams that ship reviewed code." (14 px, ink-500) and "© 2026 Tvashtr"
    (13 px).
  - Column **Product** (12.5 px/600 heading, 14 px links): Canvas → `?s=product`, Domains →
    `?s=domains`, Desktop for Mac → `#/download`, Changelog → the GitHub releases page.
  - Column **Resources**: GitHub → the repo, Docs → the repo README on GitHub, Status → hidden
    (OQ-14).
  - Column **Legal**: Privacy and Terms, hidden until texts exist (OQ-14).

### Landing (1440)
- **WEB-9** Hero:
  - pill "Open source · Your keys, or your own Claude or Grok plan" (license caveat, OQ-4);
  - h1 "Compose your own team of AI agents, not just use one." with "not just use one." in
    italic coral;
  - lede "Draw the team on a canvas: who plans, who builds, who reviews, and where you step in. It
    works on your real GitHub repo and hands back a reviewed pull request.";
  - primary lg **Start building — sign in with GitHub** goes to `#/signin`;
  - secondary lg **Download for Mac** goes to `#/download` (never straight to the file: Mac-1 →
    Mac-2, Win-1 → Win-2);
  - meta line "Free and open source", "No card needed", "Desktop: Mac only for now".
- **WEB-10** The product mock (hero), the four feature mocks and the sign-in canvas are static
  illustrations built from design-system pieces. They use fixed sample data, `aria-hidden="true"`,
  and are never focusable. The mock **Approve** / **Request changes** buttons are inert: rendered
  with the Button classes, `tabIndex={-1}`, no handlers. No React Flow (too heavy for the landing).
- **WEB-11** Proof strip: "Works on your real repos", "Every change reviewed before it ships", "Your
  API keys, or your Claude / Grok plan" and "Open source on GitHub · [stars]". `[stars]` is the live
  count from `GET /api/public/site` (`· 128 stars`), omitted with its separator when unknown (OQ-13).
- **WEB-12** The gap:
  - eyebrow "The gap"; h2 "Agent tools are either a black box or a pile of code."; lede "Tvashtr
    sits in between: composable like a framework, legible like a teammate. And it works on your own
    repo.";
  - card "// without Tvashtr": "Wire orchestration by hand, or trust a black box", "No view into what
    each agent actually did", "Long runs drift away from what you asked for", "Demos on toy repos,
    not your codebase";
  - card "// with Tvashtr": "Draw the team on a canvas, wire it your way", "Open any node and read
    exactly what it did", "A living spec keeps every agent on the same page", "Runs on your repo and
    ships a reviewed PR".
- **WEB-13** Why Tvashtr: eyebrow "Why Tvashtr", h2 "Composable. Legible. Steerable.", then four rows:
  - "Your team is yours" / "Draw the process you actually use." / "Add a product manager, an
    architect, two engineers and a picky reviewer, or just one agent. Wire who hands work to whom and
    where it loops back." / "Pick the model for each role", "Loops with a limit, so runs can’t spin
    forever", "Save it, re-run it, fork it".
  - "Steerable live documents" / "A living spec every agent reads." / "The spec is a real document
    you can edit while the team works. Change your mind mid-run and the next agent to read it follows
    the new version." / "Every version kept", "See who read which version", "Edit in place, like a
    doc".
  - "Domains" / "Your own documents, with sources." / "Put your help docs, contracts or papers in a
    domain. You and your agents ask it questions, and every answer shows the exact passage it came
    from." / "Answers only from your files", "Test that search finds the right file", "Use it as a
    team step, or let an agent search".
  - "Gates" / "You step in where it matters." / "Put an approval gate after the spec, before shipping,
    or anywhere else. The reviewer checks the work against the spec before you ever see a pull
    request." / "Approve or send back with notes", "Reviewed PRs on your own repo", "Stop a run at any
    time".
  - Every claim maps to a shipped capability: gates and cancel; versioned spec with read tracking
    (B-DOCS); duplicate (B-TEAMS); Domains eval, the query node and the Domains tool. Keep them as
    designed.
- **WEB-14** How it works: eyebrow "How it works"; h2 "From idea to reviewed pull request."; cards "1
  Compose the team — Start from a template or a blank canvas. Drop in agents and wire the flow.", "2
  Launch with an idea — Describe what you want. Pick the repo. Watch each node work, live.", "3 Review
  and ship — Approve at your gates. Get a reviewed pull request on your repo."
- **WEB-15** Two ways to run:
  - eyebrow "Two ways to run"; h2 "Same teams. Run them where it suits you."; lede "Sign in once.
    Your teams, tools and keys are the same on the website and on the Mac app.";
  - header cells: "Website" + secondary md **Start on the web** (globe) → `#/signin`; "Desktop app"
    + pill "Mac" + primary md **Download for Mac** → `#/download`;
  - rows (label · Website · Desktop app): "Where it runs" · "Tvashtr’s servers" · "Your computer";
    "Models" · "Any provider, with your API keys" · "Your Claude or Grok plan first, then API keys";
    "Your code" · "Your GitHub repos" · "GitHub repos and local folders"; "Runs when you close it" ·
    "Keep going" · "Stop when you quit the app"; "Best for" · "Trying it out, Domains, long hosted
    runs" · "Using the plan you already pay for";
  - disclaimer "Desktop runs your own installed Claude Code or Grok. You sign in inside that tool;
    Tvashtr never sees your login. Tvashtr isn’t affiliated with Anthropic or xAI.";
  - a real `<table>` with `scope` headers.
- **WEB-16** Who it’s for:
  - eyebrow "Who it’s for"; h2 "For people who want the team to be theirs.";
  - cards "Engineers — Point a team at your repo, wire the review loop the way you actually review,
    and get a reviewed PR back.", "Founders — Turn an idea into a spec, a prototype, then shipped
    code, without hiring a whole team first.", "Solo builders — Run a small studio of agents end to
    end while you stay in the loop at the gates that matter.";
  - the testimonial figure is **not rendered** until a real, permitted quote exists (OQ-12).
- **WEB-17** Questions: eyebrow "Questions"; h2 "Before you start."; five rows.
  - Each row is a `<button type="button" aria-expanded aria-controls>` (18 px/500, padding 20 0, top
    rule) with a chevron-down (closed) or arrow-up (open) icon, 18 px, ink-500.
  - The answer is a `<p>` (16 px, line-height 1.6, max-width 820, ink-600) under its button.
  - It is a **single-open** accordion: opening one closes the others (Faq-2 closed item 1). The
    first item is open on page load (Web-Landing).
  - Answers:
    - "Do I need an API key?" → "Not on Desktop if you already pay for Claude or Grok: Tvashtr uses
      your plan through your own Claude Code or Grok install. On the website, you add an API key for
      each provider your team uses."
    - "Does Tvashtr see my code or my Claude login?" → "Your agents work in a private sandbox with the
      repos you connect. On Desktop, you sign in to Claude Code or Grok yourself; Tvashtr never sees
      or stores that login."
    - "Which models can I use?", "What is Tvashtr Desktop for?" and "Is it open source?" have no
      designed answer; see OQ-11 for the proposed copy.
- **WEB-18** Closing:
  - dark panel (radius 28, padding 72 40): "Start weaving." (56 px display, cream) and "Compose your
    first team in a few minutes. Free and open source." (17 px, `#c7c4ba`);
  - primary lg **Start building — sign in with GitHub** → `#/signin`;
  - secondary lg **Download for Mac** → `#/download`, drawn with an on-dark treatment so the label is
    readable (OQ-22).
- **WEB-19** Landing layout below 1440: the content column is 1200 max with 120 side padding. From 960
  to 1439 the feature rows keep two columns and shrink. Below 960 they stack, text first. Below
  720 the mobile page (WEB-20…25) takes over. Only 1440 and 390 are parity-gated (OQ-25).

### Landing on a phone (< 720 px)
- **WEB-20** Mobile header: Logo (22) and IconButton md "Open menu" (hamburger). It is sticky, like
  the desktop header.
- **WEB-21** Mobile hero:
  - pill "Open source · your keys or your plan";
  - the same h1;
  - lede "Draw the team on a canvas. It works on your GitHub repo and hands back a reviewed pull
    request.";
  - full-width lg primary **Start building** (GitHub icon) and secondary **Download for Mac**. Both
    open the computer-handoff sheet (WEB-24, OQ-24);
  - the note "Tvashtr is built for a computer screen." (13 px, centred);
  - a static three-node mock (START Product manager, AGENT Engineer (ringed), AGENT Reviewer).
- **WEB-22** Mobile sections:
  - "Why Tvashtr" / "Composable. Legible. Steerable." with four cards: "Your team is yours — Draw the
    process you actually use: roles, handoffs, loops and gates.", "A living spec — Edit the spec
    mid-run. The next agent reads the new version.", "Domains — Your own documents, answered with the
    exact passage.", "Gates — Approve the spec, send work back, and get a reviewed PR.";
  - "Two ways to run" / "Website or Mac app" with "**Website** · runs on Tvashtr’s servers with your
    API keys." and "**Desktop app** · runs on your Mac with your Claude or Grok plan.";
  - "Questions" with four rows (the design's order, no "Is it open source?"), built as buttons with
    the same accordion and answers as WEB-17, all closed initially (as drawn);
  - the dark "Start weaving." panel with a full-width primary that opens the handoff sheet (label per
    OQ-10);
  - footer: Logo (22), "Composed teams that ship reviewed code.", then "GitHub · Docs · Privacy ·
    Terms" as links, minus the hidden ones (OQ-14).
- **WEB-23** Menu (Mob-2):
  - the hamburger opens a full-screen panel (`role=dialog`, aria-label "Menu") and turns into
    IconButton "Close menu" (×);
  - links (18 px, 80 px rows with rules): **Product**, **How it works**, **Domains**, **Desktop for
    Mac** (→ `#/download`), **GitHub** (external);
  - then primary lg full **Start building** (→ handoff sheet) and secondary lg full **Sign in**
    (→ `#/signin`);
  - focus is trapped, Escape and × close, choosing a link closes the menu and then scrolls or
    navigates, and body scroll is locked while open.
- **WEB-24** Computer-handoff sheet (Mob-3): a bottom sheet (`role=dialog`, aria-label "Best on a
  computer"), 20 px top radius, scrim, focus trap, Escape and scrim-click close.
  - Title "Tvashtr works best on a computer".
  - Body, button and input follow OQ-10. The design's "We’ll email you a sign-in link…", the Email
    Input and **Email me the link** need an email service that doesn't exist.
  - Ghost md full **Continue on this phone anyway** → `#/signin`.
- **WEB-25** Phones never get the DMG: no mobile control links to the file.

### Sign in
- **WEB-26** Sign-in layout (Start-2, Start-3, Err-1 share it): the left panel (820) and right panel
  (620, a 420 column centred vertically) as in §1. **← Back to the website** goes to `#/welcome`. Below
  720 px the left panel is hidden and the right column is full width (not designed; OQ-25).
- **WEB-27** Hosted mode (`/api/config.hosted_mode`):
  - h1 "Sign in to Tvashtr"; lede "Use your GitHub account. It’s how Tvashtr opens pull requests on
    your repos.";
  - primary lg full **Continue with GitHub** navigates to `GET /api/auth/github/start` (+ `next`,
    `app`), which replaces today's raw `github_install_url` link (B-2). After the click the button
    shows its loading state until the page unloads;
  - checklist card: "New here? Signing in creates your account." and "You choose which repos Tvashtr
    can use later, not now." Both are true: find-or-create happens in the callback, and the authorize
    URL grants no repos; repos are added later through `github_manage_url`;
  - foot note "Using the Mac app? Sign in from the app. It opens this page for you and brings you
    back." (true only with WEB-31; OQ-18).
- **WEB-28** Self-hosted mode (`hosted_mode: false`, used by local dev and every e2e run) isn't
  designed. It keeps email/password in the same layout.
  - The right panel shows h1 "Sign in to Tvashtr", Field "Email", Field "Password", a primary lg full
    **Sign in**, and a toggle "New here? **Create an account**" ↔ "Already have an account? **Sign
    in**", which switches the button to **Create account**.
  - Error copy is kept from today: "Incorrect email or password.", "That email already has an
    account — try logging in.", "Enter a valid email and a password of at least 8 characters.",
    "Something went wrong. Is the backend running?".
  - The old role and building steps and the "Enter Tvashtr" success step are removed. Success goes
    straight to `#/signin/done` (WEB-29).
  - No parity gate for this variant.
- **WEB-29** `#/signin/done` (Start-3):
  - tile (coral, spinner); h1 "Signing you in…"; body "GitHub sent you back. Setting up your
    workspace; this takes a few seconds." (self-hosted: "Setting up your workspace; this takes a few
    seconds.");
  - status list: "Signed in as <login>" is ✓ once `/api/auth/me` returns (the name is `github_login`,
    else `display_name`); "Account ready" is ✓ once the first Home reads (`/api/teams`,
    `/api/inbox`) return; "Opening Home…" spins, then the page goes to `next` or `#/home` (replace).
  - Minimum display is 400 ms, so the screen doesn't flash. There is no artificial wait beyond that.
  - `/api/auth/me` answering 401 here goes to `#/signin?error=failed`.
- **WEB-30** Errors (Err-1): the warn tile (triangle) and h1 "Sign-in didn’t finish", then a body per
  `?error=`:
  - `cancelled` (GitHub `error=access_denied`): "GitHub said the request was cancelled. Nothing was
    changed. You can try again." (designed);
  - `failed` (code exchange or identity lookup failed; proposed): "GitHub didn’t complete the
    sign-in. Nothing was changed. You can try again.";
  - `expired` (state cookie missing or mismatched; proposed): "That sign-in took too long or was
    started in another tab. Nothing was changed. You can try again.".

  Then primary lg full **Try again** (refresh icon), which restarts WEB-27's flow with the same
  `next`/`app`. The help line is "Still stuck? Check that your browser allows cookies for this site,
  or read the sign-in help." (OQ-15). The link goes to `docs/help/sign-in.md` on GitHub, a new file
  written by this slice.
- **WEB-31** Desktop sign-in through this page (`#/signin?app=desktop`, OQ-18). It depends on the
  Desktop app area choosing browser sign-in.
  - The page looks like WEB-27, and the foot note is replaced by "You’ll go back to Tvashtr for Mac
    when you’re done."
  - If the visitor is already signed in on the website, the page skips GitHub.
  - Either way it ends on `#/signin/done?app=desktop`. That page mints a handoff token (B-5), fires
    `tvashtr://welcome?handoff=<token>` and shows the status list with a third line "Opening Tvashtr
    for Mac…".
  - Proposed copy: h1 "You’re signed in", body "Go back to Tvashtr for Mac to continue. If it didn’t
    open, use the button.", a primary lg full **Open Tvashtr** (re-fires the link; browsers may block
    a protocol launch without a click), and a link **Stay on the website** → `#/home`.

### Download
- **WEB-32** Platform detection (`lib/platform.ts`, pure, unit-tested):
  - `os` ∈ mac | windows | linux | phone | unknown, read from `navigator.userAgentData.platform`
    when present, else the user agent (iPhone, iPad and Android count as `phone`);
  - `arch` ∈ arm | x86 | unknown, only from
    `navigator.userAgentData.getHighEntropyValues(["architecture"])` (Chromium). Safari and Firefox
    give `unknown`, because they report Intel even on Apple silicon;
  - `?os=` overrides `os`, and then no "We detected" claim is made.
- **WEB-33** Mac page (Web-Download; `os=mac`, or `unknown` without the badge):
  - badge (success, check): "We detected a Mac with Apple silicon" only when `arch = arm`; "We
    detected a Mac" when `arch = unknown`; for `arch = x86` see OQ-6. No badge with `?os=mac`;
  - h1 "Tvashtr for Mac"; lede "Run your teams on this computer, with the Claude or Grok plan you
    already pay for. Same account, teams and keys as the website.";
  - primary lg **Download for Mac · Apple silicon** is an `<a href={DESKTOP_MAC_DMG_URL}>`. Its click
    also `navigate`s to `#/download/started` (no `preventDefault`: the asset answers
    `Content-Disposition: attachment`, so the page stays);
  - meta line (13 px): the Intel link is replaced per OQ-6, then "v<version> · macOS 11 or later"
    (OQ-8), with the version omitted when unknown;
  - card "What you need on your Mac": "Claude Code or Grok installed, if you want to use your plan.
    The app checks for you.", "Or an API key for any provider.", "Runs stop when you quit the app."
- **WEB-34** Install steps (Web-Download2):
  - badge (success, download icon) "Your download has started"; h1 "Three steps and you’re in.";
  - step 1 "Open the downloaded file" — "**Tvashtr-mac.dmg** is in your Downloads. Drag Tvashtr into
    Applications." (the real file name, not the design's `Tvashtr-[version].dmg`);
  - step 2 "Open it the first time with right-click → Open" — "This build isn’t notarized by Apple
    yet, so macOS asks you to confirm once." plus the session-mandated addition in the same
    instruction area: "If macOS says “Tvashtr is damaged and can’t be opened”, open Terminal, run this
    once, then open Tvashtr again:", a monospace code line `xattr -dr com.apple.quarantine
    /Applications/Tvashtr.app` and an IconButton "Copy command" (toast "Command copied"). This is a
    reported deviation;
  - step 3 "Sign in with GitHub" — "Use the same account as the website. The app walks you through
    the rest.";
  - secondary md **I’ve installed it — open Tvashtr** opens WEB-35; ghost md **Download again**
    re-requests `DESKTOP_MAC_DMG_URL` (same anchor);
  - a direct visit to `#/download/started` shows the page as is. The badge still says the download
    started, which is acceptable for a bookmarked page. Proposed: without a click in this tab, the
    badge reads "Install Tvashtr for Mac" and **Download again** reads **Download**.
- **WEB-35** "Open Tvashtr?" dialog (Mac-4): `Dialog` (500 content, `role=dialog`, aria-label "Open
  Tvashtr?"), title "Open Tvashtr?", body "Your browser asks before opening the app. Tvashtr then
  shows its own welcome and signs you in with the same GitHub account.", ghost sm **Cancel** and
  primary sm **Open Tvashtr**. **Open Tvashtr**:
  - fires `tvashtr://welcome`, or, when signed in on the website, first mints a handoff token (B-5)
    and fires `tvashtr://welcome?handoff=<token>` so the app can offer `DT-Handoff`'s "Continue as
    <login>";
  - then closes the dialog. It never auto-downloads anything.
- **WEB-36** Windows or Linux page (Web-DownloadWin; `os=windows|linux`):
  - badge (info, info icon) "We detected Windows" / "We detected Linux";
  - h1 "The desktop app is Mac-only for now."; lede "You can do everything on the website today with
    API keys. Want to know when Windows is ready?" (Linux: "…when Linux is ready?");
  - primary lg **Use the website** (globe) → `#/signin` (signed in: `#/home`);
  - the notify row follows OQ-9;
  - link "I’m on a Mac — show the Mac download" → `#/download?os=mac` (replace).
  - A phone (`os=phone`) never gets this page. `#/download` on a phone shows the Mac page without a
    badge and without the download button, with the handoff sheet's action instead (OQ-24).
- **WEB-37** Every Download control uses `DESKTOP_MAC_DMG_URL`
  (`https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg`), never a tag
  URL. The controls are: landing hero and closing, Two ways, Web-Download, Download again, the menu's
  Desktop for Mac → page, and anything added later. The file name stays `Tvashtr-mac.dmg`. A vitest
  asserts every rendered `a[href*="releases"]` download link equals the constant.

### Cross-cutting
- **WEB-38** Accessibility:
  - landmarks: a skip link "Skip to content" (kept from today), header `nav aria-label="Site"`,
    `main`, `footer`;
  - mocks are `aria-hidden`;
  - accordion buttons carry `aria-expanded`/`aria-controls`;
  - dialogs, sheets and the menu trap focus and return it to the invoker;
  - every icon-only button has a label ("Open menu", "Close menu", "Copy command");
  - body text contrast ≥ 4.5:1 (ink-600 on paper passes; the dark panel's `#c7c4ba` on ink-900
    passes).
- **WEB-39** Document titles:
  - landing: "Tvashtr — compose your own team of AI agents";
  - sign-in: "Sign in · Tvashtr";
  - download: "Tvashtr for Mac";
  - the app keeps "Tvashtr".
- **WEB-40** External links (GitHub, releases, README, help) open in a new tab with
  `rel="noopener noreferrer"`. Inside Desktop they would open in the OS browser anyway
  (`setWindowOpenHandler`), but public pages never render there.
- **WEB-41** Public pages set no cookies of their own and load no third-party scripts, analytics or
  fonts beyond the ones the app already uses. The only cookies are the session cookie and the
  sign-in state cookie (B-2).
- **WEB-42** A 401 during app use (the api seam) goes to `#/signin` with `next` set to the current
  address, not to the landing (OQ-27).
- **WEB-43** Toasts on public pages ("Command copied", "Link copied") need `ToastProvider` above
  `AuthGate`'s branches, not only around `Workspace`.

---

## 3. Backend gap table

| ID | Needs | Status | Where / proposal |
|---|---|---|---|
| B-1 · WEB-4, WEB-29 | Who is signed in (name for "Signed in as", Avatar) | **EXISTS** | `GET /api/auth/me` → `UserOut{id, email, github_login, display_name}` (`auth.py`). 401 when signed out; `getMe()` maps it to `null` |
| — · WEB-27, WEB-28 | Which sign-in door (GitHub vs email/password) | **EXISTS** | `GET /api/config` → `hosted_mode`, `github_install_url` (OAuth authorize URL), `github_manage_url`. Email/password: `POST /api/auth/register`, `/login`, `/logout` |
| B-2 · WEB-27, WEB-30, WEB-31, WEB-2 | Start GitHub sign-in with CSRF `state`, a return address and the Desktop flag | **MISSING** | **New `GET /api/auth/github/start?next=<app address>&app=desktop&redirect_uri=<loopback>`** on `auth_router` in `backend/tvashtr/auth.py` (pre-auth by nature, like the callback). Logic in a new `control_plane/github_signin.py`. 404 when `hosted_mode` is off (like the callback). It validates `next` against `^/[A-Za-z0-9/_?=&.%-]{0,300}$` and `parseRoute` knowing it (else dropped, no open redirect). `app` must be `desktop` or absent. `redirect_uri` is accepted only through the existing `_is_allowlisted_desktop_loopback(..., expect_callback_path=True)` (it replaces `rewriteGithubInstallUrlForDesktop`). Response: `302 Location: https://github.com/login/oauth/authorize?client_id=…&redirect_uri=…&state=<nonce>` + `Set-Cookie: tv_oauth_state=<itsdangerous-signed {n, next, app}>; Max-Age=600; HttpOnly; SameSite=Lax; Path=/api/auth/github; Secure=<cookie_secure>`. `/api/config` gains `github_signin_url: "/api/auth/github/start"` (additive; `github_install_url` stays for older clients). No owner scoping (no account yet) |
| B-3 · WEB-29, WEB-30 | Callback reports what happened and returns to the sign-in screens | **PARTIAL** | `auth.github_callback` today: no `error` handling, success → `frontend_origin` root, exchange failure → JSON 400. Changes (all in `auth.py`, redirect-only, no new keys): (a) `?error=access_denied` → `302 {frontend}/#/signin?error=cancelled`; any other `error` → `…?error=failed`. (b) When a `tv_oauth_state` cookie exists, `state` must match its nonce, else `…?error=expired`. A missing cookie is still accepted during rollout, so old clients keep working; drop that after one release. (c) `GithubAppError` → `302 …#/signin?error=failed` (never echo GitHub's error). (d) Success → `302 {frontend}/#/signin/done` + `?next=…&app=desktop` from the cookie, and clear the cookie. (e) The no-`code` install return stays as today. Old SPA builds (Desktop 0.3.0) parse unknown hashes to Home, so (d) is backward compatible. The Desktop loopback bounce keeps working: the hash is appended after the origin allow-list check |
| B-4 · WEB-11, WEB-33, WEB-37 (and DT-Update, Desktop area) | Latest Desktop release (version, date, size), minimum macOS, GitHub star count | **MISSING** | **New public `GET /api/public/site`** in a new `backend/tvashtr/routes/public_site.py` (`router = APIRouter(prefix="/api/public")`, included in `main.py` next to `auth_router`, **without** `get_current_user`, like `/api/config`). Logic in a new `control_plane/site_info.py`. Response: `{"repo_url":"https://github.com/lazyxgenius/Tvashtr","stars":128,"desktop":{"version":"0.4.0","tag":"desktop-v0.4.0","published_at":"2026-09-26T10:12:00Z","dmg_url":"https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg","release_url":"https://github.com/lazyxgenius/Tvashtr/releases/tag/desktop-v0.4.0","size_bytes":131072000,"arch":["arm64"],"min_macos":"11"},"checked_at":"…"}`. Rules: `dmg_url` is **always** the stable constant, never the tag URL. The `…/releases/latest` result is accepted only if `tag_name` matches `^desktop-v(\d+\.\d+\.\d+)$`, else `version: null`. `size_bytes` comes from the `Tvashtr-mac.dmg` asset. `stars` = `stargazers_count`. `min_macos` is a table keyed by the Electron major (35 → "11"), pinned by a pytest that reads `desktop/package.json`. Sources: GitHub REST `GET /repos/{repo}` and `/releases/latest`, unauthenticated, 3 s timeout, in-process TTL cache 10 min, last good value kept on failure, else nulls; never 5xx. Repo from a new setting `TVASHTR_PUBLIC_REPO` (default `lazyxgenius/Tvashtr`). No user data, so no owner scoping; the endpoint is safe to expose. The Desktop app area uses the same `desktop.version` for DT-Update, compared with the running app's version (bridge D-3) |
| B-5 · WEB-31, WEB-35 (and DT-Handoff, Desktop area) | Carry the website sign-in into the Mac app ("signs you in with the same GitHub account", "brings you back", "Continue as lazyxgenius") | **MISSING** | Shared with the Desktop app area, which owns the redeem side and should build it. The website only mints. Two routes on `auth_router` in `auth.py`, logic in a new `control_plane/desktop_handoff.py`. (1) **`POST /api/auth/desktop-handoff`** (explicit `Depends(get_current_user)`) → `200 {"token":"<itsdangerous URLSafeTimed, salt 'tv-desktop-handoff', payload {u: owner_id, n: nonce}>","expires_at":"…","link":"tvashtr://welcome?handoff=<token>"}`, TTL 120 s. The token binds the caller only, so one account can never mint for another. (2) **`POST /api/auth/desktop-handoff/redeem {token}`** (public; called by Desktop through its loopback proxy, which already strips `Domain`/`Secure`) → `200 UserOut` + `Set-Cookie tv_session`. Bad or expired → `400 {"detail":"That sign-in link expired. Sign in again."}`; the account is gone → `404 {"detail":"Not found"}`. It is stateless, so a token can be replayed within 120 s. That is accepted because `DT-Handoff` makes the user press "Continue as <login>" with the name shown. Single-use would need a table (Schema needs) |
| B-6 · WEB-36 | Windows/Linux "Tell me" (email when Windows is ready) | **MISSING, not proposed** | It would need `POST /api/public/waitlist {email, platform}` + a table + someone to email the list later. There is no email service and no operator commitment. Decision OQ-9: replace with a GitHub "watch releases" link. Nothing to build |
| B-7 · WEB-24 | Mobile "We’ll email you a sign-in link" | **MISSING, not proposed** | A magic sign-in link needs an email sender (a missing key) and a new passwordless auth path (security surface). Decision OQ-10: Web Share / copy link. Nothing to build |
| — · WEB-29 | "Account ready" means something real | **EXISTS** | The callback's `_find_or_link_github_user` creates or links the account before the redirect. B-TEAMS stopped seeding a starter team, so nothing else is "set up". The two reads WEB-29 waits on (`/api/teams`, `/api/inbox`) exist |
| — · WEB-2 | SPA served for any path/hash on fly.dev and the Desktop loopback | **EXISTS** | `main.py` SPA catch-all (non-`/api` paths → `index.html`). Hash routes need no server change |
| — · WEB-17, OQ-11 | "Which models can I use?" answer stays true | **EXISTS** | `GET /api/config.provider_catalogue` (`thinker_default`/`worker_default` per provider). The answer names only providers with at least one seat. `nvidia_nim` has both seats `None`, so it is never named (session rule: never invite a key that powers nothing) |

**Schema needs.** None. This area needs no new table or column, and the shared `0042` migration
doesn't need anything from it. Considered and rejected:

| Candidate | Why it came up | Avoidable without schema? |
|---|---|---|
| `waitlist_signups(id, email, platform, created_at)` | Web-DownloadWin "Tell me" | **Yes.** Not building the email list (OQ-9). If the operator later wants it, it is one small table plus a privacy notice |
| `auth_handoffs(id, owner_id, code_hash, created_at, expires_at, redeemed_at)` | single-use website→app handoff codes (B-5) | **Yes.** A stateless signed token with a 120 s TTL; the replay window is covered by the explicit "Continue as <login>" confirmation |
| `oauth_states(nonce, next, app, created_at)` | CSRF `state` for GitHub sign-in (B-2) | **Yes.** A signed, short-lived `tv_oauth_state` cookie |
| `site_info_cache(key, value, fetched_at)` | cache GitHub release and star lookups across Fly machines | **Yes.** An in-process TTL cache per machine (≤ 6 GitHub calls/hour/machine, far under the 60/hour unauthenticated limit) |

---

## 4. Desktop bridge gaps

The website pages never run inside Desktop, so this area needs **no new bridge method** of its own.
What it touches is the routing rule plus shared deep-link and version work owned by the Desktop app
area. Today: `tvashtrDesktopInfo = { shell, version: 5, platform }`. `tvashtrDesktop` exposes
`engines`, `navigation`, `repos` and `app` (`preload.cjs`). The deep-link allow-list is in
`deepLink.cjs`, and `tvashtr://` is registered (`build.protocols`, `setAsDefaultProtocolClient`,
`open-url`, single-instance).

- **D-1: public pages never render in Desktop (renderer rule, no bridge change).**
  - `AuthGate` checks `document.documentElement.dataset.tvashtrDesktop === "true"` (set in
    `main.tsx` from `window.tvashtrDesktop`) before routing.
  - Signed out, it goes to the Desktop welcome route (Desktop app area). Signed in, to `#/home`.
  - Today the Desktop window shows the old website landing when signed out. That is a bug against
    DtF-Index, fixed by whichever of the two areas lands first.
- **D-2: deep-link targets for the handoff (`deepLink.cjs`; owned by the Desktop app area).**
  - The website fires `tvashtr://welcome` and `tvashtr://welcome?handoff=<token>`. Neither parses
    today: `welcome` isn't allow-listed, and only `connect` params survive.
  - Add `welcome` → `{ path: "/desktop/welcome" }` (or whatever address the Desktop area gives
    DT-Welcome). A `handoff` param is kept only if it matches `^[A-Za-z0-9_.-]{20,512}$`.
  - Widen `TvashtrDeepLinkTarget.params` in `vite-env.d.ts` to `{ connect?: "claude" | "grok";
    handoff?: string }`, and document it in `desktop-bridge.md`.
  - The token is never used as a path or shown. It is only POSTed to B-5 redeem.
  - Tests: accepted, and rejected when too long, when it has bad characters, or when it has extra
    segments.
- **D-3: running app version (shared with DT-Update; not used by website pages).**
  - `tvashtrDesktopInfo.appVersion = app.getVersion()` (from `desktop/package.json` `version`,
    today `0.3.0`, on the round-2 branch `0.4.0`), exposed from `preload.cjs` via
    `process.argv`/`additionalArguments` or an `ipcRenderer.sendSync` at load.
  - Bump `tvashtrDesktopInfo.version` to 6.
  - The website doesn't need it; it is listed because B-4 is the other half of the update
    comparison.
- **D-4: protocol launch on a fresh install (behaviour, no code).**
  - macOS registers `tvashtr://` when LaunchServices sees the app in /Applications, and reliably
    after the first launch.
  - A quarantined, unsigned app launched through the scheme shows the same "Tvashtr is damaged"
    error. So WEB-34's `xattr` line must come **before** **I’ve installed it — open Tvashtr**; the
    step order already puts it there.
  - If nothing opens, the Mac-4 dialog has no fallback in the design. Keep the design; the steps page
    stays visible behind it.
- **D-5: no Intel build (electron-builder config).** `build.mac.target[0].arch` is `["arm64"]`, so
  "Intel Mac? Get that version" has nothing to point at (OQ-6).
  - A later option is `"universal"` with `artifactName` unchanged. That keeps the single stable
    `Tvashtr-mac.dmg` link and roughly doubles its size.
  - Not proposed for this area: it can't be tested on Intel here, and the Desktop CLI harness would
    need an x64 check.
- **D-6: sign-in goes in-window today, while the design shows the browser.**
  - `main.cjs` keeps GitHub OAuth inside the Electron window (`isGithubAuthUrl` + `loadURL`), with
    the FE rewriting `redirect_uri` to loopback. `DT-Waiting` ("We opened GitHub in your default
    browser") and this area's sign-in foot note ("It opens this page for you and brings you back")
    both assume the system browser.
  - If the Desktop area moves sign-in to the browser, it should open
    `https://tvashtr.fly.dev/#/signin?app=desktop` (WEB-31) and redeem the handoff it receives
    (B-5, D-2). Otherwise the foot note changes (OQ-18).
  - Whichever way it goes, `local-server.cjs` must also proxy `GET /api/auth/github/start` (B-2);
    today it special-cases only the callback prefix. The FE passes the loopback `redirect_uri`
    explicitly.
- **D-7: nothing else.** External links from any page already open in the OS browser
  (`setWindowOpenHandler` → `shell.openExternal`).

---

## 5. Frontend mapping

**Today:**
- `components/AuthGate.tsx` is a state machine (`loading` / `authed` / `unauthed` × `landing` /
  `login`). It renders `LandingPage` or `AuthWizard` when signed out, and wraps only `Workspace` in
  `ToastProvider`.
- `components/LandingPage.tsx` (760 lines) + `landing.css` (976 lines) is the Sep 22 landing: its
  own nav, hero stage with parallax, scroll-assembled how-it-works, `#how`/`#why` anchors, and direct
  DMG links with the old "right-click → Open" note.
- `components/AuthWizard.tsx` is the two-panel email/password wizard with throwaway role/building
  steps and an "Enter Tvashtr" finish. Its hosted variant is a single link to
  `config.github_install_url`.
- `lib/desktopDownload.ts` holds `DESKTOP_MAC_DMG_URL` and `DESKTOP_RELEASES_URL`.
- `lib/nav.ts` has app routes only.

**New pages: `frontend/src/pages/site/`** (CSS in `pages/site/site.css`, exact px from the HTML):
- `SiteHeader.tsx`: the 1440 header, with signed-out and signed-in right sides and a `current` prop.
  `MobileHeader.tsx` + `MobileMenu.tsx` cover Mob-1/2.
- `SiteFooter.tsx` for desktop and mobile.
- `LandingPage.tsx` renders the sections as components: `Hero`, `ProductMock`, `ProofStrip`, `Gap`,
  `WhyRows` (+ `mocks/*`), `HowItWorks`, `TwoWays`, `WhoFor`, `Faq`, `Closing`. `LandingMobile.tsx`
  holds the 390 variant, chosen by `matchMedia("(max-width: 719px)")`. Both share `faqItems.ts` and
  `Faq.tsx`.
- `SignInPage.tsx` covers the hosted door, the self-hosted form, the error variants and
  `?app=desktop`. `SignInDone.tsx` covers Start-3 and the Desktop "back to the app" state. Both use
  `SignInLayout.tsx` (left brand panel + canvas mock).
- `DownloadPage.tsx` covers the Mac, Windows/Linux and phone variants. `DownloadSteps.tsx` covers
  the steps, the `xattr` copy row and `OpenAppDialog`.
- `ComputerHandoffSheet.tsx` is the Mob-3 sheet.
- `SiteRoot.tsx` picks the page from the route (with WEB-3's Desktop redirect) and loads
  `/api/auth/me` once for the header.

**Reuse** (`frontend/src/design-system/components`): `Button` (primary/secondary/ghost; sm/md/lg;
`loading`; full width), `ButtonLink` (every navigating CTA, including the DMG anchor), `IconButton`,
`Logo` (26/22), `Avatar` (accent), `Badge` (success/info with icon, for the detection badges and the
"Running"/"Done" mock badges), `Input`/`Field`, `Dialog` (Mac-4, 500 content + 22 padding),
`ToastProvider`/`useToast`, `cx`, `useDismiss`, the overlay stack (`lib/overlayStack.ts`) and
`useModalDialog`.
- **New DS piece:** the bottom-sheet variant for Mob-3. Add `side?: "right" | "bottom"` to `Sheet` in
  `overlays.tsx` rather than building a one-off, so the overlay stack still owns Escape. Its test
  lives in `components.test.tsx`.
- The mock node cards are static, local components (`pages/site/mocks/NodeCardMock.tsx`); they do
  not reuse `canvas/AgentNodeCard`, which needs React Flow context.

**Replaces and deletes:**
- `components/LandingPage.tsx` + `LandingPage.test.tsx` + `frontend/src/landing.css`;
- `components/AuthWizard.tsx` + `AuthWizard.test.tsx` and the `.tv-auth*` / `.tv-authwiz*` rules in
  `index.css`;
- `AuthGate.tsx` is rewritten as a thin session provider plus `SiteRoot`/`Workspace` switch (keep the
  401 seam, now → `#/signin?next=`), and `AuthGate.test.tsx` is rewritten;
- `rewriteGithubInstallUrlForDesktop` in `lib/api.ts` retires once B-2 ships (the FE passes
  `redirect_uri` to `/start`).

**Nav and routes (`lib/nav.ts`):**
- Add `type SiteSection = "product" | "how" | "domains" | "two-ways" | "faq"` and the Route
  variants `{ page: "welcome"; section?: SiteSection }`, `{ page: "download"; step?: "started"; os?:
  "mac" | "windows" | "linux" }` and `{ page: "signin"; done?: boolean; error?: "cancelled" | "failed"
  | "expired"; app?: "desktop"; next?: string }`.
- `parseRoute`/`routeToHash` handle `welcome`, `download[/started]` and `signin[/done]`. Unknown
  public values are dropped, not errors.
- A new `isPublicRoute(route)`. `sectionOf` returns a new `"site"`.
- The empty hash is special-cased in `SiteRoot`/`AuthGate` (landing vs Home), not in `parseRoute`,
  which keeps returning HOME so existing callers don't change.
- `nav.test.ts` gains round-trip cases, including `next` encoding and rejection of `next` values
  that aren't app addresses.

**API client:** `frontend/src/lib/api/site.ts`, re-exported from `lib/api.ts`:
- `getSiteInfo()` returns `SiteInfo | null` (B-4). It is shape-validated, and any failure returns
  `null`, so the page renders without the version and stars;
- `startGithubSignIn({next, app})` builds the `/api/auth/github/start` URL, adding `redirect_uri` in
  Desktop;
- `mintDesktopHandoff()` returns `{token, link}` (B-5).

**Constants:** `lib/desktopDownload.ts` gains `GITHUB_REPO_URL`,
`GITHUB_RELEASES_PAGE_URL` (`…/releases`), `DESKTOP_MIN_MACOS_LABEL = "macOS 11 or later"`,
`QUARANTINE_FIX_COMMAND = "xattr -dr com.apple.quarantine /Applications/Tvashtr.app"` and
`SIGNIN_HELP_URL`. A vitest reads `desktop/package.json` and checks that `DESKTOP_MIN_MACOS_LABEL`
matches the Electron major table and that `build.mac.artifactName` is still `Tvashtr-mac.${ext}`.

**Tests (vitest):**
- routing: signed out/in × public/app route × web/Desktop, including WEB-3;
- `lib/platform.ts`: user-agent and UA-CH cases, `?os=` override, no "detected" claim on override;
- FAQ: single-open, first open on the landing, all closed on mobile;
- sign-in error variants and Try again keeping `next`;
- `SignInDone`: status lines and the redirect to `next`;
- download: the anchor `href` equals the constant, a click lands on `#/download/started`, the copy
  button;
- the Mob-3 sheet: `navigator.share` path, clipboard fallback, "Continue on this phone anyway".

**e2e:**
- Rewrite the selector contract in `frontend/e2e/auth.spec.ts`, `accounts.spec.ts`,
  `revamp-shell.spec.ts` and `memory_shelf.spec.ts` ("Get started" → "Start building"; no
  role/building/"Enter Tvashtr" steps; "Create account" stays as the self-hosted toggle's button).
- Add `frontend/e2e/website.spec.ts`: logged-out landing → sign-in page; download page with a Mac UA
  and a Windows UA; FAQ toggle; the Desktop-mode redirect.
- The Ship Protocol's prod smoke ("loads the landing and sign-in pages") switches to `#/welcome` and
  `#/signin` and checks "Compose your own team of AI agents" and "Sign in to Tvashtr".

**Parity:** `scripts/design-parity/scenarios/website.mjs`.
- Logged-out scenarios answer `GET /api/auth/me` with `() => ({ status: 401 })`. Signed-1 uses the
  default identity with `github_login: "lazyxgenius"` and `display_name: "Lazyx"`. Fixtures: hosted
  config and `GET /api/public/site`.
- Viewports: Web-Landing 1440×6640; Web-Mobile 390×2300; Mob-1/2/3 390×844; all others 1440×900.
- Flow frames use `steps`: scroll via `?s=two-ways|faq`; Faq-1 closes item 1 first; Faq-2 opens item
  2; Mac-4 clicks **I’ve installed it — open Tvashtr**; Mob-2 clicks the hamburger; Mob-3 clicks
  **Start building**.
- **Harness gap:** a scenario `userAgent` plus an `init` script to stub
  `navigator.userAgentData.getHighEntropyValues` (platform "macOS", architecture "arm"; or
  "Windows"). Without it the detection badges can't be rendered honestly. `?os=` suppresses them.
- Items expected as "not found in app", to be explained in `docs/superpowers/parity/website.txt`: the
  version/macOS placeholders, the Intel link, the email Input/Tell me, "Email me the link", the
  testimonial, the hidden footer links and the xattr additions.
- Desktop mode records "n/a — website only; Desktop shows DT-Welcome/Home (WEB-3 test)" per
  artboard.

---

## 6. Open questions

- **OQ-1: where the landing lives for a signed-in user.** Signed-1 shows the site to a signed-in
  visitor, but today the root goes straight to Home, and bookmarks rely on that. **Decision:** keep
  the root as Home when signed in. Public pages have their own addresses (`#/welcome`, `#/download`),
  reachable from the header logo, the sign-in page, the Engines "Get Tvashtr Desktop" flow (OQ-26)
  and shared links. On those pages a signed-in visitor gets Signed-1's header.
- **OQ-2: what "Open app" opens.** **Decision:** the web app: `next` if one was remembered, else
  `#/home`. It is not the Mac app. The website frames are about the browser. The Mac app is opened
  only by Mac-4's explicit dialog.
- **OQ-3: self-hosted sign-in isn't designed** (the design is GitHub-only). Local dev and every e2e
  run are self-hosted. **Decision:** WEB-28: the same layout with an email/password form, and the
  throwaway role/building steps and the "Enter Tvashtr" finish removed. It is not parity-gated.
- **OQ-4: "open source" with no license.** The design says "Open source" in the hero pill, the meta
  line, the proof strip, the closing lede, the FAQ, the mobile pill and the footer. The repo has no
  `LICENSE`, and an unlicensed public repo is not open source. **NEEDS_HUMAN:** the operator picks a
  license (e.g. MIT or Apache-2.0) and adds `LICENSE`. That is the only thing the design can't
  answer. **Interim decision** if the website ships first:
  - "Open source · …" → "Source on GitHub · …";
  - "Free and open source" → "Free, source on GitHub";
  - "Open source on GitHub · N stars" → "Source on GitHub · N stars";
  - closing "Free and open source." → "Free, with the source on GitHub.";
  - FAQ "Is it open source?" → the answer "The source is on GitHub. A license hasn’t been chosen
    yet.";
  - restore the design copy the day a license lands (one constant file,
    `pages/site/copy.ts`).
- **OQ-5: Mac install steps on current macOS.** The unsigned app gets "Tvashtr is damaged", and
  right-click → Open doesn't help. **Decision (session rule):** keep steps 1–3 as designed and add
  the `xattr -dr com.apple.quarantine /Applications/Tvashtr.app` line, with a Copy button and one
  lead-in sentence, inside step 2 (WEB-34). Reported as a deviation. Step 1 names the real file
  `Tvashtr-mac.dmg`, not `Tvashtr-[version].dmg` (the name is stable by rule).
- **OQ-6: "Intel Mac? Get that version".** There is no Intel build (D-5). **Decision:** replace the
  link with plain text "Needs a Mac with Apple silicon (M1 or later)". When UA-CH reports `x86`,
  show the Windows-style page variant: badge (info) "We detected an Intel Mac", h1 "The desktop app
  needs Apple silicon for now.", and the same **Use the website** + notify row. A universal build is a
  later Desktop decision.
- **OQ-7: "We detected a Mac with Apple silicon" can't always be known.** Safari and Firefox report
  Intel on every Mac. **Decision:** claim Apple silicon only when UA-CH says `arm`; otherwise "We
  detected a Mac" (WEB-33). The button label stays "Download for Mac · Apple silicon", which states
  what the file is.
- **OQ-8: "[version] · [minimum macOS]".** **Decision:** "v<version>" from B-4 (omitted when
  unknown) and "macOS 11 or later" (Electron 35's floor), pinned by the constant test. The line reads
  e.g. "Needs a Mac with Apple silicon (M1 or later) · v0.4.0 · macOS 11 or later".
- **OQ-9: Windows "Tell me" (email me when Windows is ready).** There is no email service, no
  privacy notice and no one to send it (B-6). **Decision:** replace the Input + **Tell me** with a
  secondary md **Watch for releases on GitHub** (mail icon kept) → the repo's releases page. Keep the
  lede's question. Collecting emails is a later product call and would need the `waitlist_signups`
  table. Reported as a deviation.
- **OQ-10: mobile "We’ll email you a sign-in link".** There is no email sender (a missing key), and a
  magic sign-in link would be a new auth path (B-7). **Decision:**
  - sheet body: "The canvas needs a big screen. Send yourself this page and open it on your
    computer.";
  - drop the Email Input;
  - primary lg full **Send me the link** (share icon) calls `navigator.share({ title: "Tvashtr",
    url: "https://tvashtr.fly.dev/" })`. Where `navigator.share` is missing it becomes **Copy the
    link** with the toast "Link copied";
  - the dark panel's button becomes **Send me a link for my computer**;
  - the ghost **Continue on this phone anyway** is kept.

  Reported as a deviation.
- **OQ-11: three FAQ answers aren't designed.** **Decision (honest, data-driven where it can be):**
  - "Which models can I use?" → "On the website, any model from anthropic, xai, openai, gemini,
    groq, deepseek or openrouter, with your own API key for that provider. You can also type a custom
    model ID. On Desktop, your Claude or Grok plan runs first, then the same API keys. Each agent in a
    team can use a different model." The provider list is built from `provider_catalogue` entries
    with at least one seat, so NIM, which serves no seat, never appears.
  - "What is Tvashtr Desktop for?" → "Running your teams on your own Mac with the Claude or Grok plan
    you already pay for, on a local folder or a GitHub repo. It uses the same account, teams and keys
    as the website. Runs stop when you quit the app. Mac only for now."
  - "Is it open source?" → per OQ-4 (with a license: "Yes. The code is on GitHub under the <license>
    license.").
- **OQ-12: testimonial placeholder.** The design's own caption says "add once you have permission".
  **Decision:** don't render the figure until a real, permitted quote is supplied (operator content,
  non-blocking). Never ship bracketed placeholders.
- **OQ-13: "[stars]".** **Decision:** the live `stars` from B-4, formatted "· 1,234 stars". When
  unknown, the item reads "Open source on GitHub" (or the OQ-4 interim).
- **OQ-14: footer links with no destination.** **Decision:**
  - Changelog → the GitHub releases page; Docs → the repo README; GitHub → the repo;
  - **Status**, **Privacy** and **Terms** are hidden, and so is the empty "Legal" column, until pages
    exist. The mobile footer line becomes "GitHub · Docs";
  - writing Privacy and Terms is operator content (legal), non-blocking.
- **OQ-15: "Check that pop-ups aren’t blocked".** Sign-in is a full-page redirect, not a pop-up, so
  that advice is false. **Decision:** "Still stuck? Check that your browser allows cookies for this
  site, or read the sign-in help." The first-party `tv_session` / `tv_oauth_state` cookies are what
  actually break sign-in when blocked. "read the sign-in help" links to a new `docs/help/sign-in.md`
  (cookies, a GitHub account needing email verification, "Authorize" vs "Install", a stale tab).
  Reported as a deviation.
- **OQ-16: sign-in errors other than "cancelled".** Only cancelled is designed. **Decision:** the
  `failed` and `expired` variants in WEB-30, with the same layout and button.
- **OQ-17: "Setting up your workspace; this takes a few seconds."** Nothing is provisioned after the
  callback. **Decision:** keep the copy; it covers the account find-or-create and the first Home
  load. "Account ready" is ticked from real events (WEB-29). The screen shows for at least 400 ms,
  with no fake delay beyond that.
- **OQ-18: "Using the Mac app? Sign in from the app. It opens this page for you and brings you
  back."** That is true only if Desktop signs in through the system browser via this page. Today it
  signs in inside its own window (D-6). **Decision:** propose to the Desktop app area that its "Sign
  in with GitHub" opens `https://tvashtr.fly.dev/#/signin?app=desktop` in the default browser, which
  returns through `tvashtr://welcome?handoff=…` (WEB-31, B-5, D-2). That makes this line true and also
  gives DT-Handoff its "Continue as <login>". If the Desktop area keeps in-window sign-in, change the
  line to "Using the Mac app? Sign in from the app with the same GitHub account." The Desktop area's
  analysis must record which one it chose. Whichever area builds B-5 first owns it.
- **OQ-19: Mac-4 when the visitor isn't signed in on the website** (the usual case on a download
  page). **Decision:** fire plain `tvashtr://welcome`. The app shows `DT-Welcome` and the user signs
  in there, so "signs you in with the same GitHub account" stays true. When signed in, mint and pass
  a handoff (WEB-35) so the app offers "Continue as <login>".
- **OQ-20: OAuth `state` / login CSRF.** Today's authorize link has no `state`, so a crafted
  callback could sign a victim into an attacker's account. **Decision:** build B-2/B-3 as a security
  fix alongside the screens (the spec §3.6 precedent). They also carry `next` and `app`, which the
  screens need anyway.
- **OQ-21: a signed-in visitor clicks "Start building — sign in with GitHub"** (Signed-1 keeps the
  label). **Decision:** keep the label as designed and go straight to `#/home`. Signing in again would
  be pointless.
- **OQ-22: the closing panel's secondary button renders unreadable** (dark label on the dark panel
  in `Web-Landing.png`). **Decision:** an on-dark secondary: transparent background, cream label and
  border at `rgba(250,249,245,0.35)`, same size as the design's secondary lg. Parity matches its size
  and font, and the colour is exempt.
- **OQ-23: clipped footers** (Web-Landing at 6640, Web-Mobile at 2300). **Decision:** build the
  footers from the HTML (WEB-8, WEB-22). Parity measures only what's inside the artboard, so they
  don't show up.
- **OQ-24: "Download for Mac" and "Start building" on a phone.** Only Start building's sheet is
  designed. **Decision:** both open the computer-handoff sheet (a DMG is useless on a phone).
  `#/download` opened on a phone shows the Mac page without a badge and with **Send me the link** in
  place of the download button.
- **OQ-25: sizes between 390 and 1440, and sign-in/download on phones.** Not designed.
  **Decision:** WEB-19's breakpoints. Sign-in below 720 hides the left panel. The download pages are
  already one centred column and simply narrow. Only the designed sizes are parity-gated.
- **OQ-26: the Engines "Get Tvashtr Desktop" dialog (ENG-47) downloads the DMG with no install
  steps,** so users meet "Tvashtr is damaged" with no help. **Decision (cross-area, small):** its
  **Download** starts the same DMG link and also opens `#/download/started`, so the xattr step is
  always one screen away. Raise it with the Engines owner. It isn't in this area's parity scope.
- **OQ-27: where a mid-session 401 goes.** Today it goes to the landing. **Decision:**
  `#/signin?next=<current address>`, so a user whose session expired signs in and lands back where
  they were. The landing is for visitors.
- **OQ-28: FAQ open state** (Web-Landing opens item 1; Faq-1 shows all closed; Faq-2 closes item 1
  when item 2 opens). **Decision:** single-open, with item 1 open on load (WEB-17). Faq-1 is
  reproduced by closing item 1 first in its parity scenario. Mobile starts all closed, as drawn.
- **OQ-29: Linux visitors** (WbF-Index says "Windows or Linux"; only Windows is drawn).
  **Decision:** the same page with "We detected Linux" and "…when Linux is ready?".
- **OQ-30: nav "Product" target.** **Decision:** the "Why Tvashtr" section (the product features).
  "How it works" and "Domains" go to their own sections. "Desktop" is the download page, which the
  design confirms by drawing it as the current page there.

**NEEDS_HUMAN (only what the files and rules can't answer)**
- **License (OQ-4).** Choose a license and add `LICENSE` to the repo. Until then the site ships the
  interim "source on GitHub" wording, and every "open source" line in the design waits on it.
  Non-blocking for the build.

**Operator content, non-blocking** (hidden until supplied, by decision): a permitted testimonial
(OQ-12); Privacy and Terms texts (OQ-14).

**Deviations to report at ship**
1. Step 2 gains the `xattr` line and a "Tvashtr is damaged" lead-in (session rule).
2. Step 1 names `Tvashtr-mac.dmg`.
3. The Intel link is replaced by "Needs a Mac with Apple silicon (M1 or later)".
4. The Apple silicon badge appears only when detectable.
5. `[version] · [minimum macOS]` is filled from B-4 and a constant.
6. Windows/Linux "Tell me" email becomes a GitHub releases link.
7. Mobile "email me a link" becomes share/copy link.
8. "pop-ups" becomes cookies, and the help link targets a new doc.
9. The testimonial, Status, Privacy and Terms are hidden.
10. `[stars]` is live or omitted.
11. The three FAQ answers were written by us.
12. The closing panel's secondary button is readable on dark.
13. The failed/expired sign-in variants and the `?app=desktop` variant were added.
14. The sign-in foot note is conditional on OQ-18.
15. "Open source" wording is interim if no license exists by ship (OQ-4).
