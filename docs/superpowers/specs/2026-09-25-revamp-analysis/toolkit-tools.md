# toolkit-tools — Toolkit › Tools and Toolkit › Secrets

Scope: `TkF-Index`, `Toolkit-Tools`, `Toolkit-ToolsBrowse`, `Toolkit-AddTool2/3/2Local`, `Toolkit-ToolDetail`,
`Toolkit-ToolsDesktop`, `Toolkit-BeforeAfter`, `Toolkit-Secrets`, `Toolkit-ReplaceSecret`, and flows `TkF-ToolTabs-*`,
`TkF-ToolSearch-*`, `TkF-AddTool-*`, `TkF-AddToolLocal-*`, `TkF-FixSecret-*`, `TkF-ToolMenu-*`, `TkF-Catalog-*`,
`TkF-Paste-*`, `TkF-Detail-*`, `TkF-ToolsEmpty-*`, `TkF-AddSecret-*`, `TkF-SecretMenu-*`, `TkF-SecretFix-*`,
`TkF-SecretsEmpty-*`.

Code read: `frontend/src/components/{ToolsShelf,SecretsShelf,Dashboard,AppShell,AuthGate,LaunchPanel}.tsx`,
`frontend/src/panel/{ToolsSection,TeamNodePanel}.tsx` (note: the panel folder is `frontend/src/panel/`, not
`components/panel/`), `frontend/src/lib/{api,time,domains}.ts`, `frontend/src/vite-env.d.ts`,
`backend/tvashtr/routers.py` (secrets 2020–2065, tool library 2067–2160, team node PATCH 2942–3091, github repos
3566–3646), `main.py` (`/api/config`, `/api/tool-catalog`), `auth.py` (GitHub callback), `models.py`
(`AgentNode`, `GithubInstallation`, `McpSecret`, `ToolLibraryItem`), `control_plane/{mcp_secrets,node_library,
node_tools,tool_skill_catalog,github_app,team_run}.py`, `engines/desktop_runner_adapter.py`,
`desktop/electron/{main.cjs,preload.cjs,runner/cliCommand.cjs}`.

---

## 1. Screens

**Toolkit shell (every screen).** The left nav's old "Tools" item becomes a **Toolkit** group button with four
sub-items: `Tools 3`, `Skills 3`, `Memory 2 new`, `Secrets` with a WARN badge `1 missing`. Under the list is a note:
"Toolkit holds what any team’s agents can use. Switch things on per agent in its Skills & tools tab." Top bar is
unchanged (logo, "Connected" backend dot, avatar).

**Tools · Installed (`Toolkit-Tools`, `TkF-ToolTabs-1`).** h1 "Tools" and a lede. Header buttons "Paste mcp.json"
(secondary) and "Add tool" (primary). Pill tabs are `Installed 3` and `Browse`. Below them: a "Search tools" input
(240px) and a Status select. A table with columns Tool / Runs / Status / Used by / ⋯ lists each MCP server:
- name, plus a `Local` or `Remote` outline badge
- the command line (`uvx mcp-server-fetch`) or the URL without its scheme (`api.githubcopilot.com/mcp`)
- status: `Ready`, or WARN `Needs LINEAR_TOKEN` with a tint "Add secret" button
- usage: `2 agents · 1 team`
- a ⋯ icon button

An info footnote says Domains is built in and is not added here. Rows look alphabetical (fetch, github, linear;
a duplicate lands as github-copy after github; a pasted sqlite lands last).

**Tools · Browse (`Toolkit-ToolsBrowse`, `TkF-ToolTabs-2`).** "Paste mcp.json" leaves the header; "Add tool" stays.
The Browse tab shows four cards, each with a title, badge, description and action:
- Web fetch (`Free · no login`, success badge): "Add", which becomes a disabled "In your tools" once added
- GitHub App repos (`Needs GitHub App`, warning badge): "Install GitHub App"
- Custom server (`Any MCP server`): "Set up"
- Paste mcp.json (`Bulk`): "Paste"

**Search and filter (`TkF-ToolSearch-1..4`).**
1. Typing "lin" filters the table live to linear.
2. The Status select opens a listbox: All statuses / Ready / Needs attention.
3. Picking "Needs attention" shows the line "Showing tools that need attention · 1" with a "Clear" button, and the
   table is filtered.
4. Searching "slack" gives the empty result "No tools match “slack”", "Try another word, or add it as a custom
   server.", and the buttons "Clear search" and "Add tool".

**Add a custom server, remote (`TkF-AddTool-1..7`, `Toolkit-AddTool2/3`).** "Add tool" opens a right sheet
(`aside role=dialog`, 540px, over a scrim). The header reads "Add a tool" with the subtitle "Step 1 of 3", which
becomes "linear · step 2 of 3". A 3-step stepper shows Basics / Connection / Secrets; completed steps get a check.
1. **Basics.** "Start from" radios: The catalog / A custom server (default) / An mcp.json. A Name field with helper
   "Lowercase, no spaces. Agents see this name." Buttons Cancel and "Next: Connection".
2. **Connection.** "Where it runs" segmented control (Local command / Remote URL). A URL field. "Headers" rows: a
   name input, then a value shown as "Bearer" plus a secret chip `${LINEAR_TOKEN} · not set` (WARN), a remove icon,
   and "Add header". A hint: "Type `${` to pick a secret…". An "Advanced (raw JSON)" disclosure. Buttons Back and
   "Next: Secrets".
3. **`${` autocomplete.** Typing `${` opens a listbox of existing secrets, each with its usage ("GITHUB_TOKEN used
   by github", "SENTRY_TOKEN not used"), then a divider and "Create LINEAR_TOKEN".
4. **Advanced JSON open.** Shows `{ "url": …, "headers": { "Authorization": "Bearer ${LINEAR_TOKEN}" } }` and
   "Edits here and in the form above stay in sync."
5. **Secrets step.** "linear uses one secret. Add its value now or later in Secrets." Then a LINEAR_TOKEN row with
   a `Not set` badge and a password input, and the note "Stored encrypted for your account. We never show it again."
   A "Switch it on for agents now / You can also do this later, per agent." row with a "Choose agents" button.
   Buttons Back and "Add tool".
6. **Choose agents.** A second dialog, "Turn linear on for…", with the sub-line "Each agent can still switch it off
   in its Skills & tools tab." Checkboxes are grouped by team: Indicator sprint team has Product manager (with a
   `thinker` tag), Engineer, and Reviewer (checked); Docs team has Writer. Buttons Skip and "Turn on for 1 agent".
7. **Added.** The linear row turns `Ready`, the nav loses "1 missing", and a dark toast reads "linear added and
   turned on for Reviewer." with an "Open Reviewer" action.

**Add a custom server, local command (`TkF-AddToolLocal-1..2`, `Toolkit-AddTool2Local`).** Same sheet, with the
name "sqlite". Step 2 is set to "Local command": a Command field (`uvx`), an Arguments field (optional, helper
"Space-separated."), and "Environment" rows. One row is a literal (`SQLITE_READONLY=true`). The other has a secret
chip (`API_KEY = ${SQLITE_API_KEY} · not set`). Each row has "Remove variable", and there is an "Add variable"
button and an "Advanced (raw JSON)" disclosure.

**Fix a tool that needs a secret (`TkF-FixSecret-1..3`).** Clicking "Add secret" on the linear row opens the
"Add LINEAR_TOKEN" dialog (500px). The Name is prefilled and disabled, there is a Value password input, the note
"Stored encrypted. We never show a value again.", and the buttons Cancel / "Save secret". On save the row turns
`Ready`, the nav badge disappears, and a toast reads "LINEAR_TOKEN saved. linear is ready."

**⋯ menu on a row (`TkF-ToolMenu-1..4`).**
- The menu (240px) has: Edit connection, Duplicate, Turn on for agents…, Remove from Toolkit.
- **Remove** opens an alertdialog: "Remove github from Toolkit? 3 agents in 2 teams use it: Engineer and Reviewer in
  Indicator sprint team, Writer in Docs team. They lose it on their next run." Buttons Cancel and "Remove tool"
  (secondary). After removal the row is gone and a toast reads "github removed from Toolkit." There is no undo.
- **Duplicate** adds a row `github-copy`, Remote, Ready, "Not used yet". The toast reads "Copied as github-copy.
  Rename it in its settings." with an "Open" action.

**Add from the catalog (`TkF-Catalog-1..4`).**
1. Web fetch shows a primary "Add".
2. After adding, it shows "In your tools" (disabled), and a toast reads "Web fetch added. Turn it on for an agent in
   its Skills & tools tab." with a "Choose agents" action.
3. "Install GitHub App" opens an alertdialog, "Install the Tvashtr GitHub App": "GitHub opens in a new window. Pick
   the repos Tvashtr can use, then come back here. Hosted runs can only open pull requests on those repos."
   Buttons Cancel and "Open GitHub".
4. Back from GitHub, the card badge is `App installed` (success) and the action is "Choose repos" (secondary). A
   toast reads "GitHub App installed on 2 repos."

