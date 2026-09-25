# Area `panel`: per-agent settings drawer + canvas chrome

Scope: `Main`, `Before-After`, `Desktop-*` (Editing, Focus, ModelPicker), `Web-*` (1024, AddSkill, Memory, NewAgent, Runs, Setup, Skills), `Panel-*` (AddMenu, AddTool, CloseUnsaved, EntryAgent, FromRepo, FullLength, MemoryEmpty, ModelWeb, RunsEmpty, SkillsEmpty, Warnings), and every `Flow-*` (More, Templates, Model, Access, Reads, Writes, Routing, Schema, Save, Presets, LoadMode, SkillMenu, PasteJson, ToolMenu, Memory, Runs, Docs).

Code read: `frontend/src/App.tsx`, `panel/{TeamNodePanel,DrawerShell,SkillsSection,ToolsSection,NodeMemorySection,SidePanel}.tsx`, `components/{MemoryFact,LastRun,BackendDot}.tsx`, `canvas/{AgentNodeCard,TeamCanvas,paletteItems}.ts(x)`, `lib/{api,engines,topology}.ts`, `design-system/components/primitives.tsx`, `backend/tvashtr/routers.py` (node PATCH, graph reads, memories, documents, templates), `models.py`, `main.py` (tool-catalog, skill-presets), `control_plane/{teams,team_run,context_compiler,node_skills,node_tools,node_library,tool_skill_catalog,graph_validity,provider_models,credentials,credential_gate,memory,desktop_jobs}.py`, `engines/desktop_runner_adapter.py`, `desktop/electron/{main,preload}.cjs`, `runner/cliCommand.cjs`.

---

## 1. Screens

**Main (Desktop · Setup, interactive).** This is the full Desktop window. The Electron title bar reads "Tvashtr — the living canvas". The app header has the Logo, "the living canvas", a "Tvashtr Desktop" environment chip and the account Avatar ("Lazyx"). The toolbar has a "Back to teams" outline icon button, the primary "Run this team", the team name "Indicator sprint team", "$0.00" and a "Connected" status. The canvas is 1056px wide. It shows the node cards (START · ENTRY Product manager, Engineer, Reviewer), two Gates (PRD approval, Escalation), the Stop and Ship terminals, and the edge labels approved / rejected / changes requested. It also has the + add button, zoom controls and a minimap. The selected Reviewer has a coral ring. The 384px `aside "Reviewer settings"` is docked on the right and pushes the canvas.
- **Header:** the role glyph, the name "Reviewer", the description "Checks against the spec", and the Focus mode, More actions and Close buttons.
- **Badges:** "Changes requested · 31m ago" is a button that jumps to Runs. "Read-only" has a lock icon. "Grok 4.7" names the model.
- **Tabs:** Setup · Skills & tools (4) · Memory (3) · Runs · Docs. All five tabs are clickable and each one is designed.
- **Footer:** "All changes saved" with a disabled Save button. On the Memory tab it reads "Memory changes save right away" instead.

**Before-After.** "Before" lists the problems with the current drawer: 14 equal-weight sections, Save near the bottom under Memory, Last run placed last, empty add forms always open, and gray helper text at 2.2:1 contrast. "After" annotates five changes:
1. The header states what the agent is, how it runs and how the last run went.
2. Tabs replace the long scroll. The copy says "Four tabs", but five are designed.
3. Instructions come first, with the routing rule attached.
4. Rows are short, with one-line hints and details moved into ⓘ tooltips.
5. Save is always visible and shows unsaved changes.

**Desktop-Editing.** This is the Setup tab after edits. The instructions editor shows the run-time banner. The routing line turned to a warning: "…Instructions no longer match your arrows", with a tint "Update instructions" button. The Model section label carries a "Changed" dot. The footer shows a coral dot, "2 unsaved changes", Discard and "Save ⌘S".

**Desktop-ModelPicker.** The model button opens a 324px listbox:
- A "Search models" field and the note "Only models proven to run a full build are listed."
- Provider groups, each with a letter tile and a credential state:
  - X xai: "Grok subscription · this computer", with grok-4.7 selected.
  - A anthropic: "Claude subscription · this computer", with claude-sonnet-5 and claude-sonnet-4.
  - O openai: "API key", with gpt-4.1-mini and gpt-4o-mini.
  - G gemini: "No key yet", with an inline password field "Paste your Gemini API key" and an Add button.
- Footer actions "Add a provider" and "Use a custom model ID".

**Desktop-Focus.** Focus mode is a 1240px `role=dialog` ("Reviewer in focus view") over a dimmed canvas.
- **Header:** the badges plus "Dock to the side", More actions and Close.
- **Tabs:** the same five tabs.
- **Left side:** a large instructions editor with a line-number gutter and the banner "Added at run time, above your instructions: the idea + the latest spec". A status bar shows "Line 12, column 38" and "1,284 characters · about 320 tokens". The buttons are "Preview as the agent sees it" and "Templates".
- **Right aside:** all the settings (Routing, Model, Images, Access & documents, and Advanced expanded).
- **Footer:** the same shared Save footer.

**Web-Setup / Web-1024.** These are the same as Main, except:
- The environment chip reads "tvashtr.fly.dev" and there is no window title bar.
- The model hint reads "Uses your xAI API key" instead of "Your Grok subscription · runs on this computer".
- At 1024px the drawer is marked `[overlay]`. It floats over the full-width canvas instead of pushing it.

**Web-Skills.** The Skills & tools tab:
- **Skills (3)** with an "Add skill" button. The rows are:
  - house-style: "Custom" badge, "Always on".
  - pytest-review: "org/skills @ main" badge, "Agent decides".
  - security-checklist: "Library" badge, "When triggered", with the trigger chips auth, secrets, tokens.
- The "Follow the repo’s rules files" switch.
- **Tools (2)** with an "Add tool" button and a "Domains" switch. The rows are:
  - fetch: "Local", `uvx mcp-server-fetch`.
  - github: "Library", `https://api.githubcopilot.com/mcp · ${GITHUB_TOKEN}`.
  Each row has an Enable switch and a ⋯ menu.

**Web-AddSkill.** The Skills tab swaps in place to the sub-view "Write a new skill", with a Back to skills button.
- Name (placeholder `house-style`) and "Skill content (SKILL.md)" with 8 rows.
- "When should it load?" as a segmented control: Always on / When triggered / Agent decides.
- The hint "Loads only when the conversation mentions one of the trigger words." and a "Trigger words" field (helper "Separate with commas.").
- "Adds to this agent. Save to keep it." with Cancel and "Add skill".

**Web-Memory.**
- A "Remember what it learns" switch. It is disabled for a read-only agent, with the copy "Only agents that can edit files record new lessons. Turn on **File access** in Setup to use this."
- The intro "Private lessons that apply only to this agent. Team-wide lessons live in the Memory shelf."
- "Waiting for your review · 1": one suggested note with Keep and Discard.
- The repo group "lazyxgenius/trade_mcp · 2" with two notes. Each note shows "Learned in round N · date" and has Pin (active state), Edit and Delete icon buttons.
- The link "Open Memory shelf". The footer reads "Memory changes save right away".

**Web-Runs.**
- A "Last run" card: the "Changes requested" badge, "Round 3 · 31m ago", the reasons text with inline `code` spans, truncated with "Show all".
- "Earlier rounds": Round 2 and Round 1, each with a badge and a relative time.

**Web-NewAgent (first time).**
- **Header:** "New agent" / "Add a short description", with the badges "Not run yet" (neutral dot) and "Needs a model" (warning).
- **Checklist:** "Get this agent ready 1 of 3": Write instructions / Pick a model / Choose documents · reads the spec by default, with a "Hide this" button.
- **Instructions:** replaced by "Start from a template — Pick one to fill in the instructions, then edit it.", with the buttons Product manager / Engineer / Reviewer / Start from scratch.
- **Routing:** "Connect an arrow out of this agent on the canvas to set where its work goes."
- **Model:** "Choose a model", with the hint "This agent needs a model before the team can run."
- **Footer:** "1 unsaved changes" (plural error in the design).

**Panel-FullLength.** The whole Setup tab with Advanced expanded.
- **Backup model:** a "None" picker. Hint: "Used once if the main model fails (bad key, provider down)."
- **Output format:** "None" with "Add JSON schema". Hint: "Optional. If the output doesn’t match, the run logs a warning. It won’t fail."

**Panel-SkillsEmpty.**
- **Skills:** "No skills yet — Skills teach this agent your team’s way of doing things." Four option cards:
  - Write a new skill (Your own SKILL.md)
  - Presets (Ready-made skills)
  - Your library (Skills saved to your account)
  - From a GitHub repo (Pin a branch, tag or commit)
- **Rules:** the "Follow the repo’s rules files" switch, off.
- **Tools:** the Domains switch, off. A "Web fetch — Let it fetch web pages. No login needed." row with Add. The empty text "No servers yet. Add one, pick from your library, or paste an mcp.json."
- **Tab counts:** none.

**Panel-AddMenu.** "Add skill" opens a 220px menu: Write a new skill / From presets / From your library / From a GitHub repo.

