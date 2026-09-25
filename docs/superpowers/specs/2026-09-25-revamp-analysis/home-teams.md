# home-teams — Gap analysis (prefix `TEAMS-`)

Scope: the Home page shell (header, nav footer, greeting), the **Teams** section (tabs, search,
sort, grid/list, ⋯ menu, rename, duplicate, delete, run history), the **New team** dialog, the
**⌘K** palette, the **account menu** + keyboard shortcuts, the **backend-unreachable** state,
**Recent runs** (filter, PR links), the **Spend** panel (no analyst owns it, so it is covered here),
and the **first-time get-started checklist**. The Start-a-run composer, Needs you and Running now
belong to other analysts. This report only lists them where my flows call into them.

Code read: `frontend/src/components/{Dashboard,NewTeamDialog,AppShell,BackendDot,AuthGate,DomainsPage}.tsx`,
`frontend/src/lib/{api,status,time,desktopDownload}.ts`, `frontend/src/vite-env.d.ts`,
`frontend/src/design-system/components/ds.css`, `backend/tvashtr/{routers,main,auth,models,metering}.py`,
`backend/tvashtr/control_plane/{teams,team_run,desktop_jobs}.py`, `desktop/electron/{main,preload}.cjs`.

---

## 1. Screens

**HmF-Index**: a legend page. It lists the 23 Home flows (79 screens). My flows: Teams tabs (4),
Teams search/sort/grid-list (4), Teams ⋯ menu (8), Teams run history (4), New team (6), ⌘K (3),
Account menu (2), Backend can't be reached (2), Recent runs filter + PR (4), First time checklist (7).