**Paste an mcp.json (`TkF-Paste-1..3`).** A right sheet titled "Paste mcp.json" with the subtitle "From Claude,
Cursor or VS Code".
1. A code area holds JSON with a missing comma. Below it: "Line 3: add a comma after the linear entry.", and "Add 2
   servers" is disabled.
2. Once fixed, it shows "2 servers found" and a checked list: linear (Remote), sqlite (Local). "Add 2 servers" is
   enabled.
3. Added: a new sqlite row (Local, `uvx mcp-server-sqlite`, Ready, "Not used yet"). The toast reads "2 servers
   added. linear needs a secret." with an "Add secret" action.

**Tool detail page (`Toolkit-ToolDetail`, `TkF-Detail-1..5`).** Clicking a row opens a full page.
- Breadcrumb "Tools › github".
- Header: icon, name, `Remote` badge and a `Ready` dot. Buttons "Duplicate" and "Save changes" (disabled when
  clean).
- Left column, **Connection** card: URL input; a read-only "Headers Authorization: Bearer" line with the chip
  `${GITHUB_TOKEN} · set` (OK); "Advanced (raw JSON)".
- Left column, **Remove from Toolkit** card: "The 3 agents above lose it on their next run." and a "Remove" button.
- Right column, **Used by 3 agents in 2 teams**: rows of role, team and an "Open" link to the canvas, then "Edits
  here reach every agent above on its next run."

The flow:
1. The page opens.
2. Editing the URL (…/mcp/v2) shows an `Unsaved` marker and a "Discard" button, and enables "Save changes".
3. Raw JSON is expanded.
4. After save, a toast reads "Saved. 3 agents use the new settings on their next run."
5. "Remove" opens an alertdialog: "Remove github? Engineer, Reviewer and Writer lose it on their next run. You can
   add it again later." Buttons Cancel and "Remove tool".

**Tools empty (`TkF-ToolsEmpty-1`).** The header, tabs, search and filter stay. The table is replaced by "No tools
yet", "Tools are MCP servers your agents can call, like web fetch or GitHub. Start from the catalog, or connect your
own.", and the buttons "Paste mcp.json" (secondary) and "Browse catalog" (primary). The footnote is gone.

**Secrets (`Toolkit-Secrets`).** h1 "Secrets" and the lede "Values your tools use as ${NAME}. Stored encrypted for
your account. Once saved, a value is never shown again." "Add secret" is primary. A WARN status banner reads
"LINEAR_TOKEN is used by linear but has no value. linear won’t connect until you add it." with "Add value". A
table with columns Name / Used by / Updated / ⋯ has three rows:

| Name | Badge | Used by | Updated | Action |
|---|---|---|---|---|
| LINEAR_TOKEN | `No value` (warning) | linear | — | tint "Add value" |
| GITHUB_TOKEN | `Sensitive` (neutral) | github | Sep 20 | ⋯ |
| SENTRY_TOKEN | `Sensitive` | "Not used by any tool" | Aug 30 | ⋯ |

The footer reads "Model API keys (OpenAI, Gemini, OpenRouter…) live in Engines , not here." and links "Open Engines →".

