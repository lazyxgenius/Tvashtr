# Tvashtr Desktop app screens — gap analysis (area `desktop_app`, prefix `DT-`)

Screens covered (40, exactly the `desktop_app` list in `design/revamp-export/render/areas.json`):
`DT-Welcome`, `DT-Waiting`, `DT-Handoff`, `DT-Engines`, `DT-Project`, `DT-Team`, `DT-Ready`,
`DT-Splash`, `DT-Offline`, `DT-Expired`, `DT-Update`, `DtF-Index`, `DtF-Run-1` … `DtF-Run-8`,
`DtF-Sign-1`, `DtF-Sign-2`, `DtF-Claude-1`, `DtF-Claude-2`, `DtF-Claude-3`, `DtF-Key-1`,
`DtF-Key-2`, `DtF-Key-3`, `DtF-Git-1`, `DtF-Git-2`, `DtF-Git-3`, `DtF-Hand-1`, `DtF-Hand-2`,
`DtF-Launch-1`, `DtF-Launch-2`, `DtF-Off-1`, `DtF-Off-2`, `DtF-Exp-1`, `DtF-Upd-1`, `DtF-Upd-2`.
For every one: the outline (`render/outlines/<Name>.txt`), the PNG (`render/png/<Name>.png`, looked
at) and the exact HTML (`project/<Name>.dc.html`; the `DtF-*` copies of a `DT-*` board were diffed
against it line by line, so every difference listed below is the whole difference).

Code read:
- **Desktop shell:** `desktop/package.json`, `desktop/electron/{main,preload,deepLink,windowOptions}.cjs`,
  `electron/harness/{types,terminalLogin,enginePrefs,claude,grok}.cjs` (status, connect, install
  URLs), `electron/runner/{engineController,runner,api}.cjs`, `electron/repos/{recent,common}.cjs`,
  `desktop/scripts/{local-server.cjs,build.mjs}`, `.github/workflows/desktop-mac-release.yml`.
- **Frontend:** `src/vite-env.d.ts` (bridge types), `main.tsx`, `components/{AuthGate,
  DesktopTitleBar,DesktopDisclosure}.tsx`, `lib/{desktopDownload,desktopRepos,nav,backendStatus,
  engines}.ts`, `lib/api.ts` (`getMe`, `rewriteGithubInstallUrlForDesktop`, `createTeam`),
  `lib/api/teams.ts`, `pages/Workspace.tsx`, `pages/shell/Shell.tsx` (nav foot, account menu),
  `pages/home/{HomePage,FirstTimeHome,AddKeySheet,Composer}.tsx` (Desktop paths only),
  `design-system/components/{index.ts,overlays.tsx,ds.css}` (exports, Sheet, toast placement), plus
  a grep of every `tvashtrDesktop` / `isDesktopApp` / `DesktopTitleBar` / `desktopRepos` /
  `desktopDownload` use.
- **Backend:** `auth.py` (session cookie, GitHub callback, loopback allow-list),
  `control_plane/github_app.py` (`build_install_url`, code exchange), `main.py` (router mounting,
  `/health`, `/healthz`, `/api/config`), `desktop_runner_routes.py`, `control_plane/desktop_jobs.py`
  (claim, heartbeat, `OFFLINE_ERROR`), `engines/desktop_runner_adapter.py` (offline timing),
  `config.py` (`desktop_runner_*_seconds`), `control_plane/teams.py` (templates, default models,
  `create_team_from_template`, `create_blank_team`), `control_plane/provider_directory.py`,
  `control_plane/preferences.py`, `routers.py` (`POST /api/teams`, `GET /api/templates`,
  `/api/github/repos`), `routes/{local_repo,engines,account,home}.py`, `models.py`
  (`DesktopNodeJob`, `EngineSubscriptionStatus`).
- **Docs:** the spec and plan, both briefs, `plans/api/{desktop-bridge,local,engines,teams,runs}.md`,
  `HANDOVER-2026-09-25-revamp.md`, round-1 `engines.md` (model) and `panel.md`, and the session
  brief `prompts/revamp-e2e.md` Phase 2.

Facts that shape everything below:
- **Sign-in today stays inside the Electron window.** `main.cjs` loads GitHub's OAuth pages in the
  app window and `lib/api.ts::rewriteGithubInstallUrlForDesktop` points the callback at the loopback
  proxy. The design's sign-in happens in the user's **default browser** ("Opens your browser",
  "Finish signing in in your browser", "Copy the sign-in link", "Continue as lazyxgenius … you're
  signed in [on tvashtr.fly.dev]"). No backend or bridge piece for a browser sign-in exists.
- **Logged out, Desktop shows the website's landing page today** (`AuthGate` → `LandingPage`).
  `DtF-Index` says the Mac app "never shows the website's marketing page". An unreachable backend
  also lands on the landing page (a failed `getMe` becomes "unauthed").
- **The session is a stateless signed cookie** (`itsdangerous`, 14 days, payload = user id). So
  "session ended" = 401, and a browser-to-app sign-in can be built with signed, short-lived codes
  and no table.
- **Runs are orchestrated on Tvashtr's servers.** From Desktop, only nodes whose model is covered
  by a connected Claude/Grok plan run on the Mac (the runner); API-key nodes run on Tvashtr's
  servers. When Desktop quits, `runner.stop()` kills the CLI and posts nothing; the claimed job
  expires after `desktop_runner_offline_seconds` (120 s) with "Tvashtr Desktop went offline —
  reopen it and retry.", and until then it also blocks that provider for new claims.
- **The Mac app is unsigned** (`identity: null`), has no auto-updater, and its version is
  `desktop/package.json` `version` (0.3.0 on this branch; `app.getVersion()` in main). The release
  asset name is stable: `Tvashtr-mac.dmg`.
- **Templates stamp BYOK defaults only.** `create_team_from_template` picks each node's model from
  the owner's saved keys (`_PROVIDER_DEFAULT_ORDER`, which deliberately excludes `anthropic` and
  `xai`). A Desktop user with only Claude/Grok plans gets nodes their plans can't run. There is no
  "Spec only" template.
- **The renderer never subscribes to `navigation.onNavigate`** (bridge v5 ships it; F0 did not wire
  it), and `DesktopTitleBar` hard-codes "Tvashtr — the living canvas".
- **NVIDIA NIM serves no seat** (`PROVIDER_CATALOGUE["nvidia_nim"]` has both defaults `None`), but
  `provider_directory` still offers it as "Open models on NVIDIA NIM".

---

## 1. Screens

Every board in this area is **Desktop only** (it draws the 30px macOS title strip). None is checked
in website mode; each family says why it has no website twin. A coral ring (a `box-shadow` span
around one control) on a `DtF-*` board only marks "what you click next". It is an annotation, not
UI.

### Layout families (exact geometry lives in the HTML; summarised so builders find it)

- **Launch frame** (Welcome, Waiting, Handoff, Splash, Offline, Expired, Sign-2, Off-2, Upd-2): the
  30px title strip reads "Tvashtr". Below it a radial coral wash (`radial-gradient(90% 70% at 50%
  0%, #f7e7df …)`) with one centred column. The column is 820px wide (Welcome, Handoff), 560px
  (Waiting, Offline, Sign-2, Expired) or 440px (Splash, Off-2, Upd-2), with an 18px gap. It holds a
  64px logo mark or a 56px icon tile, then an h1 in the display font: 46px (Welcome), 36px (the
  560 family) or 30px (the 440 family). The foot is absolutely placed 24px in from each side and
  18px up: "Tvashtr Desktop · [version]" on the left, "Help" and "Privacy" on the right (12.5px,
  ink-500).
- **Status checklist card** (Splash, Off-2, Upd-2): padding 14px 18px, radius 12, 8px gap. Each line
  is 12.5px with an icon: sage `#52613e` + check for done, `#7a5423` + warning triangle for "fix
  later", ink-600 + spinner for in progress, ink-500 + info icon for a note.