**Panel-AddTool.** The sub-view "Add a tool" (Back to tools), with pill tabs Add a server | Library | Paste mcp.json.
- Server name (e.g. linear).
- "Where it runs": Local / Remote, with the hint "Remote servers are reached by URL. Local servers start from a command."
- URL.
- The hint "Need a secret? Write it as `${LINEAR_TOKEN}`. It stays a reference and is filled in at run time from your Secrets. Adds to this agent. Save to keep it."
- Cancel and "Add server".

**Panel-FromRepo.** The sub-view "Add skills from a GitHub repo":
- Repository.
- Version, optional: "A branch, tag or commit. Pinning keeps runs repeatable.", placeholder main.
- "Only these skills", optional: "Leave empty to add every skill in the repo.", placeholder `review-*, pytest-*`.
- "Skills load when the team runs." with Cancel and "Add repo".

**Panel-ModelWeb.** The website model picker:
- xai: "API key", grok-4.7.
- anthropic: "No key yet". It explains "Your Claude or Grok subscription can run agents in **Tvashtr Desktop**. On the website, add an API key." and offers "Paste your Anthropic API key" with Add.
- openai: API key.
- deepseek: API key, deepseek-chat.
- Add a provider and Use a custom model ID.

**Panel-MemoryEmpty.** The same Memory tab with "No notes yet — As this agent runs, lessons that only apply to it will appear here."

**Panel-RunsEmpty.** The header badges are "Not run yet" and "Needs a model". The body reads "This agent hasn’t run yet — Press Run this team and what it did will show up here."

**Panel-EntryAgent.** The Product manager with the badge "Done · 31m ago" (success). The File access segments are disabled, with "The first agent writes the shared spec the team reads, so it stays read-only." The body copies the Reviewer text, including "Reads spec" and "Writes Nothing". See open question 5.

**Panel-CloseUnsaved.** The editing state plus an alertdialog "Unsaved changes": "Save your changes to Reviewer? You changed the instructions and the model.", with Keep editing / Discard / Save.

**Panel-Warnings.**
- A same-model advisory under the model: "Reviewer and Engineer both run `xai/grok-4.7`. Reviews are stronger when the reviewer runs a more capable model than the one it checks.", with a Dismiss icon.
- A changed Backup model `openai/gpt-4o-mni` with a warning: "No provider matches `openai/gpt-4o-mni`. It will fail at run time if the name is wrong or the key isn’t set.", with Dismiss.
- The footer in its error state: "Couldn’t save. Try again.", with Discard and "Try again".

**Flow-More (⋯).**
1. ⋯ opens a 240px menu: Open in focus view, Rename, Open its documents, Delete agent ("Its arrows are removed too").
2. "Delete Reviewer?" is an alertdialog: "Its arrows to Engineer and Ship are removed too. Past runs keep their results.", with Cancel and "Delete agent".

**Flow-Templates.**
1. Templates opens a 250px menu: Product manager / Architect / Engineer / Reviewer / "Compare templates in focus view".
2. The alertdialog "Replace the instructions? The Reviewer template replaces what’s in the editor now. Nothing is saved until you press Save, so Discard brings your text back.", with Cancel and Replace.
3. The dark toast "Reviewer template applied" with Undo. The routing line shows the out-of-sync warning and the footer shows "2 unsaved changes".

**Flow-Model (add a missing key).**
1. The picker is open.
2. A Gemini key is pasted (`AIza••••`) into the inline field.
3. The model is set to "G gemini-2.5-flash" with the hint "Uses your Gemini API key (saved in Engines)". The dark toast "Gemini key saved to Engines" has an "Open Engines" action. The Model label gets the Changed dot and the footer shows 2 unsaved changes.

**Flow-Access.**
1. Clicking "Can edit files" opens a confirm popover: "Let Reviewer change files? It gets write tools in its sandbox, and its changes can end up in the pull request. Reviewers usually stay read-only.", with "Keep read-only" and "Allow edits".
2. The header badge becomes "Can edit files" (accent). The hint becomes "Full agent loop. It can change files in the repo. Memory → Remember what it learns is now available." The footer shows 2 unsaved changes.

**Flow-Reads.**
1. "+ Add" opens a popover, "Documents it reads, in order". It has checkboxes (Shared spec — Product manager ✓, build-notes — Engineer ✓, design — "no one writes this yet"), a "New document name" field and "Drag to change the order. It reads them top to bottom."
2. The chips read "spec (default)" and "build-notes", each with a remove X.

**Flow-Writes.**
1. "Choose" opens "The one document it writes". The radios are "Nothing (default)" and "build-notes — Engineer writes this". A new-name field is prefilled with `review-notes`, with the button "Use review-notes".
2. The row reads "Writes review-notes" with a remove X. A toast says "New document. Other agents can add it to their Reads."

**Flow-Routing.**
1. The routing line is out of sync and the user clicks Update.
2. The alertdialog "Update the instructions? This adds the verdict-file lines your arrows need:" previews the "+" lines to be added, with Cancel and "Add lines".
3. The line is back to "Instructions match your arrows", with the toast "Instructions updated to match your arrows" and Undo.

**Flow-Schema.**
1. Advanced is expanded.
2. The Output format sub-view (Back) shows a JSON editor with the inline error "Line 3: add a comma after the list." Done is disabled. The other buttons are Insert example, Clear and Cancel.
3. After a fix it shows "Valid JSON Schema" and Done is enabled.

**Flow-Save.**
1. "2 unsaved changes", Discard, "Save ⌘S".
2. "Saving 2 changes…", with the button in its loading state reading "Saving".
3. "Saved. This drives the next run you launch."

**Flow-Presets.**
1. Add skill → From presets.
2. The sub-view "Add from presets" has "Search presets" and checkbox rows with a title and description: TDD discipline ✓, YAGNI ✓, Caveman (terse). The buttons are Cancel and "Add 2 skills".
3. The new rows tdd-discipline and yagni appear with the badge "Preset" and "Agent decides". The toast "2 skills added" has Undo.

**Flow-LoadMode.**
1. A skill's mode button opens a 290px menu:
   - "Always on — The full skill goes into every prompt"
   - "When triggered — Loads when the conversation mentions a trigger word"
   - "Agent decides — Listed; the agent opens it when it needs it"
2. pytest-review becomes "When triggered" with the chips "pytest" and "tests". The footer shows unsaved changes.

**Flow-SkillMenu.**
1. A skill's ⋯ menu offers Edit / Open in Toolkit / Remove from this agent.
2. The heading becomes "Skills 2", with the toast "Removed pytest-review" and Undo. The footer shows unsaved changes.

**Flow-PasteJson.**
1. Add tool opens a menu: "Add a server — Name, Local or Remote, command or URL", "From your library", "Paste mcp.json".
2. The Paste mcp.json pill tab shows the pasted JSON, "2 servers found" (linear — Remote, sqlite — Local) and the warning "linear uses ${LINEAR_TOKEN}, which isn’t set yet. Add it in Toolkit → Secrets.", with Cancel and "Add 2 servers".
3. The rows are added. linear gets a "Needs secret" warning badge. The toast "2 servers added · 1 needs a secret" has an "Add secret" action.

**Flow-ToolMenu.** A tool's ⋯ menu offers Edit connection / Open in Toolkit / Remove from this agent.

**Flow-Memory.**
1. Keep a suggested note.
2. "Waiting for your review · 0" and the toast "Kept. It applies to future runs." with Undo. The mock still renders the note, which is an artifact.
3. Edit a note inline: a 3-row textarea, a force select (MUST / SHOULD / MAY / CONTEXT / SHOULD NOT / MUST NOT, default "require"=MUST), Cancel and "Save note".
4. The alertdialog "Delete this note? Reviewer won’t be reminded of it again. You can’t undo this.", with Cancel and "Delete note".

**Flow-Runs.**
1. Click Round 2.
2. Round 2 expands in place: "The tests ran, but the new function is not registered on INDICATORS, so the builder can’t list it.", "16.9k tokens", "$0.00", "44m ago", and an "Open in focus view" button.

**Flow-Docs.**
1. The Docs tab:
   - "From run “Add an RSI indicator” · 31m ago" with a Change button.
   - A shared card: "Shared · everyone reads this / Shared spec / PRD · written by Product manager / v3 · 31m ago · read by all 3 agents", with Open.
   - "This agent writes: No document. Its verdict goes to Runs.", with "Set in Setup".
   - "This agent reads": Shared spec ("Read first, by default", v3 · same as above, Open) and build-notes ("Written by Engineer", v2 · 36m ago, Open).
   - The link "See all documents in this run".
2. Change opens a 280px run menu: "Add an RSI indicator — 31m ago · 3 rounds", "Fix the MACD label — Sep 22 · approved", "First team run — Sep 20 · approved".

**Desktop vs website, across all screens.**
- **Environment chip:** "Tvashtr Desktop" vs "tvashtr.fly.dev". Only Desktop has the OS title bar.
- **Model hint:** Desktop reads "Your Grok subscription · runs on this computer" and the website reads "Uses your xAI API key".
- **Model picker groups:** Desktop shows subscription groups ("… subscription · this computer"). The website shows API-key groups plus the "No key yet … Tvashtr Desktop" explainer for anthropic and xai.
- **Drawer layout:** at 1024 (the website, and also the Desktop min width of 1024) the drawer overlays the canvas instead of pushing it.
- Everything else is identical.