**Add a secret (`TkF-AddSecret-1..4`).**
1. The "Add a secret" dialog has a Name field (placeholder "e.g. GITHUB_TOKEN", helper "Capital letters, numbers
   and _. Tools use it as ${NAME}.") and a Value password field ("Paste the secret value"). "Save secret" is
   disabled while the fields are empty.
2. The name "notion-token" gives the error "Use capital letters, numbers and _, like NOTION_TOKEN."
3. The name "GITHUB_TOKEN" gives the error "GITHUB_TOKEN already exists. Use Replace value on it instead."
4. Saved: a new NOTION_TOKEN row (Sensitive, "Not used by any tool", "Just now"), and a toast "NOTION_TOKEN saved.
   Use it in a tool as ${NOTION_TOKEN}."

**Secret ⋯ menu (`TkF-SecretMenu-1..6`, `Toolkit-ReplaceSecret`).**
1. The menu has: Replace value, See tools that use it, Copy ${GITHUB_TOKEN}, Delete secret.
2. "See tools that use it" opens a 300px popover, "Tools that use GITHUB_TOKEN". It reads "Used by 1 tool" and
   shows github with "3 agents · 2 teams" and an "Open" link to the tool.
3. "Replace value" opens the "Replace GITHUB_TOKEN" dialog: "The old value is deleted when you save. github picks
   up the new one on its next run." The Name is disabled, with helper "Names can’t be changed. Delete and add a new
   secret instead." A "New value" field and the buttons Cancel / "Replace value".
4. Replaced: toast "GITHUB_TOKEN replaced. github uses the new value on its next run."
5. "Delete secret" opens an alertdialog: "Delete GITHUB_TOKEN? github uses it. github stops connecting for
   Engineer, Reviewer and Writer until you add it again. You can’t undo this." Buttons Cancel and "Delete secret".
6. Deleted: the row is gone and a toast reads "GITHUB_TOKEN deleted. github now needs a secret." The nav still
   shows "1 missing" (see Q2).

**Fix a missing value (`TkF-SecretFix-1..2`).** "Add value" in the banner opens the "Add LINEAR_TOKEN" dialog with
the name prefilled and disabled. After saving, the banner is gone. The row changes to `Sensitive`, "Just now" and a
⋯ button, the nav badge is gone, and a toast reads "LINEAR_TOKEN saved. linear is ready."

**Secrets empty (`TkF-SecretsEmpty-1`).** "No secrets yet" and "Secrets hold values like tokens. Tools use them as
${NAME}, so the value never sits in the config. Add one here, or while adding a tool." with an "Add secret"
button. No banner and no nav badge.

**Desktop (`Toolkit-ToolsDesktop`).** The raw HTML diff against `Toolkit-Tools` is only the title bar ("Tvashtr —
the living canvas", traffic lights) and a 30px shorter body. There are no Desktop-specific controls or copy.
Behavioural differences that still exist in code are in §4 and §6.

**Before → after (`Toolkit-BeforeAfter`).** This is the intent statement:
- 4 sub-pages instead of one long page
- add forms open only on demand
- a health status and fix button on every tool
- "used by" on every tool and skill

---

## 2. Behaviour requirements

### Shell / navigation
- **TOOL-1** The left nav shows a "Toolkit" group button with the sub-items Tools, Skills, Memory and Secrets.
  Clicking "Toolkit" opens Tools, the default sub-page. The active sub-item has `aria-current="page"`.
- **TOOL-2** The nav shows the helper copy: "Toolkit holds what any team’s agents can use. Switch things on per agent
  in its Skills & tools tab."
- **TOOL-3** The nav "Tools" item shows the count of installed tools ("Tools 3"). Hide it at 0; the empty design
  still shows "3", which is a design slip.
- **TOOL-4** The Tools page header has h1 "Tools" and the lede "MCP servers your agents can call. Add a server here
  once, then switch it on for any agent in its Skills & tools tab."
- **TOOL-5** The header buttons are "Paste mcp.json" (secondary, Installed tab only) and "Add tool" (primary, both
  tabs).
- **TOOL-6** The pill tabs are "Installed" (with the total installed count, unaffected by filters) and "Browse".
- **TOOL-7** The Installed-tab footnote (info icon), shown only when the list is non-empty, reads: "**Domains** is
  built in. Turn it on for an agent in its Skills & tools tab. It isn’t added here."

### Installed list
- **TOOL-8** The table has the columns Tool / Runs / Status / Used by / actions. Rows are sorted by name, A→Z.
- **TOOL-9** The Tool cell shows the name and a transport badge: `Local` when `server_config.command` is set,
  `Remote` when `server_config.url` is set.
- **TOOL-10** The Runs cell shows, for Local, `command` plus `args` joined by spaces (`uvx mcp-server-fetch`). For
  Remote it shows the URL without its scheme and trailing slash (`api.githubcopilot.com/mcp`).
- **TOOL-11** The Status cell shows `Ready` (OK dot) when every `${NAME}` in the tool's `env`/`headers` values has a
  stored secret. Otherwise it shows WARN `Needs <NAME>` plus a tint "Add secret" button that opens the Add-<NAME>
  dialog (TOOL-71). The copy for 2+ missing names is not designed (see Q3).
- **TOOL-12** The Used by cell shows `N agent(s) · M team(s)`, pluralised ("1 agent · 1 team", "3 agents · 2 teams"),
  or "Not used yet" when unused.
- **TOOL-13** Each row has a ⋯ IconButton with `aria-label="More actions for <name>"`.
- **TOOL-14** Clicking a row (outside its buttons) opens that tool's detail page.

### Search and filter
- **TOOL-15** The "Search tools" input filters rows live by name, case-insensitive substring.
- **TOOL-16** The Status select offers "All statuses" (default), "Ready" and "Needs attention", and combines with the
  search.
- **TOOL-17** When the status filter is not "All", a summary line shows ("Showing tools that need attention · 1") with
  a "Clear" button that resets the filter. The "Ready" wording is not designed; suggest "Showing ready tools · N".
- **TOOL-18** No-results state: "No tools match “<query>”", "Try another word, or add it as a custom server." Buttons:
  "Clear search" (secondary) clears the query; "Add tool" (primary) opens the wizard. Recommend prefilling Name with
  the query.

### Empty / loading / error
- **TOOL-19** Empty state (no tools): "No tools yet", "Tools are MCP servers your agents can call, like web fetch or
  GitHub. Start from the catalog, or connect your own." Buttons: "Paste mcp.json" (secondary) opens the paste sheet;
  "Browse catalog" (primary) switches to the Browse tab.
- **TOOL-20** Loading state: a skeleton or "Loading…" in place of the table. Error state: "Couldn’t load your
  tools." with Retry. Neither is designed; the current shelf silently swallows errors.

### Browse (catalog)
- **TOOL-21** Web fetch card: title "Web fetch", success badge "Free · no login", copy "Fetch web pages over HTTP. Runs
  locally with uvx mcp-server-fetch." The primary button "Add" becomes a disabled secondary "In your tools" once a
  tool of that name or catalog key exists.
- **TOOL-22** Clicking "Add" on Web fetch creates the tool and stays on Browse. A toast reads "Web fetch added. Turn it
  on for an agent in its Skills & tools tab." with a "Choose agents" action that opens the Turn-on dialog (TOOL-47)
  for the new tool.
- **TOOL-23** GitHub App repos card: copy "Hosted runs use your Tvashtr GitHub App installation. Install the App, then
  launch against an App repo." When no installation exists: warning badge "Needs GitHub App" and primary "Install
  GitHub App". When installed: success badge "App installed" and secondary "Choose repos".
- **TOOL-24** "Install GitHub App" opens an alertdialog titled "Install the Tvashtr GitHub App" with the body "GitHub
  opens in a new window. Pick the repos Tvashtr can use, then come back here. Hosted runs can only open pull
  requests on those repos." Buttons: Cancel (ghost) and "Open GitHub" (primary), which opens the install URL.
- **TOOL-25** On return (window focus or visibility), re-read the install state. If it went from 0 to installed, or
  the repo set changed, show the toast "GitHub App installed on N repos." (pluralise "1 repo") and flip the card
  (TOOL-23).
- **TOOL-26** "Choose repos" opens the GitHub "add repositories" page and runs the same return detection
  (TOOL-25).
- **TOOL-27** Custom server card: neutral badge "Any MCP server", copy "Connect any server: a local command (like uvx
  or npx) or a remote URL, with secrets as ${NAME}.", secondary "Set up". "Set up" opens the wizard at step 1 with
  "A custom server" selected.
- **TOOL-28** Paste mcp.json card: neutral badge "Bulk", copy "Bring servers over from Claude, Cursor or VS Code. We
  check it and list what we found before adding.", secondary "Paste". "Paste" opens the paste sheet.
- **TOOL-29** On a self-hosted backend (`hosted_mode=false`), hide the GitHub App card or show it disabled with the
  note "Hosted only". Not designed.

### Add tool wizard (sheet)
- **TOOL-30** "Add tool" opens a right sheet: `role=dialog`, `aria-label="Add a tool"`, 540px, over a scrim. The
  title is "Add a tool" with the subtitle "Step 1 of 3", then "<name> · step N of 3" from step 2 on. Close is an X
  icon button (`aria-label="Close"`). Focus is trapped and Escape closes. Discarding a half-filled draft is not
  designed; recommend no confirm below step 2 and "Discard this tool?" after.
- **TOOL-31** The stepper shows Basics / Connection / Secrets. The current step's number is highlighted and completed
  steps show a check.
- **TOOL-32** Step 1, "Start from", has three radios:
  - "The catalog — Web fetch or GitHub App repos, set up for you." Choosing it closes the sheet and opens the Browse
    tab.
  - "A custom server — Any MCP server: a local command or a remote URL." This is the default.
  - "An mcp.json — Paste config from Claude, Cursor or VS Code." Choosing it swaps to the paste sheet.
- **TOOL-33** Step 1 has a Name input with helper "Lowercase, no spaces. Agents see this name." Validate the format
  and uniqueness before "Next: Connection". Error copy is not designed; propose "Use lowercase letters, numbers, -
  and _, like my-server." and "You already have a tool named <name>." Buttons: Cancel (ghost) and "Next:
  Connection" (primary).
- **TOOL-34** Step 2 has a "Where it runs" segmented control with "Local command" and "Remote URL" (`aria-pressed`).
- **TOOL-35** Remote mode:
  - "URL" input.
  - "Headers" rows: a header-name input and a value field that renders literal text plus `${NAME}` chips. Each chip
    shows its state: "· not set" (WARN) or "· set" (OK).
  - "Remove header" icon and an "Add header" ghost button.
- **TOOL-36** Local mode:
  - "Command" input.
  - "Arguments" input, marked optional, helper "Space-separated."
  - "Environment" rows: KEY input plus a value field with chips.
  - "Remove variable" and "Add variable".
- **TOOL-37** Hint line: "Type `${` to pick a secret. The value stays out of the config and is filled in at run time."
- **TOOL-38** Typing `${` in a header or env value opens a listbox of existing secret names. Each shows its usage
  ("used by <tool>, <tool>" or "not used"). After a divider comes "Create <SUGGESTED>", where the suggestion is
  `<TOOL_NAME_UPPER>_TOKEN`. Picking one inserts `${NAME}`; "Create" inserts the ref and adds that name to step 3.
  Arrow keys move, Enter picks, Escape closes.
- **TOOL-39** "Advanced (raw JSON)" disclosure: a textarea holding the server config JSON, with "Edits here and in the
  form above stay in sync." Edits sync both ways, and invalid JSON shows an inline error without clobbering the form.
- **TOOL-40** Step 2 buttons: Back (ghost) and "Next: Secrets" (primary). Validation: a Remote needs an http(s) URL
  and a Local needs a command. The copy is not designed.
- **TOOL-41** Step 3 opens with "<name> uses one secret. Add its value now or later in Secrets." Pluralise to "uses N
  secrets". The zero-secret copy is not designed; propose "<name> uses no secrets." and hide the rows. For each
  referenced name:
  - The name, with a `Not set` (warning) badge, or `Set` if the secret already exists.
  - For unset names only, a password input with placeholder "Paste the value".
  - The note "Stored encrypted for your account. We never show it again."
- **TOOL-42** Step 3 has the row "Switch it on for agents now" / "You can also do this later, per agent." with a
  "Choose agents" button. It opens the Turn-on dialog (TOOL-47) and the selection is held until "Add tool".
- **TOOL-43** Step 3 buttons are Back and "Add tool" (primary). Submitting:
  1. Store each non-empty secret value.
  2. Create the tool.
  3. Turn it on for the chosen agents.
  4. Close the sheet and refresh the list and nav badges.

  Partial failure must say which step failed (not designed).
- **TOOL-44** Toast after adding: "<name> added and turned on for <Role>." with "Open <Role>", which opens that
  team's canvas with the agent's drawer on its Skills & tools tab. Variants are not designed: none chosen → "<name>
  added."; 2+ agents → "<name> added and turned on for N agents." with no Open action.
- **TOOL-45** After adding, the new row shows Ready when all values were given, else Needs <NAME>, and the Secrets nav
  badge updates.
- **TOOL-46** Local-command variant: the same three steps, with the step-2 local fields (TOOL-36).

### Turn on for agents dialog
- **TOOL-47** The dialog is `role=dialog`, `aria-label="Turn on for agents"`, 500px. Title "Turn <name> on for…", sub
  "Each agent can still switch it off in its Skills & tools tab."
  - Lists every agent node (agent/completion kinds) across all the user's library teams, grouped under team-name
    headers.
  - Each row is a checkbox, the role name, and a `thinker` tag for edits-off agents (`edits_allowed=false`).
  - When opened from the ⋯ menu, agents that already use the tool are pre-checked.
  - Buttons: Skip (ghost), and primary "Turn on for N agent(s)" whose count tracks the checked set.
  - Recommend a note on agents that run on a Desktop subscription (see Q10).

### Row ⋯ menu
- **TOOL-48** The ⋯ menu (`role=menu`, 240px) has four items:
  - "Edit connection" → detail page.
  - "Duplicate".
  - "Turn on for agents…" → TOOL-47.
  - "Remove from Toolkit".

  Arrow-key navigation; Escape closes.
- **TOOL-49** Remove confirmation (`role=alertdialog`) reads "Remove <name> from Toolkit? <N> agents in <M> teams use
  it: <Role> and <Role> in <Team>, <Role> in <Team>. They lose it on their next run." Buttons: Cancel (ghost) and
  "Remove tool" (secondary). Unused-tool copy is not designed; propose "Remove <name> from Toolkit? No agents use
  it."
- **TOOL-50** After removal the row disappears and the toast reads "<name> removed from Toolkit." There is no undo.
  Counts update in the tab and nav.
- **TOOL-51** Duplicate creates `<name>-copy` with the same config; if taken, use `-copy-2` and so on. The new row
  shows "Not used yet". The toast reads "Copied as <name>-copy. Rename it in its settings." with "Open", which opens
  the copy's detail page.

### Tool detail page
- **TOOL-52** Breadcrumb "Tools › <name>"; "Tools" goes back to the list and keeps the search and filter.
- **TOOL-53** Header: tool icon, name, transport badge, and a status dot with label ("Ready" / "Needs <NAME>").
- **TOOL-54** Header buttons: "Duplicate" (secondary, same as TOOL-51) and "Save changes" (primary, disabled while
  clean).
- **TOOL-55** Dirty state shows an `Unsaved` marker, a "Discard" (ghost) button that reverts to the saved config, and
  an enabled "Save changes". Guarding against navigating away while dirty is not designed; recommend a confirm.
- **TOOL-56** The "Connection" card:
  - Remote: the URL input and a "Headers" line such as "Authorization: Bearer ${GITHUB_TOKEN} · set", with the chip
    state from TOOL-35.
  - Local: Command, Arguments and Environment, as in TOOL-36 (not drawn).
  - An "Advanced (raw JSON)" disclosure with the JSON, synced as in TOOL-39.
  - Header and env rows are read-only here. Recommend reusing the editable rows from the wizard.
- **TOOL-57** Save → the toast "Saved. <N> agents use the new settings on their next run." The 0-agent variant is not
  designed; propose "Saved."
- **TOOL-58** The "Remove from Toolkit" card reads "The <N> agents above lose it on their next run." with a "Remove"
  (secondary) button. It opens an alertdialog: "Remove <name>? <Role>, <Role> and <Role> lose it on their next run.
  You can add it again later." Buttons: Cancel and "Remove tool". After removal, return to the Tools list with the
  toast from TOOL-50.
- **TOOL-59** The "Used by <N> agents in <M> teams" card lists one row per agent: role name, team name, and an "Open"
  link. The link opens that team's canvas with the node selected on its Skills & tools tab. The footer reads "Edits
  here reach every agent above on its next run." Empty copy is not designed; propose "Not used yet. Turn it on for
  an agent in its Skills & tools tab." with a "Turn on for agents…" button.
- **TOOL-60** Rename: the duplicate toast says "Rename it in its settings", but the detail page has no Name field.
  Add a Name input to the Connection card, validated as in TOOL-33.

### Paste mcp.json
- **TOOL-61** A right sheet (`aria-label="Paste mcp.json"`, 540px) with title "Paste mcp.json", subtitle "From Claude,
  Cursor or VS Code", and a Close button.
- **TOOL-62** A monospace textarea. Live parse errors are friendly, line-numbered and name the entry, e.g. "Line 3:
  add a comma after the linear entry." While the JSON is invalid, the primary "Add N servers" stays disabled. N comes
  from the last tolerant parse.
- **TOOL-63** On a valid parse the sheet shows "<N> servers found" and a checkbox list, all checked by default. Each
  row is the server name plus a Local or Remote badge. The primary button reads "Add <checked> servers".
- **TOOL-64** Accepted root keys are `mcpServers` (Claude Desktop / Claude Code / Cursor) and `servers` (VS Code).
  VS Code `${input:x}` and `${env:X}` refs are normalised to `${X}`. Drop a `"type":"stdio"` key.
- **TOOL-65** After adding, the rows appear with "Not used yet". The toast reads "<N> servers added." and, if any
  added tool is missing secrets, adds "<name> needs a secret." with an "Add secret" action that opens the Add-<NAME>
  dialog.
- **TOOL-66** A pasted server whose name already exists needs defined behaviour; it is not designed (see Q1).

### Fix a missing secret from Tools
- **TOOL-67** The row "Add secret" button opens the "Add <NAME>" dialog with Name prefilled and disabled, the helper
  "Capital letters, numbers and _. Tools use it as ${NAME}.", a Value password field ("Paste the secret value"), the
  note "Stored encrypted. We never show a value again.", and the buttons Cancel and "Save secret".
- **TOOL-68** After saving, the row flips to Ready and the nav "missing" badge updates. The toast reads "<NAME> saved.
  <tool> is ready." Recommend "<NAME> saved." when the tool still misses another secret.

### Desktop
- **TOOL-69** Desktop renders the same page and behaviour. The Install GitHub App round trip must land back on
  Toolkit › Tools › Browse with the TOOL-25 toast. Today Electron loads GitHub in the main window and returns to `/`
  (see §4).
- **TOOL-70** On Desktop, the "Local" badge and Turn-on dialog must not imply tools reach agents that run on this
  computer with a Claude or Grok subscription (see Q10). Not designed.

### Accessibility and keyboard (not designed; standard)
- **TOOL-71** Escape closes any sheet, dialog, menu, listbox or popover, and focus returns to the trigger (reuse
  `useModalDialog`).
- **TOOL-72** Enter submits the focused dialog's primary action when it is enabled.
- **TOOL-73** Toasts use `role="status"`; the action button is focusable. Auto-dismiss after about 5s, paused on
  hover or focus.

### Secrets
- **SECRET-1** The nav Secrets item shows a WARN badge "N missing": the count of distinct `${NAME}`s referenced by
  installed tools that have no stored value. It is hidden at 0.
- **SECRET-2** Header: h1 "Secrets", the lede "Values your tools use as ${NAME}. Stored encrypted for your account.
  Once saved, a value is never shown again.", and a primary "Add secret".
- **SECRET-3** Show one WARN banner (`role=status`) per missing name: "<NAME> is used by <tool> but has no value.
  <tool> won’t connect until you add it." with "Add value" (secondary), which opens SECRET-19. Copy for a name used
  by 2+ tools is not designed; propose "used by linear and jira … they won’t connect".
- **SECRET-4** The table has the columns Name / Used by / Updated / actions. Order: missing rows first, then by name
  A→Z.
- **SECRET-5** A missing row shows the name plus a `No value` (warning) badge, the tool names under Used by, "—" under
  Updated, and a tint "Add value" button (→ SECRET-19).
- **SECRET-6** A stored row shows:
  - the name, with a `Sensitive` (neutral) badge;
  - Used by: comma-separated tool names, or "Not used by any tool";
  - Updated: "Just now" (<1 min), otherwise a short date ("Sep 20");
  - a ⋯ button (`aria-label="More actions for <NAME>"`).

  The value is never shown, masked or otherwise.
- **SECRET-7** The footer reads "Model API keys (OpenAI, Gemini, OpenRouter…) live in Engines , not here." with the
  link "Open Engines →", which switches the dashboard view to Engines. Fix the stray space before the comma.
- **SECRET-8** Empty state (no stored secrets and none missing): "No secrets yet", "Secrets hold values like tokens.
  Tools use them as ${NAME}, so the value never sits in the config. Add one here, or while adding a tool." and a
  primary "Add secret".
- **SECRET-9** The Add-a-secret dialog (`role=dialog`, "Add a secret", 500px) has:
  - Name: placeholder "e.g. GITHUB_TOKEN", helper "Capital letters, numbers and _. Tools use it as ${NAME}."
  - Value: a password field with placeholder "Paste the secret value".
  - The note "Stored encrypted. We never show a value again."
  - Buttons Cancel and "Save secret"; Save is disabled until both fields are non-empty.
- **SECRET-10** Name format error: "Use capital letters, numbers and _, like <SUGGESTION>." The suggestion is the
  input upper-cased with each run of other characters turned into `_` ("notion-token" → NOTION_TOKEN). Rule:
  `^[A-Z_][A-Z0-9_]*$`, max 128 characters.
- **SECRET-11** Name-taken error (409): "<NAME> already exists. Use Replace value on it instead."
- **SECRET-12** On save, the new row appears with "Just now" and the toast reads "<NAME> saved. Use it in a tool as
  ${<NAME>}."
- **SECRET-13** The ⋯ menu (`role=menu`) has: "Replace value", "See tools that use it", "Copy ${<NAME>}", "Delete
  secret".
- **SECRET-14** "See tools that use it" opens a popover (`role=dialog`, "Tools that use <NAME>", 300px). It shows
  "Used by N tool(s)" and, per tool, the name, "<a> agents · <t> teams", and an "Open" link to the tool's detail
  page. Unused copy is not designed; propose "Not used by any tool."
- **SECRET-15** "Copy ${<NAME>}" writes the literal `${NAME}` to the clipboard. Confirmation is not designed; propose
  the toast "Copied ${NAME}."
- **SECRET-16** The Replace dialog (`aria-label="Replace <NAME>"`) reads "Replace <NAME>" / "The old value is deleted
  when you save. <tool> picks up the new one on its next run." (unused variant: drop the second sentence). Fields:
  Name, disabled, with helper "Names can’t be changed. Delete and add a new secret instead."; "New value", a
  password field with placeholder "Paste the new value". Buttons: Cancel and "Replace value", disabled while empty.
- **SECRET-17** After replacing, the Updated cell reads "Just now" and the toast reads "<NAME> replaced. <tool> uses the
  new value on its next run."
- **SECRET-18** Delete confirmation (`role=alertdialog`) reads "Delete <NAME>? <tool> uses it. <tool> stops connecting
  for <Role>, <Role> and <Role> until you add it again. You can’t undo this." Buttons: Cancel and "Delete secret"
  (secondary). Unused copy is not designed; propose "Delete <NAME>? No tool uses it. You can’t undo this."
- **SECRET-19** "Add value" from the banner, a missing row, or a tool row opens the "Add <NAME>" dialog with Name
  prefilled and disabled; otherwise it is as SECRET-9. After save:
  - the banner is removed;
  - the row changes to Sensitive / "Just now" / ⋯;
  - the nav badge updates;
  - the toast reads "<NAME> saved. <tool> is ready."
- **SECRET-20** After a delete, the toast reads "<NAME> deleted. <tool> now needs a secret." (unused: "<NAME>
  deleted."). Dependent tools flip to Needs attention. Recommend the row re-appears as a `No value` row and the nav
  count goes up; the design shows neither (see Q2).
- **SECRET-21** A value is only ever typed into `type=password` inputs. No API returns a value, masked or otherwise;
  drop the fake `••••` the current shelf shows.
- **SECRET-22** Loading and load-error states for the table (not designed), as in TOOL-20.
- **SECRET-23** Desktop: identical. Clipboard copy works in Electron's `http://127.0.0.1` secure context without a
  bridge.

---

## 3. Backend gap table

Reference facts, verified in code:
- **Library refs on a node.** They live in `AgentNode.tool_config` JSONB as `tool_config.tvashtr.library:
  [<tool uuid str>…]`. The per-agent on/off switch is keyed by server **name**:
  `tool_config.tvashtr.servers[<name>].enabled` (default on). An inline `tool_config.mcpServers[<name>]` with the
  same name overrides the library tool at run time (`node_tools.build_mcp_config`). The FE writes this from
  `panel/ToolsSection.tsx` (`librariesOf` / `addLibraryRef` / `setEnabled`).
- **Secret refs** are resolved **only in `env` and `headers` values**, not in `url`, `command` or `args`
  (`node_tools._secret_refs` / `_substitute`). The ref regex is `\$\{([A-Za-z_][A-Za-z0-9_]*)\}`. A missing secret
  drops that server and records a `run_warnings` row; the run continues.
- **Neither POST upsert checks for an existing name.** `POST /api/secrets` upserts on `(owner, name)` via
  `mcp_secrets.set_owner_mcp_secret`, and `POST /api/tool-library` upserts on `(owner, name)` via
  `node_library.create_owner_tool`. Both overwrite silently.
- **`PATCH /api/tool-library/{id}`** has no name-clash check. Renaming onto an existing name hits
  `uq_tool_library_owner_name`, an unhandled IntegrityError, so a 500.
- **`mcp_secrets.updated_at` and `tool_library.updated_at` exist** (migrations 0022/0023, `onupdate=now()`) but are
  never serialised.
- **The only name validation is "non-empty after strip"**, in both routers.
- **GitHub App state:** `GET /api/github/repos` returns `{repos:[{name,full_name,private,default_branch,html_url}],
  installation_count}`. `GET /api/config` returns `hosted_mode`, `github_install_url` (OAuth authorize) and
  `github_manage_url` (`github.com/apps/<slug>/installations/new`).

| ID | Needs | Status | Where / proposal |
|---|---|---|---|
| TOOL-3, SECRET-1 | Nav counts (tools, missing secrets) on every dashboard page | PARTIAL | Derivable from `GET /api/tool-library` + `GET /api/secrets` + client ref-parsing, but that is 2 calls and duplicated parsing on every page. **Add `GET /api/toolkit/summary`** → `{"tools":3,"tools_needing_attention":1,"skills":3,"memory_inbox":2,"secrets_missing":1}`. It lives in a new `control_plane/toolkit.py` that calls `node_library` / `mcp_secrets` / memory helpers; `skills` and `memory_inbox` are shared with the Skills and Memory analysts. |
| TOOL-8, TOOL-9, TOOL-10 | Name, transport, command/URL per tool | EXISTS | `GET /api/tool-library` → `tools[].{id,name,server_config,created_at}`. Transport and "Runs" are derived from `server_config.command/args/url/type` (existing `transportOf` in `ToolsShelf.tsx`). |
| TOOL-11, TOOL-53, TOOL-16 | Tool status (Ready / Needs NAME) and filter | PARTIAL | Client-derivable as `refs(server_config.env∪headers) − GET /api/secrets names`, but duplicated regex. **Extend each `tools[]` item** with `"secret_refs":["LINEAR_TOKEN"]`, `"missing_secrets":["LINEAR_TOKEN"]`, `"status":"ready" \| "needs_attention"`, `"updated_at": iso`. `node_library.list_owner_tools` loads the owner's secret names once (`mcp_secrets.list_owner_mcp_secret_names`) and reuses `node_tools._secret_refs`; move it to a shared `node_library.secret_refs(server)`. Also treat a config with neither `command` nor `url` as `needs_attention`. |
| TOOL-12 | "N agents · M teams" per tool | MISSING | **Add `"used_by":{"agent_count":2,"team_count":1}` to each `tools[]` item.** New `node_library.tool_usage(owner_id) -> dict[tool_id, list[UsageRow]]`: select `AgentNode` join `TeamGraph` where `TeamGraph.is_library`, `TeamGraph.owner_id == owner`, `AgentNode.kind in ("agent","completion")`, `AgentNode.tool_config IS NOT NULL`, and scan `tvashtr.library`. Count a node only when the ref is **effective**: not `tvashtr.servers[name].enabled == false` and not overridden by an inline `mcpServers[name]`. Owner-scoped; run-snapshot clones are excluded because they are `is_library=false`. No migration. Optional later: a GIN index on `agent_nodes.tool_config`. |
| TOOL-15, TOOL-17, TOOL-18 | Search, status filter, no-results | EXISTS | Client-side over `GET /api/tool-library` (+ status fields above). |
| TOOL-21, TOOL-23, TOOL-27, TOOL-28 | Catalog cards and copy | PARTIAL | `GET /api/tool-catalog` (`main.py` → `tool_skill_catalog.public_tool_catalogue`) returns `fetch`, `github` ("GitHub (PAT)", stdio `npx @modelcontextprotocol/server-github`) and `github-app`, with `badge` `"Free"` / `"Needs ${GITHUB_TOKEN}"` / `"Needs GitHub App"`. **Change in `tool_skill_catalog.TOOL_CATALOGUE`:** fetch `description` → "Fetch web pages over HTTP. Runs locally with uvx mcp-server-fetch."; add a tool-specific `badge` "Free · no login" (do not change `access_badge("free")`, which skill presets also use). Match github-app's description to the design copy. Decide the fate of `github` (PAT) — not in the design (see Q8). "Custom server" and "Paste mcp.json" cards are FE-static. |
| TOOL-21 | "In your tools" detection | EXISTS | Name match `tools.some(t => t.name === entry.name)` (existing `ToolsShelf`). It breaks if the user renames; optional hardening is a nullable `tool_library.catalog_key TEXT` column (migration `0041_tool_library_catalog_key`), set by a `catalog_key` field on POST. |
| TOOL-22 | Add from catalog | EXISTS | `POST /api/tool-library {name, server_config}` → `{id,name}`. After the create-only change below, a name clash returns 409 → show "In your tools". |
| TOOL-23 | GitHub App install state + repo count | EXISTS | `GET /api/github/repos` → `installation_count` (0 ⇒ "Needs GitHub App"), `repos.length` (N repos). `GET /api/config` → `hosted_mode` (hide the card when false, TOOL-29). The pattern is already in `LaunchPanel.tsx`. |
| TOOL-24, TOOL-26 | Install / "Choose repos" URLs | EXISTS | `/api/config.github_install_url` (use when `installation_count==0`; Desktop-rewritten by `rewriteGithubInstallUrlForDesktop`) and `/api/config.github_manage_url` (use for "Choose repos"). Caveat: after `installations/new`, GitHub redirects to the App's *Setup URL*. If that is `/api/auth/github/callback` without "Request user authorization during installation", `code` is absent and the route 422s because `code: str` is required (`auth.github_callback`). Config risk; see Q9. |
| TOOL-25 | Detect return + "installed on N repos" | PARTIAL | Re-poll `GET /api/github/repos` on focus. It works, but lists every repo (up to 1000 per installation) just for a badge, and the self-heal backfill runs only when the owner has **zero** rows. **Add `GET /api/github/status`** → `{"hosted":true,"installed":true,"installation_count":1,"repo_count":2}`. Use GitHub `GET /installation/repositories?per_page=1` → `total_count` per installation, via a new `github_app.count_installation_repositories(installation_id)`. Same owner-scoping plus the zero-row backfill as `list_github_repos`. |
| TOOL-33, TOOL-60 | Tool name format + uniqueness (create/rename) | MISSING | Routers accept any non-empty name; POST **silently overwrites** an existing tool of that name; PATCH rename onto a taken name → 500. **Change `POST /api/tool-library`** to create-only: 422 `{"detail":"Use lowercase letters, numbers, - and _, like my-server."}` unless `^[a-z0-9][a-z0-9_-]{0,63}$`; 409 `{"detail":"You already have a tool named <name>."}` when taken. **PATCH:** same checks (allow an unchanged legacy name) and catch IntegrityError → 409. Logic: `node_library.create_owner_tool` raises `ToolNameTaken`. `ToolsSection.attachFetch` already looks up an existing `fetch` before POST, so create-only is compatible. |
| TOOL-40 | Connection shape validation | PARTIAL | The server only requires a non-empty dict. **Add** 422 "Add a command or a URL." unless exactly one of `command` (non-empty string) or `url` (http/https) is present, in `node_library.validate_server_config()`, called by POST, PATCH and import. |
| TOOL-35, TOOL-36, TOOL-56 | Chip state "· set" / "· not set" | EXISTS | `GET /api/secrets` → `secrets[].name`. |
| TOOL-38 | `${` autocomplete with "used by <tool>" | PARTIAL | Names exist; usage does not. Covered by `used_by_tools` on `GET /api/secrets` (SECRET-6 row). |
| TOOL-39 | Raw JSON round-trip | EXISTS | `server_config` is stored and returned verbatim (`ToolLibraryItem.server_config` JSONB). |
| TOOL-41, TOOL-43 | Save step-3 secret values | EXISTS | `POST /api/secrets {name,value}` per filled value (create-only after SECRET-11; a name already set is shown as `Set`, with no input). |
| TOOL-43 | Create the tool | PARTIAL | `POST /api/tool-library` → `{id,name}` only. **Return the full item** (`id,name,server_config,created_at,updated_at,secret_refs,missing_secrets,status,used_by`) so the FE can insert the row without a refetch. |
| TOOL-47 | Candidate agents grouped by team, with thinker tag and current state | MISSING | Today it needs `GET /api/teams` plus N × `GET /api/teams/{id}/graph` (heavy; also returns prompts). **Add `GET /api/agents?tool_id=<uuid>`** → `{"teams":[{"team_id":"…","team_name":"Indicator sprint team","agents":[{"node_id":"…","role_name":"Product manager","kind":"completion","edits_allowed":false,"tool_enabled":false,"tool_overridden":false}]}]}`. Library teams only, agent/completion kinds, ordered by team `created_at` then node `position.x`. Logic in `control_plane/teams.py` (`list_owner_agents(owner_id)`), reusing `node_library.tool_usage` for `tool_enabled`. The Skills analyst can share it via `?skill_id=`. |
| TOOL-43, TOOL-47 | Turn a library tool on/off for chosen agents across teams | MISSING | `PATCH /api/teams/{team}/nodes/{node}` requires `prompt`+`model` for agent nodes and **replaces `tool_config` wholesale**, so a cross-team fan-out from the client is N racy full-node writes. **Add `PUT /api/tool-library/{id}/agents`** with body `{"node_ids":["…","…"]}` (the full desired "on" set). For every owner library-team agent/completion node, in one transaction:<br>• **in the set:** ensure `str(id)` is in `tvashtr.library`; delete `tvashtr.servers[name]` if it has `enabled:false`.<br>• **not in the set but currently effective:** remove the id from `tvashtr.library` and drop `tvashtr.servers[name]`.<br>• **an inline `mcpServers[name]` exists:** skip the node and report it.<br>Assign fresh dicts so JSONB is flagged dirty. Response: `{"agents":[{"node_id","role_name","team_id","team_name"}],"agent_count":1,"team_count":1,"skipped":[{"node_id","reason":"an inline server named linear overrides it"}]}`. Logic: `node_library.set_tool_agents(owner_id, tool_id, node_ids)`. |
| TOOL-44, TOOL-59 | "Open <Role>" deep link | PARTIAL | Data: `team_id` + `node_id` come from the PUT response / usage rows above. There is **no URL router**; `AuthGate` only passes `teamId` / `initialRunId` to `App`. This is an FE gap (§5), not backend. |
| TOOL-48 (pre-check), TOOL-49 | Current users of a tool; the remove-impact sentence | MISSING | Same `tool_usage`. **Add `GET /api/tool-library/{id}`** → the item plus `"used_by_agents":[{"team_id","team_name","node_id","role_name"}]`. 404 when it is not the owner's. |
| TOOL-50, TOOL-58 | Remove tool | PARTIAL | `DELETE /api/tool-library/{id}` → 204 exists, but referencing nodes keep a **dangling id**. The drawer then shows "(removed from library)" and every run records a "referenced library tool not found" warning. **Change `node_library.delete_owner_tool`** to also strip the id from every owner node's `tvashtr.library` and drop `tvashtr.servers[<name>]`, in the same transaction. Return `200 {"removed_from_agents":3}` (or keep 204). |
| TOOL-51 | Duplicate | MISSING | Doing it client-side as `POST` with `<name>-copy` would overwrite an existing `-copy` (upsert) and needs a name probe. **Add `POST /api/tool-library/{id}/duplicate`** → 201 full item with `name` = first free of `<name>-copy`, `<name>-copy-2`, …; `used_by` is 0 (refs are not copied). Logic: `node_library.duplicate_owner_tool`. |
| TOOL-52, TOOL-53, TOOL-56 | Detail page data | PARTIAL | Pick the item from `GET /api/tool-library`; the used-by list is MISSING (see `GET /api/tool-library/{id}` above). |
| TOOL-55, TOOL-57, TOOL-60 | Save edits (URL/headers/env/raw JSON/name) | PARTIAL | `PATCH /api/tool-library/{id} {name, server_config}` exists and propagates live (the resolver re-reads each run). Gaps:<br>(a) The response is `{id,name}`; **return the full item including `used_by.agent_count`** for the "N agents use the new settings" toast.<br>(b) A rename orphans each node's `tvashtr.servers[<old>]` switch, so a switched-off agent silently gets the tool back. On rename, `node_library.update_owner_tool` must move `servers[old]` to `servers[new]` on referencing nodes.<br>(c) Name clash → 409 instead of 500.<br>(d) Accept a partial body (either field optional). |
| TOOL-62, TOOL-63, TOOL-64, TOOL-65, TOOL-66 | Paste mcp.json → add N servers | PARTIAL | Possible as N × `POST /api/tool-library`, but that is non-atomic and would silently overwrite same-name tools. Parse, error lines and VS Code normalisation stay FE. **Add `POST /api/tool-library/import`** with body `{"servers":{"linear":{"url":"…"},"sqlite":{"command":"uvx","args":["mcp-server-sqlite"]}},"on_conflict":"error"\|"replace"\|"rename"}` → 200 `{"added":[<full item>…],"conflicts":["linear"]}`. With `error`, nothing is written on conflict and 409 comes back with `conflicts`. Each server passes `validate_server_config` and the name rules. Logic: `node_library.import_owner_tools`. The "linear needs a secret" toast reads `added[].missing_secrets`. |
| TOOL-67, TOOL-68, SECRET-19 | Add a value for a missing secret | EXISTS | `POST /api/secrets {name,value}` → `{name}`. It should also return `updated_at` for "Just now". |
| TOOL-70 | Know which agents won't receive tools on Desktop | MISSING (info) | Desktop-routed nodes go through `engines/desktop_runner_adapter.py`, whose `enqueue_job` carries no `mcp_config`. The CLI also runs with `--safe-mode` (Claude) or an allow-list that blocks MCP (Grok) (`desktop/electron/runner/cliCommand.cjs`). No run warning is recorded. **Minimum:** in `team_run`, when `desktop_route` is set and `build_mcp_config` returns servers, call `record_resolution_warning(run_id,"tool",name,"tools don’t run on Desktop subscription agents")`. Whether to flag at authoring time is Q10. |
| SECRET-3, SECRET-5, SECRET-8 | Referenced-but-unset names ("No value" rows, banner, empty state) | PARTIAL | Client-derivable from all tools' refs minus stored names. **Extend `GET /api/secrets`** with a separate `"missing":[{"name":"LINEAR_TOKEN","used_by_tools":[{"id":"…","name":"linear"}]}]`. Keep `secrets[]` as stored rows only: `ToolsSection` treats `secrets[].name` as "present". Logic: `mcp_secrets.list_owner_mcp_secrets_detailed(owner_id)` plus `node_library` ref scanning. |
| SECRET-6, TOOL-38, SECRET-14 | Secret "used by" tools | MISSING | **Add to each `secrets[]` item** `"used_by_tools":[{"id":"…","name":"github"}]` (library tools whose env/headers reference it). The per-tool "3 agents · 2 teams" comes from `tools[].used_by`. Inline node servers are not counted (Q5). |
| SECRET-6, SECRET-12, SECRET-17 | Updated date | PARTIAL | The column `mcp_secrets.updated_at` exists (and bumps on upsert through ORM `onupdate`), but `GET /api/secrets` returns only `{name}`. **Return `{"name","created_at","updated_at","used_by_tools"}`**; POST and PUT return `{"name","updated_at"}`. |
| SECRET-10 | Name format validation | MISSING | `POST /api/secrets` stores any non-empty name. "notion-token" would be saved and then be un-referenceable, because `_REF` rejects `-`. **Add** 422 `{"detail":"Use capital letters, numbers and _, like NOTION_TOKEN."}` unless `^[A-Z_][A-Z0-9_]{0,127}$`, in `routers.add_secret`. The suggestion is computed by the FE; the server may echo it as `detail.suggestion`. Existing non-conforming rows still list, replace and delete. |
| SECRET-11 | Name already used | MISSING | `POST` upserts silently. **Make `POST /api/secrets` create-only** → 409 `{"detail":"<NAME> already exists. Use Replace value on it instead."}` (`mcp_secrets.create_owner_mcp_secret` raises `SecretExists`). The only FE callers are `SecretsShelf.handleAdd` (being rebuilt). |
| SECRET-16, SECRET-17 | Replace value | PARTIAL | Replacement works today only through the POST upsert, which SECRET-11 removes. **Add `PUT /api/secrets/{name}`** with body `{"value":"…"}` → 200 `{"name","updated_at"}`; 404 when absent; 422 on an empty value. Logic: the existing `set_owner_mcp_secret` (the update branch). |
| SECRET-18 | Delete impact (tool + agent role names) | MISSING | Needs `used_by_tools` (above) plus `GET /api/tool-library/{id}` `used_by_agents` for each tool, fetched when the dialog opens. |
| SECRET-18 (action), SECRET-20 | Delete a secret | EXISTS | `DELETE /api/secrets/{name}` → 204 (idempotent). |
| SECRET-20 | Deleted secret becomes a "No value" row | EXISTS (derived) | Once `missing[]` exists, a deleted but still-referenced name shows up in `missing`. |
| SECRET-21 | Value never returned | EXISTS | No endpoint serialises `secret_encrypted`; values are decrypted only in `node_tools` at run time. |

---

## 4. Desktop bridge gaps

1. **GitHub App install round trip (TOOL-24..26, TOOL-69).** Today `attachNavigationGuards` in
   `desktop/electron/main.cjs` does the following:
   - `setWindowOpenHandler` + `isGithubAuthUrl` load any `github.com/apps/<slug>/installations/new` or
     `login/oauth/…` URL **in the main window**, replacing the SPA, and deny a new window.
   - After GitHub redirects, `localBounceTarget` reloads `${localOrigin}/`.
   - The SPA boots on Home. The Toolkit › Tools › Browse state, and the "Back from GitHub" toast, are lost.
   - The design copy "GitHub opens in a new window … then come back here" is false on Desktop.

   Proposed bridge, in `preload.cjs` + `main.cjs` + the `vite-env.d.ts` `TvashtrDesktopBridge` type:
   ```ts
   github?: {
     /** Opens `url` in a child BrowserWindow (parent = main window, same session so cookies carry).
      *  Resolves when that window navigates back to the local origin or /api/auth/github/callback
      *  ("returned"), or when the user closes it ("closed"). The main window is never navigated away. */
     openInstall: (url: string) => Promise<{ outcome: "returned" | "closed" }>;
   };
   ```
   The main process registers `ipcMain.handle("tvashtr:github:openInstall", …)`. It creates the child window, lets
   `isGithubAuthUrl` URLs navigate in it, and treats `will-redirect` / `did-navigate` to `localOrigin` as done. The
   renderer then re-reads GitHub status (TOOL-25).

   A no-bridge fallback that works on both surfaces: before navigating, write
   `sessionStorage["tv:return"]="toolkit/tools/browse"`, and have `AuthGate`/`Dashboard` restore that view and fire
   the toast on boot. It works on Desktop because the window comes back to the same `127.0.0.1` origin. Recommend the
   fallback for v1 and the bridge when the copy must stay "new window".
2. **Clipboard (SECRET-15).** No bridge needed: `navigator.clipboard.writeText` works in Electron on the loopback
   origin, which is a secure context.
3. **Local command tools on the user's computer.** Not supported, and no bridge can fix it alone.
   - A tool marked `Local` (stdio `command`) runs inside the OpenHands sandbox (Fly machine / Docker), never on the
     user's computer, on both web and Desktop.
   - Desktop subscription agents (`claude` / `grok` CLI via the runner) get **no MCP tools at all**. The job payload
     has no `mcp_config`, and `cliCommand.cjs` passes `--safe-mode` (Claude) or blocks MCP (Grok).

   Supporting it would need all of:
   - (a) the backend to forward the resolved `mcp_config` (with plaintext secret values) in the desktop job;
   - (b) the runner to write it to a temp file and pass `--mcp-config <file> --strict-mcp-config` instead of
     `--safe-mode`;
   - (c) a compliance and security review of `M-subs-desktop`.

   Out of scope; see Q10.
4. **Nothing else** in this area needs native capability. There are no folder pickers or terminals.

---

## 5. Frontend mapping

**What exists today:**
- The `Dashboard.tsx` `view === "tools"` block stacks `SecretsShelf`, `ToolsShelf`, `SkillsShelf` and
  `MemoryShelf` on one page, with the header "Tools / MCP secrets, reusable tool and skill libraries, and account
  memory…".
- `AppShell.tsx` `NAV` is flat: `home | domains | engines | tools`.
- There is no URL router; `AuthGate` holds `openTeamId` and `dashView` in state.

**Keep and reuse:**
- `ToolsShelf.tsx`:
  - `buildServerConfig(transport,target,argsText,rows)` (exported and tested), `rowsOfBlock`, `transportOf`.
  - The "single source of truth `configText` ↔ guided fields" sync (`writeConfig` / `seedGuided` / `onAdvanced`).
    This is exactly the wizard and detail page's "Edits here and in the form above stay in sync" behaviour. Move it
    into a hook, `useServerConfigForm`, in `lib/toolConfig.ts`.
- `panel/ToolsSection.tsx`:
  - the `REF` regex and `refsOf` — move to `lib/toolConfig.ts` for status, chips and the missing count;
  - the storage contract (`tvashtr.library`, `tvashtr.servers[name].enabled`), which the attach endpoint mirrors.
- `lib/useModalDialog.ts`: focus trap, Escape and focus return for every dialog and sheet.
- `LaunchPanel.tsx`: the `installation_count` install/manage branching. Extract a `useGithubAppStatus()` hook shared by
  LaunchPanel and the Browse card.
- `lib/time.ts` `formatRelativeTime`: returns "just now" / "Sep 20"; the design wants "Just now" (capitalise at the
  call site). The "Updated" column only shows "Just now" or a short date, never "3m ago", so add a
  `formatUpdated(iso)`.
- The `.tv-seg` segmented control CSS: reuse it for "Where it runs".

**Rebuild:**
- `AppShell.tsx`: a nested nav with a "Toolkit" group, sub-items with count and WARN badges, and the helper text.
  Change `DashView` to e.g. `"toolkit"` plus a `ToolkitView = "tools" | "skills" | "memory" | "secrets"`, and a
  `toolId` for the detail sub-page. Badges come from `GET /api/toolkit/summary`, re-fetched after every Toolkit
  mutation (a small context: `ToolkitCountsProvider`). The nav is shared with the Skills and Memory analysts.
- `Dashboard.tsx` tools view → `<ToolkitPage view=… />` switching `ToolsPage | SkillsPage | MemoryPage |
  SecretsPage | ToolDetailPage`.
- `ToolsShelf.tsx` → **`ToolsPage.tsx`**: the Installed table, search and filter, empty and no-results states,
  footnote, and the Browse catalog grid.
- `SecretsShelf.tsx` → **`SecretsPage.tsx`**: the missing banners, table, empty state and footer link. The link needs
  a new `onOpenEngines` prop that sets the dashboard view.
- `lib/domains.ts` `domainsMcpAccountToolsHint()`: new copy (TOOL-7).
- Tests to rewrite: `ToolsShelf.test.tsx`, `SecretsShelf.test.tsx`, and the tools-view parts of
  `Dashboard.test.tsx` and `AppShell.test.tsx`. Keep the `buildServerConfig` unit tests.

**New components:**

| Component | Purpose |
|---|---|
| `AddToolSheet` | 3-step wizard; `Stepper`; Basics / Connection / Secrets steps |
| `ConnectionFields` | Local/Remote form shared by the wizard and the detail page; `KeyValueRows` for headers and env |
| `SecretRefInput` | Text input rendering `${NAME}` as chips with a set/not-set state; opens `SecretAutocomplete` on `${` |
| `SecretAutocomplete` | `role=listbox`: existing names with usage plus "Create <NAME>" |
| `RawJsonDisclosure` | The "Advanced (raw JSON)" textarea |
| `TurnOnForAgentsDialog` | Grouped checkboxes, `thinker` tag, live count |
| `ToolRowMenu` | Row ⋯ menu |
| `RemoveToolDialog` | Alertdialog with a composed impact sentence ("Engineer and Reviewer in X, Writer in Y") |
| `ToolDetailPage` | Breadcrumb, header, dirty bar ("Unsaved" / Discard / Save), Connection card, Remove card, `UsedByList` |
| `CatalogCard` | One Browse card |
| `InstallGithubAppDialog` | The install alertdialog |
| `PasteMcpJsonSheet` | Tolerant parser and "friendly JSON error" linter; server checklist |
| `SecretDialog` | Modes: add, add-prefilled (disabled name), replace |
| `DeleteSecretDialog` | Delete alertdialog with impact |
| `SecretRowMenu` | Secret ⋯ menu |
| `ToolsUsingSecretPopover` | "See tools that use it" popover |
| `MissingSecretBanner` | WARN status banner |
| `EmptyState` | Shared empty-state block |

The `PasteMcpJsonSheet` linter must produce copy like "Line 3: add a comma after the linear entry." `JSON.parse`
messages differ per engine, so it needs a small hand-written scanner that tracks the line and the last key. No new
dependency.

**Shared primitives the designs use** (`<DS.*>`; none exist yet in `frontend/src/design-system`, which has only
tokens):
- `Tabs` (pill, with count)
- `Badge`: outline / success / warning / neutral
- `Button`: primary / secondary / ghost / tint, `sm`
- `IconButton`
- `Input`: label, helper, error, optional, disabled, password
- `Select`: listbox popover
- `Menu` (⋯)
- `Dialog` and `AlertDialog` (500px)
- `Sheet` (right `aside`, 540px, with scrim)
- `Popover` (300px)
- `Toast`: dark, `role=status`, one optional action button; no undo in this area
- Status dot + label
- Segmented control
- Stepper
- Checkbox list
- Table with a row-click and ⋯ cell

All but the Stepper, the chip input and the JSON linter are shared with the Skills, Memory and Engines areas.

**Canvas deep link ("Open <Role>", detail-page "Open"):**
- `AuthGate` needs `openNodeId` (and a tab hint `"skills"`) next to `openTeamId`.
- `App` needs `initialNodeId`, used to call `setSelectedNodeId` after `loadTeam`.
- `TeamNodePanel` needs an `initialTab`; its tabs belong to the canvas/drawer analyst.
- The dashboard needs an `onOpenNode(teamId, nodeId, tab)` prop, alongside `onOpenTeam` and `onOpenRun`.

**Coordination with the node drawer (the Skills & tools tab, owned by another analyst):**
- `TeamNodePanel` saves the whole `tool_config` via PATCH. A drawer opened before a Toolkit attach or remove would
  overwrite the change when saved.
- Mitigation: the drawer refetches the node on focus. Alternatively, the PATCH merges `tvashtr.library` /
  `tvashtr.servers` server-side when a new `tool_refs_patch` field is sent. Flag this to that analyst.

---

## 6. Open questions / ambiguities

1. **Pasting or adding a tool whose name already exists.** Paste-3 adds "linear" while a linear row already exists,
   and toasts "2 servers added". AddTool-7 adds linear onto an existing linear row. Today's POST would silently
   overwrite it.
   - *Recommend:* POST and import are create-only. In the paste list, a clashing server shows "Replaces your
     <name>", unchecked by default; checking it sends `on_conflict:"replace"` for that name.
   - *Recommend:* the wizard's Name step shows "You already have a tool named <name>."
2. **Deleting a secret a tool still uses.** SecretMenu-6 removes the row and leaves the nav at "1 missing".
   - *Recommend:* the row re-appears as `No value`, with its banner, and the nav becomes "2 missing", matching the
     "github now needs a secret" toast.
3. **A tool missing 2+ secrets.** The design only shows "Needs LINEAR_TOKEN" / "Add secret".
   - *Recommend:* "Needs LINEAR_TOKEN" for one and "Needs 2 secrets" for more. "Add secret" opens a stacked dialog
     with one password field per missing name.
4. **What unchecking an agent in "Turn on for agents…" means.** It could remove the reference or set
   `enabled:false`.
   - *Recommend:* remove the reference (Toolkit set = effective users). `servers[name].enabled:false` stays the
     drawer's per-agent switch.
   - Needs agreement with the Skills & tools analyst, including whether that tab lists every Toolkit tool with a
     switch; then "on" means ref present and not disabled.
5. **Should inline node servers count in "used by" and in the missing-secret count?**
   - *Recommend:* library tools only; the design says tools are added "here once".
   - *Also:* a one-off migration or prompt to lift existing inline `mcpServers` into the library, so no secret use
     is hidden.
6. **Renaming.** The toast says "Rename it in its settings", but the detail page has no Name field.
   - *Recommend:* add Name to the Connection card.
   - *Recommend:* the backend migrates each node's `servers[old]` switch on rename (§3).
7. **Tool name rule and copy.** Only the helper "Lowercase, no spaces." is designed.
   - *Recommend:* `^[a-z0-9][a-z0-9_-]{0,63}$`, error "Use lowercase letters, numbers, - and _, like my-server."
     Existing mixed-case names stay valid until renamed.
8. **The catalog's "GitHub (PAT)" entry** (stdio `npx @modelcontextprotocol/server-github`, needs `GITHUB_TOKEN`) is
   not in the Browse design. The sample installed "github" is the remote `api.githubcopilot.com/mcp`.
   - *Recommend:* switch the catalog entry to the remote GitHub MCP (`{"url":"https://api.githubcopilot.com/mcp/",
     "headers":{"Authorization":"Bearer ${GITHUB_TOKEN}"}}`), with the badge "Needs GITHUB_TOKEN" and a Browse card
     between Web fetch and GitHub App repos.
   - Or drop it from Browse. The designer should confirm.
9. **Which GitHub URL "Install GitHub App" opens, and whether the return works.**
   - *Recommend:* follow LaunchPanel: `github_install_url` when `installation_count==0`, `github_manage_url` for
     "Choose repos".
   - *Verify the App settings:* if its Setup URL points at `/api/auth/github/callback` without "Request user
     authorization during installation", GitHub returns no `code` and the route 422s. Make `code` optional there,
     falling back to a redirect to the frontend that re-reads status.
   - *Self-hosted:* hide the card.
10. **Desktop and tools.** On Desktop the page is identical, but:
    - (a) `Local` tools never run on the user's computer; they run in the cloud sandbox.
    - (b) agents run through a Claude or Grok subscription on Desktop get no MCP tools at all, silently.

    *Recommend (v1):*
    - a Desktop-only line in the Turn-on dialog: "Tools don’t reach agents that run on this computer with a Claude
      or Grok subscription.";
    - a tooltip on `Local`: "Runs in the agent’s sandbox";
    - the run warning from §3.

    Running tools locally is a separate feature (§4.3).
11. **`${NAME}` outside headers/env.** The backend substitutes refs only in `env` and `headers`, so `${X}` in a URL
    query (`?api_key=${X}`) or in args is sent literally.
    - *Recommend:* only offer the `${` autocomplete in header and env values.
    - *Recommend:* show "Secrets work in headers and environment variables only." if `${` is typed in URL, Command
      or Arguments.
    - *Later:* extend `node_tools._secret_refs` / `_substitute` to `url` and `args`.
12. **SSE vs streamable HTTP.** The design has no transport-type control; `transportOf` reads `type:"sse"`.
    - *Recommend:* set `"type":"sse"` automatically when the URL path ends in `/sse`; raw JSON can override. Confirm
      the OpenHands/fastmcp client behaviour for a URL without `type`.
13. **Literal secrets in pasted configs.** Claude/Cursor configs often hold real tokens inline, and `server_config` is
    stored and returned in plaintext. The Paste card says "We check it".
    - *Recommend:* the paste step flags values that look secret: keys matching `/TOKEN|KEY|SECRET|PASSWORD/i`, or
      `Bearer <literal>`. Offer "Move to Secrets as <NAME>", which rewrites them to `${NAME}` and queues the values
      for `POST /api/secrets`.
14. **Step 3 when a referenced secret already has a value.** The design only shows "Not set".
    - *Recommend:* show a `Set` badge with no input, and a subtitle counting only unset names ("linear uses one
      secret (already set).").
15. **Status beyond missing secrets.**
    - *Recommend:* "Needs attention" also covers an invalid config (no command or URL).
    - Run-time connect failures (`run_warnings`) are not surfaced here in v1.
16. **Routing constraint.** `frontend/CLAUDE.md` (October tooling) asks for "one screen = one route file", but the
    app has no router; all dashboard views are state inside `Dashboard.tsx`.
    - *Recommend:* keep state-based sub-views for consistency with the rest of the dashboard, with each page in its
      own component file (`ToolsPage.tsx`, `ToolDetailPage.tsx`, `SecretsPage.tsx`). Decide in the implementation
      plan whether to introduce routes Toolkit-wide.
