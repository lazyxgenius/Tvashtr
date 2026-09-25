# home-run: redesigned Home + "Start a run / Needs you / Running now" flows (prefix `HOME-`)

Scope: `Home-*.txt` (Main, FullPage, Desktop, BeforeAfter, FirstTime, AllCaughtUp, Loading, Web1024) and flows
`HmF-PickTeam`, `HmF-Idea`, `HmF-PickRepo` (website), `HmF-PickFolder` (Desktop), `HmF-Options`, `HmF-Launch`,
`HmF-Approve`, `HmF-Reject`, `HmF-Retry`, `HmF-FixSetup`, `HmF-Dismiss`, `HmF-AllClear`, `HmF-Stop`.
The Teams grid, Recent runs and the header are covered here only as **what Home displays**. What happens when you
click them (Teams tabs, search, sort and ⋯ menu, run history, New team, ⌘K, account menu, backend down, Recent
runs filter, the 7-screen first-time flow) belongs to the other `HmF-*` flows in other areas.

---

## 1. Screens

**Home-Main (website, 1440).** A top bar holds the logo, a wide button labelled "Search teams, runs and actions" (⌘K),
a "Connected" dot with a text label, and the avatar. The left nav has four items: Home with a count (4), Domains,
Engines with the warning badge "2 to fix", and Toolkit with the warning badge "1 missing". "Tools" is renamed to
"Toolkit". Under the nav, a "Shortcuts" legend reads "⌘K search and actions", "N new run · T new team". The main
column opens with "Good morning, Lazyx." and a line of three dashed-underline links: "4 things need you · 1 run in
progress · $6.19 spent this week". A secondary "New team" button sits on the right. Next comes the **Start a run**
card: the hint "Press N from anywhere", a multi-line idea box (placeholder "What should the team build? For
example: Add an RSI indicator with tests"), and a row with the team picker ("T Indicator sprint team"), the repo
picker ("lazyxgenius/trade_mcp · main"), "Options", a readiness hint ("⚠ Website needs 2 keys · Fix") and a primary
"Launch". Below that is a two-column grid.
- **Left column:** "Needs you 4 · Oldest first". It is a list of four kinds of item, each with its own buttons and a
  ⋯ button: approve a spec, a failed run, a team that can't run on the website, and memories to review.
  - "Running now 2" shows two run cards. Each has the team, a status badge, time elapsed, the idea, a row of node
    chips showing progress, a budget meter ("$1.21 of $5.00"), and Open / Stop.
  - "Teams" has search, sort, a grid/list toggle, pill tabs and team cards.
- **Right column (330px):** "Recent runs" (with an "All runs" filter, five rows, PR links and "Show more") and a
  "Spend" panel (total for the month, total for the week, per-team bars, and a footnote about budgets).

**Home-FullPage.** Identical to Main. It is the whole page scrolled, showing every section in order.

**Home-Desktop (Tvashtr Desktop).** Same as Main, plus the Electron title bar "Tvashtr — the living canvas". Two things
in the composer change:
- The repo picker shows a **local folder** ("~/code/trade_mcp · main").
- The readiness hint reads "Ready on this computer · Claude, Grok" (green, no Fix link), because subscription nodes
  run on the user's machine.

Needs you still lists "Indicator sprint team can't run on the website". Gaps for the website are shown even on
Desktop.

**Home-BeforeAfter.** A marketing comparison. Before:
- an approval is a small pill in a table row;
- you can't start a run from Home (team → canvas → launch panel);
- the three numbers can't be clicked;
- team rows show a node count and a date;
- there is no search, sort or filter.

After: start a run from Home; Needs you with one action per item; Running now with live progress, spend and Stop;
team cards showing the team's shape; Recent runs with PR links; spend by team; ⌘K; a first-time checklist. There are
no new requirements beyond the other screens.

**Home-FirstTime.** The nav badges and the Home count are gone. The main column shows:
- The heading "Welcome to Tvashtr, Lazyx." with the line "Build a team of agents, run it on your repo, and review the
  pull request it opens." and the New team button.
- A **"Get started 0 of 4 done"** checklist with a "Hide checklist" button:
  1. "Connect an engine: Your Claude or Grok plan on Desktop, or an API key." [Open Engines] (primary)
  2. "Create a team: Start from a template. You can change every agent later." [New team]
  3. "Start your first run: Tell the team what to build, and pick a repo." [Start a run]
  4. "Review the pull request: Approve the spec and the ship when the team asks." [See how]
- "Start from a template": four cards (PM → Engineer; PM → Engineer ⇄ Reviewer; PM → Architect → Engineer ⇄ Reviewer;
  Full feature squad), each with a description and "Use template".
- "How Tvashtr works": three numbered steps.

The composer, Needs you, Running now, Teams, Recent runs and Spend are all hidden.

**Home-AllCaughtUp.** The nav reads "Home" with no count. The greeting line is "Nothing needs you · 1 run in progress
· $6.19 spent this week". Needs you shows the empty state "You're all caught up. Approvals, failed runs and setup gaps
show up here." with no count pill. Running now shows 1 card (Docs team).

**Home-Loading.** The header and nav are rendered (the Engines and Toolkit badges are already there; Home has no
count). The main column holds skeleton blocks: two greeting bars (320×30, 260×12), a 150px composer block, and a
two-column grid of 220/180px cards on the left and 260/160px cards on the right (330px column).

**Home-Web1024.** The same content at 1024 wide in a single column: composer, Needs you, Running now (2-up), Teams
(2-up). Recent runs and Spend are **not in the frame**; the right column is dropped (see Q17).

**HmF-PickTeam-1/2.**
- (1) Clicking the team button opens a 460px listbox popover with a "Search teams" input and the heading "Your teams".
  Each option shows the team's initial, its name, "{n} agents" and a readiness phrase:
  - "Website: needs 2 keys"
  - "Ready"
  - "Website: needs xai key"
  - "Ready · never run"

  The last row is "New team…".
- (2) Picking "Docs team" changes the button to "D Docs team", and the hint becomes "Ready on the website" (green
  check).

**HmF-Idea-1/2.** (1) Clicking the idea box gives it a coral focus ring. (2) Typing "Add a Stochastic RSI indicator
with tests" replaces the placeholder.

**HmF-PickRepo-1/2 (website).**
- (1) The repo button opens a 360px popover with a "Search repos" input, the heading "GitHub App repos" and these
  options:
  - "lazyxgenius/trade_mcp main" (selected)
  - "lazyxgenius/cryptoground-mcp main"
  - "No repo · build a fresh app"
  - "Add repos on GitHub…"

  The footnote reads "The team works on its own branch and opens a pull request."
- (2) Picking the fresh-app option changes the button label to "No repo · fresh app".

**HmF-PickFolder-1/2 (Desktop).**
- (1) The folder button ("~/code/trade_mcp · main") opens a 360px popover with the heading "Recent folders" and these
  options:
  - "~/code/trade_mcp main"
  - "~/code/cryptoground-mcp main"
  - "Choose a folder…"
  - "No repo · build a fresh app"

  The footnote reads "The team works on its own branch. Your working folder is never touched." There is no search
  box. The hint reads "Ready on this computer · Claude, Grok".
- (2) The button now shows "~/code/cryptoground-mcp · main".

**HmF-Options-1.** "Options" opens a 300px popover with three fields:
- "Base branch" text input (default "main")
- "Scope" select with options Whole repo / packages/indicators / web
- "Budget for this run" input (default "$5.00") with the helper "The run stops if it would spend more."

**HmF-Launch-1…7 (website).**
1. Launch with an empty box: the box border turns red and an inline `role=alert` says "Describe what the team should
   build."
2. Launch with the idea typed while keys are missing: an amber `role=alert` banner inside the composer says "**Can't
   run on the website yet.** Indicator sprint team uses anthropic and xai models, and there's no API key for them."
   with [Add keys] (secondary) and [Open Engines] (ghost).
3. "Add keys" opens the right sheet "Add an API key", subtitled "For website runs, and Desktop runs without a
   subscription". It has a Provider dropdown ("A anthropic") and the line "Covers models that start with
   `anthropic/`, like anthropic/claude-sonnet-5." Then a password "API key" input (placeholder "Paste the key"), the
   footnote "Saved encrypted. After you save, you'll only see •••• and the last 4 characters. Key 1 of 2 · then xai",
   and [Cancel] [Save key].
4. The same sheet for "X xai", `xai/`, xai/grok-4, "Key 2 of 2".
5. The keys are saved. A dark toast says "Keys saved. Indicator sprint team can run on the website." The alert is gone
   and the hint reads "Ready on the website". The setup-gap item leaves Needs you; the counts go 4→3 (nav, greeting,
   section).
6. Clicking Launch turns the button into "Launching…" (loading).
7. The run has started. The toast says "Run started on Indicator sprint team." with [Open run]. The idea box is
   cleared back to the placeholder. The greeting reads "3 things need you · 2 runs in progress". "Running now 3" puts
   a new card first: Indicator sprint team, Running, "just now", "“Add a Stochastic RSI indicator with tests”",
   chips, "$0.00 of $5.00", Open/Stop. That makes a **second concurrent run of the same team**.

**HmF-Approve-1…3.**
1. Click Review on "Approve the spec".
2. A 620px dialog sheet opens beside Home, over a scrim. It is titled "Approve the spec", with "Indicator sprint team
   · “Add an RSI indicator with tests”" and Close. It shows:
   - badges "Written by Product manager", "Version 2" and "Waiting 26m" (warning dot);
   - an amber note: "The run is paused at **Approval**. Approve to let the Engineer start building. You can still edit
     the spec while the run is live.";
   - the spec as markdown: h1 "Add an RSI indicator", intro, then "Goals", "Acceptance" and "Out of scope" with code
     spans;
   - footer buttons [Open run] (ghost), [Reject…] (secondary) and [Approve and continue] (primary).
3. Approved. The toast says "Approved. The Engineer is building." with [Open run]. The item is removed (4→3) and the
   greeting reads "2 runs in progress". The Indicator card's badge changes from "Awaiting you" to "Running"; the
   Approval chip turns done (green) and the "Waiting for you at Approval" line disappears.

**HmF-Reject-1/2.**
1. Clicking "Reject…" stacks a 500px `alertdialog` over the spec sheet. It says "Reject the spec? The run stops and is
   marked Stopped. Nothing is built or pushed." It has an optional multi-line input (3 rows) "What should change next
   time?" and [Cancel] [Reject and stop run].
2. The item is removed (3). The greeting reads "1 run in progress". The Indicator card is **removed** from Running
   now ("Running now 1"). The toast says "Run stopped. Your note is saved with the run." with [Start again].

**HmF-Retry-1…4.**
1. Clicking Retry on the failed-run item fills the composer:
   - a grey note above the idea box: "↺ Retrying the failed run with the same idea and repo.";
   - idea "Fix the flaky login test";
   - team "B Bugfix squad".

   The hint in the sample still reads "Website needs 2 keys · Fix".
2. "Fix" opens the Add-key sheet for xai with the footnote "Used by Bugfix squad".
3. The toast says "xai key saved. Bugfix squad can run on the website." The hint reads "Ready on the website".
4. After Launch, the toast says "Run started on Bugfix squad. The failed run stays in its history." with [Open run].
   The failed item leaves Needs you (4→3) and the greeting reads "2 runs in progress".

**HmF-FixSetup-1…3.** "Fix" on the setup-gap item opens the sheet for anthropic ("Key 1 of 2 · then xai"), then for
xai ("Key 2 of 2"). Then the toast says "Keys saved. Indicator sprint team can run on the website." The item is
removed (4→3) and the composer hint reads "Ready on the website".

**HmF-Dismiss-1…3.**
1. ⋯ on the memories row opens a 220px menu: "Review in Toolkit", "Remind me tomorrow", "Dismiss".
2. After Dismiss the row is removed (4→3). The toast says "Dismissed. The memories still wait in Toolkit › Memory."
   with [Undo].
3. Clicking Review (or "Review in Toolkit") goes to Toolkit › Memory. The sub-nav reads Tools 3 / Skills 3 / Memory
   "2 new" / Secrets "1 missing", with the Inbox tab selected (owned by the Toolkit area).

**HmF-AllClear-1.** The last item is done. The toast says "All caught up." The nav shows "Home" with no count, the
greeting reads "Nothing needs you · …", and Needs you shows the empty state.

**HmF-Stop-1…3.**
1. Click Stop on the Docs team card.
2. A 500px `alertdialog`: "Stop this run? Docs team stops now and the run is marked Stopped. Anything already pushed
   stays on its branch. You can't resume a stopped run." with [Keep running] (ghost) and [Stop run] (secondary).
3. The toast says "Run stopped." The greeting reads "4 things need you · nothing running". The Docs card **stays** in
   Running now with an outline "Stopped" badge and no Stop button. The team card shows "Stopped" and "Write the API
   reference for /runs · stopped just now".

**Website vs Desktop, summary.**
- **Composer target:** GitHub App repos on the website vs local folders on Desktop.
- **Readiness hint:** website counts API keys only ("Website needs n keys · Fix" / "Ready on the website"); Desktop
  also counts fresh Claude/Grok subscriptions ("Ready on this computer · Claude, Grok").
- **Title bar:** Desktop only.
- **Launch body:** Desktop launches send `desktop_target: true`.
- **Links:** PR links open in the OS browser on Desktop. GitHub "Add repos" pages stay inside the window on Desktop
  (`isGithubAuthUrl`).
- **Shortcuts:** ⌘K shows as Ctrl K on Windows and Linux.
- **Same on both:** Needs you, Running now, Teams, Recent runs and Spend. The Spend footnote mentions Desktop
  subscriptions on both.

---

## 2. Behaviour requirements

### A. Shell (shared by all Home screens)
- **HOME-1** Header search button with the visible text "Search teams, runs and actions" and a `kbd` "⌘K" (show
  "Ctrl K" on non-Mac). Clicking it opens the command palette; the palette's contents belong to the ⌘K flow.
- **HOME-2** Connection indicator: a dot plus the **visible** label "Connected". It polls health. There are three
  states: checking, connected, unreachable (the unreachable screens belong to the Backend flow). Today there is only a
  dot with a tooltip (`BackendDot`).
- **HOME-3** An avatar showing the user's display name "Lazyx" (the menu belongs to the Account flow).
- **HOME-4** Left nav:
  - Items: Home, Domains, Engines, **Toolkit** (renamed from "Tools").
  - Home carries the Needs-you count badge, hidden when 0.
  - Engines carries the warning badge "{n} to fix"; Toolkit carries the warning badge "{n} missing". Both are hidden
    when 0 (see Home-FirstTime).
  - The nav count is the same number as the greeting's "{n} things need you" and the Needs-you section count.
- **HOME-5** Nav footer "Shortcuts": "⌘K search and actions", "N new run · T new team".
- **HOME-6** Desktop only: the window title reads "Tvashtr — the living canvas".

### B. Greeting
- **HOME-7** H1 "Good {morning|afternoon|evening}, {name}." It uses the local clock. The name is the GitHub login,
  falling back to the capitalised local part of the email (today: "Good to see you, {handle}.").
- **HOME-8** Summary line with three parts separated by " · ":
  - "{n} things need you" (a link, amber). Use the singular "1 thing needs you". Show "Nothing needs you" (plain text)
    when 0.
  - "{n} run(s) in progress" (a link). Show "nothing running" when 0. **This counts only `pending|running` runs.
    `awaiting_human` runs are counted under "need you"** (Main: Running now 2 but "1 run in progress").
  - "${x} spent this week" (a link).

  Each link scrolls to and focuses its section: Needs you, Running now, Spend.
- **HOME-9** A "New team" secondary button at the top right opens the New team dialog (NewTeam flow).

### C. Start a run composer
- **HOME-10** Card title "Start a run" with the hint "Press N from anywhere".
- **HOME-11** A multi-line idea box with the placeholder "What should the team build? For example: Add an RSI indicator
  with tests". It gets a focus ring (Idea-1) and grows with its content.
- **HOME-12** Validation: pressing Launch with an empty or whitespace-only idea sends no request. The box gets an error
  border and an inline `role=alert` says "Describe what the team should build." The error clears on input.
- **HOME-13** Team button: the team's initial (coral square), its name and a chevron (`aria-haspopup=listbox`). Default
  selection, in order: the last team used from Home, else the team with the most recent run, else the first team.
- **HOME-14** Team popover (listbox, 460px):
  - "Search teams" filter and the heading "Your teams".
  - Each option: initial, name, "{node_count} agents", and a readiness phrase ("Ready", "Ready · never run",
    "Website: needs 2 keys", "Website: needs xai key"). The selected option has `aria-selected`.
  - The last option, "New team…", opens the New team dialog and selects the new team once it is created.
- **HOME-15** Readiness per launch target:
  - The **website** counts only API keys held.
  - **Desktop** also counts Claude/Grok subscriptions that are connected *and* whose runner is fresh (the same rule
    as `credential_gate.missing_providers_for_launch`).
  - The phrase shows the missing provider names when there is one, and "{n} keys" when there are several.
- **HOME-16** Repo button (website): a GitHub icon plus "{owner/name} · {base branch}", or "No repo · fresh app".
- **HOME-17** Repo popover (website, 360px):
  - "Search repos" filter and the heading "GitHub App repos".
  - One option per repo: "{full_name} {default_branch}".
  - "No repo · build a fresh app".
  - "Add repos on GitHub…" opens `github_manage_url`, or `github_install_url` when `installation_count` is 0.
  - Footnote: "The team works on its own branch and opens a pull request."
- **HOME-18** Repo popover states (not designed; keep today's LaunchPanel copy):
  - loading;
  - "Couldn't reach the server to list your repositories.";
  - App not installed → "Install the Tvashtr GitHub App →";
  - installed but no repos → "Add repositories on GitHub →";
  - no search matches.
- **HOME-19** Desktop folder button: "{~/path} · {branch}", with the path shown relative to home.
- **HOME-20** Desktop folder popover (360px, no search):
  - Heading "Recent folders"; one option per folder: "{~/path} {current branch}".
  - "Choose a folder…" opens the **native** folder dialog. A folder picked there becomes selected and is added to
    Recent folders.
  - "No repo · build a fresh app".
  - Footnote: "The team works on its own branch. Your working folder is never touched."
- **HOME-21** Folder validation: the folder must be a git work tree. Errors are not designed; recommended copy:
  "That folder isn't a git repository." A recent folder that has been moved or deleted shows as unavailable and can be
  removed.
- **HOME-22** Options popover (300px):
  - "Base branch" input. It defaults to the repo's default branch (website) or the folder's current branch (Desktop).
  - "Scope" select: "Whole repo" plus the repo's top-level tracked package folders (e.g. `packages/indicators`,
    `web`).
  - "Budget for this run" dollar input. It defaults to the server's per-run default ($5.00), with the helper "The run
    stops if it would spend more."
- **HOME-23** Options validation:
  - The base branch must exist; recommended copy "No branch named {x} in {repo}."
  - The budget must be a positive amount; recommended copy "Enter an amount above $0."
  - When "No repo" is selected, Base branch and Scope are disabled or hidden and Budget stays.
- **HOME-24** The chosen base branch shows in the repo or folder button ("· main").
- **HOME-25** Readiness hint beside Launch, three variants:
  - Website with gaps: amber "Website needs {n} key(s)" plus a "Fix" link.
  - Website ready: green check "Ready on the website".
  - Desktop: "Ready on this computer · {subscription names routing nodes}", e.g. "Claude, Grok". If keys are still
    missing on Desktop, recommend "This computer needs {n} key(s) · Fix".
- **HOME-26** "Fix" opens the Add-API-key sheet sequence for the selected team's missing providers (§D).
- **HOME-27** The Launch button (primary) shows "Launching…" with a spinner and is disabled while the request is in
  flight.
- **HOME-28** Launch with missing keys (client pre-check, or a server 422 carrying `missing_providers`) shows an amber
  `role=alert` in the composer: "**Can't run on the website yet.** {Team} uses {p1} and {p2} models, and there's no API
  key for them." with [Add keys] and [Open Engines]. List the providers naturally ("a", "a and b", "a, b and c").
- **HOME-29** "Add keys" starts the sheet sequence. "Open Engines" navigates to Engines.
- **HOME-30** After the last key in the sequence is saved:
  - toast "Keys saved. {Team} can run on the website.";
  - the alert is removed and the hint becomes "Ready on the website";
  - that team's setup-gap item leaves Needs you, and every count (nav, greeting, section) goes down.
- **HOME-31** Other launch refusals show the server's message inline, in the same alert style (not designed):
  - 422 "team graph is not runnable" (with `errors[]`), plus a link to open the team;
  - 422 model no longer served;
  - 422 github_repo not in installations;
  - 422 invalid base branch or subpath;
  - 422 Desktop missing credentials;
  - 429 concurrency or daily ceiling (`detail.message`).
- **HOME-32** A successful launch **stays on Home** (today the canvas takes over):
  - toast "Run started on {Team}." with [Open run];
  - the idea box and retry note are cleared;
  - a new card goes first in Running now (badge Running, "just now", the idea, the shape chips, "$0.00 of ${cap}",
    Open/Stop);
  - Running now count +1, greeting "in progress" +1;
  - the run appears at the top of Recent runs and the team card updates.
- **HOME-33** A launch from Desktop sends `desktop_target: true`. Recommend keeping today's note as a tooltip or
  helper: "Claude and Grok nodes run on this computer … keep Tvashtr Desktop open until the run finishes."
- **HOME-34** Several runs of the same team can run at once (Launch-7). No client-side block.

### D. Add-API-key sheet
- **HOME-35** A right sheet (520px, `role=dialog`, label "Add an API key", over a scrim): title "Add an API key",
  subtitle "For website runs, and Desktop runs without a subscription", and a Close icon.
- **HOME-36** A Provider dropdown showing "{initial} {provider}", prefilled with the current missing provider. The
  line "Covers models that start with `{provider}/`, like {example model}." takes the example from the provider
  catalogue.
- **HOME-37** An "API key" password input (placeholder "Paste the key"). The footnote reads "Saved encrypted. After you
  save, you'll only see •••• and the last 4 characters." followed by one of: "Key {i} of {n} · then {next}", "Key {n}
  of {n}", or, for a single key for a team, "Used by {Team}".
- **HOME-38** [Cancel] and [Save key] (primary):
  - Saving an empty key is blocked.
  - Save goes to the next provider in the sequence, or closes the sheet and shows the toast.
  - Cancel ends the sequence; keys already saved stay saved.
  - Save errors use the Engines add-key error states.
- **HOME-39** With one missing key, the toast is "{provider} key saved. {Team} can run on the website."

### E. Needs you
- **HOME-40** Header "Needs you", a count pill and "Oldest first". Items come from **all runs and teams**, ordered
  oldest first.
- **HOME-41** Approve item: shield icon, title "Approve the spec", meta "{Team} · “{idea}” · waiting {26m}".
  [Review] (primary) and ⋯ (`aria-label` "More for Approve the spec").
- **HOME-42** Failed-run item: warning icon, title "Run failed", meta "{Team} · “{idea}” · {11h ago} · {reason}" (e.g.
  "Engineer has no xai key on the website"). [View run] (secondary), [Retry] (ghost), ⋯.
- **HOME-43** Setup-gap item, one per team that can't run on the website: key icon, title "{Team} can't run on the
  website", body "No API keys for {anthropic and xai}." followed by "Desktop runs still work with your {Claude and
  Grok} plans." only when those subscriptions are connected. [Fix] (secondary), ⋯.
- **HOME-44** Memories item: brain icon, "{n} new memories to review", "Learned by {role(s)} on {repo label}". [Review]
  (ghost), ⋯.
- **HOME-45** Other pending human tasks must also appear (not designed; suggested titles):
  - ship-approval gate → "Approve the ship";
  - blocking `budget_approval` → "Approve going over budget";
  - `budget_threshold` nudge → "{Team} has used 80% of its budget" (dismissed through acknowledge);
  - escalation gates.
- **HOME-46** The ⋯ menu on the memories item (`role=menu`, 220px): "Review in Toolkit", "Remind me tomorrow",
  "Dismiss".
- **HOME-47** Dismiss removes the item and lowers every count. Toast "Dismissed. The memories still wait in Toolkit ›
  Memory." with [Undo]; Undo puts the item back.
- **HOME-48** "Remind me tomorrow" snoozes the item until tomorrow. The toast is not designed; recommend "We'll remind
  you tomorrow." with [Undo]. The item comes back once the snooze ends.
- **HOME-49** "Review" and "Review in Toolkit" go to Toolkit › Memory with the **Inbox** tab selected (deep link into
  the dashboard view).
- **HOME-50** The ⋯ menus for the approve, failed and setup items are not designed. Recommendations:
  - approve: "Open run", "Remind me in 1 hour" (no Dismiss);
  - failed: "Open run", "Dismiss";
  - setup: "Open Engines", "Dismiss". A dismissed gap comes back if the set of missing providers changes.
- **HOME-51** Empty state: "You're all caught up. Approvals, failed runs and setup gaps show up here." The section count
  is hidden, the nav badge is hidden and the greeting reads "Nothing needs you".
- **HOME-52** When an action on Home clears the last item, a toast says "All caught up."
- **HOME-53** Items acted on elsewhere (canvas TasksDrawer, another tab, Desktop) drop off at the next refresh. An
  action that loses a race (409) refreshes the list and shows a soft toast.

### F. Approve / reject the spec
- **HOME-54** Review opens a sheet **beside Home** (620px, `role=dialog`, label "Approve the spec", over a scrim):
  - title "Approve the spec", subtitle "{Team} · “{idea}”", and Close;
  - focus is trapped inside; Escape closes it.
- **HOME-55** Three badges: "Written by {author role}" (e.g. "Product manager"), "Version {n}" (the latest version),
  and "Waiting {elapsed}" (warning dot).
- **HOME-56** An amber note: "The run is paused at **{gate role}**. Approve to let the {next role} start building. You
  can still edit the spec while the run is live." The next role is the target of the gate's approved edge.
- **HOME-57** The spec body is the latest version rendered as markdown (h1, paragraphs, h2, bullet lists, inline
  code). While the run is live it can be edited; a save makes a new version, as PrdView does today.
- **HOME-58** Footer: [Open run] (ghost) opens the run view; [Reject…] (secondary); [Approve and continue] (primary).
- **HOME-59** Approve closes the sheet and shows the toast "Approved. The {next role} is building." with [Open run]:
  - the item is removed and the counts updated (needs you −1, in progress +1);
  - the run card changes from "Awaiting you" to "Running"; the gate chip turns done and the waiting line is removed.
- **HOME-60** "Reject…" opens an `alertdialog` (500px):
  - "Reject the spec? The run stops and is marked Stopped. Nothing is built or pushed.";
  - an optional multi-line field "What should change next time?" (3 rows);
  - [Cancel] and [Reject and stop run].
- **HOME-61** Reject sends the note, closes both overlays and shows the toast "Run stopped. Your note is saved with the
  run." with [Start again]. The item is removed, the run card leaves Running now, the team badge becomes "Stopped",
  and "in progress" goes down.
- **HOME-62** "Start again" fills the composer with the same team, idea, repo, branch, scope and budget, plus the note
  (see Q12).
- **HOME-63** Stale gate: a 409 "task already resolved" closes the sheet, refreshes, and shows a toast (recommend "This
  was already handled.").

### G. Retry a failed run
- **HOME-64** Retry fills the composer with the failed run's team, idea, target (repo or folder), base branch, scope
  and budget, and shows the note "Retrying the failed run with the same idea and repo." above the idea box. The page
  scrolls to the composer and focuses it.
- **HOME-65** Readiness is recomputed for that team. With one missing key, Fix opens the sheet with the footnote "Used
  by {Team}" (HOME-37/39).
- **HOME-66** Launch creates a new run **linked to the failed run**. Toast "Run started on {Team}. The failed run
  stays in its history." with [Open run]. The failed item leaves Needs you. The retry note clears.
- **HOME-67** Changing the team or clearing the composer ends retry mode and removes the note (recommended).
- **HOME-68** [View run] opens the failed run's view (canvas run view for that run).

### H. Fix a setup gap
- **HOME-69** Fix on a setup-gap item runs the Add-key sheet for each missing provider of that team (website target).
  Then the toast "Keys saved. {Team} can run on the website." appears, the item is removed, and the composer hint
  updates if that team is selected.

### I. Running now
- **HOME-70** Section "Running now" with a count of runs with status `pending|running|awaiting_human`, laid out in a
  two-column card grid.
- **HOME-71** Card: team name; a status badge (warning "Awaiting you", info "Running"); time since the run started
  ("26m", "just now"); the idea in quotes.
- **HOME-72** Progress strip:
  - one 22px chip per node, in walk order, with › separators; a loop-back pair shows "⇄";
  - the tooltip is the role name;
  - chip states: done (sage), active (coral with a glow), waiting at a gate (amber), not reached (grey). Failed and
    stopped states are recommended.
- **HOME-73** A line "⇄ Waiting for you at {gate role}" while the run is paused at a gate.
- **HOME-74** A budget meter (70px bar, width = spent ÷ cap) and the text "${spent} of ${cap}". Spent is the **live**
  accrued cost.
- **HOME-75** [Open] (secondary) opens the run view. [Stop] (ghost) opens the confirmation.
- **HOME-76** Stop confirmation `alertdialog` (500px): "Stop this run? {Team} stops now and the run is marked Stopped.
  Anything already pushed stays on its branch. You can't resume a stopped run." with [Keep running] and [Stop run].
- **HOME-77** Stop cancels the run and shows the toast "Run stopped.":
  - the card gets an outline "Stopped" badge and loses its Stop button;
  - the team card reads "Stopped" and "{idea} · stopped just now";
  - the greeting reads "nothing running" when no runs are left;
  - any pending approval of that run leaves Needs you.
- **HOME-78** Live data: progress, spend and status refresh while any run is active. A completed run leaves the
  section. A failed run leaves the section and appears in Needs you.
- **HOME-79** The empty Running now state is not designed; recommend hiding the section.

### J. Teams grid (display only; interaction belongs to the Teams flows)
- **HOME-80** Header controls:
  - "Teams" title, "Search teams" input, and a "Sort: Last active" menu (Last active / Name / Spend / Created);
  - a Grid/List toggle;
  - pill tabs "All {5}", "Needs you {2}", "Running {1}", "Not run yet {1}".
- **HOME-81** Team card:
  - name and a status badge from the last run (Awaiting you / Running / Failed / Completed / Stopped / Over budget /
    Not run yet);
  - shape chips (roles in walk order, "⇄" for loops);
  - a last-run line: "{idea} · {26m ago}". A running team shows "started 11m ago" and a stopped one "stopped just
    now". A team that has never run shows "Created {yesterday} from {template name}";
  - footer "{n} runs · ${spend}" or "No runs yet";
  - [Run] (ghost) and ⋯.
- **HOME-82** The card's [Run] selects that team in the composer, scrolls to it and focuses the idea box
  (recommended).

### K. Recent runs
- **HOME-83** Section "Recent runs" with an "All runs" filter button (filter options: All runs, Running, Needs you,
  Completed, Failed, Stopped; they belong to the RunsFilter flow).
- **HOME-84** Rows, newest first, five at a time:
  - the idea;
  - "{Team} · {26m ago}";
  - a status word for runs that aren't completed ("Awaiting you", "Running", "Failed", "Stopped");
  - completed runs with a PR show the link "PR #{n}" (new tab on the website, OS browser on Desktop);
  - a "Show more" link pages further.
- **HOME-85** Clicking a row opens that run (recommended).
- **HOME-86** Completed runs without a PR (fresh-app runs, local folders): recommend "Branch tvashtr/…" or "Shipped".

### L. Spend
- **HOME-87** "Spend" panel:
  - month name ("September") and the month-to-date total ("$15.93");
  - "${x} this week";
  - per-team rows for the month, sorted by amount descending, each with a bar scaled to the largest amount and its
    dollar amount.
- **HOME-88** Footnote: "Each run stops at ${default budget} unless you change its budget. Subscription runs on Desktop
  count against your plan, not here."
- **HOME-89** A zero-spend state is not designed; recommend "$0.00" and "No spend yet this month."

### M. First time
- **HOME-90** First-time mode: heading "Welcome to Tvashtr, {name}." and "Build a team of agents, run it on your repo,
  and review the pull request it opens." Nav badges are hidden and the New team button stays.
- **HOME-91** A "Get started {k} of 4 done" checklist with [Hide checklist] and four steps (copy as in §1): Open
  Engines (primary), New team, Start a run (reveals and focuses the composer), See how (docs or help).
- **HOME-92** When each step counts as done:
  1. any API key saved or any subscription connected;
  2. the user created a team (the auto-seeded team doesn't count);
  3. any run exists;
  4. any run has passed an approval gate, or has a `pr_url`.

  Done steps show a check.
- **HOME-93** "Start from a template": one card per template (name, description, [Use template]). Use template opens
  the New team dialog with that template chosen.
- **HOME-94** "How Tvashtr works": three steps with fixed copy (§1).
- **HOME-95** Hide checklist persists per user, so the website and Desktop agree.

### N. Loading, errors, layout
- **HOME-96** Loading skeleton exactly as Home-Loading. The shell renders at once and the counts fill in after
  loading.
- **HOME-97** Layout:
  - 1440: main column max 1100px; composer full width; then two columns (flexible + 330px). Left: Needs you,
    Running now, Teams. Right: Recent runs, Spend.
  - 1024 (and Desktop's minimum window width of 1024): a single column with 2-up grids. Recommend Recent runs and
    Spend stack under Teams.
- **HOME-98** Errors per section. Not designed; recommend an inline "Couldn't load {section}. Retry" per section. Today
  there is a single page-level banner, "Couldn't reach the backend — some sections may be stale."

### O. Keyboard, accessibility, toasts
- **HOME-99** `N` focuses the idea box from anywhere in the dashboard. It is ignored while typing in an input,
  textarea or contenteditable, or while a dialog is open.
- **HOME-100** `T` opens the New team dialog, with the same exceptions as HOME-99.
- **HOME-101** `⌘K` / `Ctrl+K` opens the command palette.
- **HOME-102** Accessibility:
  - Pickers are listboxes: options with `role=option` and `aria-selected`, arrow keys and Enter, Escape closes, focus
    returns to the trigger.
  - ⋯ menus use `role=menu` and `menuitem`.
  - Sheets and alertdialogs trap focus, close on Escape (`alertdialog` closes on Escape = Cancel), and restore focus
    afterwards.
- **HOME-103** Toasts: dark, `role=status`, bottom placement, auto-hide after about 6s (longer when they have an
  action). Action buttons: "Open run", "Undo", "Start again". A new toast replaces the current one.
- **HOME-104** ⌘/Ctrl+Enter in the idea box launches (recommended). Plain Enter adds a new line.

### P. Environment and freshness
- **HOME-105** The target is picked by `document.documentElement.dataset.tvashtrDesktop === "true"`:
  - website: GitHub repo picker, website readiness;
  - Desktop: folder picker, Desktop readiness, `desktop_target: true`.

  Self-hosted website (`hosted_mode=false`) keeps a typed repo path (Q15).
- **HOME-106** Home refreshes:
  - after each of its own actions;
  - on a timer (about 5s while any run is active, about 30s otherwise);
  - when the window regains focus.

  Nav counts refresh on every dashboard page.
- **HOME-107** "Open run" everywhere (toasts, cards, sheet, View run) opens the canvas run view for **that run's
  library team** (`App` with `teamId` + `initialRunId`). "Back" returns to Home.

---

## 3. Backend gap table

Details for each proposal (P1–P13) follow the table.

| ID | Needs | Status | Where / proposal |
|---|---|---|---|
| HOME-2 | Backend health for "Connected" | **EXISTS** | `GET /health` → `{status, db}` (main.py:122); `BackendDot` polls every 5s |
| HOME-3, HOME-7 | Display name (GitHub login) | **PARTIAL** | `GET /api/auth/me` returns only `{id, email}` (`UserOut`, auth.py:125). `users.github_login` exists but isn't serialized → **P13** |
| HOME-4 (Home count), HOME-8 (needs you) | Count of items that need you, across runs | **MISSING** | No cross-run feed; `GET /api/runs/{run_id}/tasks` is per run → **P1** (`count`) |
| HOME-4 (Engines "to fix") | Number of providers used by teams with no key (website) | **PARTIAL** | Derivable only by fetching every team graph (N+1) plus `/api/providers` → **P5** `readiness` (exact definition owned by the Engines area) |
| HOME-4 (Toolkit "missing") | MCP secrets referenced by tools but never set | **MISSING** | Only `GET /api/secrets` (names) exists; nothing scans `tool_config` for `${NAME}` → owned by the Toolkit area (`mcp_secrets.py` + `node_tools.py`) |
| HOME-8 (in progress) | Count of `pending/running` runs | **EXISTS** | `GET /api/runs` → `runs[].status` (routers.py:2439) |
| HOME-8, HOME-87 | Week and month spend | **MISSING** | Nothing aggregates by time. `GET /api/costs` returns raw rows and **isn't owner-scoped** (routers.py:599; `cost_records` has no owner) → **P4** |
| HOME-13 | Default team: most recent activity | **EXISTS** | `GET /api/teams` → `teams[].last_run.at` (created_at of the latest run) |
| HOME-14 | Team list, agent count | **EXISTS** | `GET /api/teams` → `name`, `node_count` |
| HOME-14, HOME-15, HOME-25 | Readiness for each team and target | **PARTIAL** | For the *selected* team the FE can compute it: `GET /api/teams/{id}/graph` `nodes[].model` + `GET /api/providers` `providers[].provider` + `GET /api/engines/subscriptions` `subscriptions[].runner_fresh` → `missingProvidersForModels` (lib/engines.ts:114). For the whole popover list it's N+1 → **P5** |
| HOME-14 ("New team…") | Create a team | **EXISTS** | `POST /api/teams {template, name}` (NewTeam flow) |
| HOME-16/17/18 | GitHub App repos + install/manage links | **EXISTS** | `GET /api/github/repos` → `repos[{name, full_name, private, default_branch, html_url}]`, `installation_count`; `GET /api/config` → `github_install_url`, `github_manage_url` (not passed to Dashboard today, only to App) |
| HOME-19/20/21 | Launch a run on a **local folder** from Desktop | **MISSING** | Desktop proxies every `/api` call to hosted Fly (desktop/electron/main.cjs:7, 252). Hosted mode refuses `repo_path` (routers.py:1024) and `/api/repo/inspect` (routers.py:688). The run workspace lives on Fly; the Desktop runner only gets a snapshot → **P10** + bridge (§4) |
| HOME-22 (base branch, website) | List branches; honour the chosen `base_ref` | **PARTIAL** | `create_run` **overwrites** `base_ref` with the repo's `default_branch` when `github_repo` is set (routers.py:1051); no branch listing → **P6** |
| HOME-22 (scope, website) | Top-level package list for a GitHub repo; accept `subpath` | **MISSING** | `create_run` forces `subpath = None` for GitHub runs (routers.py:1052); `repo_subpaths` works on local disk only → **P6** |
| HOME-22 (branch/scope, self-hosted path) | Inspect a local path | **EXISTS** | `POST /api/repo/inspect` → `{is_git, current_branch, branches, tracked_file_count, subpaths[{path,file_count}]}` (only when `hosted_mode=false`) |
| HOME-22 (budget default), HOME-88 | Server default budget per run ($5.00) | **MISSING** | `Settings.default_run_budget_usd` (config.py:110) isn't exposed → **P7** |
| HOME-22/23 (budget submit) | Budget per run on launch | **PARTIAL** | `POST /api/runs` accepts `budget_cap_usd` (routers.py:165) but doesn't validate it (0 or negative is accepted) → **P8** |
| HOME-27, HOME-32 | Launch | **EXISTS** | `POST /api/runs {team_graph_id, idea, github_repo|repo_path, base_ref, subpath, budget_cap_usd, desktop_target}` → `{run_id}` |
| HOME-28 | Refusal for missing keys | **EXISTS** | 422 `detail = {message, missing_providers[], missing_nodes[], subscription_only}` (routers.py:811); Desktop variant adds `desktop_target:true` (routers.py:757). The FE writes the copy |
| HOME-31 | Other refusals | **EXISTS** | 422 `{message:"team graph is not runnable", errors[]}`; 422 `{message, unservable_models[], missing_nodes[]}`; 422 github_repo/base_ref/subpath; 429 `{code, message}` (routers.py:915) |
| HOME-32 (new card), HOME-70–74, HOME-78 | List of active runs with team, progress, gate, live spend, budget | **PARTIAL** | `GET /api/runs` rows carry only `{run_id, idea, status, created_at, repo_path}` (routers.py:2428). Per run you would need `GET /api/runs/{id}` (costs[] summed = live spend; **no `budget_cap_usd`** in `_run_to_dict`, routers.py:642) + `/graph` (nodes[].status) + `/tasks` → 3 calls per run → **P3** |
| HOME-33 | Desktop launch routing | **EXISTS** | `desktop_target` → `runs.desktop_subscriptions` (routers.py:1130) |
| HOME-34 | Concurrent runs of one team | **EXISTS** | No per-team lock; the hosted per-owner cap returns 429 `owner_concurrency_limit` |
| HOME-36 | Example model for a provider | **EXISTS** | `GET /api/config` → `provider_catalogue[{provider, thinker_default, worker_default, …}]` |
| HOME-37/38/39, HOME-69 | Save an API key | **EXISTS** | `POST /api/providers {provider, api_key}` → `{provider, key_last4}` (routers.py:1833) |
| HOME-40, HOME-41, HOME-45 | Pending gates and nudges across all runs | **MISSING** | `human_tasks` can only be read per run (routers.py:3449) → **P1** |
| HOME-42 | Failed runs, each with a readable reason | **MISSING** | `runs` has no failure column. The reason lives only in `agent_invocations.outcome_detail` (team_run.py:1995), as raw text like "owner {uuid} has no credential for provider 'xai'". `TeamSummary.last_run.error` is declared in the FE but **never sent** → **P9** + **P1** |
| HOME-43 | Setup gaps for each team (website) | **MISSING** | The shared rule exists (`credential_gate.missing_providers_for_launch`) but no endpoint applies it per team → **P5** + **P1** |
| HOME-43 ("Desktop runs still work…") | Subscriptions connected | **EXISTS** | `GET /api/engines/subscriptions` → `connected` (server helper `_connected_subscription_ids`, routers.py:795) |
| HOME-44 | Pending memories + "learned by" role + repo label | **PARTIAL** | `GET /api/memories?status=pending_review` → `{id, content, repo_key, node_id, source_run_id, source_invocation_id, created_at}`. No role name; `repo_key` = the run's `repo_path` (a clone path on the server for hosted runs), not `owner/name` → **P1** (the server resolves `source_invocation_id`→`agent_nodes.role_name` and `source_run_id`→`runs.github_repo`) |
| HOME-46/47/48, HOME-50 | Dismiss, snooze and undo for inbox items | **MISSING** | No storage → **P2** |
| HOME-49 | Toolkit › Memory inbox | **EXISTS** | FE navigation only (the memory endpoints exist) |
| HOME-51/52/53 | Empty or stale inbox | **MISSING** | Depends on **P1**. A lost race on resolve already returns 409 "task already {status}" (routers.py:3487) |
| HOME-54/55/57 | Spec document for a gate + version + author | **PARTIAL** | `GET /api/runs/{id}` → `run.pm_document_id`; `GET /api/documents/{id}` → `versions[{version_no, content, created_by, created_at}]`. `created_by` is `"agent:entry"` or `"human"`, not a role; the FE must map the entry (root) node of `/graph` to a label. **Security:** `GET /api/documents/{id}` and `POST …/versions` are **not owner-scoped** (routers.py:552, 568) → P1 returns `document_id` only for owned runs; fixing document scoping is owned by the Docs area |
| HOME-56 | Gate role name + role of the next node | **EXISTS** | `GET /api/runs/{id}/graph` → `nodes[{id, role_name, kind, config}]`, `edges[{source_node_id, target_node_id, conditions:{when}}]`; task `topic = "gate:{run_id}:{node_id}"`. P1 also returns `gate_role` and `next_role` |
| HOME-57 (edit) | Save a new spec version | **EXISTS** | `POST /api/documents/{id}/versions {content}` (same scoping caveat) |
| HOME-55 ("Waiting 26m") | When the gate opened | **EXISTS** | `human_tasks.created_at` (in `GET /api/runs/{id}/tasks`) |
| HOME-59 | Approve | **EXISTS** | `POST /api/runs/{id}/tasks/{task_id}/resolve {decision:"approve"}` |
| HOME-61 | Reject with a note; the run is marked Stopped | **EXISTS** | `resolve {decision:"reject", note}` → `close_gate_step` stores `resolution_note` (gates.py:109). The run ends `rejected` (FE label "Stopped", lib/status.ts:213) when the reject edge leads to a Stop terminal (true for every template) |
| HOME-62, HOME-64 | Full launch target of an old run (to prefill) | **PARTIAL** | `GET /api/runs/{id}.run` has `idea, github_repo, repo_path, base_ref, subpath, desktop_target` but **no `budget_cap_usd`** and no library team id → **P3** + **P11** |
| HOME-66 | Link a retry to the failed run and remove it from Needs you | **MISSING** | No link between a failed run and its retry → **P8** (`retry_of_run_id`) |
| HOME-68, HOME-85, HOME-107 | Map run → library team (to open the canvas run view) | **PARTIAL** | `runs.team_graph_id` is the **clone**. The library team can only be reached through the clone→origin node join (teams.py:1432). Nothing in the run APIs returns it → **P11** |
| HOME-76/77 | Stop a run | **EXISTS** | `POST /api/runs/{id}/cancel` → `{run_id, status:"cancelled", workflow_status}`. It also closes pending tasks (teams.py:1663) |
| HOME-77 ("stopped just now") | When a run ended | **PARTIAL** | `runs.updated_at` exists, but `TeamSummary.last_run` has only `at` (= created_at) → **P5** |
| HOME-81 | Team card fields | **PARTIAL** | `GET /api/teams` has `name, created_at, node_count, last_run{status, at, run_id}, spend_usd`. Missing: `last_run.idea`, `last_run.updated_at`, `run_count`, `shape`, `created_from` (template). `spend_usd` sums `cost_total_usd`, which is written only at the end of a run, so **in-flight spend is missing** → **P5** |
| HOME-84 | Recent runs with team, PR, paging, filter | **PARTIAL** | `GET /api/runs` has no team, `pr_url`, cost, pagination or filter (the full `_run_to_dict` has `pr_url`, but only per run) → **P3** |
| HOME-87 (per team) | Month spend for each team | **MISSING** | → **P4** |
| HOME-90/92 | First-time state: engines, teams, runs, PR | **PARTIAL** | Derivable from `/api/providers`, `/api/engines/subscriptions`, `/api/runs`, `/api/teams`. **But** `GET /api/teams` auto-seeds "My team" (`seed_library_if_empty`, routers.py:2518), so "Create a team" can never read as not done → **P12** |
| HOME-93 | Templates | **EXISTS** | `GET /api/templates` → `{template, name, description}`; `POST /api/teams` |
| HOME-95 | Hide the checklist, per user | **MISSING** | No user preferences store → **P12** (localStorage is the fallback) |
| HOME-106 | Fresh data | **PARTIAL** | Polling only; fine if P1, P3 and P4 are cheap enough to poll. Push is out of scope |

### Proposals

**P1 — cross-run inbox: `GET /api/inbox`** (new `control_plane/inbox.py`, route in `routers.py`, owner-scoped)
```json
{
  "count": 4,
  "items": [
    { "key": "gate:812", "kind": "approval", "since": "2026-09-25T08:14:00Z",
      "team": {"id": "<library team uuid>", "name": "Indicator sprint team"},
      "run":  {"id": "<run uuid>", "idea": "Add an RSI indicator with tests"},
      "task": {"id": 812, "kind": "prd_approval", "title": "…", "blocking": true,
               "gate_node_id": "<uuid>", "gate_role": "Approval", "next_role": "Engineer"},
      "document_id": "<run.pm_document_id or null>" },
    { "key": "run_failed:<run uuid>", "kind": "run_failed", "since": "<runs.updated_at>",
      "team": {…}, "run": {"id","idea","target":{…as P3…},"budget_cap_usd":5.0,"desktop_target":false},
      "failure": {"code":"missing_credential","node_role":"Engineer","provider":"xai","target":"website",
                  "message":"Engineer has no xai key on the website"} },
    { "key": "setup:<team uuid>:website", "kind": "setup_gap", "since": "<team.created_at>",
      "team": {…}, "target": "website", "missing_providers": ["anthropic","xai"],
      "missing_nodes": ["Architect","PM"], "desktop_covers": ["claude","grok"] },
    { "key": "memories", "kind": "memories", "since": "<oldest pending created_at>",
      "count": 2, "learned_by": ["Reviewer"], "repos": ["lazyxgenius/trade_mcp"] }
  ]
}
```
Rules:
- **approval:** `human_tasks.status='pending' AND blocking`, joined to `runs` on `runs.workflow_id = human_tasks.run_id` where `runs.owner_id = me` and the run isn't terminal. Includes `budget_approval`. The `low_nudge` `budget_threshold` task becomes `kind:"nudge"`.
- **run_failed:** `runs.status='failed'` in the last 14 days, and no run has `retry_of_run_id` = this run (P8).
- **setup_gap:** library teams where `missing_providers_for_launch(models, byok=held_provider_slugs(owner), fresh_subscriptions=set(), desktop_target=False)` isn't empty.
- **memories:** `node_memories.status='pending_review'` for the owner.

Then drop anything dismissed or snoozed (P2) and sort by `since` ascending. The server resolves the gate role and next role from the run's clone graph: the gate's out-edge whose `conditions.when='approved'`, or its unconditional out-edge.

**P2 — dismiss / snooze / undo** (new migration `inbox_dismissals`; logic in `inbox.py`)
- Table: `inbox_dismissals(id bigserial PK, owner_id uuid NOT NULL FK users, item_key text NOT NULL, action text CHECK (action IN ('dismissed','snoozed')), snooze_until timestamptz NULL, fingerprint text NULL, created_at timestamptz DEFAULT now(), UNIQUE(owner_id, item_key))`.
- `POST /api/inbox/dismissals {key, action:"dismiss"|"snooze", until?: ISO8601}` → `{key, action, until}`. Returns 422 when dismissing an `approval` (only snooze is allowed) and 404 when the key isn't one of the user's current items.
- `DELETE /api/inbox/dismissals/{key}` → 204 (Undo). The key is URL-encoded.
- `fingerprint` is recorded at dismiss time so that new information brings the item back:
  - memories: max `created_at` of the pending rows;
  - setup gap: the sorted `missing_providers`.

  The inbox shows a dismissed item again when its current fingerprint differs.

**P3 — richer run list + run dict** (`GET /api/runs`, `_run_to_dict`; new `control_plane/run_views.py`)
- `GET /api/runs?status=active|needs_you|completed|failed|stopped|all&team_id=&limit=20&cursor=<created_at>_<id>&include=progress`
- Response: `{runs:[…], next_cursor}`. Existing keys stay; each row adds:
```json
{ "run_id":"…","idea":"…","status":"awaiting_human","created_at":"…","updated_at":"…","repo_path":null,
  "team":{"id":"…","name":"Indicator sprint team"},
  "target":{"kind":"github|local|desktop_folder|none","label":"lazyxgenius/trade_mcp","base_ref":"main","subpath":null},
  "pr_url":"https://github.com/…/pull/42","pr_number":42,"ship_branch":"tvashtr/…",
  "spent_usd":1.21,"budget_cap_usd":5.0,"desktop_target":false,"retry_of_run_id":null,
  "awaiting":{"task_id":812,"gate_role":"Approval","kind":"prd_approval"},
  "failure":null,
  "progress":[{"node_id":"…","role_name":"PM","kind":"completion","state":"done|active|waiting|idle|failed|stopped","loops_with":null}] }
```
- `spent_usd` = `metering.running_cost(run_id)` while the run is live, else `cost_total_usd`. Batch it with one `GROUP BY workflow_id` query.
- `progress` comes from the latest `AgentInvocation` per node (the same logic as `get_run_graph`, routers.py:1719) plus pending gate topics. Order nodes by walk (topological from the root); `loops_with` marks `conditions.when='changes_requested'` back-edges.
- Add `budget_cap_usd`, `spent_usd`, `library_team_id`, `retry_of_run_id` and `failure` to `_run_to_dict` as well, so `GET /api/runs/{id}` carries them.

**P4 — spend: `GET /api/spend?tz=Europe/Berlin`** (`metering.owner_spend(owner_id, since, until, by_team)`)
```json
{ "month":{"label":"September","start":"2026-09-01T00:00:00+02:00","total_usd":15.93},
  "week":{"start":"2026-09-21T00:00:00+02:00","total_usd":6.19},
  "by_team":[{"team_id":"…","name":"Full feature squad","total_usd":9.10}],
  "other_usd":0.0, "default_run_budget_usd":5.0 }
```
- Query: `SUM(cost_records.cost_usd)` joined to `runs` on `runs.workflow_id = cost_records.workflow_id`, where `runs.owner_id = me` and `cost_records.created_at` falls in the window, grouped by `runs.library_team_id` (P11).
- This is live, so in-flight spend counts. Off-ledger rows (`workflow_id IS NULL`: memory and domain embeddings) have no owner and are left out.
- Week starts Monday in the given tz (Q3). Consider an index on `cost_records(created_at)`.
- Also **scope `GET /api/costs` to the owner** (join `runs`) or remove it. Today it returns every account's cost rows.

**P5 — richer team summary** (`teams._team_summary` / `list_library_teams`, batched; migration adds `team_graphs.created_from_template text NULL`)
- Add to each `GET /api/teams` row:
  - `run_count`;
  - `last_run.{idea, updated_at, pr_url}`;
  - `shape: {nodes:[{id, role_name, kind, gate_kind}], edges:[{source, target, loop:bool}]}` (walk order);
  - `created_from: {template, name} | null`;
  - `readiness: {website:{ready, missing_providers, missing_nodes}, desktop:{ready, missing_providers, routed_subscriptions}, subscriptions_connected:["claude","grok"]}`.
- Readiness reuses `credential_gate.missing_providers_for_launch` and `desktop_routed_subscriptions` with `held_provider_slugs(owner)` and `desktop_jobs.fresh_subscription_ids(owner)`.
- Switch `spend_usd` to the live `cost_records` sum.
- Set `created_from_template` in `create_team_from_template` (the key), `create_blank_team` (`'blank'`) and `seed_library_if_empty` (`'seed'`). Existing rows are left NULL.

**P6 — branches and scope for hosted GitHub runs** (`github_app.py` + `routers.py`)
- `GET /api/github/repos/{owner}/{repo}/branches` → `{default_branch, branches:["main","dev",…]}`. Authorise with `find_repo_in_installations`, then call `GET /repos/{o}/{r}/branches` with an installation token (paginated, capped at 300).
- `GET /api/github/repos/{owner}/{repo}/subpaths?ref=main` → `{subpaths:[{path,file_count}], truncated:bool}`. Uses the Git Trees API `GET /repos/{o}/{r}/git/trees/{ref}?recursive=1`, counting blobs under each top-level folder (the same shape as `repo_subpaths`).
- Changes to `create_run` for `github_repo`:
  - Accept `body.base_ref` when it is in the branch list. Otherwise return 422 `{message:"base_ref is not a branch of {repo}", branches}`. When it is absent, default to `default_branch`.
  - Accept `body.subpath` when it is a top-level folder in the tree; otherwise return 422 as for `repo_path`.
  - Remove `subpath = None` (routers.py:1052).
- Executor: `add_worktree` cuts from `base_ref`, but a fresh clone only has `origin/<branch>` for non-default branches. For hosted runs pass `origin/{base_ref}`, or create the local branch in `_materialize_hosted_clone` (team_run.py:267). The PR already targets `run.base_ref` (team_run.py:1517).

**P7 — expose the default budget.** Add `default_run_budget_usd: float | null` to `ConfigResponse` (main.py:157). It is public config; P4 also echoes it.

**P8 — launch options on `POST /api/runs`.**
- Add `retry_of_run_id: str | None`. It must be one of the caller's runs and in a terminal state (else 422). Store it in a new nullable column `runs.retry_of_run_id uuid FK runs(id) ON DELETE SET NULL` (migration). P1 uses it to hide the failed item; P3 returns it.
- Validate `budget_cap_usd`: `Field(gt=0, le=<operator max, e.g. 500>)` → 422 "budget must be above $0".

**P9 — structured run failure.**
- Migration adds `runs.failure_code text NULL`, `runs.failure_message text NULL` and `runs.failed_node_id uuid NULL`.
- Extend `mark_run_failed_step(run_id, *, code, message, node_id)` (team_run.py:1560) and pass them from every call site (team_run.py:1995–2300).
- Put a small humaniser in a new `control_plane/run_failure.py`:
  - `NoCredentialError` → `missing_credential` + "{Role} has no {provider} key on {the website|this computer}";
  - Desktop runner went stale → "Tvashtr Desktop went offline — reopen it and retry.";
  - `github delivery failed` → "Couldn't open the pull request: …";
  - over-context and everything else → the first line of the reason.
- Fallback for old rows: at read time, the latest failed invocation's `outcome_detail`, else "The run stopped with an error."

**P10 — local-folder runs from Desktop** (new `control_plane/local_repo.py`, desktop runner routes, migration)
1. `POST /api/desktop/repo-snapshots` takes a multipart `git bundle` of `base_ref` (size-capped, e.g. 200 MB) → `{snapshot_id}`, stored like workspaces (machine-local, with Fly-replay semantics as for snapshots today).
2. `POST /api/runs` accepts `local_repo: {snapshot_id, label:"~/code/trade_mcp", base_ref, subpath}`. It is mutually exclusive with `github_repo` and `repo_path`, and allowed in hosted mode only with `desktop_target:true`. New columns: `runs.local_repo_label text NULL`, `runs.local_snapshot_id text NULL`.
3. A durable step, like `clone_github_repo_step`, clones the bundle into the run directory and sets `repo_path`. The rest of the executor is unchanged.
4. The Ship terminal for such a run skips the PR and stores a result bundle of `tvashtr/<run_id>`, served at `GET /api/runs/{id}/ship-bundle`.
5. Desktop fetches it into the user's folder as a new branch without touching the working tree (bridge `repos.bringBackBranch`).

Until P10 ships, Desktop can only offer GitHub repos, or local folders when it points at a self-hosted local backend (`TVASHTR_API_BASE`, `hosted_mode=false`), where `repo_path` and `/api/repo/inspect` already work.

**P11 — `runs.library_team_id`.**
- Migration: `uuid NULL FK team_graphs(id) ON DELETE SET NULL`, indexed.
- Set it in `create_run`'s clone path (routers.py:1114). Backfill it from the clone→origin join (`_run_rollup_by_origin`).
- Use it in P1, P3 and P4 and return it in `_run_to_dict`. This replaces the three separate join implementations (teams.py:1432, 1692, 1712).

**P12 — first time and preferences.**
- `created_from_template='seed'` (P5) lets the FE ignore the auto-seeded team for step 2. Alternatively, stop seeding for accounts created after the redesign, since Home, not the canvas, is now the default.
- `users.preferences jsonb NOT NULL DEFAULT '{}'` (migration) + `PATCH /api/me/preferences {home_checklist_hidden: bool}` → the merged preferences object.
- Or a single `GET /api/home/onboarding` → `{steps:{engine,team,run,review}, done:k, hidden}`.

**P13 — identity.** Add `github_login: str | None` and `display_name: str` (github_login, else the capitalised local part of the email) to `UserOut` and `GET /api/auth/me`.

---

## 4. Desktop bridge gaps

The bridge today is `window.tvashtrDesktop = { engines }` (preload.cjs) and `tvashtrDesktopInfo.version = 3`. Add a
`repos` namespace, bump the version to 4 for feature detection, and add the types to `frontend/src/vite-env.d.ts`
(`TvashtrDesktopBridge`). Every handler lives in `desktop/electron/main.cjs` (or `electron/repos/*.cjs`) and runs git
through the existing PATH enrichment (`harness/spawnEnv.cjs`, `pathDetect.cjs`).

| Method (renderer) | IPC channel / main handler | Purpose (req) |
|---|---|---|
| `repos.pickFolder(): Promise<{path: string, displayPath: string} \| null>` | `tvashtr:repos:pickFolder` → `dialog.showOpenDialog(mainWindow, {properties:["openDirectory"], title:"Choose a folder"})`; `displayPath` replaces `$HOME` with `~` | "Choose a folder…" (HOME-20) |
| `repos.inspect(path): Promise<{is_git:true, current_branch, branches[], tracked_file_count, subpaths[{path,file_count}], remote_url:string\|null} \| {is_git:false, error}>` | `tvashtr:repos:inspect` → mirrors `worktree.repo_inspect` + `repo_subpaths` using local git (`rev-parse --is-inside-work-tree`, `branch --format`, `ls-files`) | Branch shown in the button, the Base branch and Scope options, validation (HOME-19/21/22/23) |
| `repos.recent.list(): Promise<{path, displayPath, branch:string\|null, available:boolean}[]>`, `repos.recent.add(path)`, `repos.recent.remove(path)` | `tvashtr:repos:recent:*` → JSON in `app.getPath("userData")/recent-folders.json`, max 8, most recent first; `list` re-checks each path | "Recent folders" (HOME-20/21) |
| `repos.prepareRun({path, baseRef}): Promise<{snapshot_id: string}>` | `tvashtr:repos:prepareRun` → `git bundle create <tmp> <baseRef>`, upload with the session cookie through the local proxy (the pattern in `runner/api.cjs`) to `POST /api/desktop/repo-snapshots` | Launch on a folder (P10) |
| `repos.bringBackBranch({path, runId}): Promise<{branch: string}>` + `repos.onBranchReady(cb): () => void` | `tvashtr:repos:bringBack` → download `GET /api/runs/{id}/ship-bundle`, then `git fetch <bundle> tvashtr/<id>:tvashtr/<id>` inside `path` (never checkout, never touches the working tree); the runner could call it automatically when a run it owns completes | "Your working folder is never touched" + where the result lands (P10, HOME-86) |
| *(optional)* `repos.reveal(path)` | `shell.showItemInFolder` | Not in the design; useful from Recent runs on a folder run |

These need **no** bridge method:
- PR links: `setWindowOpenHandler` already sends non-auth URLs to `shell.openExternal` (main.cjs:272).
- "Add repos on GitHub…": `isGithubAuthUrl` keeps `/installations/new` and `/apps/*/installations` in the window.
- ⌘K / N / T: handled in the renderer. Check that no application-menu accelerator steals Cmd+K or Cmd+N.

Window title: Electron shows `document.title`. Set the SPA `<title>` (or handle `page-title-updated`) to "Tvashtr — the
living canvas" for HOME-6.

---

## 5. Frontend mapping

**Today:**
- `components/Dashboard.tsx` (688 lines) renders Home as a greeting, three stat tiles and a team table with inline
  rename, delete confirm, a run-history drill-down, and a failed-run "recover" strip whose Retry just opens the canvas.
- Launching lives in `App.tsx`: "Run this team" → `LaunchPanel` → `handleLaunch`, which runs `runTeam` with
  `desktop_target` and swaps to the run view.
- The credential gate runs in an `App.tsx` effect (`listProviders` + `listSubscriptionStatuses` →
  `missingProvidersForModels`).
- Approve and reject exist only inside a run: `TasksDrawer` + `App.handleResolve`.
- Stop exists only in the canvas (`CancelRunButton` + `App.handleCancel`).
- There is no router: `AuthGate` switches between `Dashboard` and `App` using `openTeamId` / `openRunId` / `dashView`.

**Keep or reuse:**
- `AuthGate` routing: it already threads `onOpenRun(runId, teamId)` and `initialRunId` into `App` (HOME-107). It must
  also pass `config` to `Dashboard`, and gain a deep link for Toolkit › Memory › Inbox (HOME-49).
- `AppShell`: extend it with the header search button, the connection label, nav badges and counts, the shortcuts
  footer, and the Tools→Toolkit rename (`DashView "tools"` → `"toolkit"` plus sub-views).
- `BackendDot`: add a text-label variant.
- `NewTeamDialog` (New team, "New team…", `T`, Use template).
- `panel/PrdView` for the spec body and live edit in the Approve sheet.
- `lib/useModalDialog` for focus trapping.
- `lib/engines` (`missingProvidersForModels`, `subscriptionProviderForModel`, `displayNameForSubscription`).
- `lib/status` (`runStatusPill`, `RUN_TERMINAL`; map tones to Badge variants: paused→warning, running→info,
  failed→danger, done→success, idle→neutral, stopped→outline, overbudget→warning).
- `lib/time.formatRelativeTime`; add an elapsed form: "26m", "just now", "waiting 26m".
- `lib/api` functions: `runTeam`, `resolveTask`, `cancelRun`, `addProvider`, `getGithubRepos`, `getTemplates`,
  `listMemories`.

**Extract (shared by the canvas and Home):**
- `lib/launch.ts`: the launch logic from `App.handleLaunch` (desktop_target, and `ApiError` message / `missingNodes`
  handling).
- `useCredentialGate` hook, from App's effect.
- `RepoPicker` state machine, from LaunchPanel's hosted repo-list logic and its three empty states, plus the
  large-repo and edits-off advisories (keep them as inline notes).

LaunchPanel itself can either stay for the canvas's "Run this team" or be replaced by jumping to the Home composer
with the team preselected (Q18).

**Rebuild or replace:**
- The Home branch of `Dashboard.tsx` becomes a new `HomePage`, made of:
  - `GreetingLine`;
  - `RunComposer` = `TeamPicker`, `IdeaBox`, `RepoPicker` (website) / `FolderPicker` (Desktop, bridge),
    `RunOptionsPopover`, `ReadinessHint`, `LaunchAlert`, retry note;
  - `AddApiKeySheet` + a sequencer; shared with the Engines area (EnF-OvAddKey); built from EnginesShelf's add-key
    form;
  - `NeedsYouInbox` (`InboxItem` variants + `ItemMenu`);
  - `ApproveSpecSheet` + `RejectSpecDialog`;
  - `RunningNowCard` (`RunProgressStrip`, which the Teams card shape also uses; `BudgetMeter`) + `StopRunDialog`,
    replacing `CancelRunButton`'s arm-and-confirm on Home;
  - `TeamsGrid` / `TeamCard` (shared with the Teams flows);
  - `RecentRunsList`;
  - `SpendPanel`;
  - `FirstTimeChecklist`, `TemplateCards`, `HowItWorks`;
  - `HomeSkeleton`.
- Remove from Home: the stats strip; the team table with inline rename and delete (these move to the Team ⋯ menu
  flow); the drill-down (moves to the History flow).
- New app-level pieces: `Toaster` (`role=status`, action and undo, one at a time); `useHotkeys` (N, T, ⌘/Ctrl-K, with
  the input and dialog guards); `useHomeData` polling (`/api/inbox`, `/api/runs?status=active&include=progress`,
  `/api/runs?limit=5`, `/api/teams`, `/api/spend`; refetch after every action).

**Shared primitives the designs use:**
- `DS.Button` (primary / secondary / ghost, sm, loading), `DS.IconButton` (⋯, Close), `DS.Badge` (dot variants:
  warning, info, danger, success, neutral, outline), `DS.Tabs` (pill, with counts), `DS.Input` (label, helper,
  multiline, password, sm), `DS.Select`, `DS.Avatar`, `DS.Logo`, `DS.Switch`.
- A Listbox popover (team, repo and folder pickers, the sort menu), a Menu (⋯), a Sheet (right side, scrim; 520 and
  620px), an AlertDialog (confirm, with an optional note field), a Toast with action/undo, and a skeleton block.

**No React design-system components exist in the repo.** `frontend/src/design-system/` holds only token CSS, so these
primitives are a prerequisite shared with every area.

**Tests that change:** `Dashboard.test.tsx`, `AppShell.test.tsx`, `LaunchPanel.test.tsx`, `App.test.tsx` (the launch
path moves). Also note `frontend/CLAUDE.md` asks for "one screen = one route file", but the app has no router. Home
stays a state-switched view unless a router is introduced (a decision for the plan).

---

## 6. Open questions / ambiguities (each with a recommendation)

1. **Local-folder runs on Desktop can't work against hosted Fly today.** Hosted mode fences `repo_path` and
   inspection; workspaces live on the server.
   *Recommend:* P10 (upload a bundle, bring back a branch). In the meantime, ship Desktop with GitHub repos plus
   "Choose a folder…" enabled only when pointed at a self-hosted local backend.
2. **The budget helper "The run stops if it would spend more." is wrong.** The backend *pauses* at a blocking
   `budget_approval` gate after a step and can overshoot by about one step.
   *Recommend:* change the copy to "The run pauses and asks you before spending more." Keep the backend behaviour.
3. **Week and month boundaries.**
   *Recommend:* the browser's time zone (sent as `tz`), weeks starting Monday, and the month as the calendar month.
4. **Spend per team.** In the panel it is this month (the rows sum to the month total); on team cards it is all time
   (both $4.82 in the sample).
   *Recommend:* the panel shows the month and the card shows all time, both live.
5. **"In progress" vs "Running now".** "{n} runs in progress" excludes awaiting-approval runs; Running now includes
   them.
   *Recommend:* keep this as designed.
6. **Finished runs in Running now.** After Stop the card stays as "Stopped"; after Reject it disappears.
   *Recommend:* one rule — a run that ends while Home is open stays as a muted card until the next full load, or 60s.
   Cards that were already terminal when Home loaded are never shown.
7. **⋯ menus for approve, failed and setup items are not designed.**
   *Recommend:* HOME-50. Blocking approvals can't be dismissed, only snoozed.
8. **Setup-gap noise.** Every team without keys produces a row.
   *Recommend:* one row per team for teams active in the last 30 days (or run at least once), and fold the rest into
   "{n} more teams can't run on the website".
9. **Setup gaps on Desktop.** The design shows gaps for the website even on Desktop.
   *Recommend:* keep them, and add a "can't run on this computer" gap when a team has neither a key nor a fresh
   subscription.
10. **Which team version a retry uses.**
    *Recommend:* the current library team (the user may have fixed a model), with the old run's idea, target, branch,
    scope and budget, and `retry_of_run_id` recorded.
11. **Retry keys hint in the sample** still reads "Website needs 2 keys" for Bugfix squad, which lacks only xai.
    *Recommend:* compute it; it should read "Website needs xai key".
12. **What "Start again" after a reject should carry.**
    *Recommend:* prefill the same team, idea and target, and append the reject note to the idea as a new paragraph
    ("Also: …"), editable before Launch.
13. **The seeded "My team" conflicts with "Create a team 0 of 4".**
    *Recommend:* stop seeding new accounts (Home no longer needs a team to render), and treat `created_from='seed'`
    as not user-created for existing ones.
14. **When first-time mode shows.**
    *Recommend:* when the account has no runs and the checklist isn't hidden. The rest of Home appears after the first
    run. "Start a run" in the checklist reveals the composer in place.
15. **Self-hosted website** (`hosted_mode=false`, local dev).
    *Recommend:* the repo popover offers "Type a path…", which uses `/api/repo/inspect` as LaunchPanel does now.
16. **Desktop shows only folders.** Users who want PR runs on Desktop have no path.
    *Recommend:* two groups in the Desktop popover, "Recent folders" and "GitHub App repos".
17. **1024 drops Recent runs and Spend.**
    *Recommend:* stack them under Teams below 1200px; don't hide them.
18. **"N from anywhere".**
    *Recommend:* across all dashboard pages; on the canvas, N returns to the Home composer with that team selected.
    Also replace the canvas's LaunchPanel with that jump for one launch surface, or keep LaunchPanel as a fallback.
19. **The label "Written by Product manager".**
    *Recommend:* take the entry node's `role_name`, with a small map for the built-in presets (PM → Product manager,
    Architect → Architect). Show "Edited by you" when the latest version's `created_by` is `human`.
20. **Greeting counts turn into plain text in the later flow frames.**
    *Recommend:* always links when a count is above 0.
21. **Completed runs without a PR** (fresh app, local folder).
    *Recommend:* show "Branch tvashtr/…" for folder runs and "Shipped" for fresh-app runs.
22. **The idea is required on Home, but the API still defaults an empty idea** (`resolve_run_idea`).
    *Recommend:* require it on the client only; leave the API default for scripts.
23. **Readiness wording in the team picker on Desktop.**
    *Recommend:* use the target's wording: "Ready on this computer" / "This computer: needs {p} key".
24. **"Remind me tomorrow".**
    *Recommend:* 09:00 local time the next day, sent as an absolute `until`.
25. **A failed run with no recorded reason** (workflow ERROR, Desktop offline).
    *Recommend:* the P9 fallback copy "The run stopped with an error." plus View run.
26. **Security, outside this area's UI.** `GET /api/costs` and `GET/POST /api/documents/{id}` aren't owner-scoped
    (authenticated but cross-account).
    *Recommend:* fix both before Home reads specs and spend through them. P4 replaces `/api/costs` for Home.