---

## 2. Behaviour requirements

### Canvas chrome
- **PANEL-1** Header shows: the Logo, "the living canvas", an environment chip, and the Avatar. The chip reads "Tvashtr Desktop" with a monitor icon when `dataset.tvashtrDesktop==="true"`, else "tvashtr.fly.dev" (the actual host). The Avatar opens the existing profile menu with the email and Log out.
- **PANEL-2** Desktop only: the window title reads "Tvashtr — the living canvas". It already comes from `index.html` `<title>`.
- **PANEL-3** Toolbar: a "Back to teams" outline IconButton with aria-label "Back to teams". Today it is "Back to dashboard". It returns to Dashboard Home.
- **PANEL-4** Primary "Run this team" with a play icon keeps today's gating: validity errors disable it, and missing credentials turn it into "Configure providers". It opens the LaunchPanel.
- **PANEL-5** Toolbar shows the current team name, e.g. "Indicator sprint team". Not shown today.
- **PANEL-6** Right cluster:
  - The run spend "$0.00".
  - A backend status dot with a visible label: "Connected", or "Checking…" / "Unreachable". Today the status has only a tooltip.
- **PANEL-7** Layout: with the drawer open at wide viewports the canvas shrinks by 384px (a push). At ≤~1280px the drawer overlays the canvas with a left shadow. Selecting a node keeps it in view (existing FitView).
- **PANEL-8** Canvas node cards: the entry eyebrow "START · ENTRY", name, description, "Edits on/off" chip, engine chip, "● Waiting" status and model slug. The selected node gets a coral ring. Edge labels read approved / rejected / changes requested. Cards must show the new per-node name and description (PANEL-24).
- **PANEL-9** Canvas controls: + (add node) top-left; zoom in / zoom out / fit bottom-left; minimap bottom-right. These exist today.

### Drawer shell, header, tabs, footer
- **PANEL-10** Drawer:
  - An `aside`, 384px wide, `aria-label="<Name> settings"`, full height, with its own scrolling body and a pinned footer.
  - One drawer per selected agent node.
  - Gate, terminal and domain-query nodes keep their existing bodies inside the new shell. No tabs, since there is no design for those kinds.
- **PANEL-11** Header shows the role glyph tile, the name (display font, ellipsis) and the one-line description. The New agent placeholders are "New agent" / "Add a short description".
- **PANEL-12** Header icon buttons: "Focus mode" (title "Focus mode"), "More actions" (⋯), "Close panel" (title "Close").
- **PANEL-13** Status badge, as a button titled "See the last run" that switches to Runs:
  - `<Outcome> · <relative time>`, e.g. "Changes requested · 31m ago" (accent + dot), "Approved", or "Done · 31m ago" (success, for prd_written / built / reported).
  - "Failed" (danger) for a failed round.
  - "Not run yet" (neutral + dot) when there is no run.
- **PANEL-14** Access badge: "Read-only" (neutral, lock icon) when `edits_allowed=false`, else "Can edit files" (accent).
- **PANEL-15** Model badge shows a friendly model name, e.g. "Grok 4.7" for `xai/grok-4.7`. When no model is set it shows "Needs a model" (warning) instead.
- **PANEL-16** Tabs (DS.Tabs `line`) with roving arrow-key focus: Setup · Skills & tools (count) · Memory (count) · Runs · Docs. Counts are hidden when zero.
  - Memory count = active + pending notes.
  - For the Skills & tools count, see open question 1.
- **PANEL-17** Footer states, always visible:
  - **Clean:** "All changes saved" with a disabled Save.
  - **Dirty:** a coral dot, "N unsaved changes" (use "1 unsaved change" for one), a ghost "Discard" and a primary "Save ⌘S" ("Ctrl S" off macOS).
  - **Saving:** "Saving N changes…" with a loading "Saving" button.
  - **Saved:** "Saved. This drives the next run you launch.", which decays to Clean.
  - **Error:** "Couldn’t save. Try again." with Discard and "Try again".
  - **Memory tab:** "Memory changes save right away" with a disabled Save.
- **PANEL-18** A "Changed" dot (title "Changed") marks each section or field label whose draft differs from the saved value: instructions, model, images, file access, reads, writes, backup model, output format, skills, tools.
- **PANEL-19** ⌘S / Ctrl+S saves when dirty and valid (preventDefault on the browser Save). Esc closes the top-most menu, popover or dialog.
- **PANEL-20** Discard reverts every drafted field to the last saved node and clears the Changed dots.
- **PANEL-21** Leaving with unsaved changes opens an alertdialog "Save your changes to <Name>? You changed <list>." (e.g. "the instructions and the model"), with Keep editing / Discard / Save. It triggers when the user:
  - clicks Close;
  - selects another node (today the `key` remount silently drops drafts);
  - clicks Back to teams;
  - reloads or closes the tab (web `beforeunload`) or the window (Desktop, see §4).
- **PANEL-22** Save sends one PATCH of the dirty fields, then refetches the team graph so the canvas card updates. Save is disabled while any sub-view (skill form, schema editor) holds an invalid draft.

### More actions
- **PANEL-23** ⋯ menu (240px): "Open in focus view", "Rename", "Open its documents", "Delete agent" (sub-line "Its arrows are removed too").
- **PANEL-24** Rename: edit the node's display name and short description. The inline header edit is not designed; see open question 18. The name is required. The canvas card and the header use it.
- **PANEL-25** Delete agent opens an alertdialog "Delete <Name>? Its arrows to <targets joined with "and"> are removed too. Past runs keep their results.", with Cancel / "Delete agent". It deletes the node, closes the drawer and reloads the graph and validity.
- **PANEL-26** "Open its documents" switches to the Docs tab.

### Setup: Instructions, templates, routing
- **PANEL-27** Instructions card has a label and an ⓘ ("Who this agent is and how it works. This is its whole identity: edit it, then run the team."), a ghost "Templates" button and an "Open full editor" icon that opens Focus mode.
- **PANEL-28** Run-time banner with a lock icon: "Added at run time: the idea + the latest spec". Derive it from the node:
  - The entry agent gets "the idea".
  - A node with `reads_from` gets "the idea + <doc names>".
- **PANEL-29** Inline editable monospace editor, collapsed to about 196px with a fade and a "Show all N lines" expander.
- **PANEL-30** Templates menu (250px): Product manager / Architect / Engineer / Reviewer / "Compare templates in focus view".
- **PANEL-31** Picking a template over non-empty text opens an alertdialog "Replace the instructions? The <Template> template replaces what’s in the editor now. Nothing is saved until you press Save, so Discard brings your text back.", with Cancel / Replace. An empty editor applies the template without a confirm.
- **PANEL-32** Applying a template shows the toast "<Template> template applied" with Undo (restores the previous draft) and marks the draft dirty.
- **PANEL-33** Empty instructions (new agent) show "Start from a template — Pick one to fill in the instructions, then edit it." with Product manager / Engineer / Reviewer / Start from scratch. Start from scratch opens an empty editor.
- **PANEL-34** Routing line under the instructions, built from the out-edges: "Says “<label>” → <target>. Anything else → back to <loop target>." With a check icon: "Instructions match your arrows".
- **PANEL-35** When the verdict block in the instructions no longer matches the edge labels, the line turns WARN: "… Instructions no longer match your arrows", with a tint "Update instructions" button.
- **PANEL-36** Update opens an alertdialog "Update the instructions? This adds the verdict-file lines your arrows need:" with a diff of "+" lines, and Cancel / "Add lines".
- **PANEL-37** After Update: the toast "Instructions updated to match your arrows" with Undo, and the draft is dirty.
- **PANEL-38** No out-arrow shows "Connect an arrow out of this agent on the canvas to set where its work goes." A single forward edge is not designed; recommend "Then → <target>." with no sync check.

### Setup: Model and Images
- **PANEL-39** Model row has the label "Model" and an ⓘ ("Only models proven to run a full build are listed."). The button shows the provider letter tile and the model id, or "Choose a model" when none is set.
- **PANEL-40** Credential hint under the model:
  - Desktop with a fresh subscription: "Your <Grok|Claude> subscription · runs on this computer".
  - BYOK: "Uses your <Provider> API key".
  - Just added: "Uses your <Provider> API key (saved in Engines)".
  - No model: "This agent needs a model before the team can run."
  - No credential at all: reuse the missing-provider copy.
- **PANEL-41** Model picker (listbox popover, 324px):
  - Contents:
    - "Search models" filters providers and models.
    - The note "Only models proven to run a full build are listed.".
    - One group per provider with a tile, name and state ("<X> subscription · this computer" | "API key" | "No key yet"), and options with `aria-selected` and a check mark.
  - Keyboard: arrows, Enter and Esc.
  - Only the models the catalogue lists for this node's seat are shown.