**Home-Main (context, website)**: a 60px header holds the Logo, a centred 420px search button
("Search teams, runs and actions" with a `⌘K` kbd), the connection state ("Connected" with a green dot)
and the avatar. The left nav shows Home (with a count, "4"), Domains, Engines (a WARN chip, "2 to fix")
and **Toolkit** (renamed from today's "Tools", with a WARN chip, "1 missing"). A "Shortcuts" footer in
the nav reads "⌘K search and actions", "N new run · T new team". The main area opens with a greeting
("Good morning, Lazyx."), a summary line of three dashed links ("4 things need you · 1 run in progress ·
$6.19 spent this week") and a secondary "New team" button. Below that is a 2-column grid: the main
column holds Start a run, Needs you, Running now and **Teams**; a 330px right rail holds **Recent runs**
and **Spend**. The Teams toolbar has a search input, a "Sort: Last active" dropdown, a Grid/List pill
toggle and status pill tabs with counts. Team cards sit in a 2-column grid. **Home-Desktop** differs
only in the window chrome title and the composer (local folder, "Ready on this computer · Claude,
Grok"), so my sections are identical on Desktop. **Home-Web1024** removes the right rail entirely
(no Recent runs, no Spend). **Home-Loading** shows grey skeleton blocks.

**HmF-TeamTabs-1…4 (tabs)**: the pill tabs are All 5 / Needs you 2 / Running 1 / Not run yet 1.
- **All**: shows all 5 cards.
- **Needs you**: shows the cards whose latest run is "Awaiting you" or "Failed".
- **Running**: shows only the "Running" card. The "Awaiting you" team is not listed there.
- **Not run yet**: shows only the never-run card.

The rest of the page stays the same across tabs.

**HmF-TeamFind-1…4 (search, sort, grid/list)**:
1. Typing "payments" with no match replaces the grid with an empty state: "No teams match “payments”",
   "Try another word, or start a new team from a template.", [Clear search] [New team].
2. Opening Sort shows a listbox: Last active (selected), Name, Spend, Created.
3. "Sort: Spend" reorders the cards by spend, highest first ($9.10 first).
4. Switching to **List** renders a table with the columns Team (name plus the pipeline strip),
   Status, Last run, "Runs · spend" and ⋯. A never-run team shows "0 · $0.00" and "Created yesterday
   from PM → Engineer" in the Last run cell. List rows have no Run button.

**HmF-TeamMenu-1…8 (⋯ menu)**:
1. ⋯ on a card opens a 220px menu: Open canvas, Start a run, Run history | Rename, Duplicate | Delete
   team (in danger colour).
2. **Start a run** leaves the page in place, sets the composer's team and shows a dark toast:
   "Indicator sprint team picked. Say what to build."
3. **Rename** swaps the card's name and badge for an input (aria "Team name", pre-filled) plus "Save
   name" and "Cancel" icon buttons.
4. Clearing the name shows the error "Give this team a name so you can tell it apart."
5. Saving shows the new name ("Indicators squad") in place. No toast.
6. **Duplicate** adds a card "Indicator sprint team (copy)" with status Not run yet, "Copied just now"
   and "No runs yet". It has the same pipeline strip.
7. **Delete** opens an alertdialog (500px, scrim): "Delete Indicator sprint team? This deletes the team
   and its 7 runs, including their history. You can’t undo this." A WARN strip reads "A run is waiting
   for your approval. Deleting stops it." Buttons: Cancel (ghost) and Delete team (secondary).
8. After deletion the card is gone and a toast reads "Indicator sprint team deleted."

**HmF-History-1…4 (run history sheet)**: ⋯ → Run history opens a 480px right sheet (role=dialog). The
title is "Run history" and the subtitle "Indicator sprint team · newest first", with a Close button. The
footer reads "Click a run to open it on the canvas." and has an [Open canvas] button.
1. Loading: 4 skeleton rows.
2. Loaded: each row shows the idea, a status badge (Awaiting you, Completed, Failed, Stopped), a
   "Sep 25 · $1.21" line and a "PR #39" link on runs that opened a PR.
3. Couldn't load: "Couldn’t load this team’s runs — is the backend running?" with [Try again].
4. Never ran: "This team hasn’t run yet", "Start a run from Home, or open the team and press Run." and
   a primary [Start a run].

**HmF-NewTeam-1…6**: a 720px modal "New team".
1. The Name input has the placeholder "e.g. Launch squad" and the helper "So this isn’t another “New
   team”.". Under "Starting point" are 5 selectable cards (aria-pressed), each with a name, a pipeline
   strip and a description: Blank (selected), PM → Engineer, PM → Engineer ⇄ Reviewer, PM → Architect
   → Engineer ⇄ Reviewer, and Full feature squad. The footer note reads "You can change every agent
   after you create it." Buttons: Cancel and Create team.
2. Create with an empty name shows the input error "Give this team a name so you can tell it apart."
3. The user names the team "Payments squad" and picks the review-loop card.
4. The primary button becomes a loading "Creating…".
5. The canvas opens on the new team with a toast "Payments squad created. Click an agent to set it
   up, then Run."
6. Templates failed to load: "Starting point Couldn’t load the starter templates — is the backend
   running? You can still start from Blank." Only the Blank card is shown.

**HmF-CmdK-1…3**: a 640px palette dialog.
1. With an empty query it shows a **Needs you** group (Approve the spec · Indicator sprint team; Run
   failed · Bugfix squad) and an **Actions** group (Start a run `N`, New team `T`, Add an API key ·
   Engines, Open Toolkit). The footer reads "↑↓ move ↵ open esc close".
2. Typing "ind" gives three groups:
   - **Teams**: Indicator sprint team, "7 runs · Awaiting you".
   - **Runs**: two ideas with "team · time".
   - **Actions**: "Start a run on Indicator sprint team" and "Open the Indicators domain" (hint "Domains").
3. "zzz" shows "Nothing matches “zzz”. Try a team name, a run, or an action like “new team”."

**HmF-Account-1…2**: the avatar opens a 250px popover. It shows the avatar letter, "Lazyx" and the email,
then Download Tvashtr Desktop, Keyboard shortcuts (hint `?`), a separator and Log out. **Keyboard
shortcuts** opens a 500px dialog: "Work from the keyboard anywhere in the dashboard." It lists Search and
actions ⌘K, Start a run N, New team T, Show shortcuts ?, Close a menu or sheet Esc, and a [Done] button.
On Desktop the "Download Tvashtr Desktop" item makes no sense (see §6).

**HmF-Backend-1…2**:
1. The header status turns red: "Can’t reach backend". A red banner (role=alert) at the top of main
   reads "Couldn’t reach the backend — some sections may be stale. Last updated 2 minutes ago." with
   [Try again]. The data from the last good load stays on screen.
2. After Try again succeeds, the banner is gone, the header reads "Connected" and a toast says
   "Reconnected. Everything is up to date."

**HmF-RunsFilter-1…4 (Recent runs)**: each row has a status dot, the idea, "team · relative time", and
on the right either the status text or a "PR #42" link.
1. The "All runs" button opens a listbox: All runs, Running, Needs you, Completed, Failed, Stopped.
2. "Failed" leaves only the failed row.
3. "Stopped" with no matches shows "No runs match this filter."
4. Hovering "PR #42" shows a tooltip: "Opens github.com/lazyxgenius/trade_mcp/pull/42 in a new tab".

**HmF-FirstTime-1…7**: a Home variant for new accounts.
1. The page reads "Welcome to Tvashtr, Lazyx." and "Build a team of agents, run it on your repo, and
   review the pull request it opens.". Nav badges are hidden and so are the Teams, Recent runs and
   Spend sections. A **Get started** card ("0 of 4 done", "Hide checklist") lists 4 numbered steps.
   The first step is primary: "Connect an engine" [Open Engines]. The other buttons are ghost: Create a
   team [New team], Start your first run [Start a run], Review the pull request [See how]. Below the
   card are "Start from a template" (4 template cards with [Use template]) and "How Tvashtr works"
   (3 numbered points).
2. Open Engines lands on Engines › Overview (setup), which the Engines analyst owns.
3. 1 of 4: step 1 shows as "Done" and "New team" becomes primary.
4. 2 of 4: the template block is replaced by the Start-a-run composer with the new team pre-picked
   ("Ready on the website"), and "Start a run" is primary.
5. 3 of 4: the Running now section shows the first run and "See how" is primary.
6. 4 of 4: the heading changes to "You’re all set". An OK callout reads "Your first pull request is
   open: PR #1. Home now shows your runs and teams." with a primary [Hide checklist].
7. Hidden: Home returns to normal ("Good morning, Lazyx.", "Nothing needs you · nothing running ·
   $0.84 spent this week", empty-state Needs you and Running now, a single team card, one recent run
   with PR #1). There are **no status tabs** when there is only one team. A toast reads "Checklist
   hidden. Bring it back from the account menu."

---

## 2. Behaviour requirements

### Shell: header and nav
- **TEAMS-1** Header, left to right:
  - The Logo (DS.Logo, size 26).
  - A centred 420px search button with the accessible name "Search teams, runs and actions", a search
    icon and a kbd showing "⌘K" on macOS and "Ctrl K" elsewhere. Clicking it opens the palette (TEAMS-50).
  - The connection status (TEAMS-61).
  - The avatar (DS.Avatar sm, accent, the user's initial). Clicking it toggles the account menu (TEAMS-56).
- **TEAMS-2** Nav items: Home, Domains, Engines, **Toolkit** (rename the current "Tools" label).
  Badges: Home shows the Needs-you item count ("Home 4", hidden at 0); Engines shows a WARN chip
  "{n} to fix"; Toolkit shows a WARN chip "{n} missing". The data comes from the Needs-you, Engines
  and Toolkit analyses. All badges are hidden in the first-time state.
- **TEAMS-3** Nav footer "Shortcuts" shows kbd rows: "⌘K search and actions" and "N new run · T new team".

### Greeting and summary
- **TEAMS-4** Heading "Good {morning|afternoon|evening}, {Name}.", using the local clock. {Name} is the
  GitHub login if there is one, else the email local-part with the first letter capitalised ("Lazyx").
- **TEAMS-5** Summary line of three anchor links separated by "·":
  - "{n} things need you" scrolls to Needs you.
  - "{n} run(s) in progress" scrolls to Running now. It counts pending/running only; awaiting runs are
    under "need you". Singular forms: "1 thing needs you", "1 run in progress".
  - "${x} spent this week" scrolls to Spend.
  - The all-zero form is plain text: "Nothing needs you · nothing running · ${x} spent this week".
- **TEAMS-6** Secondary "New team" button in the greeting row opens the New team dialog.

### Teams section: toolbar
- **TEAMS-7** Section title "Teams". A search input (DS.Input sm, placeholder "Search teams") filters
  teams live by a case-insensitive substring of the name. It combines with the active status tab.
- **TEAMS-8** No-match empty state: "No teams match “{query}”" and "Try another word, or start a new
  team from a template.". [Clear search] (secondary sm) empties the input. [New team] (primary sm)
  opens the New team dialog.
- **TEAMS-9** Sort button "Sort: {option}" (aria-haspopup=listbox, aria-expanded) opens a listbox with
  Last active (default), Name, Spend, Created; the current option has aria-selected=true. Orders:
  - **Last active**: newest activity first, where activity is the latest run activity, else the team's
    created time.
  - **Name**: A→Z (locale compare).
  - **Spend**: highest first.
  - **Created**: newest first.
  The choice is saved per browser in localStorage.
- **TEAMS-10** A Grid/List pill toggle (DS.Tabs pill, items Grid|List, default Grid), saved per browser
  in localStorage.
- **TEAMS-11** Status pill tabs with counts: All {n}, Needs you {n}, Running {n}, Not run yet {n}.
  - Needs you: latest run is `awaiting_human` or `failed`.
  - Running: latest run is `pending` or `running`.
  - Not run yet: no runs.
  - The tabs are hidden when the account has fewer than 2 teams (FirstTime-7).
- **TEAMS-12** Empty tab (not designed): one line per tab, e.g. "No teams are running right now." and
  "Every team has run at least once." Copy is to be confirmed.

### Team card (grid, 2 columns) and list row
- **TEAMS-13** Card header: the team name (15px semibold) and a status badge with a dot:
  - Awaiting you (warning)
  - Running (info)
  - Failed (danger)
  - Completed (success)
  - Not run yet (neutral)
  - Stopped (outline) for `cancelled`/`rejected`
  - Over budget for `over_budget` (see §6 Q3)
- **TEAMS-14** **Pipeline strip**: one 22px chip per node along the main path, from the start node to
  Ship. Each chip has a role icon and a `title` tooltip (PM, Architect, Approval, Engineer, Reviewer,
  Ship, or Thinker/Worker/Domain for custom nodes). Chevrons separate the chips, and a **⇄** glyph sits
  between two nodes joined by a loop-back edge. The same strip appears in list rows, New-team template
  cards and first-time template cards.
- **TEAMS-15** Last-run line:
  - Running: "{idea} · started {rel(created_at)}".
  - Awaiting / Failed / Completed / Stopped: "{idea} · {rel(last activity)}" ("26m ago", "11h ago", "2d ago").
- **TEAMS-16** Never-run team: "Created {day-relative} from {template name}", e.g. "Created yesterday
  from PM → Engineer", plus "No runs yet". A duplicated team shows "Copied {just now}" plus "No runs
  yet". A Blank team shows "from Blank". Seeded or legacy teams with no known template show "Created {x}".
- **TEAMS-17** Counts: "{n} runs · ${spend}" ("1 run" singular; spend to 2 decimals).
- **TEAMS-18** A ghost **Run** button (play icon) does the same as ⋯ › Start a run (TEAMS-24).
- **TEAMS-19** A ⋯ IconButton (aria-label "More actions for {team}") opens the team menu (TEAMS-22).
- **TEAMS-20** Clicking the card body, outside its buttons, opens the team on the canvas (recommended;
  the menu also has Open canvas).
- **TEAMS-21** List view is a table with the columns Team (name + strip), Status (badge), Last run
  ("{idea} · {time}" or "Created yesterday from PM → Engineer"), "Runs · spend" ("7 · $4.82",
  "0 · $0.00") and a ⋯ cell. Clicking a row opens the canvas. Inline rename works in the Team cell.

### Team ⋯ menu and actions
- **TEAMS-22** Menu (role=menu, 220px popover anchored to ⋯) with icons: Open canvas, Start a run,
  Run history, separator, Rename, Duplicate, separator, **Delete team** (danger colour). Arrow keys
  move, Enter activates, Esc or an outside click closes and returns focus to ⋯.
- **TEAMS-23** **Open canvas** opens the team on the canvas (AuthGate `onOpenTeam`).
- **TEAMS-24** **Start a run** sets this team in the Start-a-run composer, scrolls the composer into
  view, focuses the idea field and shows a toast "{team} picked. Say what to build."
- **TEAMS-25** **Run history** opens the run-history sheet (TEAMS-36).
- **TEAMS-26** **Rename**: the name and badge become an input (aria-label "Team name", pre-filled and
  selected) with "Save name" (✓) and "Cancel" (✕) icon buttons. Enter saves; Esc and ✕ cancel.
- **TEAMS-27** A blank or whitespace name on save shows the input error "Give this team a name so you
  can tell it apart." and sends no request. A server 422 maps to the same copy.
- **TEAMS-28** A successful rename updates the card in place (the name and the ⋯ aria-label) with no
  toast. On failure the editor stays open and a toast says "Couldn’t rename the team — is the backend
  running?" (not designed; proposed).
- **TEAMS-29** **Duplicate** creates "{name} (copy)" with the same nodes, edges, prompts, models,
  tools, skills, gate/terminal config, edits toggles and layout. It copies no runs. The new card shows
  Not run yet, "Copied just now" and "No runs yet". Scroll to it and briefly highlight it.
- **TEAMS-30** **Delete team** opens an alertdialog (500px, scrim, focus trapped, aria-label "Delete
  {team}?"). The text reads "Delete {team}?" then "This deletes the team and its {n} runs, including
  their history. You can’t undo this." Buttons: Cancel (ghost) and Delete team.
- **TEAMS-31** Impact warning strip (WARN) in the delete dialog:
  - A run of the team is awaiting approval: "A run is waiting for your approval. Deleting stops it."
  - A run is pending/running: "A run is in progress. Deleting stops it." (proposed)
  - Zero runs: the body becomes "This deletes the team. You can’t undo this." (proposed)
  - Exactly 1 run: "its 1 run".
- **TEAMS-32** Confirming removes the card and shows a toast "{team} deleted." (no undo; the action is
  irreversible). On error the dialog stays open with "Couldn’t delete the team — is the backend
  running?" (proposed). Deleting the **last** team must not bring back a default team (see gap G-13).
- **TEAMS-33** All mutations (rename, duplicate, delete) refresh the counts, tab counts, Spend, Recent
  runs and ⌘K data. Deleting a team also removes its runs from Recent runs.

### Run history sheet
- **TEAMS-34** A right sheet (480px, role=dialog, scrim) with title "Run history" and subtitle "{team} ·
  newest first". Close, Esc and the scrim close it and return focus to the opener.
- **TEAMS-35** Loading: 4 skeleton rows.
- **TEAMS-36** Loaded: one row per run, newest first. Each row shows the idea, a status badge (TEAMS-13
  vocabulary) and "{Mon D} · ${cost}". The cost includes the live cost of in-flight runs and the actual
  cost of failed/cancelled runs. A "PR #{n}" link appears when the run opened a PR. Clicking a row opens
  that run on its team's canvas (existing `onOpenRun(runId, teamId)`).
- **TEAMS-37** Error: "Couldn’t load this team’s runs — is the backend running?" with [Try again],
  which refetches.
- **TEAMS-38** Empty: "This team hasn’t run yet", "Start a run from Home, or open the team and press
  Run." and a primary [Start a run], which closes the sheet and behaves as TEAMS-24.
- **TEAMS-39** Footer: "Click a run to open it on the canvas." and [Open canvas] (secondary), which
  opens the team.

### New team dialog
- **TEAMS-40** A 720px modal "New team" with Close. Triggers: greeting New team, `T`, ⌘K "New team",
  the search-empty New team, first-time step 2, first-time "Use template" (template pre-selected), and
  Domains' "create team".
- **TEAMS-41** Name input: label "Name", placeholder "e.g. Launch squad", helper "So this isn’t another
  “New team”.".
- **TEAMS-42** Create with a blank name shows the input error "Give this team a name so you can tell
  it apart." (replacing the helper). The error clears on typing.
- **TEAMS-43** "Starting point" cards (buttons, aria-pressed; Blank selected by default), each with a
  name, pipeline strip and description:
  - Blank: "An empty canvas: one thinker into Ship. Wire the rest yourself."
  - PM → Engineer: "A PM writes the spec; an Engineer builds and ships it. No review step."
  - PM → Engineer ⇄ Reviewer: "Adds a Reviewer that runs the tests and loops back for fixes."
  - PM → Architect → Engineer ⇄ Reviewer: "Two thinkers plan it, then a build-and-review loop ships it."
  - Full feature squad: "Plan, you approve, build and test in a loop, you approve the ship."
- **TEAMS-44** Note "You can change every agent after you create it." Footer: Cancel (ghost) and Create
  team (primary).
- **TEAMS-45** While creating, the primary button is loading with the label "Creating…" and the form
  is disabled.
- **TEAMS-46** On success the dialog closes, the canvas opens on the new team, and the canvas shows a
  toast "{name} created. Click an agent to set it up, then Run.".
- **TEAMS-47** Template load failure: the text "Couldn’t load the starter templates — is the backend
  running? You can still start from Blank." appears beside "Starting point" and only the Blank card is
  shown. Create still works.
- **TEAMS-48** Create failure (not designed): the dialog stays open with "Couldn’t create the team — is
  the backend running?" (existing copy) and the button re-enables.

### ⌘K palette
- **TEAMS-49** ⌘K (macOS) or Ctrl+K (others), or the header button, opens a 640px dialog anywhere in
  the dashboard; ⌘K again closes it. The input placeholder is "Search teams, runs and actions…" with an
  "esc" hint. The footer reads "↑↓ move ↵ open esc close".
- **TEAMS-50** Empty query shows two groups:
  - **Needs you**: the top Needs-you items ("Approve the spec" · team, "Run failed" · team).
  - **Actions**: Start a run (kbd N), New team (kbd T), Add an API key (hint "Engines"), Open Toolkit.
- **TEAMS-51** Query matching is case-insensitive over team names, run ideas, domain names and action
  labels. Groups:
  - **Teams**: name plus "{n} runs · {status label}".
  - **Runs**: idea plus "{team} · {rel time}".
  - **Actions**: contextual "Start a run on {team}" for matching teams, "Open the {domain} domain"
    (hint "Domains"), and matching static actions.
- **TEAMS-52** No match: "Nothing matches “{q}”. Try a team name, a run, or an action like “new team”."
- **TEAMS-53** Keyboard: ↑/↓ move across all groups, ↵ opens, Esc closes. Hovering moves the selection.
  Use combobox/listbox ARIA with aria-activedescendant.
- **TEAMS-54** Targets:
  - A team opens the canvas.
  - A run opens that run on its team's canvas.
  - "Start a run [on X]" behaves as TEAMS-24.
  - New team opens the dialog.
  - A domain opens Domains with that domain selected.
  - Add an API key opens Engines › API keys.
  - Open Toolkit opens Toolkit.
  - A Needs-you item performs that item's primary action (the Needs-you analyst defines it).

### Account menu and shortcuts
- **TEAMS-55** Account popover (250px): the avatar letter, name and email; "Download Tvashtr Desktop"
  (website only, TEAMS-57); "Keyboard shortcuts" with a `?` hint; a separator; "Log out" (existing
  logout). Use menu/menuitem roles, not the designed option roles. Esc and an outside click close it.
- **TEAMS-56** When the get-started checklist is hidden, the account menu shows an item that brings it
  back (e.g. "Show get-started checklist"). FirstTime-7's toast promises this, but Account-1 lacks it.
- **TEAMS-57** "Download Tvashtr Desktop" opens the latest Mac DMG, or the releases page on
  non-Mac, in a new tab. It is hidden in Desktop (see §4 for the optional Desktop replacement).
- **TEAMS-58** Keyboard shortcuts dialog (500px, focus-trapped): title "Keyboard shortcuts", "Work from
  the keyboard anywhere in the dashboard.", then Search and actions ⌘K, Start a run N, New team T, Show
  shortcuts ?, Close a menu or sheet Esc, and [Done] (primary).
- **TEAMS-59** Global shortcuts on the dashboard:
  - `N` focuses the composer's idea field. If there is no composer because the user has no team, it
    opens New team.
  - `T` opens New team.
  - `?` opens the shortcuts dialog.
  - `Esc` closes the topmost menu, sheet, dialog or palette.
  - `⌘K`/`Ctrl+K` opens the palette.

  Single-key shortcuts are ignored while focus is in an input, textarea, select or contenteditable
  element, while a modal is open, and whenever Meta, Ctrl or Alt is held, so ⌘T/⌘N/Ctrl+T/Ctrl+N stay
  with the browser or OS.

### Backend reachability
- **TEAMS-60** The header status shows "Connected" with a green dot when the backend is reachable and
  "Can’t reach backend" with a red dot when it is not. It replaces today's bare `BackendDot`.
- **TEAMS-61** When the backend is unreachable, a banner (role=alert) at the top of main reads
  "Couldn’t reach the backend — some sections may be stale. Last updated {rel(lastSuccessAt)}." with
  [Try again]. Sections keep showing the last good data; nothing is blanked.
- **TEAMS-62** Try again rechecks health and refetches every Home data source. On success the banner
  goes away, the header reads Connected and a toast says "Reconnected. Everything is up to date." On
  failure the banner stays. The periodic health check also recovers on its own and shows the same toast.

### Recent runs (right rail)
- **TEAMS-63** "Recent runs" lists the 5 newest runs across all teams. Each row shows:
  - a status dot (title = status label),
  - the idea (1 line, ellipsis),
  - "{team} · {rel time}",
  - on the right, the status text (Awaiting you / Running / Failed / Stopped), or a "PR #{n}" link
    with a link icon when the run opened a PR.
- **TEAMS-64** A filter button shows the current filter ("All runs") and opens a listbox: All runs,
  Running, Needs you, Completed, Failed, Stopped. Mapping: Running = pending|running; Needs you =
  awaiting_human; Completed = completed; Failed = failed; Stopped = cancelled|rejected|over_budget.
- **TEAMS-65** A filter with no results shows "No runs match this filter."
- **TEAMS-66** "Show more" appends the next page and is hidden when there are no more runs.
- **TEAMS-67** The PR link has a tooltip "Opens {host/path of pr_url} in a new tab" and opens `pr_url`
  with `target=_blank rel=noopener`. On Desktop the tooltip reads "…in your browser" (see §4).
- **TEAMS-68** Clicking a row (outside the PR link) opens that run on its team's canvas.

### Spend panel (right rail; no other owner)
- **TEAMS-69** Contents:
  - The "Spend" heading with the current month name ("September").
  - The month total ("$15.93") and "${x} this week".
  - One bar per team: name, a bar proportional to the largest team, and the amount. Sorted highest
    first; teams with $0 are omitted.
  - The footnote "Each run stops at ${default budget} unless you change its budget. Subscription runs
    on Desktop count against your plan, not here."

### First-time checklist
- **TEAMS-70** First-time Home heading: "Welcome to Tvashtr, {Name}." with the subtitle "Build a team
  of agents, run it on your repo, and review the pull request it opens." and a New team button. Nav
  badges are hidden.
- **TEAMS-71** "Get started" card:
  - Header "Get started {k} of 4 done", or "You’re all set 4 of 4 done" when complete, and a "Hide
    checklist" button.
  - Four steps, each with a number, title, description and button. The first step not yet done has a
    **primary** button; the rest are ghost. A done step shows a check and "Done" and loses its number
    and button.
  - Steps:
    1. "Connect an engine" / "Your Claude or Grok plan on Desktop, or an API key." / [Open Engines],
       which opens Engines › Overview.
    2. "Create a team" / "Start from a template. You can change every agent later." / [New team].
    3. "Start your first run" / "Tell the team what to build, and pick a repo." / [Start a run], which
       focuses the composer.
    4. "Review the pull request" / "Approve the spec and the ship when the team asks." / [See how]
       (see §6 Q11).
- **TEAMS-72** When each step counts as done:
  1. The account holds at least one provider key or has at least one connected subscription.
  2. The user has created a team, whether from a template, blank or a duplicate; a seeded default
     team does not count.
  3. At least one run exists.
  4. At least one run has opened a PR. On Desktop local-folder runs, a completed run with a ship
     branch counts instead (§6 Q10).
- **TEAMS-73** Page body by stage:
  - 0–1 done: "Start from a template" (4 template cards with name, strip, description and [Use
    template], which opens New team with that template pre-selected) and "How Tvashtr works" (ordered):
    "1 Build a team Agents on a canvas: thinkers plan, workers write code, gates wait for you."; "2 Run
    it on a repo Each run works on its own branch, in a sandbox."; "3 Review the pull request You
    approve at the gates. Nothing merges without you."
  - 2 done: the Start-a-run composer with the newest team pre-picked, plus How.
  - 3 done: Running now plus How.
  - 4 done: an OK callout "Your first pull request is open: PR #{n}. Home now shows your runs and
    teams." with a primary [Hide checklist], plus How.
  - Note the first-time template copy for Full feature squad differs: "Plan, you approve, build and
    test, you approve the ship."
- **TEAMS-74** Hide checklist, available at any stage, is saved **per account**. Home switches to the
  normal layout (the "Good …" greeting and all sections) and shows a toast "Checklist hidden. Bring it
  back from the account menu."

### Loading and responsive
- **TEAMS-75** Initial load shows skeletons (Home-Loading): a greeting bar and card blocks. The Teams
  grid shows skeleton cards, not "Loading…".
- **TEAMS-76** At a viewport of about 1024px (the Desktop window's `minWidth` is 1024) the 330px right
  rail (Recent runs, Spend) is not in the design. See §6 Q15.
- **TEAMS-77** Toasts are dark status toasts (`role=status`), live longer than one view (the "created"
  toast shows on the canvas after the Dashboard unmounts) and stack at bottom-centre.

---

## 3. Backend gap table

Legend: see the proposals **G-1 … G-15** below the table for the concrete shapes.

| ID | Needs | Status | Where / proposal |
|---|---|---|---|
| TEAMS-2 | Home count, Engines "to fix", Toolkit "missing" | PARTIAL (dependency) | Owned by the Needs-you / Engines / Toolkit analyses. The Home count equals the Needs-you inbox size. |
| TEAMS-4 | display name | PARTIAL | `GET /api/auth/me` → `UserOut{id,email}` (auth.py:125). Email-derived works today; GitHub accounts may have `{login}@users.noreply.github.com`. **G-12**: add `github_login: str \| null` to `UserOut`. |
| TEAMS-5 | needs-you count, in-progress count, week spend | PARTIAL | In-progress: derive from the team summaries' `last_run.status` or `GET /api/runs?status=running` (**G-6**). Needs-you: the other analyst's inbox. Week spend: MISSING, see **G-8** `GET /api/spend`. |
| TEAMS-7, 8 | team names for search | EXISTS | `GET /api/teams` → `teams[].name` (control_plane/teams.py `_team_summary`). Client-side filter. |
| TEAMS-9 | sort keys | PARTIAL | Name=`name`, Created=`created_at` EXIST. Spend=`spend_usd` exists but **undercounts** (G-2). Last active: MISSING; `last_run.at` is the latest run's `created_at`. **G-1**: add `last_active_at`. |
| TEAMS-11 | per-team latest status for tab counts | EXISTS | `teams[].last_run.status` (`_run_rollup_by_origin`, teams.py:1432). Client-side counts. |
| TEAMS-13 | status badge | EXISTS | `teams[].last_run.status`; `null` = Not run yet. |
| TEAMS-14 | pipeline strip (node order, roles, loop edges) | MISSING | The summary has only `node_count`. Fetching `/api/teams/{id}/graph` per card is N+1. **G-1**: add `shape` to the summary; **G-5**: add `shape` to `GET /api/templates`. |
| TEAMS-15 | last idea + last activity time | PARTIAL | `last_run` = `{status, at, run_id}` only (teams.py:1476). **G-1**: add `idea`, `updated_at`, `pr_url`. |
| TEAMS-16 | template the team was created from, "copied" origin | MISSING | No column. **G-3** migration: `team_graphs.template_key`, `team_graphs.duplicated_from_id`. **G-1** exposes `template_key`, `template_name`, `duplicated_from`. |
| TEAMS-17 | run count, total spend | PARTIAL | `spend_usd` EXISTS but counts only `runs.cost_total_usd`, which is written **only** by `finalize_run_step` (team_run.py:1554). Failed runs (`mark_run_failed_step`), cancelled runs (`cancel_run_core`) and in-flight runs count as $0. Run count MISSING. **G-1** + **G-2**. |
| TEAMS-18, 24, 38 | start a run on a team | EXISTS (other area) | Composer → `POST /api/runs {team_graph_id, idea, …}`. My flows only pre-pick the team (frontend). |
| TEAMS-20, 23, 39 | open team canvas | EXISTS | `GET /api/teams/{id}/graph` (routers.py:2910) via AuthGate `onOpenTeam`. |
| TEAMS-26–28 | rename | EXISTS | `PATCH /api/teams/{id} {name}` → updated summary; 422 "A team name is required." on blank (routers.py:3114, `rename_library_team`). |
| TEAMS-29 | duplicate | MISSING | `clone_team_graph` (teams.py:1310) makes a non-library run snapshot and stamps `cloned_from_node_id`. **G-4**: `POST /api/teams/{id}/duplicate`. |
| TEAMS-30 | run count in delete copy | MISSING | **G-1** `run_count` (or count `GET /api/teams/{id}/runs` when the dialog opens as a stop-gap). |
| TEAMS-31 | "a run is waiting / in progress" impact | PARTIAL | Today's FE (`isActive`) reads only `last_run.status`, so an older still-running run is missed. **G-1**: add `active_run_count`, `awaiting_run_count`. |
| TEAMS-32 | delete + stop runs | EXISTS (with 2 caveats) | `DELETE /api/teams/{id}` → `{team_graph_id, deleted:true}`. `delete_library_team_and_runs` cancels in-flight runs, then hard-deletes runs, run rows and clones (teams.py:1775). Caveat 1: the next `GET /api/teams` re-seeds "My team" when the last team is deleted (**G-13**). Caveat 2: `desktop_node_jobs` rows of deleted runs are not removed (**G-14**). The FE `deleteTeam` doc comment ("runs are unaffected") is stale. |
| TEAMS-34–37 | team run history | PARTIAL | `GET /api/teams/{id}/runs` → `runs[]{run_id,status,idea,created_at,cost_total_usd}`; `[]` vs 404 distinct (teams.py:1712). Missing: `pr_url`, `updated_at`, and a correct cost for in-flight/failed/cancelled runs. **G-7**. |
| TEAMS-41, 42 | server-side name validation on create | PARTIAL | `POST /api/teams` (routers.py:2522) stores `body.name` untrimmed and accepts a blank name. **G-5**: trim, then 422 "A team name is required."; also persist `template_key`. |
| TEAMS-43 | templates with strip + design copy | PARTIAL | `GET /api/templates` → `templates[]{template,name,description}` (teams.py:1425). Missing `shape`. Descriptions and names differ from the design (backend uses "↔" and long descriptions). **G-5**. Blank stays a frontend constant because NewTeam-6 needs it when the call fails. |
| TEAMS-45–47 | create team | EXISTS | `POST /api/teams {template,name}` → summary (`team_graph_id`). |
| TEAMS-50 | Needs-you group | PARTIAL (dependency) | Comes from the Needs-you analyst's account-wide inbox. Fallback: runs with `status in (awaiting_human, failed)` from **G-6**. |
| TEAMS-51 | search teams / runs / domains | PARTIAL | Teams: `GET /api/teams` EXISTS. Domains: `GET /api/domains` → `domain_id,name` EXISTS. Runs: `GET /api/runs` (routers.py:2439) returns `{run_id,idea,status,created_at,repo_path}` with **no team and no pagination**. **G-6** adds `team`, `q`, `limit/cursor`. Client-side search is enough for teams, domains and actions. Runs need `q` once the list is paginated. |
| TEAMS-54 | open a run from the palette / list | PARTIAL | Opening needs the owning **library team id** (AuthGate `onOpenRun(runId, teamId)`). `_run_summary` has none. **G-6** + **G-9** (`runs.library_team_id`). |
| TEAMS-55 | log out | EXISTS | `POST /api/auth/logout` (204). |
| TEAMS-56, 74 | per-account "hide get-started" preference | MISSING | No preferences storage on `users` (models.py:507). **G-10**: `users.preferences JSONB` plus `GET`/`PATCH /api/account/preferences`. |
| TEAMS-60–62 | reachability | EXISTS | `GET /health` → `{status:"ok"\|"degraded", db:"ok"\|"down"}` (main.py:122). "Last updated" is a client timestamp. Note: `BackendDot` polls `/health` every **5s**, and each poll pings Postgres, which keeps Neon awake (see the `/healthz` docstring, main.py:131). **G-15**. |
| TEAMS-63 | recent runs with team, PR, time | PARTIAL | `GET /api/runs` lacks `team{id,name}`, `pr_url`, `updated_at`, `github_repo`, `ship_branch`, `cost_usd`. `pr_url` exists only on `GET /api/runs/{id}` (`_run_to_dict`, routers.py:642). **G-6**. |
| TEAMS-64, 65 | status-group filter | MISSING | There is no `status` param. **G-6** `?status=running\|needs_you\|completed\|failed\|stopped`. A client-side filter is wrong once the list is paginated. |
| TEAMS-66 | pagination | MISSING | `list_runs` returns every run, unbounded. **G-6** `limit` + `cursor` → `next_cursor`. |
| TEAMS-67 | PR url | PARTIAL | `runs.pr_url` column exists (models.py:371) but is not in the list. **G-6**. |
| TEAMS-69 | month/week spend per team + default budget | MISSING | Nothing aggregates by period; `cost_records.created_at` exists (models.py:91). **G-8** `GET /api/spend`. The default budget is `Settings.default_run_budget_usd` = 5.00 (config.py:110) and is not exposed. |
| TEAMS-72 step 1 | engine connected | EXISTS | `GET /api/providers` → `providers[]`; `GET /api/engines/subscriptions` → `subscriptions[].connected` (routers.py:1816, 1944). |
| TEAMS-72 step 2 | user-created team | PARTIAL | `GET /api/teams` always returns ≥1 team because `seed_library_if_empty` creates "My team" (routers.py:2518, teams.py:1641), so step 2 would always be done. **G-13** (stop seeding) or **G-3** `template_key='seed'`. |
| TEAMS-72 step 3 | any run | EXISTS | `GET /api/runs` → `runs.length > 0`. |
| TEAMS-72 step 4 | first PR / first shipped run | PARTIAL | Needs `pr_url` (and `ship_branch`/`status` for Desktop local runs) in the list. **G-6**; optionally **G-11** `GET /api/onboarding`. |
| TEAMS-73 | "Use template" / composer / Running now | EXISTS (other areas) | Templates **G-5**; composer and Running now are owned elsewhere. |

**Row count: 38 · EXISTS 13 · PARTIAL 17 · MISSING 8.** Rows marked "(dependency)" or "(other
area)" are counted as they appear.

### Proposals

**G-1: extend the team summary** (`control_plane/teams.py`: `_run_rollup_by_origin`,
`_team_summary`, `list_library_teams`; also returned by `POST /api/teams`, `PATCH /api/teams/{id}`
and G-4). The change is additive; every existing key stays.
```json
{
  "team_graph_id": "…", "name": "Indicator sprint team", "created_at": "…", "node_count": 7,
  "last_run": { "status": "awaiting_human", "at": "<created_at>", "run_id": "…",
                "idea": "Add an RSI indicator with tests", "updated_at": "…", "pr_url": null },
  "spend_usd": 4.82,
  "run_count": 7,
  "active_run_count": 0,
  "awaiting_run_count": 1,
  "last_active_at": "…",
  "template_key": "full_squad", "template_name": "Full feature squad",
  "duplicated_from": { "team_graph_id": "…", "name": "…" },
  "shape": {
    "nodes": [ { "id": "…", "kind": "thinker|worker|gate|terminal|domain_query",
                 "role": "pm|architect|engineer|reviewer|thinker|worker|gate|ship|stop|domain_query",
                 "label": "PM" } ],
    "loops": [ { "from": 4, "to": 3 } ]
  }
}
```
Field rules:
- `last_active_at` = max(`runs.updated_at`) over the team's runs, else `created_at`.
- `run_count`, `active_run_count` (pending|running) and `awaiting_run_count` (awaiting_human) are
  `COUNT(*) FILTER (…)` over the same de-duplicated per-run subquery the rollup already uses.
- `duplicated_from` is `null` unless the team came from G-4.

Shape algorithm: add a pure `team_shape(nodes, edges) -> dict` to `control_plane/graph_validity.py`
next to `graph_dicts`, so it can be unit tested.
- Start from the root (the same rule as `_team_root_node_id`).
- Follow forward/branch edges (no `loop_limit`, not `escalation`), preferring the edge whose target
  reaches a `ship` terminal.
- Record a `loop_back` edge (`conditions.loop_limit`) as `loops[{from,to}]` using indices into `nodes`.
- Omit `stop` terminals and escalation-only targets.
- Labels: pm→"PM", architect→"Architect", engineer→"Engineer", reviewer→"Reviewer", gate→`config.title`
  shortened to "Approval", ship→"Ship", thinker→"Thinker", worker→"Worker", domain_query→"Domain". If
  the canvas analyst adds a node display name, use it.
- Batch it: fetch all nodes and edges of the owner's library teams in 2 queries inside
  `list_library_teams`.

**G-2: honest run cost.**
1. In `control_plane/team_run.py` `mark_run_failed_step` and `control_plane/teams.py`
   `cancel_run_core`, also set `cost_total_usd = metering.running_cost(run_id)`, matching
   `finalize_run_step`.
2. Everywhere a list or rollup reads cost, use `COALESCE(runs.cost_total_usd, live.sum, 0)`, where
   `live` = `SELECT workflow_id, SUM(cost_usd) FROM cost_records GROUP BY workflow_id` joined on
   `runs.workflow_id`. That covers in-flight runs such as the "$1.21" on an awaiting run in History-2.
3. Optional one-off backfill migration: `UPDATE runs SET cost_total_usd = (SELECT COALESCE(SUM(cost_usd),0)
   FROM cost_records WHERE workflow_id = runs.workflow_id) WHERE cost_total_usd IS NULL AND status IN
   ('failed','cancelled')`.

**G-3: migration `0041_team_origin` (or the next free number).**
- `team_graphs.template_key TEXT NULL` holds `'blank'|'two_node'|'review_loop'|'plan_review'|'full_squad'|'seed'`.
- `team_graphs.duplicated_from_id UUID NULL` is a plain uuid, not a foreign key, the same pattern as
  `cloned_from_node_id`.
- No backfill; legacy teams stay NULL and render "Created {x}".
- Set `template_key` in `create_team_from_template`, `create_blank_team` and (if kept) `seed_library_if_empty`.

**G-4: duplicate a team: `POST /api/teams/{team_id}/duplicate`.**
- Body: `{"name"?: string}`; the default name is `"{source.name} (copy)"`.
- Response: 201, the G-1 summary.
- Errors: 400 malformed id; 404 when the team is not the caller's library team (reuse `_require_library_team`).
- Logic `duplicate_library_team(team_id, owner_id, name) -> str | None` in `control_plane/teams.py`:
  - Refactor `clone_team_graph` into a shared `_copy_graph(src_id, *, name, is_library, owner_id,
    link_origin: bool)`.
  - Duplicate uses `is_library=True, owner_id=owner, link_origin=False`, so `cloned_from_node_id` stays
    NULL and the copy never looks like a run snapshot of the source.
  - Set `duplicated_from_id = src.id` and `template_key = src.template_key`.
  - Copy nodes (prompt, model, engine, position, config, tool_config, skills, edits_allowed) and edges
    with remapped ids.
  - Node-tier memories (`node_memories.node_id` = authored node id) are **not** copied (§6 Q6).
  - No migration beyond G-3.

**G-5: templates and create.**
- `GET /api/templates` items gain `"shape": {nodes, loops}` (G-1 format). Declare it statically on
  `TeamTemplate` (a tuple of roles plus loop pairs), because running the builders would write DB rows.
- Update the `name`/`description` values in `_TEMPLATE_CATALOG` (teams.py:1392) to the design copy in
  TEAMS-43; the design's ⇄ is a glyph, so keep the plain name "PM → Engineer ↔ Reviewer", or render the
  name from `shape`.
- `POST /api/teams`: `name = body.name.strip()`, return 422 `{"detail":"A team name is required."}`
  when it is empty, and persist `template_key`.

**G-6: runs list: `GET /api/runs?status=&team_id=&q=&limit=&cursor=`.**
- Owner-scoped (existing).
- `status` group: `running`→(pending,running), `needs_you`→(awaiting_human), `completed`,
  `failed`, `stopped`→(cancelled,rejected,over_budget).
- `q`: ILIKE over `runs.idea` and the team name.
- `limit` defaults to 50 (max 100).
- `cursor`: opaque base64 of `(created_at, id)`, ordered `created_at DESC, id DESC`.
- Only runs with a library team (G-9) are returned by default, which excludes the API-only A/B and
  `team_shape` legacy runs.
- Response (additive; `runs` stays the key; `listRuns` has no frontend callers today, so this is safe):
```json
{ "runs": [ { "run_id": "…", "idea": "…", "status": "completed", "status_group": "completed",
              "created_at": "…", "updated_at": "…", "repo_path": null,
              "github_repo": "lazyxgenius/trade_mcp", "pr_url": "https://github.com/…/pull/42",
              "ship_branch": "tvashtr/…", "desktop_target": false, "cost_usd": 9.10,
              "team": { "team_graph_id": "…", "name": "Full feature squad" } } ],
  "next_cursor": "…" }
```
- Logic: a new `control_plane/run_queries.py` (`list_owner_runs(owner_id, *, status_group, team_id,
  q, limit, cursor)`), which joins `runs.library_team_id → team_graphs.name` (G-9) and the live cost
  (G-2).

**G-7: history rows.** `list_team_runs` (teams.py:1712) adds `pr_url`, `updated_at`, `status_group`
and the live/final cost from G-2; the key `cost_total_usd` is kept. Optional `limit`/`cursor`, with the
same semantics as G-6.

**G-8: spend: `GET /api/spend?tz=<IANA>`** (new `control_plane/spend.py`).
```json
{ "month": { "label": "September", "start": "2026-09-01", "total_usd": 15.93 },
  "week": { "start": "2026-09-21", "total_usd": 6.19 },
  "by_team": [ { "team_graph_id": "…", "name": "Full feature squad", "spend_usd": 9.10 } ],
  "default_run_budget_usd": 5.0 }
```
- Computed from `cost_records` (`created_at`, `cost_usd`) joined to `runs` on `workflow_id` and
  filtered to `runs.owner_id`.
- Grouped by `runs.library_team_id` over the current calendar month and ISO week in the user's timezone.
- Read-only; no migration beyond G-9.
- Also add `default_run_budget_usd` to `/api/config` if the composer analyst needs it.

**G-9: migration: `runs.library_team_id UUID NULL` + index `ix_runs_library_team_id`.**
- Set in `create_run` when `body.team_graph_id` is given (routers.py:1089–1114, before the clone).
- Backfill in the same migration:
  `UPDATE runs r SET library_team_id = s.team_id FROM (SELECT DISTINCT ON (r2.id) r2.id AS run_id,
  o.team_graph_id AS team_id FROM runs r2 JOIN agent_nodes c ON c.team_graph_id = r2.team_graph_id
  JOIN agent_nodes o ON o.id = c.cloned_from_node_id JOIN team_graphs t ON t.id = o.team_graph_id AND
  t.is_library) s WHERE r.id = s.run_id`.
- No FK is needed (team deletion already tears runs down). An FK `ON DELETE SET NULL` is also acceptable.
- Payoff: run count, rollups, filter-by-team, team names on runs, and delete teardown become plain
  indexed lookups. Today they rely on the clone→origin node join, which silently drops a run once every
  origin node it was cloned from has been deleted on the canvas.

**G-10: account preferences.**
- Migration: `users.preferences JSONB NOT NULL DEFAULT '{}'::jsonb`.
- `GET /api/account/preferences` → `{"get_started_hidden": false}` (defaults merged server-side).
- `PATCH /api/account/preferences` with body `{"get_started_hidden": true}` merges and returns the full
  object; 422 on unknown keys.
- Mirrors the existing `/api/memory/review-mode` pattern (routers.py:2398–2425).
- Logic: a small `control_plane/preferences.py` with a whitelist of keys and their defaults.
- Existing accounts: see §6 Q8. The recommended rollout is a data step that sets
  `get_started_hidden=true` for users who already have ≥1 run.

**G-11 (optional): `GET /api/onboarding`.** Saves 4 client calls on first paint.
```json
{ "hidden": false,
  "steps": { "engine": true, "team": true, "run": false, "review": false },
  "first_pr_url": null, "first_ship_branch": null, "newest_team_id": "…" }
```
- Logic in `control_plane/onboarding.py`: providers, `engine_subscription_statuses.connected`,
  library teams with `template_key <> 'seed'` (or any team once G-13 lands), runs, and runs with
  `pr_url`/`ship_branch`.

**G-12:** `auth.UserOut` gains `github_login: str | None` (read from `users.github_login`). It is
returned by `/api/auth/me`, `/login` and `/register`.

**G-13: stop auto-seeding.** Remove the `seed_library_if_empty(owner_id)` call from `GET /api/teams`
(routers.py:2518).
- The designed first-time Home (no teams and a template picker) replaces the "never empty" posture.
- Deleting the last team currently respawns "My team", which contradicts TeamMenu-8.
- `App.tsx` only uses `list[0]` in a standalone mount. AuthGate always passes `teamId`.
- Update `Dashboard.test.tsx` fixtures.

**G-14:** in `delete_library_team_and_runs`, also delete the deleted runs' rows:
`session.execute(delete(DesktopNodeJob).where(DesktopNodeJob.run_id == rid))`. A claimed job's next
`/events` post then returns 404, and the runner treats 4xx as final. Instructions stored in
`desktop_node_jobs.instruction` are no longer orphaned.

**G-15: health polling.** Do not add an endpoint. The frontend change:
- Poll `/health` every 30s, and only while the tab is visible.
- Also mark the backend offline on any failed data fetch (a network error or 502 from the Desktop
  proxy) and online on the next success.
- This keeps "Connected" meaning the database answers without waking Neon every 5s.

---

## 4. Desktop bridge gaps

No new bridge method is **required** for this area. Behaviour already covered by Electron:
- **PR links / Download link** open in the OS browser: `setWindowOpenHandler` → `shell.openExternal`
  (main.cjs:272). The frontend only needs `<a target="_blank" rel="noopener">`. The copy must differ:
  the website says "…in a new tab"; Desktop says "Opens github.com/…/pull/42 in your browser".
- **Backend reachability**: Desktop proxies `/api` and `/health` from `127.0.0.1:<port>` to Fly
  (main.cjs:250). A down Fly or an offline machine surfaces as 502 or a network error from the loopback
  proxy, so the same banner logic works. The Desktop runner also stops getting jobs while offline; the
  banner copy can stay identical.
- **Shortcuts**: there is no custom `Menu` in main.cjs, so ⌘K, N, T and ? reach the renderer. ⌘N/⌘T
  must stay unhandled by the page (TEAMS-59). The Desktop build ships as a Mac DMG only; the website
  shows "Ctrl K" on non-Mac.
- **Log out**: works through the proxied cookie. The Desktop runner's cookie-authenticated polls then
  401 and stop, which is the existing behaviour.

Optional additions, recommended but not blocking:
- `tvashtrDesktop.app.getInfo(): Promise<{ version: string; platform: NodeJS.Platform }>` (main:
  `ipcMain.handle("tvashtr:app:getInfo", () => ({ version: app.getVersion(), platform: process.platform }))`).
  It lets the account menu replace "Download Tvashtr Desktop" with a muted "Tvashtr Desktop {version}"
  row. `window.tvashtrDesktopInfo.version` is the *bridge* version (3), not the app version.
- `tvashtrDesktop.shell.openExternal(url: string): Promise<void>`: an explicit, allow-listed
  (https/github.com) open for PR links, so the code does not rely on `window.open` interception.
  Optional because interception already works.

Desktop-vs-website differences in this area:
1. Account menu: "Download Tvashtr Desktop" appears on the website only.
2. The PR-link tooltip copy differs.
3. First-time step 3 says "pick a repo": the website uses a GitHub repo and Desktop a local folder
   (the composer's concern).
4. First-time step 4 and Recent runs: Desktop local-folder runs ship to a branch `tvashtr/<run_id>`
   with no PR (§6 Q10).
5. The Spend footnote is shown on both surfaces.
6. Step 1 is met by a connected subscription (Desktop) or an API key (either surface).

---

## 5. Frontend mapping

**What exists today**
- `components/Dashboard.tsx` (688 lines) is one monolith. It holds the Home greeting and stats, a teams
  **table** (`tv-dash__trow`), inline rename, the delete confirm, the history drill-down (inline
  expansion), a failed-run recovery strip, the account menu and the Domains/Engines/Tools views.
- `NewTeamDialog.tsx`, `AppShell.tsx` (nav), `BackendDot.tsx` (a bare dot polling every 5s) and
  `AuthGate.tsx` (a state router with `onOpenTeam` and `onOpenRun(runId, teamId)`).
- `lib/api.ts`: `getTeams`, `getTemplates`, `createTeam`, `renameTeam`, `deleteTeam`, `getTeamRuns`,
  and `listRuns` (unused).
- `lib/status.ts` `runStatusPill` (labels already match: Awaiting you, Running, Completed, Failed,
  Stopped, Not run yet).
- `lib/time.ts` `formatRelativeTime`.
- `lib/useModalDialog.ts` (focus trap and Esc).
- `lib/desktopDownload.ts` (DMG and releases URLs).
- The design-system **CSS** layer `design-system/components/ds.css` already defines `.ds-btn`,
  `.ds-iconbtn`, `.ds-badge--{warning,info,danger,success,neutral,outline}`, `.ds-tabs--pill`,
  `.ds-input(--error)`, `.ds-menu`, `.ds-popover`, `.ds-dialog`, `.ds-sheet`, `.ds-toast(s)`,
  `.ds-kbd`, `.ds-avatar`, `.ds-logo` and `.ds-count`. No React components wrap these classes yet.

**Keep (logic)**
- The `load()` + `mountedRef` pattern.
- Rename trimming and the busy guard.
- The **history request-race guard** (`runsRequestRef`), which moves unchanged into the sheet.
- `isActive`, generalised to `active_run_count + awaiting_run_count`.
- The delete flow.
- `NewTeamDialog`'s Blank fallback card, its failure copy and the `createTeam` → `onOpenTeam` path.
- `useModalDialog` for every dialog and sheet.
- `runStatusPill`, extended with a DS Badge `variant` mapping and `runFilterGroup(status)`.
- `AuthGate`'s `onOpenRun(runId, teamId)`.

**Rebuild or split `Dashboard.tsx`** into:
- `home/HomePage` (layout: main column plus 330px right rail, responsive)
- `home/Greeting` (TEAMS-4–6, first-time variant TEAMS-70)
- `home/TeamsSection` (toolbar, tabs, grid/list, empty states)
- `home/TeamCard`
- `home/TeamRow`
- `home/TeamMenu` (⋯)
- `home/InlineRename`
- `home/DeleteTeamDialog` (alertdialog with an impact warning)
- `home/RunHistorySheet`
- `home/RecentRunsPanel`
- `home/SpendPanel`
- `home/GetStartedChecklist` + `home/TemplateGallery` + `home/HowItWorks`

The Domains, Engines and Tools views stay routed by `AppShell` view state. Remove the table, the stats
strip and the failed-run recovery strip; Needs-you owns recovery.

**Change**
- `AppShell.tsx`:
  - Rename "Tools" to "Toolkit".
  - Add nav badges (`ds-count`, WARN chips).
  - Add the nav footer "Shortcuts".
  - The header gains the centred search button and a `ConnectionStatus` component (dot + label).
- `BackendDot.tsx` becomes `ConnectionStatus` + `ConnectionBanner`, sharing a `useBackendHealth()`
  store (`status`, `lastSuccessAt`, `retry()`). Data loaders report failure and success into it (G-15).
- `NewTeamDialog.tsx`: rebuild with DS Dialog (720), DS Input (helper/error) and template cards with a
  `PipelineStrip`. Add an `initialTemplate` prop (for "Use template"). Hand the success toast to an
  app-level toaster instead of the dialog.
- `AuthGate.tsx`: host the **Toaster** (the "created" toast must appear on the canvas), the
  **preferences / onboarding** fetch and the global **shortcut provider**. Pass a one-shot `flash`
  message to `App` when opening a new team.
- `DomainsPage.tsx`: accept `initialDomainId` (⌘K "Open the X domain").
- `EnginesShelf`: accept an initial section, `"overview"` or `"api-keys"`, for first-time step 1 and
  ⌘K "Add an API key" (coordinate with the Engines analyst).
- `lib/api.ts`:
  - Extend `TeamSummary` (G-1), `TeamRunRow` (G-7) and `RunSummary` (G-6); rename `listRuns` to
    `listRuns(params)` with `next_cursor`.
  - Add `duplicateTeam`, `getPreferences`/`patchPreferences`, `getSpend` and (optionally) `getOnboarding`.
  - Fix the stale `deleteTeam` comment.
- `lib/time.ts`: add `formatDayRelative` ("today", "yesterday", "Mon D"), `formatShortDate` ("Sep 25")
  and the "started {x}" helper.

**New shared primitives** (thin React wrappers over `ds.css`, reusable across areas)
- `Button`, `IconButton`, `Badge` (dot), `Tabs` (pill, with counts), `Input` (label, helper, error),
  `Avatar`, `Logo`, `Kbd`, `Skeleton`, `Tooltip`.
- `Menu` (⋯ popover, role=menu, roving focus).
- `ListboxDropdown` (Sort and Recent-runs filter; role=listbox, aria-selected).
- `Sheet` (right drawer, 480px).
- `Dialog` and `ConfirmDialog` (alertdialog with an impact slot; used by delete).
- `Toaster` (dark `role=status` toasts; supports an optional action for undo, which other areas need).
- `CommandPalette` (combobox + grouped listbox).
- `KeyboardShortcutsDialog`, `AccountMenu`.
- `PipelineStrip` (reused by team cards, list rows, template cards and first-time templates).
- `useGlobalShortcuts` (modifier- and focus-aware).
- **Cross-area contract** with the composer owner: a `HomeActions` context exposing
  `pickTeamForRun(teamId, {toast})`, `focusComposer()`, `openNewTeam({template?})`,
  `openRunHistory(teamId)` and `scrollTo(section)`, used by the card Run button, the menu, ⌘K,
  shortcuts, History and the checklist.

**Tests**: rewrite `Dashboard.test.tsx` around the new components. Cover:
- the tab counts and sort order,
- the search empty state,
- rename blank-error without a request,
- the delete impact copy,
- the history race guard (port the existing test),
- the palette keyboard nav and no-match copy,
- shortcut suppression in inputs and with modifiers,
- the banner and reconnect toast,
- checklist step derivation and persistence.

---

## 6. Open questions / ambiguities (with recommendations)

1. **What "⇄" means in strips and template names.** The raw HTML shows it between the Engineer and
   Reviewer chips of loop teams. Recommend: render ⇄ for a loop-back edge. The strip shows only the
   main path to Ship: Stop terminals, escalation targets and rejected branches are omitted.
2. **"Needs you" tab membership.** Recommend: latest run is `awaiting_human` or `failed`. If the
   Needs-you analyst makes "dismiss" server-side, exclude teams whose failed-run item was dismissed, so
   the tab and the inbox agree. A setup gap such as "can't run on the website" should not put a team
   in the tab.
3. **`over_budget`, `rejected` and `cancelled`.** The design only shows "Stopped". Recommend: the
   filter group "Stopped" covers all three. The badge reads "Stopped" (outline) for
   rejected/cancelled; keep "Over budget" as an outline or warning label so the reason is visible.
4. **Delete button variant.** The design uses `secondary`; the menu item is danger-coloured. Recommend
   a `danger` variant for the confirm button, for consistency and safety.
5. **Delete copy for a running (not awaiting) run and for 0 runs** is not designed. Use the proposed
   copy in TEAMS-31.
6. **Duplicate details.** Where does the copy sort, and does it copy node-tier memories? TeamMenu-6
   appends the copy at the end, but "Last active" would put a just-created team first. Recommend:
   follow the sort (it appears first under Last active), then scroll to and highlight it. Do **not**
   copy node-tier memories; repo and account memories still apply. Name it "{name} (copy)" and do not
   dedupe to "(copy 2)" unless a collision matters.
7. **The auto-seeded "My team" conflicts with the first-time design and TeamMenu-8.** Recommend G-13:
   stop seeding. If seeding must stay, mark seeded teams `template_key='seed'` so step 2 ignores them.
8. **Checklist for existing accounts.** An account with PRs would suddenly see "You’re all set".
   Recommend: the G-10 migration sets `get_started_hidden=true` for users who already have ≥1 run.
   New accounts see the checklist until they hide it. It does **not** auto-hide at 4/4; the design
   keeps it visible with a primary Hide button.
9. **No way to restore a hidden checklist.** FirstTime-7 promises "Bring it back from the account
   menu", but Account-1 has no such item. Add "Show get-started checklist", visible only while hidden.
10. **Step 4 and Recent runs without a PR** (Desktop local-folder runs and self-hosted brownfield runs
    have only `ship_branch`). Recommend: step 4 is done when a run reaches `completed` and has a
    `pr_url` **or** a `ship_branch`. Callout copy for the branch case: "Your first change is on branch
    tvashtr/…". In Recent runs, show a branch chip in place of the PR link.
11. **Where "See how" goes.** Recommend: if a run is awaiting approval, open it on the canvas at the
    gate. Otherwise open the newest running run. With neither, scroll to "How Tvashtr works".
12. **"Use template": open the dialog or create directly?** Recommend opening New team with the
    template pre-selected, because a name is required.
13. **When status tabs show.** FirstTime-7 hides them with 1 team. Recommend hiding them when fewer
    than 2 teams exist; always keep search, sort and view.
14. **What the Spend panel measures.** The sample per-team bars equal all-time card spend ($9.10 …) yet
    sit under "September". Recommend: the panel (bars and total) is **calendar month** and cards show
    **all-time** spend. The week starts Monday in the browser's timezone (G-8 `tz`).
15. **Right rail at 1024px.** Home-Web1024 drops Recent runs and Spend, and Desktop's minimum width is
    1024. Recommend stacking the rail below Teams under about 1200px rather than hiding it, so Desktop
    users at minimum width keep Recent runs.
16. **⌘K "Needs you" group source.** It depends on the Needs-you analyst's account-wide inbox. Until
    that exists, fall back to G-6 runs with `awaiting_human`/`failed`.
17. **Whether ⌘K searches runs on the client or the server.** Recommend: teams, domains and actions
    client-side; runs via `GET /api/runs?q=` (debounced 150ms, limit 5) because the list is paginated
    (G-6). No unified `/api/search` is needed.
18. **ARIA roles in the design.** The shortcuts dialog is `alertdialog` and the account and filter
    menus use `option`. Recommend `dialog` for shortcuts, `menu`/`menuitem` for the account menu, and
    `listbox`/`option` only for the Sort and filter pickers.
19. **What "N" does without a composer** (first-time before a team exists). Recommend: open New team,
    and focus the composer once one exists.
20. **"1 run in progress" while Running now lists 2.** This is consistent if awaiting runs are counted
    under "need you". Confirm with the Running-now analyst so both use the same definitions.