- **Setup frame** (Engines, Project, Team): a 320px left rail (cream-200, padding 28px 22px, 22px
  gap) and a main column (padding 44px 56px 20px, 20px gap, h1 display 34px, lede 15px ink-600, max
  720px). A footer bar (padding 16px 56px, top border, surface-card) holds a ghost md **Back**,
  then, pushed right, an optional ghost md **Skip for now** and a primary md
  **Continue**/**Create team**.
  - Rail: Logo 26 → "Set up Tvashtr Desktop" (display 22px) → "About 2 minutes. You can change all
    of this later." (13px ink-500) → the step list → at the bottom Avatar sm, "Signed in as
    **lazyxgenius**" and a coral-700 link **Switch**.
  - Steps are rows with padding 10px 12px and radius 10. Done: a 24px sage circle with a check,
    title ink-600. Current: a coral-500 circle with its number, title ink-900, the row boxed
    (cream-50 + line-300 border). Later: an outlined circle, title ink-500.
- **Right sheet** (Claude-2, Key-2): 520px, over a scrim `rgba(20,20,19,0.3)`. Header padding 20px
  16px 14px 24px (display 22px title, 13px subtitle, IconButton sm "Close"). Body padding 20px 24px
  with a 16px gap. Footer padding 14px 24px: a left note (12.5px ink-500) and right-hand buttons.
- **Shell frame** (Ready, Update, Run-8, Launch-2, Upd-1): the title strip reads "Tvashtr — the
  living canvas". It is a simplified shell: a 60px header (Logo, "● Connected", Avatar) with **no ⌘K
  button**, and a 224px nav of four flat items (Home current, Domains, Engines, Toolkit) with **no
  badges**. The nav foot is either the Domains blurb or the update card. Main padding is 26px 40px,
  max 1000px.
- **Toasts** (Run-3, Claude-3, Hand-2): dark, placed `bottom: 90px; left: 820px` (above the setup
  footer, inside the main column), padding 11px 16px, 13px, with a check icon. `ds-toasts` today is
  `bottom: 32px`, centred on the window.

### Launch and sign-in (Desktop only)

No website twin: on the website the browser is already where you sign in (`Web-SignIn`); an
unreachable server can't serve the website at all (the shell shows its offline banner); and an
expired web session goes back to `Web-SignIn`.

**DT-Welcome: first launch, never signed in on this Mac.** Logo mark, h1 "Welcome to Tvashtr", a
17px lede, then a primary **lg** button with the GitHub mark, **Sign in with GitHub**, then 13.5px
helper text. Three value cards (padding 16, radius 14, a coral 16px icon, 14px 600 titles, 12.5px
body): key icon "Your plan first", folder icon "Your folders and repos", power icon "Stops when you
quit". Foot: version, Help, Privacy. State: idle only.

**DtF-Run-1** = DT-Welcome with the ring on **Sign in with GitHub** ("1 · Welcome: Sign in with
GitHub").

**DT-Waiting: waiting for the browser.** A 56px coral-100 tile with a coral spinner, h1 "Finish
signing in in your browser" (36px) and a 16px paragraph. One row holds a secondary sm **Open the
browser again** (external-link icon) and a ghost sm **Copy the sign-in link** (copy icon); a ghost
sm **Cancel** sits below. State: waiting.

**DtF-Run-2** = DT-Waiting, identical ("2 · Finish in the browser; the app waits").
**DtF-Sign-1** = DT-Waiting with the ring on **Open the browser again** ("1 · Browser closed by
mistake").

**DtF-Sign-2: sign-in didn't finish.** A 56px amber-100 tile with a warning triangle
(`#6b4a1f`), h1 "Sign-in didn't finish", a paragraph, a primary md **Try again** (refresh icon,
ringed), a ghost md **Copy the sign-in link**, and a 13px hint below. States: timed out (10
minutes) or cancelled on GitHub. The copy covers both.

**DT-Handoff: opened from the website.** DT-Welcome's layout, but the primary lg button holds an
Avatar sm ("L", accent) and **Continue as lazyxgenius**. The helper line reads "You opened the app
from tvashtr.fly.dev, where you're signed in." followed by an inline coral-700 link **Use a
different account**. Same three cards and foot.

**DtF-Hand-1** = DT-Handoff with the ring on **Continue as lazyxgenius**.
**DtF-Hand-2: no browser step, straight to Engines.** DT-Engines (step 2 current) plus the toast
"Signed in from your browser".

**DT-Expired: session ended.** Logo mark, h1 "Sign in again to continue", a paragraph, a primary
lg **Sign in with GitHub**, and 13px "Last signed in as lazyxgenius".
**DtF-Exp-1** = DT-Expired with the ring on **Sign in with GitHub**.

### Every later launch (Desktop only)

**DT-Splash: opening.** Logo mark, h1 "Opening your workspace…" (30px), and a checklist card:
✓ "Signed in as lazyxgenius", ✓ "Claude Code connected", ⚠ "Grok needs sign-in · you can fix it
later", ◌ "Loading your teams…". State: in progress. The website has nothing between loading and
Home.

**DtF-Launch-1** = DT-Splash, identical ("1 · A short check while it opens").
**DtF-Launch-2: Home, "Grok warning stays in Engines".** DT-Ready's Home, but the card heading
reads "Welcome back. What's next?". **Design inconsistency:** its chip still says "Claude and Grok
plans connected" while Launch-1 said Grok needs sign-in. The chips must be data-driven (OQ-24).

**DT-Offline: can't reach the server.** A 56px panel-300 tile with a wifi-off icon, h1 "Can't reach
Tvashtr", a paragraph, a primary md **Try again** (refresh) and a ghost md **Check service status**
(external-link), then a 12px mono detail line "tvashtr.fly.dev · no response after 10 s · tried 3
times".
**DtF-Off-1** = DT-Offline with the ring on **Try again**.
**DtF-Off-2: reconnected.** Logo mark, h1 "Reconnected", checklist ✓ "Connected", ✓ "Signed in as
lazyxgenius", ◌ "Loading your teams…".

### Setup step 2: Engines (Desktop only; the website has no local CLIs — Engines › Subscriptions is web read-only)

**DT-Engines: Claude connected, Grok needs sign-in.** h1 "How should your agents run?" and a lede.
Four rows with a 10px gap:
1. **Claude Code** (C tile): success dot badge "Connected", "Found on this Mac · signed in with
   your Claude plan · covers anthropic/* models", a Switch labelled "Use my plan" (on). Border
   `#cdd6bf` (sage).
2. **Grok** (G tile): warning dot badge "Needs sign-in", "Found on this Mac · not signed in · covers
   xai/* models", a tint sm **Sign in to Grok**. Border `#e6cfa9` (amber).
3. **Codex** (O tile): info badge (no dot) "Status only", "Not found. Tvashtr can show its status,
   but can't run agents on it yet.", a ghost sm **How to install** (external-link icon). Border
   line-300.
4. **API keys** (dashed line-400 border, key icon): "Works everywhere, including the website. Pay
   the provider per use." and a secondary sm **Use an API key instead** (key icon).

Below the rows: a consent Checkbox in a sunk box (unchecked), then 12px "Tvashtr isn't affiliated
with or endorsed by Anthropic or xAI.". Footer: **Back**, **Skip for now**, **Continue**
(disabled).

**DtF-Run-3** = DT-Engines with the ring on **Sign in to Grok** and the toast "Signed in as
lazyxgenius" ("3 · Back in the app: Claude found, Grok needs sign-in").

**DtF-Run-4: Terminal opens to sign in to Grok.** The Grok row becomes: info dot badge
"Checking…", "Finish signing in in the Terminal window", and a ghost sm **Cancel**. Everything else
is unchanged. Over the whole content area sits a scrim `rgba(20,20,19,0.35)` with a centred stack.
On top is a picture of a 560px macOS **Terminal** window ("$ grok login / Opening your browser to
sign in… / Waiting for you to finish in the browser.") — the real OS Terminal, which the app does
not draw. Below it is an in-app strip (surface-card, padding 12px 16px, radius 12, 13.5px, spinner):
"We opened Terminal for you. Finish signing in to Grok there; this updates on its own." with a ghost
sm **Cancel**.

**DtF-Run-5: both connected, tick the note, Continue.** The Grok row shows "Connected" (success
dot, sage border), "Found on this Mac · signed in with SuperGrok · covers xai/* models" and its own
"Use my plan" switch (on). The checkbox is ticked. **Continue** is enabled and ringed.

**DtF-Claude-1: Claude Code not found.** The Claude row shows a neutral badge (no dot) "Not
installed", "Install it and sign in once to use your Claude plan", a tint sm **Set up** (ringed),
and a line-300 border. Grok still needs sign-in. **Continue** is disabled.

**DtF-Claude-2: the "Use your Claude plan" sheet.** A right sheet (aria-label "Use your Claude
plan") titled "Use your Claude plan", subtitle "Tvashtr runs Claude Code on this Mac for you". It has
three numbered steps (26px coral-100 circles):
1. "Install Claude Code" / "Follow Anthropic's install guide for Mac." / a secondary sm **Open
   install guide** (external-link).
2. "Sign in once" / "Open Terminal, run the command below, and sign in with your Claude account." /
   mono `claude`.
3. "Come back and check" / "Tvashtr looks for it again and uses your plan for anthropic/* models."

Then a sunk lock note: "You sign in inside Claude Code, not in Tvashtr. Tvashtr never sees your
login." Footer: left "Not found yet", right a ghost sm **Close** and a primary sm **Check again**
(refresh, ringed).

**DtF-Claude-3: found and connected.** DT-Engines again (Claude connected, Grok needs sign-in), with
the ring around the consent checkbox and the toast "Claude Code found · using your Claude plan".
**Continue** stays disabled until the box is ticked.

**DtF-Key-1: nothing found, use an API key.** Claude shows "Not installed" + tint **Set up**. Grok
shows a neutral "Not installed", "Install the Grok CLI to use your Grok plan" and a **ghost** sm
**Set up**. Codex shows Status only. The ring sits on **Use an API key instead**. **Continue** is
disabled.

**DtF-Key-2: the "Add an API key" sheet** (aria-label "Add an API key"). Title "Add an API key",
subtitle "Works on Desktop and on the website". Its fields:
- **Provider:** a combobox button, 40px high, mono 13.5px, reading "anthropic", with a chevron.
  Hint: "Covers models that start with anthropic/, like anthropic/claude-sonnet-5."
- **API key:** a password Input holding a pasted value.
- A sunk lock note: "Saved encrypted on your account. After you save, you'll only see •••• and the
  last 4 characters."

Footer: left "Pay the provider per use"; ghost sm **Cancel** and primary sm **Save key** (ringed).
It differs from the Engines sheet (`engines.md` ENG-61): another subtitle, the provider shown in
mono without a monogram, and no "Used by" line.

**DtF-Key-3: key saved, Continue is on.** The API-keys row now reads (sage, check icon) "anthropic
key saved · •••• 9c1e", and its button is a secondary sm **Manage keys** (key icon). The checkbox is
**unticked** but **Continue** is enabled and ringed, because no plan is in use.

### Setup step 3: Project (Desktop only; the website has no local folders — its composer picks a repo per run)

**DT-Project: a git folder chosen.** h1 "Where should your teams work?" and a lede. Three radio
cards (`role="radio"`, padding 18, radius 14):
1. **"A folder on this Mac"** (selected: 1.5px coral-500 border, `#fdf6f2` fill): "Good for local
   projects. Only on Desktop." and a folder row (surface-page, line-300 border). The row shows a
   folder icon, mono 13px `~/code/trade_mcp`, a sage status "git repo · branch main ·
   lazyxgenius/trade_mcp" and a ghost sm **Change**.
2. **"A GitHub repository"**: "Tvashtr works in a copy and opens a pull request. Works on the
   website too."
3. **"Decide when I launch a run"**: "You'll pick a folder or repo each time."

Footer: **Back**, **Continue** (enabled).

**DtF-Run-6** = DT-Project with the ring on **Continue**.
**DtF-Git-1: choose a folder.** The folder card is selected with no folder yet; it shows a secondary
sm **Choose folder…** (folder icon, ringed). **Continue** is shown enabled (see OQ-20).
**DtF-Git-2: not a git repo.** Inside the selected card sits an amber-100 box (`#6b4a1f`, 13px):
⚠ "`~/Documents/notes` isn't a git repository. Teams track and review their changes with git." with
a tint sm **Set up git here** (ringed) and a ghost sm **Choose another folder**. **Continue** is
disabled.
**DtF-Git-3: git set up.** The folder row shows `~/Documents/notes` and "git set up · branch main ·
no remote yet", plus **Change**. **Continue** is enabled and ringed.

### Setup step 4: First team (Desktop only; the website's first team comes from Home's New team dialog)

**DT-Team.** h1 "Start with a team" and a lede. Three radio cards:
1. **"Plan, build, review"** (display 20px) with a "Recommended" pill (coral-100/coral-700/coral-200,
   11.5px 600). Selected. Description: "A product manager writes the spec, you approve it, an
   engineer builds, a reviewer checks." A strip of role chips (padding 8px 10px, radius 10, a 12.5px
   600 name with an icon, a 10.5px ink-500 plan label) joined by arrows: Product manager "Grok plan"
   → You approve → Engineer "Claude plan" → Reviewer "Grok plan" → Ship PR.
2. **"Spec only"**: "Turns an idea into a reviewed spec. No code changes." Strip: Product manager
   "Grok plan" → Reviewer "Claude plan".
3. **"Blank canvas"**: "Start empty and add your own agents."

Then an Input "Team name" (420px) holding "Refund feature team". Footer: **Back** and a primary md
**Create team**.

**DtF-Run-7** = DT-Team with the ring on **Create team**.

### Ready and Home (Desktop only; the website's first-time Home is the get-started checklist, `FirstTimeHome`)

**DT-Ready: Home right after setup.** Shell frame, h1 "Home". Then a coral card (padding 26px 28px,
coral-200 border, radius 18, `#fdf6f2`):
- h2 "You're set up. Give your team its first job." (display 26px)
- four sage chips with check-circle icons: "Signed in as lazyxgenius", "Claude and Grok plans
  connected", "~/code/trade_mcp", "Refund feature team"
- an Input labelled "What should Refund feature team build?" holding "Add a self-serve refund
  button to Billing"
- a primary md **Launch** (play icon) and a ghost md **Open the canvas first**

Then "When you're ready" (13px 600) and three cards: "Add a domain" (book) "Give agents your docs,
with sources."; "Add tools" (wrench) "GitHub, Linear, web fetch and more."; "Try another template"
(people) "Spec only, or build your own.". The nav foot is the Domains blurb.

**DtF-Run-8** = DT-Ready with the ring on **Launch** ("8 · Home: give the team its first job").

### Update (Desktop only; the website is always the deployed version)

**DT-Update: an update is ready.** DT-Ready, but the nav foot is an update card (sunk, padding 12,
radius 10, 12px): **"Update ready · [version]"** (600), "Restarting stops running teams. 1 run is
going.", and a full-width primary sm **Restart to update** (refresh icon).
**DtF-Upd-1** = DT-Update with the ring on **Restart to update**.
**DtF-Upd-2: restarting.** Launch frame (440 family). Logo mark, h1 "Updating Tvashtr…",
checklist ◌ "Installing [version]" and ⓘ "Your running team will resume from its last step".

### Not a screen

**DtF-Index: index board.** "Desktop first-run flows" lists 10 flows / 28 screens (First run 8,
Sign-in didn't finish 2, Claude Code isn't installed 3, No plan on this Mac: use an API key 3,
Project · the folder isn't a git repo 3, Opened from the website 2, Every launch after the first 2,
Offline at launch 2, Session ended 1, Update ready 2) and explains the coral ring. Its rule is a
requirement: the Mac app "never shows the website's marketing page"; the first launch is setup and
every later launch goes straight to Home (DT-1, DT-2).

**Summary of Desktop vs website:** everything here is Desktop only. The shared pieces are the Shell
(Ready/Update reuse the round-1 shell), the Add-key sheet (Engines F2), the Home composer (launch)
and the template catalogue (`GET /api/templates`).

---

## 2. Behaviour requirements

### Routing, frames and launch order
- **DT-1** On Desktop (`isDesktopApp()`), a signed-out user never sees `LandingPage` or
  `AuthWizard`. They see DT-Welcome, or DT-Handoff when the app was opened from the website, or
  DT-Expired when someone signed in on this Mac before. The website keeps its current screens.
  Exception: a self-hosted backend (`hosted_mode: false`) shows the email/password form inside the
  Welcome frame (OQ-37).
- **DT-2** Launch order on Desktop:
  1. The splash (DT-Splash) checks `/health` (10 s timeout per try; up to 3 tries, 1 s then 2 s
     apart). All three fail → DT-Offline.
  2. `GET /api/auth/me`. On 401: DT-Expired if a last user is remembered on this Mac, else
     DT-Welcome/DT-Handoff.
  3. Signed in, and setup on this Mac not finished for this account → setup at its saved step.
  4. Otherwise it reads the engine status from the bridge and `GET /api/teams`, then Home (or a
     pending deep link, DT-49).

  The splash lines tick as each answer arrives.
- **DT-3** The title strip reads "Tvashtr" on every launch, sign-in and setup screen, and "Tvashtr —
  the living canvas" inside the shell and canvas. `DesktopTitleBar` takes its text from the current
  screen and `document.title` matches.
- **DT-4** The launch frame foot reads "Tvashtr Desktop · <version>" (the running app's version from
  the bridge, DB-3). **Help** and **Privacy** open in the default browser (DT-51).

### Sign in with the browser
- **DT-5** Welcome copy, exactly:
  - h1 "Welcome to Tvashtr"
  - lede "This app runs your agent teams on this Mac. Sign in to pick up your teams, or to start
    your first one." (honest-copy decision OQ-4)
  - button **Sign in with GitHub**
  - "Opens your browser. Use the same account as the website. New to Tvashtr? Signing in creates
    your account."
  - cards "Your plan first — Uses the Claude or Grok plan you already pay for, through your own
    Claude Code or Grok.", "Your folders and repos — Teams can work in a folder on this Mac or on a
    GitHub repo." and "Stops when you quit — Runs happen on this Mac. Quit the app and they stop."
    (OQ-4)
- **DT-6** **Sign in with GitHub** calls `auth.startSignIn()` (DB-1). It opens the default browser
  on the backend's `/api/auth/desktop/start` URL and shows DT-Waiting at once. The browser signs in
  with GitHub (or reuses its tvashtr.fly.dev session), then hands a one-time code back through
  `tvashtr://auth/done`. The app finishes by itself: "When you're done there, you'll come back here
  on your own."
- **DT-7** Waiting copy: h1 "Finish signing in in your browser"; "We opened GitHub in your default
  browser. When you're done there, you'll come back here on your own."
  - **Open the browser again** re-opens the same sign-in URL and restarts the 10-minute clock.
  - **Copy the sign-in link** copies that URL (clipboard). Proposed toast: "Sign-in link copied."
  - **Cancel** drops the pending sign-in (the code can no longer be used) and returns to Welcome.
- **DT-8** On success the app brings its window to the front.
  - First time on this Mac for this account: it goes to setup step 2 with the toast "Signed in as
    <login>" (DtF-Run-3).
  - Otherwise: splash, then Home.

  The rail and all later "Signed in as <login>" text use `display_name` (the GitHub login for
  GitHub accounts).
- **DT-9** If there is no code within 10 minutes, or GitHub reports the user cancelled, the app shows
  DtF-Sign-2: h1 "Sign-in didn't finish"; "The browser didn't send you back within 10 minutes, or
  you cancelled on GitHub. Nothing was changed."; **Try again** (starts a fresh sign-in, DT-6);
  **Copy the sign-in link** (copies the fresh URL without opening the browser); "Browser opened on
  another computer? Copy the link and open it here instead."
- **DT-10** Opened from the website (a `tvashtr://` link carrying the display hint `from=web&login=`,
  DB-2) while signed out on this Mac:
  - Show DT-Handoff: **Continue as <login>** with Avatar, "You opened the app from <site host>,
    where you're signed in.", and the link **Use a different account**.
  - **Continue as …** runs DT-6 with `account=current`. The browser already holds a tvashtr.fly.dev
    session, so it returns at once with no GitHub step. The app lands on setup step 2 (or Home) with
    the toast "Signed in from your browser" (DtF-Hand-2).
  - **Use a different account** runs DT-6 with `account=github`.
  - The login in the link is only a label. The account actually signed in is the one the browser
    session proves.
- **DT-11** Session ended (a 401 at launch, or any 401 mid-session, when a last user is remembered):
  DT-Expired. h1 "Sign in again to continue"; "Your session ended. Your teams and runs are safe;
  sign in to pick up where you left off."; **Sign in with GitHub** (DT-6); "Last signed in as
  <login>". After signing in, the app returns to the address the user was on.
- **DT-12** **Switch** (setup rail) signs out: `POST /api/auth/logout`, then `auth.forgetUser()`,
  then DT-Welcome. It does not disconnect any plan and does not clear this Mac's setup for the old
  account.

### Launch states
- **DT-13** Splash (DT-Splash / DtF-Launch-1): h1 "Opening your workspace…". The lines, in order:
  - "Signed in as <login>" (done once `me` answers)
  - one line per runnable plan: "Claude Code connected" / "Grok connected" (sage); "Grok needs
    sign-in · you can fix it later" (amber) for needs_login; proposed "Claude Code not found · you
    can fix it later" for needs_install. A plan the user turned off shows no line, and Codex shows
    no line.
  - "Loading your teams…" (spinner) until `GET /api/teams` answers

  The splash never blocks on a plan problem.
- **DT-14** Offline (DT-Offline / DtF-Off-1): h1 "Can't reach Tvashtr"; "Your teams, runs and
  documents are stored on Tvashtr's servers, so the app needs a connection to open them. Nothing on
  this Mac was changed."; **Try again**; **Check service status**. The detail line is mono
  "<api host> · <reason> · tried 3 times", where the reason is "no response after 10 s" (timeout),
  proposed "couldn't connect" (proxy 502/504) or proposed "answered with an error (<status>)"
  (other 5xx or `db: down`).
  - **Try again** reruns DT-2 step 1.
  - The app also retries by itself when the OS reports it is back online (`online` event).
  - **Check service status** opens `<api origin>/health` in the browser (OQ-8).
- **DT-15** Reconnected (DtF-Off-2): after a successful retry, h1 "Reconnected" with ✓ "Connected",
  ✓ "Signed in as <login>", ◌ "Loading your teams…", then Home (or DT-Expired / Welcome by the DT-2
  rules).

### Setup frame
- **DT-16** Rail copy:
  - "Set up Tvashtr Desktop" and "About 2 minutes. You can change all of this later."
  - steps "Sign in"/<login>, "Engines"/"How agents run here", "Project"/"Where teams work", "First
    team"/"Start from a template"
  - "Signed in as **<login>**" and **Switch**

  Step states are done (check), current (boxed, coral number) and later (outlined). Steps are not
  clickable. The list uses `aria-current="step"`.
- **DT-17** Setup is per Mac and per account. The current step, the plan consent, the project choice
  and "finished" are saved on this Mac through the bridge (DB-4), so quitting mid-setup resumes at
  the same step. Setup pages have addresses `#/setup/engines`, `#/setup/project` and `#/setup/team`
  (Desktop only; on the website they go to Home).
- **DT-18** Footer: **Back** goes to the previous step. On Engines (the first step after sign-in) it
  is rendered disabled (OQ-15). **Skip for now** appears only on Engines. **Continue** / **Create
  team** follow DT-27 (Engines), DT-32 (Project) and DT-36 (First team).

### Setup step 2: Engines
- **DT-19** h1 "How should your agents run?"; lede "We looked for AI tools on this Mac. Your plan is
  used first; API keys are the backup." (Mac becomes "computer" off macOS, DT-50.) Status comes
  from `engines.getStatus()` + `onStatus` (bridge), never from the server mirror.
- **DT-20** Claude Code row, by state:
  - connected: success dot "Connected"; "Found on this Mac · signed in with your Claude plan · covers
    anthropic/* models"; Switch "Use my plan" (on); sage border.
  - needs_install: neutral "Not installed"; "Install it and sign in once to use your Claude plan";
    tint sm **Set up** (opens DT-25).
  - needs_login (proposed, mirrors Grok): warning dot "Needs sign-in"; "Found on this Mac · not
    signed in · covers anthropic/* models"; tint sm **Sign in to Claude**; amber border.
  - api_key (proposed, ENG-35 wording): info "On an API key"; "Found on this Mac · signed in with an
    API key, not your Claude plan"; tint sm **Sign in with your plan**.
  - error (proposed, ENG-37): danger dot "Error"; "Couldn't check Claude Code. Try again."; ghost sm
    **Check again**.
  - turned off (Switch off, OQ-17): neutral "Not used"; "Tvashtr won't run agents on your Claude
    plan. Turn this on to use it again."; Switch off.
- **DT-21** Grok row, by state:
  - needs_login: warning dot "Needs sign-in"; "Found on this Mac · not signed in · covers xai/*
    models"; tint sm **Sign in to Grok**; amber border.
  - connected: success dot "Connected"; "Found on this Mac · signed in with your Grok plan · covers
    xai/* models" (OQ-10 replaces "SuperGrok"); Switch "Use my plan".
  - needs_install: neutral "Not installed"; "Install the Grok CLI to use your Grok plan"; **Set up**,
    ghost sm when another row already offers a tint action, else tint (DtF-Key-1 vs Claude-1),
    opening the Grok variant of DT-25 (OQ-18).
  - off / error / api_key: as DT-20 with Grok names.
- **DT-22** Codex row: info "Status only" (no dot).
  - Not installed: "Not found. Tvashtr can show its status, but can't run agents on it yet." and a
    ghost sm **How to install**, which opens `https://developers.openai.com/codex` externally.
  - Installed (proposed): "Found on this Mac. Tvashtr can show its status, but can't run agents on it
    yet." with no button.
- **DT-23** Sign in to Grok (DtF-Run-4):
  - Call `engines.connect("grok")`, which opens Terminal running the vendor's own login.
  - The Grok row turns to info dot "Checking…", "Finish signing in in the Terminal window" and a
    ghost sm **Cancel**.
  - The app dims its content with the scrim and shows the strip "We opened Terminal for you. Finish
    signing in to Grok there; this updates on its own." with **Cancel**, at the design's position
    (OQ-33).
  - The status updates on its own: the bridge re-probes when the Tvashtr window regains focus and
    pushes `onStatus`. The overlay closes when Grok turns connected, needs_install or error.
  - Either **Cancel** calls `engines.cancelConnect("grok")`, closes the overlay and restores the
    previous row state. It can't close Terminal and doesn't say it does.
  - Claude uses the same flow ("Sign in to Claude", "Finish signing in to Claude there; this updates
    on its own.").
- **DT-24** "Use my plan" Switch: off calls `engines.disconnect(p)` (sticky across relaunch; the row
  becomes the "turned off" state); on calls `engines.connect(p)`. Turning it on connects at once if
  the CLI is still signed in with the plan, else it follows DT-23. Keyboard: Space toggles.
- **DT-25** The "Use your Claude plan" sheet (DtF-Claude-2), exact copy as in §1. **Open install
  guide** opens the harness `INSTALL_URL` (Anthropic's Claude Code docs) externally. **Check again**
  calls `engines.refresh("claude")`:
  - not found: the footer note stays "Not found yet"
  - found and signed in with the plan: close the sheet; the row turns Connected; toast "Claude Code
    found · using your Claude plan" (DtF-Claude-3)
  - found but not signed in (proposed): footer "Found. Sign in once (step 2), then check again."
  - found on an API key (proposed): footer "Found, but signed in with an API key. Sign in with your
    Claude plan, then check again."

  **Close** and the × close the sheet without changes. The Grok variant (OQ-18): title "Use your
  Grok plan", subtitle "Tvashtr runs Grok on this Mac for you", "Install the Grok CLI" / "Follow
  xAI's install guide for Mac." (Grok `INSTALL_URL`), command `grok login`, "Tvashtr looks for it
  again and uses your plan for xai/* models.", "You sign in inside Grok, not in Tvashtr. Tvashtr
  never sees your login."
- **DT-26** API keys row: "API keys — Works everywhere, including the website. Pay the provider per
  use." with **Use an API key instead**, which opens the setup variant of the Add-key sheet
  (DtF-Key-2).
  - Sheet copy: title "Add an API key", subtitle "Works on Desktop and on the website", fields
    Provider / API key, the note "Saved encrypted on your account. After you save, you'll only see
    •••• and the last 4 characters.", footer note "Pay the provider per use", **Cancel**, **Save
    key**. Provider hint "Covers models that start with <p>/, like <example_model>."
  - Pre-pick: the provider of the first plan that can't run here (Claude not usable → `anthropic`;
    else Grok → `xai`; else nothing).
  - Save: `POST /api/providers`. Errors follow ENG-71–73.
  - **NVIDIA NIM rule:** NIM appears in the provider list disabled, with the hint "NVIDIA NIM serves
    no model Tvashtr can run right now." It can't be picked. The same rule applies to any directory
    entry with `serves_models: false`.
  - After a save, the row becomes the saved state (DtF-Key-3): a sage check and "<p> key saved ·
    •••• <last4>". Several keys: "<p1>, <p2> keys saved". **Manage keys** reopens the sheet
    (OQ-21).
- **DT-27** Consent: Checkbox "I understand: Tvashtr runs my own Claude Code and Grok on this Mac. I
  sign in inside those tools, and Tvashtr never sees my login. Usage counts against my plan.", then
  "Tvashtr isn't affiliated with or endorsed by Anthropic or xAI."
  - **Continue** is enabled when there is at least one way to run: (a plan in use, i.e. connected
    with "Use my plan" on, **and** the box ticked) or (no plan in use and ≥ 1 saved key). This
    matches Run-5 (ticked → on), Claude-3 (plan, unticked → off) and Key-3 (key only, unticked →
    on).
  - A plan in use with a saved key still needs the box ticked.
  - Ticking is saved on this Mac with a time (DB-4).
  - **Skip for now** goes to step 3 with nothing set up (runs are later blocked by the launch gate,
    as today).
- **DT-28** Toasts on setup screens sit at the design position (bottom 90px, in the main column),
  not the window-centre default (OQ-32).

### Setup step 3: Project
- **DT-29** h1 "Where should your teams work?"; lede "Agents read and change code here. They work on
  a new branch and ask you before anything is merged." Three radio cards in one radiogroup (arrow
  keys move; Space selects), exact copy as in §1. The first time, "A folder on this Mac" is
  preselected.
- **DT-30** Folder card states:
  - (a) No folder: secondary sm **Choose folder…** → `repos.pickFolder()` → `repos.inspect(path)`.
  - (b) A git repo: the folder row shows `displayPath`, sage "git repo · branch <current_branch> ·
    <owner/repo>" (from `remote_url` on GitHub, else "git repo · branch <b>" or "… · no remote
    yet"), and **Change** (pick again).
  - (c) Not a repo: the amber box "<displayPath> isn't a git repository. Teams track and review
    their changes with git." with **Set up git here** (`repos.initGit`, DB-5) and **Choose another
    folder**.
  - (d) After git setup: "git set up · branch main · no remote yet" and **Change**.
  - A folder *inside* a repo, a missing folder or a detached HEAD shows the inspect `error` text in
    the same amber box with only **Choose another folder**.
  - Git missing shows "Git isn't installed on this computer, or Tvashtr can't find it."
- **DT-31** "A GitHub repository" selected (not designed; OQ-19): the card expands with a repo select
  from `GET /api/github/repos`. With no repos it shows a secondary sm **Connect GitHub**
  (`github_manage_url`, the existing in-window App install).
- **DT-32** **Continue**: folder card → needs a git folder (states b/d); GitHub card → needs a repo;
  "Decide when I launch a run" → always. Git-1's enabled Continue with no folder is a design slip
  (OQ-20). On Continue: save the choice on this Mac (DB-4) and, for a folder, `repos.recent.add`
  it, so the Home composer lists it first.

### Setup step 4: First team
- **DT-33** h1 "Start with a team"; lede "Pick a starting point. You can change every role, prompt
  and model on the canvas." (honest-copy fix of "It opens on the canvas…", OQ-12).
- **DT-34** Three radio cards, exact copy as in §1:
  - "Plan, build, review" + "Recommended" (template `review_loop`)
  - "Spec only" (new template `spec_only`, §3)
  - "Blank canvas" (`blank`, with the copy "Start with one agent and add your own.", OQ-11)

  The first is preselected.
- **DT-35** Each strip chip shows a display name: `pm` → "Product manager", gate → "You approve",
  `engineer` → "Engineer", `reviewer` → "Reviewer", ship → "Ship PR". Under a model node sits the
  label for where it will run: "Claude plan" / "Grok plan" when its model's provider maps to a plan
  in use on this Mac, else "API key" when a key covers it, else "Needs setup". The labels come from
  `GET /api/templates?for=desktop` (§3), so the strip shows what **Create team** will actually
  stamp.
- **DT-36** Input "Team name", prefilled "My first team" (OQ-13). **Create team** →
  `POST /api/teams {template, name, use_plans: true}`.
  - A 422 "A team name is required." shows under the field.
  - Other failures show the form error "Couldn't create the team — is the backend running? Try
    again."
  - On success: mark setup finished for this account on this Mac, then go to Home (DT-Ready).
- **DT-37** When the account already has ≥ 1 library team, step 4 is skipped. The rail shows it as
  done with the subtitle "You have teams already", and Project's **Continue** finishes setup →
  Home (OQ-14).

### Ready and Home
- **DT-38** After setup, and on later launches while the account has **no runs**, Desktop Home shows
  the ready card in place of the get-started checklist. The heading is "You're set up. Give your
  team its first job." in the session that finished setup, else "Welcome back. What's next?"
  (Launch-2). Once the account has a run, Desktop Home is the normal Home (round-1 `HomeMain`).
- **DT-39** Chips (sage check-circle, 12.5px), each data-driven:
  - "Signed in as <login>"
  - one of "Claude and Grok plans connected" / "Claude plan connected" / "Grok plan connected" /
    "<p> key saved" / "<p1>, <p2> keys saved"; the chip is hidden when nothing can run (the Engines
    fix lives in Engines, as Launch-2's title says)
  - the target: folder `displayPath` / `owner/repo` / hidden for "decide at launch"
  - the team name (the newest library team)
- **DT-40** Input label "What should <team> build?", empty with placeholder "Describe what to build".
  - **Launch** is disabled while empty. It launches with the Home composer's launch path:
    `desktop_target: true`. A folder target runs `repos.prepareRun({path, baseRef:
    current_branch})`, then `POST /api/runs {…, local_repo}`. A GitHub target sends
    `github_repo`. "Decide at launch" moves focus to the full composer with the team and idea
    filled.
  - Success → the run on the canvas. Errors use the composer's existing messages.
  - **Open the canvas first** → `#/teams/<id>`.
- **DT-41** "When you're ready" cards: "Add a domain — Give agents your docs, with sources." →
  Domains (add); "Add tools — GitHub, Linear, web fetch and more." → `#/toolkit/tools/browse`; "Try
  another template — Spec only, or build your own." → the New team dialog.
- **DT-42** Ready/Update use the round-1 Shell as is (⌘K button, badges, section foot). The design's
  simplified shell is not rebuilt (OQ-28).

### Update
- **DT-43** Desktop compares its running version (`app.getInfo().version`, from
  `desktop/package.json`) with the latest GitHub release (`GET /api/desktop/release`, §3). It checks
  after launch and every 6 hours, as a numeric semver compare. When the release is newer, the
  bridge downloads it in the background (DB-6). Only once the download is staged does the nav foot
  show the update card, on every dashboard page (replacing that section's foot): **"Update ready ·
  <version>"**, "Restarting stops running teams. <n> run is going." and **Restart to update**.
- **DT-44** Run count: the user's runs in status group `running` with `desktop_target: true` (from
  `GET /api/runs?status=running`). Copy: "1 run is going." / "<n> runs are going." / proposed "No
  runs are going." for 0.
- **DT-45** **Restart to update** runs `update.restartToUpdate()`. The app shows DtF-Upd-2: h1
  "Updating Tvashtr…", ◌ "Installing <version>", and ⓘ "Your running team will resume from its last
  step" (shown only when n > 0).
  - Main releases in-flight Desktop jobs back to the queue (§3 job release), so the relaunched app
    re-claims them and each runs its step again.
  - It swaps the app bundle and relaunches into the new version.
  - The unsaved-changes guard still applies: "Keep editing" cancels the restart.
- **DT-46** When an in-app update isn't possible (the app isn't in a writable location such as
  /Applications, the download failed, or the swap failed), the card reads "Update available ·
  <version>", "Download it, quit Tvashtr, then drag the new Tvashtr to Applications." with a primary
  sm **Download update**. That button opens the stable link
  `…/releases/latest/download/Tvashtr-mac.dmg` (`DESKTOP_MAC_DMG_URL`) in the browser. Below it the
  one-line fix: "If macOS says Tvashtr is damaged, run: `xattr -dr com.apple.quarantine
  /Applications/Tvashtr.app`" (**deviation, session rule**).

### Cross-cutting
- **DT-47** "Signed in as <login>" everywhere uses `UserOut.display_name`; the Avatar uses its
  initial with `accent`.
- **DT-48** Sign-in toasts: "Signed in as <login>" (after a browser sign-in), "Signed in from your
  browser" (after a handoff), "Claude Code found · using your Claude plan". Dark, one line, check
  icon, auto-dismiss about 6 s (ENG-79).
- **DT-49** Deep links while signed out or mid-setup: the target from
  `navigation.consumePending()` / `onNavigate` is kept. After sign-in, first-run setup runs first and
  the target opens when setup finishes. On later launches the app goes straight to the target. The
  renderer subscribes once at the root (the F0 gap). A `connect` param only highlights a card.
- **DT-50** Surface wording: "this Mac" when `tvashtrDesktopInfo.platform === "darwin"`, else "this
  computer". (Desktop ships for Mac only; this keeps dev runs honest.)
- **DT-51** External links (Help, Privacy, Check service status, How to install, Open install guide,
  Download update) open in the default browser through the existing `setWindowOpenHandler` →
  `shell.openExternal`.
  - Help → `https://github.com/lazyxgenius/Tvashtr/blob/main/docs/desktop-v1.md`.
  - Privacy → the privacy page the website area ships (NEEDS_HUMAN for its text, OQ-9).
- **DT-52** Retire the per-session `DesktopDisclosure` banner once DT-27 ships. The consent moves
  into setup, and the disclosure stays on Engines › Subscriptions (ENG-45).
- **DT-53** Accessibility:
  - radio cards use `role="radiogroup"`/`radio` + `aria-checked` with roving tab index
  - the step list uses `aria-current="step"`
  - sheets are `role="dialog"` with labels, trap focus, close on Escape and return focus
  - the Run-4 overlay is `role="dialog"` "Signing in to Grok", with Escape = Cancel
  - status checklists are `role="status"` lists
  - badges carry text

---

## 3. Backend gap table

| ID | Needs | Status | Where / proposal |
|---|---|---|---|
| DT-6–10 | Sign in from the **system browser** and hand the session to Desktop | **MISSING** | Public router `routes/desktop_public.py`, mounted in `main.py` **without** `get_current_user` (like `auth_router`). Logic in new `control_plane/desktop_auth.py`. PKCE, **stateless** (itsdangerous, own salts): (1) `GET /api/auth/desktop/start?challenge=&state=&account=current\|github`: `challenge` = base64url(SHA-256(verifier)), `^[A-Za-z0-9_-]{43}$`; `state` `^[A-Za-z0-9_-]{16,64}$`. If `account=current` and this browser request carries a valid `tv_session`, return 200 with the **return page** (below). Otherwise 302 to `github.com/login/oauth/authorize?client_id=…&redirect_uri=<public_base_url>/api/auth/github/callback&state=<signed {"c":challenge,"s":state}, salt tv-desktop-state, 15 min>`. 404 when `hosted_mode` is off; bad params → 400 HTML page "This sign-in link is broken. Go back to Tvashtr Desktop and try again." (2) `/api/auth/github/callback` (changed in place, additive): when `state` verifies as a desktop state, do the normal find-or-link + browser cookie, then return the **return page** with link `tvashtr://auth/done?code=<signed {"u":user_id,"c":challenge}, salt tv-desktop-code, 5 min>&state=<s>`. With `error=access_denied` → return page with `tvashtr://auth/done?error=cancelled&state=<s>`. Without a desktop state it behaves as today. (3) `POST /api/auth/desktop/exchange {code, verifier}` (verifier `^[A-Za-z0-9._~-]{43,128}$`): verify the code (≤ 5 min) and `base64url(sha256(verifier)) == c`, load the user, `set_session_cookie`, 200 `UserOut`. Errors: 400 `{"detail":"This sign-in has expired. Sign in again."}` (bad/expired code or unknown user); 400 `{"detail":"This sign-in belongs to another app window. Sign in again."}` (verifier mismatch). The code names exactly one user and is useless without the verifier held by Desktop main, so nothing is readable across accounts. Tests: happy path both branches, cancel, expiry (seam `max_age`), verifier mismatch, self-hosted 404, open-redirect safety (the return link is always `tvashtr://auth/done`) |
| DT-6 | The page the browser shows after sign-in | **MISSING** (not designed; OQ-3) | Server-rendered minimal HTML from `control_plane/desktop_auth.py::return_page(link, outcome)`. Design tokens inline; auto-fires `location = link` once. Copy (proposed): success "You're signed in" / "Go back to Tvashtr Desktop to continue. You can close this tab." + button **Open Tvashtr Desktop** (the link). Cancel: "Sign-in cancelled" / "Nothing was changed. Go back to Tvashtr Desktop." `Cache-Control: no-store`, `Referrer-Policy: no-referrer` |
| DT-5, 8, 11, 13, 16, 39, 47 | Who is signed in (`display_name`, `github_login`) | **EXISTS** | `GET /api/auth/me` → `UserOut{id,email,github_login,display_name}` |
| DT-11 | Session ended | **EXISTS** | Any 401 (14-day signed cookie). "Last signed in as" is remembered on the Mac (DB-1), not server data |
| DT-12 | Sign out | **EXISTS** | `POST /api/auth/logout` 204 (cookie cleared; the loopback proxy rewrites it) |
| DT-2, 14, 15 | Is Tvashtr reachable | **EXISTS** | `GET /health` → `{status, db}` (pings Postgres, so a Neon cold start counts as up once it answers). The 10 s × 3 rule is client-side. `/healthz` is process-only; don't use it for this screen, because a DB outage also means "can't open your teams" |
| DT-13, 19–24 | Plan status | **EXISTS** (bridge) | `engines.getStatus/onStatus/connect/disconnect/refresh/cancelConnect` (bridge v5). The server mirror (`GET /api/engines/subscriptions`) is not used on Desktop screens |
| DT-26, 39 | Keys: list, save | **EXISTS** | `GET/POST /api/providers` (B-ENGINES: `replaced`, `updated_at`, 422 copy) |
| DT-26 | NIM serves no model → don't invite a key | **PARTIAL** (shared with ENG) | `public_provider_directory()` still offers `nvidia_nim`. Add per entry `serves_models: bool` (true when the catalogue has any seat default, or the provider is an embeddings provider) and, when false, `hint: "NVIDIA NIM serves no model Tvashtr can run right now."` Additive to `/api/config.provider_directory`. Test: every catalogue provider with both seats `None` and no embeddings has `serves_models: false` |
| DT-31 | GitHub repos for the Project card | **EXISTS** | `GET /api/github/repos` (owner-scoped), `GET /api/github/status`, `/api/config.github_manage_url` |
| DT-30, 40 | Folder runs | **EXISTS** | `POST /api/desktop/repo-snapshots`, `POST /api/runs {local_repo}`, `GET /api/runs/{id}/ship-bundle` (B-LOCAL) |
| DT-34, 35 | "Plan, build, review", "Spec only", "Blank canvas" with **where each node will run** | **PARTIAL** | `GET /api/templates` (routers.py, session) gains `?for=desktop`. With it: (a) the list also includes `spec_only` (only with `for=desktop`, so Home's New-team dialog keeps its designed four cards); (b) each `shape.nodes[]` gains `model` (slug or null) and `runs_on` (`"claude"\|"grok"\|"api_key"\|null`), computed for **this owner** by the same function the builder uses (next row) from the owner's mirror rows (`connected`) and held keys. Response example node: `{"id":null,"kind":"thinker","role":"pm","label":"PM","model":"xai/grok-4.7","runs_on":"grok"}`. Nothing else changes; without `for` the response is byte-identical |
| DT-34 | A "Spec only" team | **MISSING** | New builder `build_spec_only_team` in `control_plane/teams.py` + a `TeamTemplate("spec_only", "Spec only", "Turns an idea into a reviewed spec. No code changes.", roles=("pm","reviewer","stop"), loops=((1,0),))`. Nodes: entry PM (completion, as the other builders) → Reviewer (`kind="agent"`, `edits_allowed=False`, verdict-emitting, prompt "review the spec against the idea") → a `terminal_kind: "stop"` terminal on approve; "changes requested" loops back to the PM (bounded by the existing loop cap). **No Ship node**, so no PR. `POST /api/teams {template:"spec_only"}` is accepted from any surface. Tests: shape equals `team_shape`; a fake-adapter run ends `completed` at the stop terminal with the spec document kept and `pr_url` null |
| DT-35, 36 | New teams on Desktop use the **plans** that are in use | **MISSING** | `POST /api/teams` (`CreateTeamRequest`) gains optional `use_plans: bool = false` (additive). When true: `create_team_from_template` / the blank builder pass `plans = {p for p in mirror rows of this owner if connected and p in ("claude","grok")}`. New pure helper `plan_first_models(roles, plans, held_providers)` (unit-tested). Mapping: claude → catalogue `anthropic` default; grok → `xai` default. Both plans: the worker seat prefers Claude and the thinker seat prefers Grok, and a **reviewer always uses the other vendor than the node it reviews** (Plan, build, review: PM Grok · Engineer Claude · Reviewer Grok; Spec only: PM Grok · Reviewer Claude, exactly the design's labels). One plan: every model node uses it. No plan: today's BYOK defaults, unchanged. `fallback_model` is still stamped from held keys (`_stamp_account_defaults`). Response unchanged. **Risk to verify in the slice:** the entry (PM) node on an `xai/…` model is routed to the Desktop runner like agent nodes, and the Phase-1 REPORT.md fallback covers a Grok PM |
| DT-43 | The latest Desktop release | **MISSING** | `GET /api/desktop/release`, public (no user data; like `/api/config`), in `routes/desktop_public.py`. Logic in new `control_plane/desktop_release.py`: GitHub `GET /repos/{desktop_release_repo}/releases/latest`; if its `tag_name` isn't `desktop-v*`, take the first non-draft, non-prerelease `desktop-v*` from `/releases?per_page=20`. Cached in process for 10 min; 3 s timeout; never raises. Response 200 `{"version":"0.6.0","tag":"desktop-v0.6.0","published_at":"2026-09-30T10:12:00Z","dmg_url":"https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg","release_url":"https://github.com/lazyxgenius/Tvashtr/releases/tag/desktop-v0.6.0","checked_at":"…"}`. When GitHub can't be reached: the same keys with `version`, `tag`, `published_at` and `release_url` null. `dmg_url` is **always** the stable link (session rule). New setting `desktop_release_repo` (default `lazyxgenius/Tvashtr`). Tests with the HTTP call monkeypatched: tag filter, cache, failure → nulls. The website's download pages can use the same endpoint |
| DT-44 | "<n> run is going" | **EXISTS** | `GET /api/runs?status=running` rows carry `desktop_target`; count on the FE |
| DT-45 | "Your running team will resume from its last step" | **MISSING** | `POST /api/desktop-runner/jobs/{job_id}/release` in `desktop_runner_routes.py` (session, owner-scoped: an unknown or other owner's job → 404 `{"detail":"job not found"}`; a job that isn't `claimed` → 409 `{"detail":"This job isn't running on Tvashtr Desktop."}`). Logic `desktop_jobs.release_job(owner_id, job_id)`: `claimed → queued`, `claimed_at` and `heartbeat_at` set to null, one node event "Tvashtr Desktop restarted — this step starts again when it's back." → 200 `{"job_id":"…","status":"queued"}`. The relaunched runner re-claims it (`claim_next` is unchanged). If Desktop doesn't come back within `desktop_runner_offline_seconds`, the adapter's existing queued rule fails the node with `OFFLINE_ERROR`, as today. It also stops a killed job from blocking that provider for 2 minutes after every restart. No DBOS step changes (the adapter only reads job rows). Tests: owner scoping, 409, re-claim after release, the offline rule still fires |
| DT-2, 17, 27, 32 | Setup progress, consent, project choice, "finished" | **not backend** | Stored on this Mac through the bridge (DB-4). The folder path must never go to the server |
| DT-38 | "Has the account got runs yet" | **EXISTS** | `GET /api/runs?limit=1` (or team summaries' `run_count`) |

### Schema needs

None from this area. Every candidate is avoidable, so this area asks **nothing** of migration
`0042`:

| Candidate | Why it came up | Avoidable without schema? |
|---|---|---|
| `desktop_logins` table (pending challenge → user) | Browser-to-app sign-in (DT-6) | **Yes.** The code and the OAuth state are signed, short-lived itsdangerous payloads; PKCE binds the code to the Desktop that holds the verifier, so no server row is needed |
| One-time handoff tokens | "Continue as" (DT-10) | **Yes.** Designed away: the handoff reuses the same PKCE start with `account=current`; no bearer token ever rides a deep link |
| `users.preferences.desktop_setup_done` / consent timestamp | Setup completion (DT-17, DT-27) | **Yes.** Setup is per Mac ("on this Mac"), so it lives in Desktop `userData`. If the operator later wants it per account, it's a whitelisted key in the existing `users.preferences` JSONB, not a column |
| Default workspace per account | Project step (DT-32) | **Yes.** It is a local path, stored on the Mac only (and in `recent-folders.json`) |
| Latest-release cache table | Update check (DT-43) | **Yes.** In-process cache |
| `desktop_node_jobs.release_count` | Bounding re-claims (DT-45) | **Yes.** Release only happens on quit/restart, not on failure; the existing offline rule bounds the wait |
| `team_graphs.template_key` for `spec_only` | New template | **Exists** (TEXT column, 0041) |

---

## 4. Desktop bridge gaps

Today (bridge v5, `docs/superpowers/plans/api/desktop-bridge.md`): `engines.{getStatus, connect,
disconnect, refresh, cancelConnect, onStatus}`, `navigation.{onNavigate, consumePending}`,
`repos.{pickFolder, inspect, recent.*, prepareRun, bringBackBranch}`,
`app.setUnsavedChanges`, and `tvashtrDesktopInfo = {shell, version: 5, platform}`. Everything
below is **v6**, additive, gated by `isAppPage` like v5, and optional in `vite-env.d.ts`.

- **DB-1: `auth`, browser sign-in with PKCE** (new `electron/auth/desktopSignIn.cjs` and
  `electron/auth/lastUser.cjs`, plus `node --test`).
  ```ts
  auth.startSignIn(opts?: { account?: "current" | "github" }): Promise<{ signInUrl: string }>
  auth.reopenBrowser(): Promise<void>          // same URL, restarts the 10-min clock
  auth.cancelSignIn(): Promise<void>
  auth.onSignIn(cb: (e:
      | { state: "waiting"; signInUrl: string }
      | { state: "signed_in"; user: { id: string; email: string; github_login: string | null; display_name: string } }
      | { state: "failed"; reason: "timeout" | "cancelled" | "expired" | "exchange_failed"; message: string }
    ) => void): () => void
  auth.getLaunchContext(): Promise<{ openedFromWeb: { login: string; host: string } | null;
                                      lastUser: { login: string; displayName: string } | null }>
  auth.forgetUser(): Promise<void>             // Switch / sign out
  ```
  - Main makes the verifier (32 random bytes, base64url), the challenge (SHA-256), and a state
    (24 bytes). It opens `${apiOrigin}/api/auth/desktop/start?…` with `shell.openExternal` and
    starts a 10-minute timer.
  - It handles `tvashtr://auth/done` itself: never queued to the page, and the state must match the
    pending sign-in or the link is ignored.
  - It exchanges the code through the loopback proxy (`POST ${localOrigin}/api/auth/desktop/
    exchange`), reads the proxy-rewritten `set-cookie`, and stores it with
    `session.defaultSession.cookies.set({url: localOrigin, name: "tv_session", …})`. Then it saves
    `lastUser` (login + display name only, `userData/last-user.json`), focuses the window and emits
    `signed_in`.
  - The verifier never leaves main.
  - Tests: PKCE shape, state mismatch ignored, timeout → `failed:timeout`, `error=cancelled` →
    `failed:cancelled`, cookie set on the loopback URL (fake session), lastUser round trip.
- **DB-2: `deepLink.cjs` additions.**
  - Accept `tvashtr://auth/done?code=&state=` and `?error=cancelled|expired&state=`. These are
    returned as `{kind:"auth", …}` to main only; the page never sees codes.
  - Accept an optional sign-in **hint** on every allowed link: `from=web` +
    `login=^[A-Za-z0-9-]{1,39}$` + `host=` (allow-listed to the configured API host). Main keeps it
    as `openedFromWeb` for `auth.getLaunchContext()`; it is not a navigation param.
  - Tests for each accepted and rejected form.
  - Website side (the F2/website areas): every `tvashtr://` link the signed-in website fires
    (ENG-48 "Open Tvashtr Desktop", `WbF-*` "Open app") appends `?from=web&login=<github_login>`.
- **DB-3: `app.getInfo()`.**
  - Signature: `app.getInfo(): Promise<{ version: string; apiOrigin: string; apiHost: string;
    platform: string; bundlePath: string | null; bundleWritable: boolean }>`.
  - `version` = `app.getVersion()` (from `desktop/package.json`), for the foot and the update
    compare.
  - `apiHost` feeds the offline detail line (the page only sees the loopback proxy).
  - `bundleWritable` chooses between the in-app update and the manual fallback.
- **DB-4: `setup`, per-Mac, per-account setup state** (`electron/setupStore.cjs`, in
  `userData/desktop-setup.json`, keyed by account id).
  - `setup.get(accountId): Promise<DesktopSetup>` and `setup.update(accountId, patch):
    Promise<DesktopSetup>`.
  - `DesktopSetup = { version: 1; step: "engines" | "project" | "team" | null; finishedAt: string |
    null; planConsentAt: string | null; workspace: { kind: "folder"; path: string; displayPath:
    string } | { kind: "github"; repo: string } | { kind: "ask" } | null }`.
  - Paths are validated like `repos.*`. Why not `localStorage`: the loopback port can change
    (`listenPrefer` walks 5178…5198), and localStorage is per origin, so it would be lost.
- **DB-5: `repos.initGit({path}): Promise<{ branch: "main"; commit: string; file_count: number }>`**
  (`electron/repos/initGit.cjs`).
  - Steps: `git init -b main`, `git add -A` (honours any `.gitignore`), then `git commit -m
    "Start tracking with Tvashtr"`. The committer is the user's git identity when `user.email` is
    set, else `-c user.name=<login> -c user.email=<login>@users.noreply.github.com`.
  - It refuses (messages the UI shows as is):
    - "This folder is already a git repository."
    - "Choose a project folder, not your home folder." (home dir or `/`)
    - "This folder has more than 20,000 files. Set up git in it yourself, then choose it again."
    - "This folder is empty. Add your project's files, then set up git." (no files)
    - "Couldn't set up git here: <git's first error line>"
  - Git missing reuses the existing message. Tests on temp dirs.
- **DB-6: `update`, check, download, restart** (new `electron/updater.cjs` + tests on temp dirs with
  a fake DMG tree and fake `hdiutil`).
  ```ts
  update.getState(): Promise<UpdateState>;  update.onState(cb): () => void;  update.check(): Promise<UpdateState>
  update.restartToUpdate(): Promise<void>;  update.openDownload(): Promise<void>
  type UpdateState = { state: "idle" } | { state: "downloading"; version: string; progress: number }
    | { state: "ready"; version: string } | { state: "installing"; version: string }
    | { state: "manual"; version: string; reason: "not_writable" | "download_failed" | "swap_failed" }
  ```
  - **Check:** after launch and every 6 h, main calls `GET /api/desktop/release` through its API
    client and compares versions numerically.
  - **Download:** Node `https` fetches `dmg_url` (the stable link, following GitHub's redirect)
    into `userData/updates/`. A Node write sets no quarantine flag. Then `hdiutil attach -nobrowse
    -readonly`, `ditto` `Tvashtr.app` to `userData/updates/Tvashtr.app`, detach. The staged
    `Info.plist` must show the expected version and `dev.tvashtr.desktop`. Then run `xattr -dr
    com.apple.quarantine` on the staged app → `ready`.
  - **Restart:**
    1. Run the unsaved-changes check.
    2. Set state `installing` (the page shows DtF-Upd-2) and run `runner.stop({release: true})`.
    3. Spawn a detached `/bin/sh` helper that waits for this PID to exit, then swaps the bundle
       (move old aside, move staged in, delete old) and `open`s it.
    4. Call `app.exit(0)`.
  - **Fallback:** any failure, a read-only or translocated bundle, or a bundle under `/Volumes` →
    `manual`. `openDownload()` then opens `DESKTOP_MAC_DMG_URL` externally, and the card shows the
    `xattr` line (DT-46).
  - The session rule ("compare the running version with the latest release and offer the
    download") is met either way.
- **DB-7: `runner.stop({release})`.**
  - On quit and on update restart, for each in-flight job: kill the CLI (as today), then POST
    `/api/desktop-runner/jobs/{id}/release` (best effort, 5 s cap).
  - `runner/api.cjs` gains `releaseJob(id)` and `latestRelease()`. Tests in `runner.test.cjs`.
- **DB-8: the renderer wiring F0 skipped.** Subscribe once to `navigation.onNavigate` at the app
  root, and call `navigation.consumePending()` at boot (DT-49). No new bridge.
- **DB-9: title strip.** Renderer only: `DesktopTitleBar` gets its text from a small store
  (`setDesktopTitle("Tvashtr" | "Tvashtr — the living canvas")`) and sets `document.title`.
  `windowOptions.cjs` already starts with title "Tvashtr".
- **DB-10: types and contract.**
  - `vite-env.d.ts` gains `auth`, `setup`, `update`, `app.getInfo`, `repos.initGit`.
  - `tvashtrDesktopInfo.version` goes to 6.
  - `docs/superpowers/plans/api/desktop-bridge.md` gains a v6 section with every error message.
- **DB-11: release notes (install steps, session rule).**
  `.github/workflows/desktop-mac-release.yml`'s body says "right-click the app → Open", which no
  longer gets past "Tvashtr is damaged". Replace it with "Drag Tvashtr to Applications, then run
  `xattr -dr com.apple.quarantine /Applications/Tvashtr.app` once in Terminal." Report it as a
  deviation.
- **Existing, keep:**
  - The Connect → Terminal login and the focus re-probe (`engineController.cjs`).
  - Sticky disconnect (the "Use my plan" switch).
  - `cancelConnect`, `repos.pickFolder` and `inspect`, `recent.add`.
  - `setWindowOpenHandler` → `shell.openExternal` for external links.
  - The in-window GitHub **App install** flow and `rewriteGithubInstallUrlForDesktop` (Toolkit and
    the composer still use them). Only **sign-in** moves to the browser.

---

## 5. Frontend mapping

**Today:**
- `main.tsx` renders `DesktopTitleBar` + `AuthGate` + `DesktopDisclosure`.
- `AuthGate` shows "Loading…", then `LandingPage` / `AuthWizard` (in-window GitHub) or `Workspace`.
  A network failure also lands on the landing page, and a 401 mid-session drops to the landing page.
- `Shell` hides "Download Tvashtr Desktop" on Desktop. `HomePage` chooses `FirstTimeHome` or
  `HomeMain`.
- No Desktop-only screens exist.

**New folder `frontend/src/pages/desktop/`**, one screen per file (the repo's one-screen-one-file
rule), CSS in `pages/desktop/desktop.css`:
- **`DesktopGate.tsx`:** the launch state machine (DT-1/2/11/15/49) used by `AuthGate` when
  `isDesktopApp()`. It owns splash → offline/expired/welcome/handoff → setup/workspace, the pending
  deep link, and the 401 seam (→ Expired).
- **Launch frame:** `LaunchFrame.tsx` (title "Tvashtr", wash, centred column, foot with version,
  Help and Privacy), used by `WelcomePage.tsx` (Welcome + Handoff variant), `WaitingPage.tsx`,
  `SignInFailedPage.tsx`, `ExpiredPage.tsx`, `OfflinePage.tsx`, and `LaunchStatusPage.tsx` (the
  checklist card for Splash, Reconnected and Updating).
- **Setup:**
  - `setup/SetupFrame.tsx` (rail + footer)
  - `setup/EnginesStep.tsx`, `setup/PlanRow.tsx` (the Claude/Grok/Codex row state machine, DT-20–24)
  - `setup/TerminalSignInOverlay.tsx` (Run-4), `setup/UsePlanSheet.tsx` (Claude and Grok variants)
  - `setup/ProjectStep.tsx`, `setup/TeamStep.tsx`, `setup/TemplateStrip.tsx`
- **Home variant:** `pages/home/DesktopReadyCard.tsx` (DT-38–41; owned by this area and rendered by
  `HomePage` on Desktop while the account has no runs, instead of `FirstTimeHome`).
- **Shell part:** `pages/shell/UpdateCard.tsx` (DT-43–46; rendered in `NavFoot` on Desktop when the
  update state isn't idle).
- **Plumbing:** `lib/desktopApp.ts` (typed, optional-chained wrappers for `auth`, `setup`, `update`,
  `app.getInfo`, `repos.initGit`) and `lib/api/desktop.ts` (`getDesktopRelease`,
  `getTemplates({for:"desktop"})`, `createTeam({…, use_plans})`, `exchange` is main-only). Both
  validate shapes at the boundary.

**Reuse:**
- `design-system/components`: Button (primary/secondary/ghost/tint, sm/md/lg), IconButton, Logo,
  Avatar, Badge (success/warning/info/neutral/danger, dot), Checkbox, Switch, Input, Sheet (520),
  Popover (provider list), ToastProvider (with a placement override for setup, OQ-32), LetterTile
  (C/G/O tiles if the geometry matches, else a local tile).
- `pages/shell/Shell.tsx` (Ready/Update), the Home composer's launch path
  (`pages/home/Composer.tsx`: `prepareRun`, `local_repo`, `desktop_target`) for DT-40, and the
  New team dialog for "Try another template".
- F2's add-key sheet (`pages/engines/AddKeySheet`, or today's `pages/home/AddKeySheet.tsx`) with
  props for subtitle, footer note, pre-pick and the `serves_models` rule. F2's plan-status helpers
  (`lib/engines.ts`: `SubscriptionStatus`, `displayNameForSubscription`, `INSTALL_URLS`).
- `lib/desktopRepos.ts` (`isDesktopApp`, `desktopRepos`), `lib/desktopDownload.ts`
  (`DESKTOP_MAC_DMG_URL` for the fallback), `lib/backendStatus.ts` (`checkBackend`; add a variant
  with a 10 s abort and the failure kind), and `lib/api.ts` (`getMe`, `logout`,
  `setUnauthorizedHandler`, `getConfig`, `listProviders`, `addProvider`).

**Replaces / retires (Desktop only; the website keeps its screens until the website area):**
- `LandingPage` and `AuthWizard` on Desktop.
- `AuthGate`'s "Loading…" div on Desktop.
- `DesktopDisclosure` (DT-52).
- `DesktopTitleBar`'s fixed title (it becomes store-driven).

**Nav / routes (`lib/nav.ts`):**
- Add `{ page: "setup"; step: "engines" | "project" | "team" }` ↔ `#/setup/<step>`. On the website
  `parseRoute` maps it to Home.
- Launch/sign-in screens are **states**, not addresses (they depend on the session).
- Deep-link targets are unchanged; the `from=web` hint is main-only (DB-2).
- `Workspace` redirects to `#/setup/<saved step>` while this Mac's setup for the account isn't
  finished (DT-17).

**Parity (Desktop mode only; no website twin):**
- Scenarios go in `scripts/design-parity/scenarios/desktop-app.mjs`, with a fake bridge (`engines`,
  `auth`, `setup`, `update`, `app.getInfo` returning version `"[version]"` so the foot text matches,
  and `repos`) plus API fixtures (`me` = lazyxgenius, templates `for=desktop`, providers).
- Expected, explained exceptions:
  - Run-4's Terminal window (an OS window, not drawn)
  - Ready/Update's simplified shell (no ⌘K button, no badges, Domains blurb foot; the app keeps the
    round-1 Shell, OQ-28)
  - honest-copy changes (OQ-4, 11, 12) that reflow text
- Every size and type must match: fonts, button sizes (`lg` on Welcome/Expired, `md` in footers,
  `sm` in rows), 420px team-name Input, 520px sheets.

---

## 6. Open questions (each with a proposed decision)

- **OQ-1: sign in in the window or in the browser?**
  - Today's in-window OAuth works, but the design is browser-based throughout (Welcome, Waiting,
    Sign-2, Handoff, Expired).
  - **Decision:** build the browser PKCE sign-in (§3, DB-1), backend first. It keeps the design's
    copy true, lets the user use their browser's GitHub session and password manager, and makes the
    handoff possible.
  - The in-window flow stays only for the GitHub App **install**.
- **OQ-2: how "Continue as lazyxgenius" proves who you are.**
  - A bearer token in a `tvashtr://` link could be taken by any app that registers the scheme.
  - **Decision:** the link carries only a display hint. "Continue as" reuses the PKCE start with
    `account=current`, and the browser's existing tvashtr.fly.dev session answers at once. That
    matches the design's own toast, "Signed in from your browser".
  - No schema, no one-time tokens.
- **OQ-3: what the browser tab shows after sign-in** (not designed).
  - **Decision:** a minimal server page (§3): "You're signed in" / "Go back to Tvashtr Desktop to
    continue. You can close this tab." + **Open Tvashtr Desktop**, and a cancel variant.
  - The website area may restyle it later.
- **OQ-4: "This app runs your agent teams on this Mac" / "Runs happen on this Mac. Quit the app and
  they stop."**
  - Only steps on a Claude/Grok plan run on the Mac; API-key steps run on Tvashtr's servers and
    continue when the app quits.
  - **Decision (honest copy, reported as deviations):**
    - lede: "This app runs your agents on this Mac with your own Claude or Grok plan. Sign in to
      pick up your teams, or to start your first one."
    - card: "Stops when you quit — Steps on your plan run on this Mac. Quit the app and they stop."
- **OQ-5: how "Restart to update" works for an unsigned app.**
  - **Decision:** an in-app updater (DB-6). The download is from the stable `Tvashtr-mac.dmg` link,
    staged, and swapped on restart, so "Update ready", "Restart to update" and "Installing
    <version>" are all true.
  - When that isn't possible, fall back to **Download update** with the manual steps and the
    `xattr` line (DT-46).
  - The version compare uses the bridge version against `GET /api/desktop/release`.
- **OQ-6: "Restarting stops running teams" vs "Your running team will resume from its last step".**
  - **Decision:** keep both lines. Build the job release (§3, DB-7): the step stops, then runs again
    when the new version reopens (within `desktop_runner_offline_seconds`).
  - The resume line shows only when a run is going.
- **OQ-7: what counts as "a run is going".**
  - **Decision:** runs in the `running` group with `desktop_target: true`. Awaiting-approval runs do
    no work, and hosted-only runs aren't affected by a restart.
  - With 0 runs: "No runs are going."
- **OQ-8: "Check service status" has no Tvashtr status page.**
  - **Decision:** open `<api origin>/health` in the browser. It is the service's own live answer,
    and seeing it answer in the browser tells the user the problem is local.
- **OQ-9: Help and Privacy targets.**
  - **Decision:** Help → `docs/desktop-v1.md` on GitHub. Privacy → the same page the website area
    ships for its footer "Privacy" link.
  - **NEEDS_HUMAN:** the privacy statement's text (legal content that neither the design nor the
    product rules can supply). Proposed interim: a factual page written from the code — what is
    stored where (account email and GitHub login, encrypted keys, teams/runs/documents on Tvashtr's
    database; on the Mac: folder paths, plan status and the last login; CLI logins never seen) — for
    the operator to approve.
- **OQ-10: "signed in with SuperGrok".**
  - The Grok CLI exposes no plan name, and the harness must not read `~/.grok`.
  - **Decision (as ENG OQ-10):** "signed in with your Grok plan". Claude keeps the design's generic
    "your Claude plan" too.
- **OQ-11: "Blank canvas — Start empty and add your own agents."**
  - `blank` creates one thinker → Ship.
  - **Decision:** "Start with one agent and add your own."
- **OQ-12: "It opens on the canvas"**, while Create team lands on Home (Run-8).
  - **Decision:** lede "Pick a starting point. You can change every role, prompt and model on the
    canvas." Home then offers **Open the canvas first**.
- **OQ-13: team name default.** The design's "Refund feature team" is sample data.
  - **Decision:** prefill "My first team"; blank → the server's 422.
- **OQ-14: first team when the account already has teams** (the handoff user usually does).
  - **Decision:** skip step 4 and mark it done with "You have teams already".
- **OQ-15: Back on the Engines step** (step 1 is sign-in, already done).
  - **Decision:** rendered disabled. Changing account is **Switch**.
- **OQ-16: when Continue is on.**
  - **Decision (fits every frame):** at least one way to run. A plan in use needs the box ticked; a
    key alone doesn't.
  - Skip for now is always available.
- **OQ-17: what "Use my plan" off means.**
  - **Decision:** sticky disconnect (the bridge v5 behaviour), with the row copy in DT-20.
  - On again reconnects without a Terminal when the CLI is still signed in.
- **OQ-18: Grok "Set up" when not installed** (only Claude's sheet is designed).
  - **Decision:** the same sheet with Grok copy (DT-25) and `grok login`.
- **OQ-19: "A GitHub repository" has no repo picker in the design.**
  - **Decision:** the card expands with a repo select, or **Connect GitHub** when the App covers no
    repos. The choice is saved on this Mac.
- **OQ-20: Git-1 shows Continue enabled with no folder.**
  - **Decision:** disabled until the folder card has a git folder. It is a design slip, and parity
    doesn't measure the disabled state.
- **OQ-21: "Manage keys" in setup.**
  - **Decision:** reopens the Add-key sheet (to add or replace) without leaving setup. Full key
    management is Engines › API keys after setup.
- **OQ-22: what "Set up git here" changes in the user's folder.**
  - **Decision:** it runs `git init -b main` and one first commit of the folder's files. The
    commit is needed because a run bundles a branch.
  - It has guards and identity fallback (DB-5) and never touches a folder that is already a repo.
- **OQ-23: where the project choice lives.**
  - **Decision:** on this Mac only (DB-4 + recent folders). A path never goes to the server, and a
    second Mac asks again.
- **OQ-24: Launch-2 chips contradict Launch-1's Grok warning.**
  - **Decision:** every chip is computed (DT-39). With Grok unconnected, the chip reads "Claude plan
    connected".
- **OQ-25: when the "ready" card shows instead of the normal Home.**
  - **Decision:** Desktop only, until the account's first run. "You're set up…" in the session that
    finished setup, "Welcome back. What's next?" on later launches.
- **OQ-26: Offline detection vs Fly cold starts.** A stopped machine can take several seconds to
  answer.
  - **Decision:** 10 s per try, 3 tries (as the design's detail line says).
  - Auto-retry on the `online` event.
- **OQ-27: templates' model choice on Desktop.**
  - **Decision:** `use_plans` with the reviewer-uses-the-other-vendor rule (§3). That reproduces
    the design's Grok/Claude labels exactly.
  - Show "API key" or "Needs setup" when a plan doesn't cover a node.
- **OQ-28: Ready/Update draw a simplified shell** (no ⌘K button, no badges, "Domains are libraries…"
  foot on Home).
  - **Decision:** keep the round-1 Shell (`Home-Main` is the canonical Home) and explain the
    differences in the parity report.
  - The update card replaces the section foot on every dashboard page.
- **OQ-29: "Spec only" in Home's New team dialog.**
  - **Decision:** served only with `?for=desktop` for now, because Home's designed dialog has four
    templates.
  - `POST /api/teams {template:"spec_only"}` works everywhere.
- **OQ-30: Claude's sign-in command** (the design shows `claude`; the harness runs `claude auth
  login`).
  - **Decision:** keep `claude`. On a fresh install it asks you to sign in, which is what step 2
    says. Connect still uses `claude auth login`.
- **OQ-31: the sign-in clock.**
  - **Decision:** 10 minutes from the last Sign in / Open the browser again / Try again.
  - A code that arrives after Cancel or timeout is ignored, and the user signs in again.
- **OQ-32: toast placement on setup screens.**
  - **Decision:** add a placement option to `ToastProvider` (bottom 90px, centred on the main
    column) used by the setup frame. Elsewhere it stays bottom-centre.
- **OQ-33: Run-4's Terminal picture.**
  - **Decision:** the app draws only the scrim and the status strip, at the design's position below
    where Terminal usually opens. The real Terminal window is the OS's.
- **OQ-34: a signed-out deep link on first run.**
  - **Decision:** setup first, then the link's page (DT-49).
  - `connect=` only highlights, as in v5.
- **OQ-35: "Use a different account".**
  - GitHub may reuse the browser's signed-in GitHub account.
  - **Decision:** start the GitHub path (`account=github`) and promise nothing more. The rail then
    shows who actually signed in.
- **OQ-36: consent storage.**
  - **Decision:** a timestamp on this Mac (DB-4), because the sentence is about "this Mac". No
    server record.
- **OQ-37: a self-hosted backend** (`hosted_mode: false`, dev only).
  - **Decision:** the Welcome frame shows the existing email/password form instead of **Sign in
    with GitHub**. Everything after sign-in is the same.
- **OQ-38: NVIDIA NIM in the setup key sheet.**
  - **Decision:** listed, disabled, with "NVIDIA NIM serves no model Tvashtr can run right now."
    (session rule; `serves_models` from the directory).
  - Never pre-picked.
- **OQ-39: the per-session `DesktopDisclosure` banner.**
  - **Decision:** retire it when the setup consent ships. The disclosure text stays on Engines ›
    Subscriptions.
- **OQ-40: the release-notes install steps.**
  - **Decision:** replace "right-click → Open" with the `xattr` step (DB-11). Reported as a
    deviation per the session rule.

NEEDS_HUMAN (only what the files and the product rules can't answer):
- The **privacy statement** behind the "Privacy" link (OQ-9). The interim proposal is a factual
  "what Tvashtr stores" page for the operator to approve.