- **PANEL-42** A "No key yet" provider shows an inline password field "Paste your <Provider> API key" with a secondary Add button. On the website, anthropic and xai also show "Your Claude or Grok subscription can run agents in **Tvashtr Desktop**. On the website, add an API key." The link goes to the Desktop download or open flow.
- **PANEL-43** After a key is added, it is stored account-wide and the provider's models become selectable. Show the toast "<Provider> key saved to Engines" with an "Open Engines" action (navigates to Dashboard Engines). The inline error for a failed add is not designed; reuse "Couldn’t save that key. Try again."
- **PANEL-44** "Add a provider" opens the Engines add-key flow (cross-area) or an inline provider + key form.
- **PANEL-45** "Use a custom model ID" enters a free-text slug `provider/model`.
- **PANEL-46** Same-model advisory (status): "<Name> and <Sibling> both run `<slug>`. Reviews are stronger when the reviewer runs a more capable model than the one it checks.", with a Dismiss X. It applies to a verdict-emitting node sharing its model with a connected agent. The dismissal is per session.
- **PANEL-47** Unknown-model warning for both the main and the backup model: "No provider matches `<slug>`. It will fail at run time if the name is wrong or the key isn’t set.", with Dismiss. It is soft and never blocks Save.
- **PANEL-48** "Images" switch with an ⓘ ("Let it send and read images. Text-only models ignore this.") drives `multimodal`.

### Setup: Access & documents
- **PANEL-49** File access is a segmented control "Can edit files" / "Read-only" with an ⓘ ("Can it change files in the repo?"). Hints:
  - Read-only: "Same agent loop with read-only tools. Only its report leaves the sandbox."
  - Edits on: "Full agent loop. It can change files in the repo. Memory → Remember what it learns is now available."
- **PANEL-50** Switching to "Can edit files" opens the confirm popover "Let <Name> change files? It gets write tools in its sandbox, and its changes can end up in the pull request. Reviewers usually stay read-only.", with "Keep read-only" / "Allow edits". See open question 6 for when to show it.
- **PANEL-51** The entry agent (no incoming edges) has both segments disabled, with the hint "The first agent writes the shared spec the team reads, so it stays read-only."
- **PANEL-52** Reads has an ⓘ ("Documents it reads before it starts, in order. Default: the spec."). It shows ordered chips: the first is "spec" with a "default" tag when implicit, and each chip has a remove X ("Remove <name>"). There is also a "+ Add" button.
- **PANEL-53** The Reads popover, "Documents it reads, in order", has:
  - Checkboxes for every document the team knows about, each with its writer: "Shared spec — Product manager", "<doc> — <Writer>", or "<doc> — no one writes this yet".
  - A "New document name" field.
  - Drag to reorder: "Drag to change the order. It reads them top to bottom."
- **PANEL-54** Writes has an ⓘ ("The one document this agent creates. By default, the entry agent writes the spec and others write nothing."). It shows "Nothing" with Choose, or a document chip with a remove X.
- **PANEL-55** The Writes popover, "The one document it writes", has the radios "Nothing (default)" and "<doc> — <Writer> writes this", plus a new-name field and a "Use <name>" button.
- **PANEL-56** Creating a new document name shows the toast "New document. Other agents can add it to their Reads."
- **PANEL-57** "Advanced" disclosure with `aria-expanded` and the summary "Backup model: <slug|none> · Output format: <set|none>".
- **PANEL-58** Backup model uses the same model picker, with a "None" option and an ⓘ ("Leave as None for no backup."). Hint: "Used once if the main model fails (bad key, provider down)."
- **PANEL-59** Output format shows "None" with a secondary "Add JSON schema" button, or "Edit". It has an ⓘ ("An advisory JSON Schema for this agent’s output.") and the hint "Optional. If the output doesn’t match, the run logs a warning. It won’t fail."
- **PANEL-60** Output format sub-view (Back):
  - The title, the hint and a JSON editor.
  - Live messages: an error with a line hint such as "Line 3: add a comma after the list." (disables Done), or "Valid JSON Schema".
  - The buttons Insert example, Clear, Cancel and Done. Done writes the draft; Clear sets it to None.

### New agent and entry agent
- **PANEL-61** A new or blank agent has the header "New agent" / "Add a short description" and the badges "Not run yet" and "Needs a model".
- **PANEL-62** The "Get this agent ready <n> of 3" checklist:
  - Items: Write instructions (prompt non-empty), Pick a model (model set), and "Choose documents · reads the spec by default" (done when Reads or Writes was touched).
  - Completed items get a check. "Hide this" dismisses the checklist per node.

### Memory tab
- **PANEL-63** The "Remember what it learns" switch saves immediately. It is disabled when read-only, with the copy "Only agents that can edit files record new lessons. Turn on **File access** in Setup to use this." (File access links to Setup).
- **PANEL-64** Intro: "Private lessons that apply only to this agent. Team-wide lessons live in the Memory shelf."
- **PANEL-65** "Waiting for your review · N" lists pending notes, each with its content, a primary "Keep" and a ghost "Discard".
- **PANEL-66** Keep shows the toast "Kept. It applies to future runs." with Undo. Discard has no toast in the design; recommend "Discarded" with Undo.
- **PANEL-67** Active notes are grouped by repo ("<repo> · N"). Each shows its content and "Learned in round <n> · <Mon D>" ("Added by you · <date>" for manual notes). Icon buttons: Pin (toggle, `active` when pinned), Edit, Delete.
- **PANEL-68** Inline edit: a 3-row textarea, a force select (MUST / SHOULD / MAY / CONTEXT / SHOULD NOT / MUST NOT), Cancel and "Save note". Blank content is refused.
- **PANEL-69** Delete opens an alertdialog "Delete this note? <Name> won’t be reminded of it again. You can’t undo this.", with Cancel / "Delete note".
- **PANEL-70** Empty: "No notes yet — As this agent runs, lessons that only apply to it will appear here." Loading and error states are not designed; recommend a skeleton, then "Couldn’t load notes." with Retry.
- **PANEL-71** The "Open Memory shelf" link goes to Dashboard Toolkit Memory.

### Runs tab
- **PANEL-72** "Last run" card for this agent's latest run:
  - The outcome badge and "Round <n> · <relative time>".
  - The outcome detail, with backticked or path-like tokens rendered as `code`, truncated with "Show all".
- **PANEL-73** "Earlier rounds" (the same run, descending), each "Round n" with its badge and time. Clicking a round expands it in place to show:
  - the detail;
  - "<tokens> tokens" (compact, e.g. 16.9k) and "$<cost>";
  - the time;
  - "Open in focus view".
- **PANEL-74** Empty: "This agent hasn’t run yet — Press Run this team and what it did will show up here."

### Docs tab
- **PANEL-75** "From run “<idea>” · <relative time>" with Change. Change opens a menu of this team's runs: "<idea> — <time> · <n rounds | outcome>". The default is the latest run.
- **PANEL-76** Shared spec card:
  - The eyebrow "Shared · everyone reads this", the title "Shared spec", and "PRD · written by <entry agent name>".
  - "v<n> · <time> · read by all <k> agents" (or "read by <k> agents").
  - An Open button that goes to the document viewer (Docs area).
- **PANEL-77** "This agent writes": the document card, or "No document. Its verdict goes to Runs." for a verdict-emitting node without a document, with "Set in Setup" (jumps to Setup and focuses Writes). For the entry agent: "<Name> is the entry agent, so it writes the Shared spec above." (per Docs-PanelPM).
- **PANEL-78** "This agent reads": each document with a provenance line ("Read first, by default" / "Written by <Writer>"), "v<n> · <time>" ("same as above" when it repeats the shared card) and Open. For the entry agent: "The idea you type when you press Run."
- **PANEL-79** The link "See all documents in this run" opens the run document drawer (Docs area).
- **PANEL-80** With no run: recommend the Runs empty copy adapted, "No documents yet — Run the team and this agent’s documents show up here." A document the selected run didn't produce shows "Not written in this run".

### Skills & tools tab: Skills
- **PANEL-81** "Skills <n>" with an ⓘ ("Reusable know-how. Worker agents get skills as context and tools; thinker agents fold them into their prompt."). A secondary "Add skill" opens a 220px menu: Write a new skill / From presets / From your library / From a GitHub repo.
- **PANEL-82** Skill row:
  - The skill name and a ⋯ button ("More actions for <name>").
  - A source badge: "Custom" (inline), "<org/repo> @ <ref>" (repo, outline), "Library" (info) or "Preset".
  - A load-mode dropdown button and, for When triggered, trigger-word chips.
- **PANEL-83** Load-mode menu (290px) with three descriptive options:
  - "Always on — The full skill goes into every prompt"
  - "When triggered — Loads when the conversation mentions a trigger word"
  - "Agent decides — Listed; the agent opens it when it needs it"
- **PANEL-84** Choosing When triggered requires at least one trigger word, entered inline (see open question 12). The words show as chips.
- **PANEL-85** The skill ⋯ menu offers Edit, "Open in Toolkit" and "Remove from this agent". Remove shows the toast "Removed <name>" with Undo. Removing, adding and changing the mode all mark the draft dirty; they persist on Save.
- **PANEL-86** "Write a new skill" sub-view:
  - Name, Skill content (SKILL.md), "When should it load?" (segmented), and "Trigger words" (helper "Separate with commas.") when triggered.
  - The note "Adds to this agent. Save to keep it." with Cancel and "Add skill".
  - Name and content are required. A duplicate name on this agent should warn, because the resolver dedups by name and the first one wins.
- **PANEL-87** "Add from presets" sub-view:
  - Search, and checkbox rows with a title and description.
  - Cancel and "Add <n> skills", disabled at 0.
  - After adding, the toast "<n> skills added" with Undo. The rows get the badge "Preset".
- **PANEL-88** "From your library" picker: the account's library skills, with already-added ones disabled. Empty: "No library skills yet." plus a link to Toolkit.
- **PANEL-89** "Add skills from a GitHub repo" sub-view:
  - Repository (required).
  - Version, optional: helper "A branch, tag or commit. Pinning keeps runs repeatable.", placeholder main.
  - "Only these skills", optional: helper "Leave empty to add every skill in the repo.", placeholder `review-*, pytest-*`.
  - The note "Skills load when the team runs." with Cancel and "Add repo".
- **PANEL-90** Skills empty state: "No skills yet — Skills teach this agent your team’s way of doing things." with four cards (Write a new skill — Your own SKILL.md; Presets — Ready-made skills; Your library — Skills saved to your account; From a GitHub repo — Pin a branch, tag or commit).
- **PANEL-91** The "Follow the repo’s rules files — When working on a real folder, also use its CLAUDE.md, AGENTS.md, .cursorrules and .cursor/rules." switch maps to the `project_rules` source.

### Skills & tools tab: Tools
- **PANEL-92** "Tools <n>" with an ⓘ ("MCP servers this agent can call. Secrets stay as ${NAME} and are filled in at run time."). A secondary "Add tool" opens a 280px menu: "Add a server — Name, Local or Remote, command or URL" / "From your library" / "Paste mcp.json".
- **PANEL-93** "Domains — Let it ask and search your domains during a run." switch with an ⓘ ("To explore yourself, use Chat/Ask. For a fixed step on the canvas, use a Query domain node.").
- **PANEL-94** Tool row:
  - The name, and a badge: "Local" / "Remote" (outline), "Library" (info), or "Needs secret" (warning) when any `${NAME}` it uses is not in Secrets.
  - A target line: the command, or the URL plus "· ${NAME}" refs.
  - An "Enable <name>" switch and a ⋯ button ("More actions for <name>").
- **PANEL-95** The tool ⋯ menu offers "Edit connection" (inline server form, or Toolkit for a library item), "Open in Toolkit" and "Remove from this agent". Recommend a Removed toast with Undo, as for skills.
- **PANEL-96** "Add a tool" sub-view with pill tabs Add a server | Library | Paste mcp.json:
  - Server name, and "Where it runs" Local/Remote with the hint "Remote servers are reached by URL. Local servers start from a command."
  - URL (Remote) or Command (Local).
  - The secret hint ("Need a secret? Write it as `${NAME}`…"), "Adds to this agent. Save to keep it.", and Cancel / "Add server".
  - Validation (not designed): name required and unique on the agent, and a URL must be http(s).
- **PANEL-97** Paste mcp.json:
  - A JSON textarea, the live parse result "<n> servers found", and the list with Remote/Local badges.
  - The missing-secret warning "<server> uses ${NAME}, which isn’t set yet. Add it in Toolkit → Secrets.".
  - Cancel and "Add <n> servers".
  - Invalid JSON is not designed; recommend "That isn’t valid JSON — Line n: …" with Add disabled.
- **PANEL-98** After a paste or add, the toast "<n> servers added · <k> needs a secret" with an "Add secret" action that goes to Toolkit Secrets, prefilled with the name.
- **PANEL-99** Tools empty state: a "Web fetch — Let it fetch web pages. No login needed." row with Add, and "No servers yet. Add one, pick from your library, or paste an mcp.json."

### Focus mode (Desktop-Focus; the Focus-* screens belong to the focus area)
- **PANEL-100** Focus dialog (1240px, `role=dialog`, "<Name> in focus view", focus trap, Esc closes):
  - The header badges, "Dock to the side" (returns to the drawer), ⋯ and Close.
  - The same tabs and footer, sharing the draft state with the drawer.
  - Setup left: an editor with line numbers, the banner "Added at run time, above your instructions: …", "Line L, column C" and "<chars> characters · about <chars/4> tokens".
  - Setup right: an aside with Routing, Model, Access and Advanced.
- **PANEL-101** "Preview as the agent sees it" shows the compiled instruction (Focus-AgentSees; focus area).

### Cross-cutting
- **PANEL-102** Menus and popovers close on outside click and Esc and return focus to their trigger. Alertdialogs trap focus. Toasts are `role=status`, auto-hide after about 6s, and pause on hover. Undo restores the prior draft or data.
- **PANEL-103** On Desktop, a node whose model runs on a subscription on this computer should say that tools, domains, skills and repo rules are not applied (backend gap B-16). Not in the design, but needed so the UI does not mislead.

---

## 3. Backend gap table

| ID | Needs | Status | Where / proposal |
|---|---|---|---|
| PANEL-1 | Account identity for Avatar | EXISTS | `GET /api/auth/me` → `{id, email}`. Initials come from email; there is no display-name field (Home/account area if a name is wanted). |
| PANEL-4 | Run gating | EXISTS | `GET /api/teams/{id}/validate` → `{errors, warnings, runnable}`; `GET /api/providers`; `GET /api/engines/subscriptions` (`connected`, `runner_fresh`); `POST /api/runs`. |
| PANEL-5 | Team name | EXISTS | `GET /api/teams` → `teams[].name` (App already calls `getTeams`). Optional cleanup: add `"name"` to the `GET /api/teams/{id}/graph` response in `routers.get_team_graph`. |
| PANEL-6 | Spend and backend status | EXISTS | `GET /api/runs/{id}` → `run.cost_total_usd`, `costs[]`; `GET /health` → `db`. |
| PANEL-11, 24, 61, 8 | Per-agent display name and description; Rename | **MISSING** | Agent nodes have only `role_name`; the card uses the hardcoded `ROLE_TITLE`/`ROLE_BLURB`. **Proposal:**<br>• The `PATCH /api/teams/{team_id}/nodes/{node_id}` agent branch accepts `title` (1–60 chars, trimmed, non-blank) and `description` (≤120). Merge them into `config.title` / `config.description` with a fresh-dict merge guarded by `model_fields_set`. `null` clears. No migration. Today these two fields are applied for gates only.<br>• `POST /api/teams/{id}/nodes` stores them for thinker/worker, and presets seed them ("Reviewer" / "Checks against the spec").<br>• `clone_team_graph` already deep-copies `config`.<br>• Keep `role_name` stable, because memory distill and trajectory key on it. |
| PANEL-13 | Last-run outcome, status and time for the header badge | PARTIAL | `GET /api/teams/{id}/graph` → `nodes[].last_run = {outcome, outcome_detail, run_id, iteration, started_at}`. It lacks `status` (a failed round has `outcome=null`) and `ended_at`. **Add** `status`, `ended_at` to `_latest_invocation_by_origin` in `routers.py`. |
| PANEL-14, 49 | File access | EXISTS | Node field `edits_allowed`; PATCH `edits_allowed`. |
| PANEL-51 | Entry agent locked read-only | PARTIAL | The UI derives entry = no incoming edge. The server only 409s `capability="worker"` on the root; it does not refuse `edits_allowed=true` on the root. **Add** a 409 in the PATCH agent branch when `edits_allowed` is true and `node.id == _team_root_node_id(...)`, detail "The first agent writes the shared spec the team reads, so it stays read-only." |
| PANEL-15, 39–41 | Model catalogue incl. subscription models, friendly labels, seat filtering | PARTIAL | `GET /api/config` → `provider_catalogue[] = {provider, thinker_default, worker_default, thinker_presets, worker_presets}` (`control_plane/teams.py PROVIDER_CATALOGUE`). It has **no `anthropic` or `xai` entries**, yet the designs list `grok-4.7`, `claude-sonnet-5` and `claude-sonnet-4`, and the Desktop runner already runs `anthropic/*` and `xai/*` via the CLIs. There are also no display labels. **Proposal:**<br>• Add `anthropic` and `xai` entries with seat presets.<br>• Add per-entry `label` ("Anthropic", "xAI") and `model_labels` (`{"xai/grok-4.7": "Grok 4.7"}`).<br>• Add `subscription` (`"claude"`/`"grok"`/`null`) and `byok_probed: bool`, so the web picker can show them as "API key" and Desktop as "subscription · this computer".<br>• Serve them through `public_provider_catalogue()` and extend the TS `ProviderCatalogueEntry`.<br>• Keep `_PROVIDER_DEFAULT_ORDER` unchanged unless probed.<br>(Engines area overlaps.) |
| PANEL-40 | Credential treatment hint | EXISTS | `GET /api/providers` → `[{provider, key_last4}]`; `GET /api/engines/subscriptions` and Desktop `tvashtrDesktop.engines.getStatus()`; the rule is `lib/engines.credentialTreatment` = `credential_gate.py`. |
| PANEL-42, 43 | Inline key add from the picker | EXISTS | `POST /api/providers {provider, api_key}` → upsert (the same table Engines uses). |
| PANEL-47 | Unknown-model warning (main and backup) | PARTIAL | Client-side today, against catalogue presets and held providers (`TeamNodePanel.modelWarning`); the fallback is not checked. Optional server check: **`GET /api/providers/{provider}/models`** → `{"models": [..] \| null}` via `provider_models.servable_models(provider, owner_key)`. It fails open, so `null` means unknown. |
| PANEL-48 | Images (multimodal) | PARTIAL | Stored: PATCH `multimodal` → `config.multimodal`. It is honoured only by `POST /api/runs/{id}/nodes/{id}/ask`. `team_run.agent_run_step` never threads it (the docstring calls it a "documented follow-on"), and the Desktop runner cannot either. **Proposal:** `team_run` passes `multimodal=resolve_multimodal(cfg)` into `AgentTask` and the OpenHands LLM config when `gateway.multimodal_supported(model)`; otherwise it records a RunWarning. |
| PANEL-18, 20, 22 | Save the full draft | EXISTS | `PATCH /api/teams/{team_id}/nodes/{node_id}` with `prompt`, `model`, `edits_allowed`, `tool_config`, `skills`, `writes_to`, `reads_from`, `fallback_model`, `output_schema`, `multimodal`, `memory_remember_enabled` → `_node_base_dict`. Every save must send `prompt` and `model`, otherwise 422. |
| PANEL-25 | Delete agent | EXISTS | `DELETE /api/teams/{team_id}/nodes/{node_id}` (edges cascade; runs use clones, so "past runs keep their results" is true). Node-tier memories keep a dangling `node_id` (intended). |
| PANEL-28, 34–38 | Run-time banner; routing summary and sync | EXISTS (client) | Everything derives from `GET /api/teams/{id}/graph` (`edges[].conditions.when` / `loop_limit`, `config.reads_from`) plus `lib/topology.emitContract/applyEmitContract`. There is no server change. The frontend must add target names and a "block equals contract" check. |
| PANEL-30–33 | Instruction templates (PM / Architect / Engineer / Reviewer prompts) | **MISSING** | The prompts exist only server-side (`routers._NODE_PRESETS` → `PM_PROMPT`, etc.). `GET /api/templates` returns team templates only. **Proposal:** **`GET /api/node-templates`** → `{"templates":[{"key":"reviewer","title":"Reviewer","description":"Checks against the spec","prompt":"…","node_kind":"worker","edits_allowed":false,"writes_to":null,"verdict_labels":["approved","changes_requested"]}, …]}`. Move `_NODE_PRESETS` into `control_plane/teams.py` as `NODE_TEMPLATES`. |
| PANEL-52, 53 | Reads: ordered list, known documents, "reads nothing" | PARTIAL | `reads_from` (ordered, kept as authored by `resolve_reads_from`) EXISTS. The known-document list derives from every node's `config.writes_to` plus the entry's `spec`. **Gap:** an empty list means "default spec", so removing the only `spec` chip cannot mean "reads nothing". **Proposal:** add `config.reads_default: bool` (default true). PATCH accepts `reads_default`; `team_run` skips `read_latest_prd_step` when false and `reads_from` is empty (`context_compiler.resolve_reads_default`). |
| PANEL-54–56 | Writes | PARTIAL | PATCH `writes_to` EXISTS. **Conflict:** `team_run` (≈L2030) *ignores* `writes_to` on a verdict-emitting node (the Reviewer) and only records a RunWarning, yet Flow-Writes lets the Reviewer write `review-notes`. **Proposal (pick one; see open question 3):**<br>• (a) Add a validity **warning** `emitting_node_writes` in `graph_validity.validate_graph`, and have the UI disable Writes for emitting nodes.<br>• (b) Widen `_resolve_pull_paths` so an emitting node with `writes_to` also pulls `REPORT.md` (a sidecar, not a workspace mutation), and let the write hook version it. |
| PANEL-58 | Backup model | EXISTS | PATCH `fallback_model` → `config.fallback_model`; `team_run._resolve_model_and_key` plus mid-run failover. It has no effect on Desktop-subscription nodes. |
| PANEL-59, 60 | Output format schema | PARTIAL | PATCH `output_schema` → `config.output_schema` EXISTS. **Gap:** `team_run` validates it only `if kind == "completion"`, against `REPORT.md`, so an agent-kind or emitting Reviewer is never checked. **Proposal:** drop the kind guard. Validate `result["report"]` for non-emitting nodes and the harvested `REVIEW_VERDICT.json` for emitting ones, with `record_resolution_warning(run_id,"output_schema",…)`. Schema-subset validation stays client-side. |
| PANEL-61, 62, 15 | "Needs a model" / new blank agent | PARTIAL | `_build_node` always stamps a default model, and PATCH accepts `model=""` (only `None` is refused) but `validate_graph` does not flag it. `agent_run_step` then silently uses `settings.default_model`. **Proposal:**<br>• `validate_graph` adds the error `no_model` ("This agent needs a model before the team can run.") for reachable agent/completion nodes with a blank model, and the warning `no_instructions`.<br>• Optionally let `CreateNodeRequest` create a blank agent with `model=""`. |
| PANEL-63 | Remember switch saves immediately | EXISTS (workaround) | PATCH `memory_remember_enabled`, but the agent branch requires `prompt` and `model`. Send the **saved** `node.prompt`/`node.model` with the flag so unsaved drafts are not clobbered. **Recommended:** make `prompt`/`model` optional in the agent PATCH (apply only when in `model_fields_set`; 422 only if sent as null). |
| PANEL-65, 66 | Pending notes: Keep / Discard | EXISTS | `GET /api/memories?node_id=<id>&status=pending_review`; `POST /api/memories/{id}/promote`; `POST /api/memories/{id}/reject`. |
| PANEL-66 | Undo "Kept" | PARTIAL | There is no demote endpoint, and promote may supersede another fact. **Recommended:** defer the promote call until the toast expires (client). Server alternative: **`POST /api/memories/{id}/unpromote`** (active → pending_review, 409 if it superseded a row) in `control_plane/memory_review.py`. |
| PANEL-67 | Active notes by repo; "Learned in round n · date" | PARTIAL | `GET /api/memories?node_id=` → `{content, polarity, repo_key, pinned, source_run_id, source_invocation_id, created_at, …}`. There is no round number, and `repo_key` is a filesystem path, so it cannot show `owner/repo`. **Add** `source_iteration` (batched join `AgentInvocation.iteration` on `source_invocation_id`) and `repo_label` (`Run.github_repo` when set, else the `basename(repo_key)`) to `memory._to_dict`/`list_memories`. |
| PANEL-67, 68, 69 | Pin, edit (content and force), delete | EXISTS | `POST /api/memories/{id}/pin` / `unpin`; `PATCH /api/memories/{id} {content, polarity}`; `DELETE /api/memories/{id}`. |
| PANEL-16 | Tab counts | EXISTS | From `skills[]` and `tool_config` on the node, plus the memories lists above. |
| PANEL-72 | Last run card | PARTIAL | Only the latest invocation is in `last_run`, with no cost. See the next row. |
| PANEL-73, 75 | Every round of this agent in a run (outcome, detail, tokens, cost, times) and the per-node run list | **MISSING** | The run-graph `GET /api/runs/{id}/graph` has `nodes[].invocations[].cost` but does not expose `cloned_from_node_id`, so the authored node cannot be mapped reliably. `GET /api/teams/{id}/runs` has no per-node rounds or outcome. **Proposal:** **`GET /api/teams/{team_id}/nodes/{node_id}/history?run_id=<optional>`** →<br>`{"runs":[{"run_id","idea","status","created_at","rounds":3,"last_outcome":"changes_requested"}], "run":{"run_id","idea","status","created_at","rounds":[{"iteration","status","outcome","outcome_detail","started_at","ended_at","cost":{"prompt_tokens","completion_tokens","total_tokens","cost_usd"}\|null}]}}`<br>• Owner-scoped via `_require_library_team`, 404 for a foreign node.<br>• Logic: `node_run_history()` in `control_plane/teams.py`, joining `AgentInvocation` → clone `AgentNode.cloned_from_node_id == node_id`, and reusing `_cost_by_invocation`.<br>• Also add `origin_node_id` (= `cloned_from_node_id`) to the run-graph node dict. No migration (indexes exist). |
| PANEL-76–78 | Per-run document cards: version, time, author agent, readers | PARTIAL | `GET /api/runs/{id}/documents` → `documents[] = {id, title, doc_type, name, created_at, updated_at}`. Versions (with `created_by = "agent:entry" \| "agent:<clone id>" \| "human"`) require one `GET /api/documents/{id}` per document. **Extend** each item with:<br>• `latest_version_no` and `latest_version_at`;<br>• `author: {origin_node_id, role_name, title} \| {"human": true}` (clone → origin via `cloned_from_node_id`);<br>• `reader_node_ids` (origin ids, computed from the run's clone-graph configs with `resolve_reads_from`; an empty list means readers of the spec);<br>• `is_spec` (`id == run.pm_document_id`).<br>Logic in `documents/service.py` plus a router helper. The Docs area overlaps. |
| PANEL-79 | All documents in the run | EXISTS | `GET /api/runs/{id}/documents` (Docs area owns the drawer and viewer). |
| PANEL-81, 82, 85, 86 | Skills list, inline skill, remove/edit | EXISTS | `node.skills[]` (inline / repo / project_rules / library) via PATCH `skills`; library names via `GET /api/skill-library`; library edit via `PATCH /api/skill-library/{id}`. |
| PANEL-83, 84 | Load mode and triggers on **every** row (repo, library, preset) | PARTIAL | `node_skills._resolve_inline` honours `mode`/`triggers` for inline sources only. `library` refs use the library item's own mode, and `repo` skills use the SDK defaults. **Proposal:** allow optional `mode` and `triggers` on `{type:"library"}` and `{type:"repo"}` sources. In `_resolve_library_source`/`_resolve_repo`, rebuild each `Skill` with `KeywordTrigger`/`is_agentskills_format` per the override (`control_plane/node_skills.py`), and extend the TS `SkillSource`. |
| PANEL-87 | Presets | EXISTS | `GET /api/skill-presets` → `{key, name, title, description, source}`; attach = `POST /api/skill-library` + a `{type:"library", id}` ref. The "Preset" badge needs provenance: store `origin:"preset:<key>"` on the node's source object. The resolver ignores extra keys, so this needs no backend change. |
| PANEL-88 | From library | EXISTS | `GET /api/skill-library` → `skills[] = {id, name, source, created_at}`. |
| PANEL-89 | Repo skills (optional version, multi-pattern filter, per-skill rows) | PARTIAL | `node_skills._resolve_repo` **requires** `ref` ("pins reproducibility") and supports a single `fnmatch` `filter`. **Proposal:**<br>• The frontend defaults a blank Version to `"main"`, or the backend resolves the default branch.<br>• Accept `filter` as a list or comma-separated patterns.<br>• Optional **`POST /api/skill-sources/preview {url, ref?, filter?}`** → `{"skills":[{"name","description"}]}` (lazy `load_public_skills`, 10s timeout; 422 "Couldn’t read skills from that repo.") so rows can show skill names like "pytest-review". |
| PANEL-91 | Repo rules files | EXISTS | The `{type:"project_rules"}` source. It is not applied on Desktop-subscription nodes (B-16). |
| PANEL-92, 94, 95, 97, 98 | Tools list, enable, remove, paste, needs-secret | EXISTS | `node.tool_config` (`mcpServers`, `tvashtr.servers.<n>.enabled`, `tvashtr.library[]`) via PATCH `tool_config`; `GET /api/tool-library`; `PATCH /api/tool-library/{id}`; `GET /api/secrets` → names. The resolver drops a server with an unresolved secret and warns. |
| PANEL-93 | Domains | EXISTS | `tool_config.tvashtr.domains = true` → `node_tools._domains_opt_in`. |
| PANEL-96 | Add server with the secret hint | PARTIAL | `node_tools` substitutes `${NAME}` only inside `env`/`headers` values, but the form has only a URL or command field. **Proposal (see open question 14):** the frontend adds an optional Headers (Remote) / Env (Local) key-value row, **or** `node_tools._secret_refs/_substitute` also cover `url` and `args`. |
| PANEL-99 | Web fetch | EXISTS | `GET /api/tool-catalog` → `tools[key=fetch].server_config` (+ `POST /api/tool-library`, or add inline). |
| PANEL-100 | Focus token estimate | EXISTS (client) | Mirror `context_compiler.estimate_tokens = len//4`. |
| PANEL-101 | "Preview as the agent sees it" | **MISSING** | **`POST /api/teams/{team_id}/nodes/{node_id}/preview`** with body `{prompt?: str, idea?: str, run_id?: str}` → `{"parts":[{"name","text","tokens"}],"total_tokens","budget"}`. New module `control_plane/node_preview.py` calling the pure `compile_context(...)` with the draft prompt, the placeholder or given idea, the latest run's spec and read documents (or placeholders), `edits_allowed`, `emits_outcome` (from edges), `remember_enabled`, and optionally `retrieve_memory`. Focus area overlaps. |
| PANEL-103 / B-16 | Desktop-subscription nodes honour tools, skills, rules | **MISSING** | `team_run` builds `mcp_config` and `skills` into `AgentTask`, but `engines/desktop_runner_adapter.py` sends only `instruction` and `model`, and the CLI runs with `--safe-mode --restricted` (Claude) or file-only `--tools` (Grok). **Proposal:**<br>• Short term: fold the resolved skills into the instruction for desktop-routed nodes (`node_skills.inject_skills_into_prompt`) and record a RunWarning `"tools"` when a desktop-routed node has `tool_config`. The UI shows PANEL-103.<br>• Long term: the runner passes MCP config (`--mcp-config`) (see §4). |

Tally: 45 rows, of which 24 EXISTS (4 of them client-derived or workaround), 16 PARTIAL and 5 MISSING. The requirements not listed need no server data: pure UI, copy, keyboard and layout.

---

## 4. Desktop bridge gaps

Current bridge (`preload.cjs`): only `tvashtrDesktop.engines.{getStatus, connect, disconnect, refresh, onStatus}` plus `tvashtrDesktopInfo {shell, version}`. The panel can reuse `engines.getStatus()`/`onStatus()` for the subscription groups and hints in the model picker. `engines.connect(provider)` could back a "Connect" affordance for a disconnected subscription group. That is not designed, but it is cheap.

1. **Unsaved changes on window close or quit (PANEL-21).** Electron does not show the browser's `beforeunload` prompt. A renderer that sets `returnValue` just silently blocks the close.
   - **Main (`main.cjs`):** add `win.webContents.on("will-prevent-unload", e => { const r = dialog.showMessageBoxSync(win, {type:"question", buttons:["Keep editing","Discard and close"], defaultId:0, cancelId:0, message:"You have unsaved changes to an agent."}); if (r === 1) e.preventDefault(); })`.
   - **Bridge (for Cmd+Q / `before-quit` and better copy):** `tvashtrDesktop.app.setUnsavedChanges(state: { dirty: boolean; agentName?: string }): void` → `ipcRenderer.send("tvashtr:app:unsaved", state)`. Main keeps the latest state and prompts in `app.on("before-quit")`.
2. **⌘S.** There is no conflict today, because there is no custom app menu. If a native menu is added later, route its Save accelerator to the renderer with `tvashtrDesktop.app.onMenuCommand(cb: (cmd: "save" | "close-panel") => void): () => void` (IPC `tvashtr:menu`) so ⌘S works even when focus is in a native control.
3. **Desktop runner (main-process `runner/`, not preload), for B-16.**
   - `runner/cliCommand.cjs` passes `--safe-mode` / `--restricted` to Claude (no MCP, no CLAUDE.md) and file-only `--tools` to Grok.
   - To honour per-node Tools and Domains on subscription nodes, the job payload (`desktop_jobs.enqueue_job`) needs a resolved `mcp_config`, and `buildCliInvocation({..., mcpConfigFile})` must add Claude `--mcp-config <file>` (and the Grok equivalent, if it has one).
   - This conflicts with the current secret-free runner invariant: resolved `${SECRET}` values would reach the user's machine. It needs a product decision.
4. **Web → Desktop link in the model picker (PANEL-42 "Tvashtr Desktop").** Link to `DESKTOP_RELEASES_URL` (`lib/desktopDownload.ts`). Opening an installed app needs `app.setAsDefaultProtocolClient("tvashtr")` plus `open-url` handling in main. That is owned by the Engines area (EnF-WebDesktop).
5. **Environment chip (PANEL-1)** needs no new API (`dataset.tvashtrDesktop` / `tvashtrDesktopInfo`).

---

## 5. Frontend mapping

**Today:**
- `App.tsx` renders `TeamNodePanel` (author) or `SidePanel` (run view) inside `DrawerShell`, a 384px docked drawer or a "pop-up" modal.
- `TeamNodePanel` is one long form: the Edits segmented control, a Remember segmented control, the System prompt textarea, an Output-contract block, a provider `<select>` plus a model `<input list=datalist>`, the Fallback model input, the Expected output textarea, a Multimodal toggle, Writes-to / Reads-from text fields, `SkillsSection` and `ToolsSection` (`<details>` with always-open add forms), `NodeMemorySection`, the Save bar, and Last run at the bottom.
- The Before list matches this.

**Keep and refactor:**
- **`TeamNodePanel` draft logic** (field seeding, `dirty`, `handleSave` capability payload, the model-warning and same-model-hint logic, the inline provider add). Extract it into a `useAgentDraft(node)` hook that returns `{draft, set, changedFields[], dirtyCount, discard, save, saveState}`. It feeds the footer, the Changed dots and the close guard.
- **Gate / terminal / domain_query branches:** keep the bodies and wrap them in the new header and shell without tabs.
- **`DrawerShell`:** rebuild it as `NodeDrawer`:
  - Header with badges, then tabs, then scroll body, then sticky footer.
  - Replace the "Open as a pop-up" toggle with Focus mode. `panelMode "modal"` becomes the focus dialog.
  - Keep `useModalDialog` for the focus trap.
  - Add responsive overlay at ≤1280.
- **`SkillsSection` / `ToolsSection` pure helpers** (`serversOf`, `transportOf`, `enabledOf`, `refsOf`, `librariesOf`, `setDomains`, `attachFetch`, `addFromPreset`, `labelOf`, `overrideNameOf`): move them into `lib/nodeTools.ts` and `lib/nodeSkills.ts`. The UI is rebuilt.
- **`NodeMemorySection` data calls** (reload, pin, update, delete, promote, reject, repo grouping via `lib/memory.reposOf`): keep them. `MemoryFact` gets a compact `panel` variant with icon buttons, "Learned in round n · date", the force select labelled MUST… (POLARITY_META) and the "Save note" and "Delete note" copy.
- **Other helpers:**
  - `lib/topology.emitContract/applyEmitContract`: extend with target names, a `contractInSync(prompt, edges)` check and a diff of the lines to add.
  - `lib/engines.credentialTreatment` / `subscriptionCoverLabel`: keep, but update the copy to the new hints.
  - `LastRun` `OUTCOME_LABELS`: reuse for badges.
  - `SidePanel.PrdDocuments`: its fetch pattern is reused by the Docs tab.
- **`App.tsx`:**
  - Add the env chip and the team name (from `getTeams`), and the "Connected" label (`BackendDot` with a label).
  - Rename the Back aria-label.
  - Add an unsaved-change interception before `handleSelectNodeId` / close / back.
  - Add a toast host.
  - Pass `teamRuns` / `onOpenEngines` / `onOpenToolkit(view, item)`. `DashView` needs Toolkit sub-routes; the Toolkit area owns those.

**New components:**
- **Shell:** `NodeDrawer`, `NodeHeader` (status, access and model badges plus inline rename), `NodeTabs`, `SaveBar`, `ChangedDot`, `InfoTip` (ⓘ).
- **Setup:** `GetReadyChecklist`, `InstructionsCard` (collapsed editor, run-time banner, Show all), `TemplatesMenu` + `useNodeTemplates`, `RoutingStatus`, `ModelPicker` (combobox/listbox with provider groups, search, inline key add, custom ID; shared by main and backup), `ReadsPicker` (checkbox + drag reorder + new name), `WritesPicker` (radio + new name), `AdvancedSection`, `OutputSchemaEditor` (JSON parse with friendly line/column messages and a schema-subset check).
- **Skills and tools:** `SkillsPanel` (`SkillRow`, `LoadModeMenu`, `AddSkillMenu`, `WriteSkillForm`, `PresetPicker`, `LibrarySkillPicker`, `RepoSkillForm`, `SkillsEmpty`) and `ToolsPanel` (`ToolRow`, `AddToolMenu`, `AddServerForm`, `PasteMcpJson`, `LibraryToolPicker`, `ToolsEmpty`, `DomainsSwitch`).
- **Other tabs:** `MemoryTab`, `RunsTab` (`RoundCard`, `useNodeHistory`), `DocsTab` (`RunSwitcher`, `DocCard`).
- **Focus:** `NodeFocusView` (dialog sharing `useAgentDraft`).
- **Hooks:** `useUnsavedGuard` (web `beforeunload` + Desktop bridge) and `useHotkey("mod+s")`.

**Shared primitives:**
- **Already in `design-system/components/primitives.tsx` but not yet used anywhere:** `Button` (primary / secondary / ghost / tint / danger, loading needed), `IconButton` (with `active`), `Badge` (neutral / accent / info / success / warning / danger / outline + `dot`), `Switch`, `Tabs` (line / pill, `count`), `Input` / `TextArea` / `Select` / `Field`, `Checkbox`, `Kbd`, `Count`, `LetterTile` (provider tiles), `Logo`, `Avatar`.
- **To build and share with the other areas** (the Toolkit, Home and Docs designs use the same patterns): `Menu` / `Popover` (⋯ menus, add menus, the load-mode menu, the run switcher), `Listbox` / `Combobox` (model picker), `AlertDialog` (confirms that "show the impact": delete lists the arrows, templates or routing show what changes, close lists the changed fields), `Toast` with an action (Undo / Open Engines / Add secret), `SegmentedControl` (formalise `.tv-seg`), `Disclosure`, `Tooltip` (ⓘ), `SubView` (in-drawer "Back" sheet for the add forms, presets and output format).

**Tests to rewrite:** `TeamNodePanel.test.tsx` (1231 lines), `SkillsSection.test.tsx`, `ToolsSection.test.tsx`, `NodeMemorySection.test.tsx`, `DrawerShell.test.tsx`, and parts of `App.test.tsx` and `App.desktop.test.tsx`.

---

## 6. Open questions / ambiguities

1. **Tab count "Skills & tools 4"** with 3 skills and 2 tools. Recommend the count = skills + tool servers (5 in Main); exclude the switches (rules files, Domains).
2. **Before-After says "Four tabs"**, but five are designed (Docs included). Recommend five.
3. **Reviewer "Writes review-notes" (Flow-Writes)** conflicts with the executor, which ignores `writes_to` on emitting nodes, and with the Docs tab copy "No document. Its verdict goes to Runs." Recommend for v1: Writes disabled for verdict-emitting nodes, with the hint "Its verdict goes to Runs.", plus a validity warning. Widening the pull to REPORT.md (B-option b) can come later.
4. **Removing the only "spec" chip** cannot mean "reads nothing" today. Recommend the new `config.reads_default=false`. Until it exists, make the default spec chip non-removable when it is alone.
5. **Panel-EntryAgent shows "Reads spec default" / "Writes Nothing"**, copied from the Reviewer, which contradicts Docs-PanelPM and the Writes tooltip. Recommend Reads = "The idea you type when you press Run" (not editable) and Writes = "spec (default)" (renamable only).
6. **When to show "Let <Name> change files?".** The copy is reviewer-specific. Recommend showing it only when the node emits a verdict (has branch out-edges). Others switch directly.
7. **Applying a template yields "2 unsaved changes"**, so templates may set more than the text. Recommend a template sets the instructions and its default File access (PM read-only, Engineer edits on, Reviewer read-only), and the confirm copy names both.
8. **Flow-Model-3 shows the routing warning after a model change.** This looks like a mock artifact; a model change must not affect routing sync.
9. **"Needs a model"**: the server always stamps a model at create. Recommend new blank agents start with `model=""`, with a `no_model` validity error (blocks Run). Show the badge when the model is blank *or* no key or subscription covers it.
10. **Remember toggle saves immediately** while everything else waits for Save. Keep it (per design), using the PATCH with the saved prompt and model, and relax the PATCH later.
11. **"Kept … Undo"**: promote may supersede another note. Recommend a deferred commit: the promote call fires when the toast closes or the drawer closes.
12. **Trigger words entry for an existing row** (Flow-LoadMode-2 shows chips only). Recommend that choosing "When triggered" opens an inline chip input under the row, which must be non-empty.
13. **Skill "Edit" on a Library or Preset skill** would change a shared account item. Recommend Edit = inline editor for Custom only, and "Open in Toolkit" for Library or Preset (showing "Used by N agents").
14. **Add server form** has only URL or Command, but the secret hint suggests `${TOKEN}` inside it, which `node_tools` does not substitute there. Recommend adding an optional Headers (Remote) / Env (Local) row to the form rather than substituting in URLs, which would leak into logs.
15. **Web fetch "Add"** in the empty state: Main shows fetch badged "Local" (inline), while today's code attaches it as a library ref (badge "Library"). Recommend adding it inline (`uvx mcp-server-fetch`) to match the design.
16. **Desktop subscription nodes** (the Grok Reviewer in Main): tools, domains, skills and rules are not applied by the Desktop runner (B-16). Recommend the PANEL-103 note, e.g. "Runs on your Grok subscription on this computer — tools and skills aren’t used there yet.", until the backend or runner gap is closed.
17. **Model picker lists anthropic/xai models** under "Only models proven to run a full build are listed", but the catalogue has none. Recommend adding catalogue entries (§3 PANEL-39) and making the note honest for unprobed BYOK entries ("Proven on your subscription").
18. **Rename UX is not designed.** Recommend Rename puts the header name and description into inline edit (Enter saves into the draft, Esc cancels), with changes going through the same Save. Store them in `config.title` / `config.description`, not `role_name`.
19. **Repo skill rows** show a skill name ("pytest-review") with an "org/skills @ main" badge. It is unclear whether rows are per source or per resolved skill. Recommend one row per source, labelled by the filter if it is a single name, else the repo name; per-skill rows only if the preview endpoint ships.
20. **Run view**: `SidePanel` (live-run inspector) is not redesigned. Recommend reusing `NodeDrawer`'s header and shell, with Runs as the default tab during a run and Setup read-only.
21. **Docs tab for a node that did not exist in the chosen run**: this is not designed. Recommend "This agent wasn’t part of this run." Also, `GET /api/documents/{id}` is authenticated but **not owner-scoped** (any signed-in user can read any document by id). This belongs to the Docs area and should be fixed with the Docs work.
22. **"1 unsaved changes"** (Web-NewAgent) is a copy error. Use the singular.
