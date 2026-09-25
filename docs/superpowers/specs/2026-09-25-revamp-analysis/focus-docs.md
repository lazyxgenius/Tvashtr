# focus-docs — Focus view + Documents: gap analysis

Scope: every `Focus-*` and `Docs-*` screen (17 screens). Prefixes: `FOCUS-` (full-screen per-agent
editor) and `DOCS-` (where run documents appear: drawer Docs tab, toolbar Documents drawer, canvas
doc chips, document viewer / live edit / compare).

Totals: 109 requirements (FOCUS-1…73, DOCS-1…36). The backend gap table has 37 rows: 18 EXISTS,
15 PARTIAL, 4 MISSING.

Cross-area overlap (flagged, not duplicated in depth): the Setup settings column (Model, Images,
File access, Reads, Writes, Advanced), Skills/Tools menus, the node ⋯ menu, Memory store rules and
the close-with-unsaved dialog are also drawn in the 384 px drawer flows (`Flow-*`, `Panel-*`,
`Web-*`). This report lists them only where the focus view changes the layout or needs new data;
the drawer/settings, toolkit/memory and engines analysts own the field-level rules.

---

## 1. Screens

**Focus-Setup (Desktop) / Desktop-Focus.** This is the focus view: a centered dialog, 1240 px wide
(`role=dialog`, "Reviewer in focus view"), over a scrim. The canvas stays visible behind it. The
header has a glyph, the title "Reviewer", the tagline "Checks against the spec", and three badges:
a status badge with an accent dot ("Changes requested · 31m ago"), "🔒 Read-only" and "Grok 4.7".
The icon buttons are "Dock to the side", "More actions" and "Close". Below the header is a line
tab bar: Setup · Skills & tools (4) · Memory (3) · Runs · Docs. The Setup body has two columns.
- **Left:** the Instructions editor. It has two ghost buttons ("Preview as the agent sees it",
  "Templates"), a locked note "Added at run time, above your instructions: the idea + the latest
  spec", a line-numbered monospace editor with a current-line highlight, and a status bar
  ("Line 12, column 38" · "1,284 characters · about 320 tokens").
- **Right:** the full settings column: Routing summary, Model + Images, Access & documents (File
  access, Reads, Writes) and an expanded Advanced section (Backup model, Output format).

A sticky footer reads "✓ All changes saved" with a disabled "Save". On Desktop a macOS title strip
("Tvashtr — the living canvas") and a "Tvashtr Desktop" pill show in the app header.

**Focus-SetupWeb.** Same as Focus-Setup, but the header shows "tvashtr.fly.dev" and there is no
title strip. The design still shows the model line "Your Grok subscription · runs on this
computer". That line cannot be true on the website (see OQ-3).

**Focus-SetupEditing.** The same view in a dirty state. The editor has a caret line. The Model label
has a coral "Changed" dot (`title="Changed"`). The footer changes to "● 2 unsaved changes" +
"Discard" (ghost) + "Save ⌘S" (primary).

**Focus-ReviewChanges.** The Setup body is replaced by a review of the unsaved changes: "Review 2
changes" / "Nothing is saved yet. Saving changes the next run you launch." / "Back to editing".
There is one section per changed field:
- "Instructions", with "+2 −1 lines", an "Undo this change" button and a unified line diff
  (context, − removed, + added).
- "Model", with "Setup → Model", an "Undo this change" button and the change "X xai/grok-4.7 →
  A anthropic/claude-sonnet-5".

The footer keeps "2 unsaved changes · Discard · Save ⌘S".

**Focus-Templates.** A second dialog (`role=dialog`, "Choose a template", 860 px) opens over the
focus view. It has the header "Start from a template" / "Templates come from your team’s template
library." and a close button. On the left is a list: Product manager ("Turns your idea into a spec
the team can build from."), Architect ("Plans the change and writes the design document."),
Engineer ("Builds the change and runs the tests.") and Reviewer ("Checks the build against the
spec and gives a verdict."). On the right is a "Preview" of the selected template's prompt with
the footnote "This replaces the current instructions. You can Discard before you save." The
buttons are "Cancel" and "Use Reviewer template". The drawer flow (`Flow-Templates-3`) shows the
outcome: the editor is replaced, a toast reads "Reviewer template applied", and the routing check
may switch to "Instructions no longer match your arrows" + "Update instructions".

**Focus-AgentSees.** The Setup body is replaced by a read-only compiled preview: "Preview as the
agent sees it" / "Read-only. Built from the last run’s idea and spec, plus your current
instructions and always-on skills." / "Back to editing". It has four numbered sections:
1. The idea ("typed when you pressed Run").
2. The latest spec ("Shared spec · v3", truncated).
3. Your instructions ("Setup → Instructions").
4. Always-on skills ("house-style" + its content).

The footer shows the saved state.

**Focus-Skills.** The Skills & tools tab in two panes.
- **Left:** "Skills 3" + "Add skill". Each skill row has a name, a source badge (Custom /
  `org/skills @ main` / Library), a load-mode button ("Always on", "Agent decides", "When
  triggered" + trigger words "auth secrets tokens") and a ⋯ menu. Below that are the "Follow the
  repo’s rules files" switch, then "Tools 2" + "Add tool", the "Domains" switch, and tool rows.
  Each tool row has a name, a badge (Local / Library), a command or URL with `${GITHUB_TOKEN}`, an
  "Enable {name}" switch and a ⋯ menu.
- **Right:** details of the selected skill: name, badge, "Edit", ⋯, "Loads Always on", "Size 412
  characters", "Used by Reviewer, Engineer", the SKILL.md content and an explanation line.

**Focus-Memory.** Two panes.
- **Filter rail:** a "Search notes" box, Scope checkboxes with counts ("This agent (3)" on, "This
  repo (6)", "Account (9)"), Force checkboxes (MUST, SHOULD, MAY, CONTEXT, SHOULD NOT, MUST NOT —
  all on) and "Open Memory in Toolkit →".
- **Main pane:**
  - a disabled "Remember what it learns · only agents that can edit files record new lessons"
    switch (the Reviewer is read-only)
  - "Waiting for your review · 1": one SHOULD suggestion, "Suggested after round 3 of “Add an RSI
    indicator”", with "Keep" and "Discard"
  - notes grouped by repo ("lazyxgenius/trade_mcp · 2") and "Not repo-specific · 1". Each note has
    a force badge, content with inline code, provenance ("Learned in round 2 · confirmed 3× ·
    pinned" / "Added by you · Sep 20") and Pin / Edit / Delete icon buttons.

The footer reads "Memory changes save right away", and Save is disabled.

**Focus-Runs.**
- **Rail:** 'Run “Add an RSI indicator”' with Rounds 3/2/1 (each "Changes requested" + a relative
  time), then "Earlier runs", with one row "Round — · Approved · Sep 22".
- **Detail of Round 3:**
  - header: badge, "Round 3 · 31m ago", "Open this run on the canvas"
  - "Verdict": the reasons, with inline `code`
  - "What it was given": "Shared spec v3", "build-notes v2", "2 memory notes MUST · SHOULD",
    "house-style always on"
  - "What it produced": `REVIEW_VERDICT.json` with its JSON
  - "Cost": "18.2k tokens in", "1.1k out", "$0.00 · Grok subscription", "2m 14s"

**Focus-Docs.** Three panes.
- **Left:** "This run’s documents" (Shared spec · Product manager · v3; build-notes · Engineer ·
  v2), with the footer 'Run “Add an RSI indicator” · 31m ago'.
- **Center:** an accent "Shared spec" badge, "v3 · written by Product manager · 31m ago", "Open",
  and the rendered markdown (h1, h2, bullets, inline code).
- **Right:**
  - "Versions" + "Compare". Rows: v3 Agent "31m ago · Product manager · Updated acceptance after
    review"; v2 You "40m ago · You · Edited while the run was live"; v1 Agent "52m ago · Product
    manager · First draft".
  - "Who uses it": "Written by Product manager", "Read by" [Engineer] [Reviewer], and "Every agent
    reads the shared spec unless its Reads says otherwise."

**Docs-PanelReviewer (Desktop drawer, 384 px).** The drawer header has "Focus mode" / ⋯ / close and
the badges. The Docs tab contains:
- 'From run “Add an RSI indicator” · 31m ago' + "Change". Flow-Docs-2 shows the Change menu:
  "{idea} · {when} · {3 rounds | approved}".
- a shared-spec card: "Shared · everyone reads this", "Shared spec", "PRD · written by Product
  manager", "Open", "v3 · 31m ago · read by all 3 agents"
- "This agent writes": "No document. Its verdict goes to Runs." + "Set in Setup"
- "This agent reads": "Shared spec — Read first, by default — v3 · same as above", and "build-notes
  — Written by Engineer — v2 · 36m ago", each with "Open"
- the link "See all documents in this run"

**Docs-PanelPM (website drawer).** The same tab for the entry agent. The badge reads "Done · 31m
ago". "This agent writes: Product manager is the entry agent, so it writes the Shared spec above."
"This agent reads: The idea you type when you press Run." There is no reads list. Nothing here is
specific to Desktop or the website, apart from the header.

**Docs-Drawer (toolbar → Documents).**
- **Toolbar:** a new toggle "📄 Documents 2" (`aria-pressed=true`), next to the team name.
- **Canvas:** document chips ("Shared spec v3" in coral, "build-notes v2" in neutral) near the
  writing agents.
- **Drawer (360 px, right, `aria-label="Documents"`):** header "Documents / What this team’s agents
  wrote" with a "Close documents" button; the run picker "Run: Add an RSI indicator · 31m ago"; a
  shared-spec card; a "Written by agents" section (build-notes, "Written by Engineer", "v2 · 36m ago
  · read by Reviewer", Open); and the footer "Documents belong to a run. While a run is live you
  can edit the shared spec to steer it."

**Docs-Viewer (Desktop) / Docs-ViewerWeb.** A document dialog (1240 px, `aria-label` = document
name) over a scrim.
- **Header:** "Shared spec / The PRD for this run · everyone reads it", a version dropdown "v3 ·
  latest", "Edit" (secondary), "Copy as Markdown", "Close".
- **Left rail:** "This run’s documents" + the run footer.
- **Center:** rendered markdown.
- **Right:** Versions + Compare + "Who uses it".

The website variant is identical apart from the app header.

**Docs-EditLive.** Edit mode on the latest version while the run is live. The "Edit" button is gone.
A primary banner reads "The run is live. Save and agents pick up your edit at their next step." A
formatting toolbar offers H1 · H2 · B · I · • List · Code, above a WYSIWYG editor. The footer reads
"● Unsaved edit · saves as v4" with "Discard" and "Save as v4".

**Docs-Compare.** "Compare" is active (tint variant). A banner reads "Comparing v2 (You) → v3
(Product manager)" with "+2 lines" (green) and "−1 line" (red). The document renders inline with
the added bullet ("`TestRegistry` lists 29 indicators, including `rsi`.") and the removed bullet
("`TestRegistry` lists 28 indicators.") marked. In the version list, v3 (to) has a coral border and
v2 (from) an outlined border.

---

## 2. Behaviour requirements

### Focus shell (all Focus-* screens)
- **FOCUS-1** Open the focus view from the drawer header's "Focus mode" icon button, from ⋯ → "Open
  in focus view", and from Runs → "Open in focus view". It is a centered dialog, ~1240 px wide,
  over a click-to-close scrim (`role=dialog`, `aria-label="{Agent} in focus view"`). The canvas
  stays mounted behind it.
- **FOCUS-2** Header identity: the node glyph, the agent title (role title, e.g. "Reviewer") and the
  tagline (e.g. "Checks against the spec", "Drafts the spec", "Writes & ships it").
- **FOCUS-3** Header status badge "{outcome label} · {relative time}" from the node's last run.
  Variants:
  - accent + dot for "Changes requested"
  - success + dot for "Approved" / "Done"
  - danger for "Failed"
  - no badge when the node never ran
- **FOCUS-4** Header capability badge "🔒 Read-only" when `edits_allowed=false`, and a model badge
  with a humanized model name ("Grok 4.7"). Both update live from the draft.
- **FOCUS-5** "Dock to the side" returns to the 384 px drawer. The active tab and every unsaved
  draft value survive both directions (drawer ⇄ focus). The preference stays sticky for the session,
  as `panelMode` is today.
- **FOCUS-6** The ⋯ "More actions" menu offers the same items as the drawer, minus "Open in focus
  view": "Rename", "Open its documents" (switches to the Docs tab), and "Delete agent — Its arrows
  are removed too". Delete confirms with "Delete Reviewer? Its arrows to Engineer and Ship are
  removed too. Past runs keep their results." [Cancel] [Delete agent].
- **FOCUS-7** "Close" with unsaved changes shows the shared alertdialog: "Save your changes to
  Reviewer? You changed the instructions and the model." [Keep editing] [Discard] [Save]. The
  sentence lists the changed fields.
- **FOCUS-8** Line tabs: "Setup", "Skills & tools" (count), "Memory" (count), "Runs", "Docs".
- **FOCUS-9** The sticky footer appears on every tab.
  - Clean: "✓ All changes saved" + a disabled "Save".
  - Dirty: "● {N} unsaved change(s)" (singular/plural) + "Discard" (ghost) + "Save ⌘S" (primary).
  - Memory tab: "Memory changes save right away".
- **FOCUS-10** ⌘S (macOS) / Ctrl+S (Windows/Linux) saves when dirty and always calls
  `preventDefault` (otherwise browsers run "Save page"). The shortcut hint shows "⌘S" or "Ctrl S"
  by platform.
- **FOCUS-11** Save sends one PATCH with every changed field. While it runs: disabled + "Saving…".
  On success the footer shows "All changes saved" and the canvas node refreshes. On failure it
  shows "Couldn’t save — try again." (existing copy) and keeps the draft.
- **FOCUS-12** "Discard" reverts every draft field to the saved node, with no confirmation (the
  design gives none). Recommended: a toast with Undo.
- **FOCUS-13** Escape closes only the top-most layer: the Templates dialog, then the preview/review
  sub-view, then the focus dialog (guarded by FOCUS-7). The focus trap stays inside the top-most
  dialog.

### Setup tab (Focus-Setup / -SetupWeb / -SetupEditing)
- **FOCUS-14** Two-column layout: the Instructions editor (flex) and the settings column (~360 px).
- **FOCUS-15** Instructions header: "Instructions", with an ⓘ tooltip "Who this agent is and how it
  works."
- **FOCUS-16** A lock-note above the editor lists what the run adds. The design copy is "Added at
  run time, above your instructions: the idea + the latest spec" (see OQ-1 on "above"). Variants:
  - the entry agent: "…: the idea"
  - a node with Reads: "…: the idea + {reads names}"
- **FOCUS-17** A code-style editor: line-number gutter, current-line highlight, monospace, no spell
  check, soft wrap off.
- **FOCUS-18** Editor status bar: "Line {l}, column {c}" (follows the caret) and "{chars} characters
  · about {tokens} tokens". Characters use thousands separators. Tokens ≈ chars/4 (the same
  heuristic as the backend `estimate_tokens`), rounded to the nearest 10.
- **FOCUS-19** Empty instructions block Save (the backend returns 422 "prompt and model are required
  for an agent node"). The inline error is not designed; recommended: "Instructions can’t be
  empty."
- **FOCUS-20** Routing summary for a node with verdict branches: "Says “approved” → Ship. Anything
  else → back to Engineer." Target names are bold, taken from the out-edges.
  - When the prompt contains the emit contract: "✓ Instructions match your arrows".
  - Otherwise, a warning: "Instructions no longer match your arrows" + "Update instructions" (tint),
    which writes the contract block into the prompt and marks it dirty.
- **FOCUS-21** Model row: the tooltip "Only models proven to run a full build are listed.", and a
  picker button (provider glyph + slug) that opens the model picker (owned by the drawer/engines
  analysts). The coverage line under it:
  - Desktop, subscription connected: "Your Grok subscription · runs on this computer"
  - website: "Uses your xAI API key" (per `Web-Setup`; see OQ-3)
- **FOCUS-22** "Images" switch (multimodal), with the tooltip "Let it send and read images.
  Text-only models ignore this."
- **FOCUS-23** File access segmented control: "Can edit files" / "Read-only" (`aria-pressed`). The
  tooltip is "Can it change files in the repo?".
  - Read-only hint: "Same agent loop with read-only tools. Only its report leaves the sandbox."
  - The entry agent is locked (existing tooltip "The first node scopes the work — it writes the
    shared spec the team reads, so it stays edits-off.").
- **FOCUS-24** "Reads" chips, in order. The tooltip is "Documents it reads before it starts, in
  order. Default: the spec." The chip "spec · default" has a remove button (`aria-label="Remove
  spec"`). "+ Add" picks a document name (names written by other agents in this team + free text).
- **FOCUS-25** "Writes". The tooltip is "The one document this agent creates. By default, the entry
  agent writes the spec and others write nothing." The value is "Nothing" + "+ Choose", which picks
  or creates a name. Disable it for agents with verdict branches (OQ-14).
- **FOCUS-26** "Advanced" disclosure (`aria-expanded`). The collapsed summary reads "Backup model:
  {none|slug} · Output format: {none|JSON schema}".
- **FOCUS-27** "Backup model": the tooltip is "Leave as None for no backup.", the picker shows
  "None", and the hint is "Used once if the main model fails (bad key, provider down)."
- **FOCUS-28** "Output format": the tooltip is "An advisory JSON Schema for this agent’s output.",
  the value is "None" + "Add JSON schema" (secondary), and the hint is "Optional. If the output
  doesn’t match, the run logs a warning. It won’t fail." Invalid JSON blocks save with the existing
  copy "That isn’t valid JSON — fix it to save."
- **FOCUS-29** Each field label whose draft differs from the saved value shows a coral "Changed" dot
  (`title="Changed"`). The footer count equals the number of changed fields.

### Review changes (Focus-ReviewChanges)
- **FOCUS-30** Open "Review {N} changes" from the dirty footer (the entry point is ambiguous — see
  OQ-4). The Setup body shows the title, the subline "Nothing is saved yet. Saving changes the next
  run you launch." and "Back to editing".
- **FOCUS-31** One section per changed field: the field name, its location ("Setup → Model") and
  "Undo this change", which reverts only that field. When the count reaches 0, return to editing
  with "All changes saved".
- **FOCUS-32** Text fields (Instructions, Output format): "+{a} −{r} lines" stats and a unified line
  diff with context. Removed lines are red with "−", added lines green with "+".
- **FOCUS-33** Scalar fields (Model, Backup model, File access, Images, Reads, Writes): old → new,
  with the provider glyph for models.
- **FOCUS-34** Skills/tools changes also appear as sections (added / removed / mode changed), since
  they are part of the same Save.

### Templates (Focus-Templates)
- **FOCUS-35** "Templates" opens a nested dialog (`aria-label="Choose a template"`, 860 px): "Start
  from a template" / "Templates come from your team’s template library." and a close button.
- **FOCUS-36** A list of templates (title + one-line description). The first selection is the
  node's own role, if it matches.
- **FOCUS-37** The Preview pane shows the full prompt of the selected template, with the footnote
  "This replaces the current instructions. You can Discard before you save."
- **FOCUS-38** "Cancel" closes. "Use {Title} template" replaces the editor text (unsaved), closes
  the dialog, shows the toast "{Title} template applied", marks Instructions changed and re-runs the
  routing check (FOCUS-20).
- **FOCUS-39** Loading and error states for the template list (not designed). Recommended:
  "Loading templates…" / "Couldn’t load templates — try again."

### Preview as the agent sees it (Focus-AgentSees)
- **FOCUS-40** "Preview as the agent sees it" replaces the Setup body with "Read-only. Built from the
  last run’s idea and spec, plus your current instructions and always-on skills." + "Back to
  editing".
- **FOCUS-41** Numbered, read-only sections with a label and a source line: "The idea — typed when
  you pressed Run"; "The latest spec — Shared spec · v{n}"; "Your instructions — Setup →
  Instructions"; "Always-on skills — {name}" (+ content). Long bodies are truncated with "…" and
  expandable.
- **FOCUS-42** The preview uses the unsaved draft instructions and settings (edits-off note, reads,
  skills), not the saved node.
- **FOCUS-43** Never-run state (not designed). Recommended: section 1 "No run yet — the idea you type
  when you press Run goes here."; section 2 "No spec yet — the Product manager writes it on the
  first run."
- **FOCUS-44** Show every part the agent actually receives, in the real order, with token counts per
  part and in total (see OQ-1/OQ-2).

### Skills & tools (Focus-Skills)
- **FOCUS-45** Tab count on "Skills & tools" (semantics: OQ-17).
- **FOCUS-46** "Skills {n}" header + "Add skill" (secondary; opens the add-skill menu owned by the
  drawer/toolkit analyst). Tooltip: "Reusable know-how. Worker agents get skills as context and
  tools; thinker agents fold them into their prompt."
- **FOCUS-47** Skill row: the name, "More actions for {name}" ⋯, and a source badge:
  - "Custom" for inline
  - "{owner/repo} @ {ref}" for a repo source
  - "Library" for a library reference

  The load-mode button reads "Always on" / "Agent decides" / "When triggered", with the trigger
  words shown under it (`auth secrets tokens`).
- **FOCUS-48** "Follow the repo’s rules files" switch with the text "When working on a real folder,
  also use its CLAUDE.md, AGENTS.md, .cursorrules and .cursor/rules." On = a `project_rules` source
  is present.
- **FOCUS-49** "Tools {n}" + "Add tool". Tooltip: "MCP servers this agent can call. Secrets stay as
  ${NAME} and are filled in at run time."
- **FOCUS-50** "Domains" switch: "Let it ask and search your domains during a run." Tooltip: "To
  explore yourself, use Chat/Ask. For a fixed step on the canvas, use a Query domain node."
- **FOCUS-51** Tool row: the name, a badge ("Local" for a stdio command, "Library" for a library
  reference), the command or URL with `${SECRET}` placeholders shown literally, an "Enable {name}"
  switch and "More actions for {name}".
- **FOCUS-52** Detail pane for the selected skill: the name, badge, "Edit" (secondary), ⋯, "Loads
  {mode}", "Size {n} characters", "Used by {agents in this team that carry the same skill}", the
  rendered SKILL.md, and an explanation line that depends on mode and capability. For example:
  "Always-on skills go into every prompt in full. Reviewer is a worker agent, so it also gets this
  skill as context."
- **FOCUS-53** Every skill/tool change is part of the Save draft (it counts toward "N unsaved
  changes").
- **FOCUS-54** Empty state (Panel-SkillsEmpty): "No skills yet — Skills teach this agent your team’s
  way of doing things." + the four add options.

### Memory (Focus-Memory)
- **FOCUS-55** Filter rail: "Search notes" (client-side text filter); Scope checkboxes "This agent
  ({n})", "This repo ({n})", "Account ({n})" (default: This agent only); Force checkboxes MUST /
  SHOULD / MAY / CONTEXT / SHOULD NOT / MUST NOT (default: all); "Open Memory in Toolkit →" goes to
  Dashboard → Tools.
- **FOCUS-56** "Remember what it learns · only agents that can edit files record new lessons"
  switch. It is disabled when File access = Read-only. The Panel-MemoryEmpty hint reads "Turn on
  File access in Setup to use this." It is a node setting, so it goes through Save.
- **FOCUS-57** "Waiting for your review · {n}": a force badge, the content, "Suggested after round
  {n} of “{run idea}”", "Keep" (promote) and "Discard" (reject). The action takes effect at once.
- **FOCUS-58** Active notes grouped by repo ("{repo label} · {n}") and "Not repo-specific · {n}".
  Each note shows:
  - a force badge (MUST = danger, SHOULD = warning, CONTEXT = neutral, …)
  - the content, with inline code rendered
  - provenance: "Learned in round {n} · confirmed {k}×[ · pinned]" or "Added by you · {date}"
- **FOCUS-59** Per-note icon buttons: Pin (toggle, `active` state), Edit (inline, saves on confirm)
  and Delete. All three act at once ("Memory changes save right away").
- **FOCUS-60** Empty state (Panel-MemoryEmpty): "Private lessons that apply only to this agent.
  Team-wide lessons live in the Memory shelf. No notes yet — As this agent runs, lessons that only
  apply to it will appear here."
- **FOCUS-61** Delete confirmation or undo (not designed). The backend delete is a hard delete, so
  recommended: an inline confirm "Delete this note?".

### Runs (Focus-Runs)
- **FOCUS-62** Rail: 'Run “{idea}”' with this agent's rounds in that run, newest first. Each row
  shows "Round {n}", an outcome badge and a relative time. The selected round is highlighted.
- **FOCUS-63** "Earlier runs": one row per earlier run where this agent ran. Each row shows "Round
  —", the agent's final outcome badge and a short date. Selecting one loads that run's rounds (see
  OQ-15).
- **FOCUS-64** Round detail header: the outcome badge, "Round {n} · {relative}", and "Open this run on
  the canvas" (secondary), which closes the focus view and opens the run view for that run.
- **FOCUS-65** "Verdict" section (for agents with verdict branches; others: "Summary"): the
  `outcome_detail`, with backtick spans rendered as `code`. Failed rounds show "Failed" + the
  reason.
- **FOCUS-66** "What it was given": each document with the version read ("Shared spec v3",
  "build-notes v2"), "{n} memory notes {FORCE · FORCE}", and "{skill} always on" per always-on
  skill.
- **FOCUS-67** "What it produced": either the verdict file name + JSON (`REVIEW_VERDICT.json {
  "verdict": …, "reasons": … }`), the document version written ("Shared spec v3"), or the files
  changed.
- **FOCUS-68** "Cost": "{in} tokens in", "{out} out" (k-abbreviated), "${cost} · {Grok subscription |
  xAI API key}", and the duration ("2m 14s").
- **FOCUS-69** Empty state (Panel-RunsEmpty): "This agent hasn’t run yet — Press Run this team and
  what it did will show up here."
- **FOCUS-70** In-flight round (not designed). Recommended: a "Running" badge, polling while the
  focus view is open, and no cost until the round ends.

### Docs tab in focus (Focus-Docs)
- **FOCUS-71** Left rail "This run’s documents": each row shows the label (Shared spec / name) and
  "{writer} · v{n}". The footer reads 'Run “{idea}” · {relative}'. Clicking a row selects the
  document.
- **FOCUS-72** Center: a document-kind badge (accent "Shared spec" or neutral {name}), "v{n} ·
  written by {writer} · {relative}", "Open" (opens the Document viewer, DOCS-18), and the rendered
  markdown.
- **FOCUS-73** Right: Versions + Compare + "Who uses it". Identical to DOCS-21…23 and shared with
  them.

### Docs tab in the drawer (Docs-PanelReviewer, Docs-PanelPM, Flow-Docs)
- **DOCS-1** Run context line: 'From run “{idea}” · {relative}' + "Change".
- **DOCS-2** The "Change" menu (`role=menu`, 280 px) lists the team's runs, newest first. Each item
  shows "{idea}" and "{relative or date} · {N rounds | final outcome}". Picking one reloads the tab
  for that run.
- **DOCS-3** Shared-spec card: "Shared · everyone reads this", "Shared spec", "PRD · written by
  {entry role}", "Open", "v{n} · {relative} · read by all {k} agents".
- **DOCS-4** "This agent writes":
  - entry agent: "{Role} is the entry agent, so it writes the Shared spec above."
  - agent with verdict branches and no Writes: "No document. Its verdict goes to Runs." + "Set in
    Setup" (goes to Setup › Writes)
  - agent with Writes (not designed): a card for its own document
- **DOCS-5** "This agent reads":
  - entry agent: "The idea you type when you press Run."
  - others: document cards in Reads order, for example "Shared spec — Read first, by default —
    v{n} · same as above" and "{name} — Written by {role} — v{n} · {relative}", each with "Open"
- **DOCS-6** "See all documents in this run" opens the toolbar Documents drawer for the same run.
- **DOCS-7** No run yet (not designed). Recommended: "No documents yet — documents appear after the
  team’s first run."
- **DOCS-8** A document named in Reads but not written in the selected run (not designed).
  Recommended: "{name} — not written in this run".
- **DOCS-9** Loading and error states for the tab. Reuse "Loading…" / "Couldn't load the documents."

### Toolbar, canvas chips, Documents drawer (Docs-Drawer)
- **DOCS-10** Toolbar toggle "📄 Documents {n}" (`aria-pressed`). It is visible once the team has at
  least one run (authoring view: the latest run; run view: that run). {n} = number of documents in
  the run.
- **DOCS-11** Canvas document chips: "Shared spec v{n}" (coral) and "{name} v{n}" (neutral), placed
  near the writing agent's outgoing edge. Clicking one opens the Document viewer on that document.
- **DOCS-12** Documents drawer (`<aside aria-label="Documents">`, 360 px, right side): header
  "Documents" / "What this team’s agents wrote", close "Close documents".
- **DOCS-13** Run picker button "Run: {idea} · {relative}" (same menu as DOCS-2, without per-node
  rounds; shows run status).
- **DOCS-14** Shared-spec card (as in DOCS-3).
- **DOCS-15** "Written by agents" section: for each named document, the name, "Written by {role}",
  "Open", and "v{n} · {relative} · read by {role list}".
- **DOCS-16** Footer note: "Documents belong to a run. While a run is live you can edit the shared
  spec to steer it."
- **DOCS-17** The drawer and the node drawer share the right edge. Opening one closes the other
  (OQ-20).

### Document viewer (Docs-Viewer, Docs-ViewerWeb)
- **DOCS-18** Viewer dialog (`role=dialog`, `aria-label={doc label}`, 1240 px) over a scrim. The
  header has a glyph, the title ("Shared spec" / {name}) and a subtitle:
  - shared spec: "The PRD for this run · everyone reads it"
  - named document (not designed; recommended): "Written by {role} · read by {roles}"
- **DOCS-19** Header controls:
  - version dropdown "v{n} · latest" (or "v{n}" when older), which picks a version
  - "Edit" (secondary; only when editable, see DOCS-26)
  - "Copy as Markdown" icon button: copies the raw markdown of the shown version (toast
    recommended: "Copied as Markdown")
  - "Close"
- **DOCS-20** Left rail "This run’s documents", to switch documents, and the footer 'Run “{idea}” ·
  {relative}'.
- **DOCS-21** Center: rendered markdown (h1/h2/paragraphs/bullets/inline code/code blocks), read-only.
- **DOCS-22** "Versions", newest first. Each row shows "v{n}", a badge ("Agent" neutral / "You"
  info), a relative time, and "{author label} · {change note}". The selected row has a coral border.
  Clicking a row shows that version.
- **DOCS-23** "Who uses it": "Written by {role}", "Read by" role badges. For the shared spec, the
  note "Every agent reads the shared spec unless its Reads says otherwise."
- **DOCS-24** Loading and error states: "Loading the spec…" / "Couldn't load the spec." (existing
  PrdView copy). Generalize "spec" to the document label.
- **DOCS-25** The website and Desktop render identically.

### Live edit (Docs-EditLive)
- **DOCS-26** "Edit" appears only when all of these hold: the run is live (non-terminal, including
  "awaiting approval"), the document is the shared spec (OQ-7), and the latest version is shown.
  Editing an older version is not offered.
- **DOCS-27** Edit mode:
  - the header drops "Edit"
  - banner (primary dot): "The run is live. Save and agents pick up your edit at their next step."
  - toolbar: H1, H2, B, I, "• List", "Code", with active states
  - WYSIWYG markdown editor seeded with the latest version
- **DOCS-28** Footer: "● Unsaved edit · saves as v{latest+1}", "Discard" (ghost) and "Save as
  v{latest+1}" (primary). Save stays disabled until the markdown changes.
- **DOCS-29** Save creates the new version. The view returns to read mode on it, and the Versions
  list gains "v{n} · You · Edited while the run was live". Existing success copy: "Saved v{n} — the
  agents read it on their next round."
- **DOCS-30** Save errors: "Couldn't save — try again." (existing).
  - If an agent saved a newer version meanwhile (recommended): "{Role} saved v{n} while you were
    editing. Compare, then save again." with a Compare shortcut.
  - If the run ended meanwhile: "This run has finished — edits can’t reach its agents."
- **DOCS-31** Closing, switching documents or switching runs with an unsaved edit asks for
  confirmation (the shared unsaved-changes dialog).
- **DOCS-32** A no-op load→save must not change the markdown (the existing round-trip guarantee of
  `prdEditor`).

### Compare (Docs-Compare)
- **DOCS-33** "Compare" toggles compare mode (ghost → tint). It is disabled with only one version
  (tooltip recommended: "Nothing to compare — this is the first version.").
- **DOCS-34** Banner: "Comparing v{a} ({author a}) → v{b} ({author b})", then "+{x} line(s)" (green)
  and "−{y} line(s)" (red), with correct singular/plural.
- **DOCS-35** The rendered document shows the diff inline: added blocks highlighted green, removed
  blocks red and struck.
- **DOCS-36** Picking the pair: by default "to" = the selected version (coral border) and "from" =
  the one before it (outlined border). Clicking another version sets "from". Leaving compare returns
  to the normal view.

---

## 3. Backend gap table

| ID | Needs | Status | Where / proposal |
|---|---|---|---|
| FOCUS-2 | Agent tagline ("Checks against the spec") | **PARTIAL** | No per-node description field. `UpdateTeamNodeRequest.description` exists but only the gate branch of `PATCH /api/teams/{team_id}/nodes/{node_id}` (routers.py ~2988) stores it. **Proposal:** in the agent branch, merge `description` into `config["description"]` (`model_fields_set`-guarded, no migration). The client falls back to a per-role map (pm → "Drafts the spec", …). Shared with the drawer analyst. |
| FOCUS-3 | Latest outcome + time for the badge | **EXISTS** | `GET /api/teams/{team_id}/graph` → `nodes[].last_run.{outcome, outcome_detail, run_id, iteration, started_at}`. |
| FOCUS-4 | Capability + model | **EXISTS** | Team graph `nodes[].edits_allowed`, `nodes[].model`. Display names are client-humanized (the catalogue in `GET /api/config.provider_catalogue` holds slugs only). |
| FOCUS-6 | Rename agent | **MISSING** | The PATCH has no name field (`role_name` drives `ROLE_TITLES` and trajectory joins; don't overwrite it). **Proposal:** `PATCH …/nodes/{node_id}` accepts `display_name: str \| null` → `config["display_name"]`. Owned by the drawer analyst. |
| FOCUS-6 | Delete agent | **EXISTS** | `DELETE /api/teams/{team_id}/nodes/{node_id}`. |
| FOCUS-11, 29, 31 | Save all Setup fields | **EXISTS** | `PATCH /api/teams/{team_id}/nodes/{node_id}` with `prompt`, `model`, `edits_allowed`, `memory_remember_enabled`, `writes_to`, `reads_from`, `fallback_model`, `output_schema`, `multimodal`, `tool_config`, `skills` (routers.py 2942–3091). The response is `_node_base_dict` (no `last_run`, so refetch the graph). |
| FOCUS-16, 44 | Truthful "added at run time" description | **PARTIAL** | `context_compiler.compile_context` puts `node_prompt` **first**, then `memory`, `idea`, `spec` or `read_documents`, `revision`, `grounding`, `worker_protocol`, `worker_focus`, `capability_note`, `remember_protocol`. So the idea and spec are added **after** the instructions, not above. The copy must change (OQ-1). No endpoint needed for the static line. |
| FOCUS-19 | Empty prompt rejected | **EXISTS** | PATCH 422 `"prompt and model are required for an agent node"` (only on `None`; an empty string is accepted!). **Proposal:** also 422 on `body.prompt.strip() == ""` for agent/completion nodes. |
| FOCUS-20 | Routing summary + contract check | **EXISTS** | Team graph `edges[].conditions.{when, loop_limit}`, `edge_type`. Client `lib/topology.emitContract` / `applyEmitContract`. |
| FOCUS-21 | Model coverage line (subscription vs key) | **EXISTS** | Desktop: `window.tvashtrDesktop.engines.getStatus()`. Web: `GET /api/engines/subscriptions` (`connected`, `runner_fresh`) + `GET /api/providers`. `lib/engines.credentialTreatment` already returns "byok" on hosted. |
| FOCUS-24 | Reads, including removing the default spec | **PARTIAL** | `config.reads_from` is stored and read. But `resolve_reads_from` returns `[]` both for "absent" and for an explicit `[]`, and team_run treats `[]` as "read the default spec". So "Remove spec" (reads nothing) can't be expressed. Also, reading `"spec"` by name renders `--- DOCUMENT: spec ---` instead of `--- PRD ---`, and turns off the C4 SPEC.md offload. **Proposal:** the PATCH stores `reads_from: null` = default and `[]` = none. `resolve_reads_from` returns `None` vs `[]`. In team_run, `if reads_from is not None: read_documents=…; spec=None`. context_compiler: no change. No migration. |
| FOCUS-25 | Writes | **PARTIAL** | `config.writes_to` works for non-branching agents. For an agent with verdict branches the run only logs a RunWarning ("…move writes_to onto a non-emitting node"). **Proposal:** add an edit-time warning to `GET /api/teams/{team_id}/validate` (`control_plane/graph_validity.py`): code `writes_on_emitting_node`, severity warning, `node_id`. |
| FOCUS-27, 28 | Backup model, output schema | **EXISTS** | `config.fallback_model`, `config.output_schema` via the PATCH. |
| FOCUS-36, 37 | Template list with full prompts | **MISSING** | `GET /api/templates` returns **team** templates (`{template, name, description}` from `teams._TEMPLATE_CATALOG`). The node presets exist only as `_NODE_PRESETS` in routers.py (PM/ARCHITECT/ENGINEER/REVIEWER_PROMPT from teams.py), used by `POST …/nodes {preset}`; no read endpoint. **Proposal:** `GET /api/node-templates` → `{"templates":[{"key":"reviewer","title":"Reviewer","description":"Checks the build against the spec and gives a verdict.","node_kind":"worker","edits_allowed":false,"prompt":"You are the Reviewer…"}, …]}`. Move `_NODE_PRESETS` into `control_plane/teams.py` as `NODE_TEMPLATES` + `list_node_templates()` (titles/descriptions from the design). No migration; code-resident. |
| FOCUS-40…44 | Compiled context preview without running | **MISSING** | No such endpoint. `compile_context` is pure and cheap. The only live compilation is inside `agent_run_step` (DBOS step). `DesktopNodeJob.instruction` stores the real instruction for subscription jobs only. `run_explain.build_system_prompt` is the Ask trail, not the compiled context. **Proposal:** `POST /api/teams/{team_id}/nodes/{node_id}/context-preview`, body = draft overrides `{"prompt"?, "edits_allowed"?, "reads_from"?, "skills"?, "memory_remember_enabled"?, "run_id"?}`. Response: `{"source_run": {"run_id","idea","created_at"} \| null, "parts": [{"key":"node_prompt\|memory\|idea\|spec\|read_documents\|revision\|capability_note\|remember_protocol","label","text","tokens","source": {"document_id","name","version_no","label"} \| null}], "skills": [{"name","mode","delivery":"context\|prompt","content","tokens"}], "total_tokens","budget","over_budget","handle_used","notes":["Repo map is added at run time when working on a real folder."]}`. Logic goes in a new `control_plane/context_preview.py`:<br>• owner-check via `_require_library_team`<br>• pick `run_id` or the team's latest run (`teams.list_team_runs`)<br>• idea = `Run.idea`; spec = `documents.service.get_latest_version(run.pm_document_id)` (omitted for the entry agent on first draft); `read_documents` via `latest_content_by_name`<br>• memory: the node's pinned + active node/repo/account facts without embedding (no LLM spend), or omit with a note<br>• skills: resolve inline + library sources (`node_library.resolve_owner_skill_source`); list repo sources as "fetched at run time"<br>• budget = `resolve_context_budget`<br>• call `compile_context(...)`<br>Read-only, no migration, no LLM calls. |
| FOCUS-47…53 | Skills/tools data + toggles | **EXISTS** | `nodes[].skills` (inline `{type,name,content,mode,triggers}`, repo `{url,ref,filter}`, `project_rules`, library `{id}`); `nodes[].tool_config` (`mcpServers`, `tvashtr.servers.<name>.enabled`, `tvashtr.domains`); `GET /api/skill-library`, `GET /api/tool-library`. "Used by" = client scan of the team graph `nodes[].skills` (match library `id` or inline `name`). |
| FOCUS-55 | Memory counts per scope | **PARTIAL** | `GET /api/memories?node_id=` / `?repo_key=` / no filter + `tier` per row exists. "This repo" needs the team's repo, but a team has no repo; memory `repo_key` = `Run.repo_path` (a server path for hosted GitHub runs, not "owner/name"). **Proposal:** add `repo_key` + `repo_label` to `GET /api/teams/{id}/runs` rows (label = `github_repo` or the basename of `repo_path`). Owned by the memory analyst. |
| FOCUS-56 | Remember toggle | **EXISTS** | `config.memory_remember_enabled` (PATCH). The executor ANDs it with `edits_allowed`. |
| FOCUS-57, 58 | Provenance "round {n} of “{idea}”" | **PARTIAL** | The memory row has `source_run_id`, `source_invocation_id`, `confirmation_count`, `pinned`, `created_at`. No round number or idea. **Proposal:** `control_plane/memory._to_dict` adds `source_iteration` (join `agent_invocations.id`) and `source_run_idea` (join `runs.id`). Additive, no migration. |
| FOCUS-58 | Node notes with no repo ("Not repo-specific") | **PARTIAL** | `memory.memory_tier` raises `InvalidTierError` for `node_id` without `repo_key` (422). **Proposal** (memory analyst): allow a node-only tier and include `node_id=X AND repo_key IS NULL` in `memory_retrieval._scope_filter`. |
| FOCUS-57, 59 | Keep / Discard / Pin / Edit / Delete | **EXISTS** | `POST /api/memories/{id}/promote`, `/reject`, `/pin`, `/unpin`, `PATCH /api/memories/{id}`, `DELETE /api/memories/{id}`. |
| FOCUS-62, 63 | This agent's rounds across the team's runs | **MISSING** | The authoring graph gives only `last_run` (one invocation). `GET /api/runs/{run_id}/graph` has per-node `invocations[]` but **no `cloned_from_node_id`** on nodes (`_node_base_dict` omits it), so an authored node can't be mapped to its clone except by `role_name` (duplicates are allowed). **Proposal A (small):** add `cloned_from_node_id` to `_node_base_dict` and `invocation_id` to each invocation dict in `/graph` (additive). **Proposal B (needed for the rail):** `GET /api/teams/{team_id}/nodes/{node_id}/runs?limit=20` → `{"runs":[{"run_id","idea","status","created_at","live":bool,"rounds":[ROUND…]}]}`, where ROUND = `{"invocation_id","iteration","status","outcome","outcome_detail","started_at","ended_at","cost":{prompt_tokens,completion_tokens,total_tokens,cost_usd}\|null,"model_used","runs_on":{"via":"subscription\|api_key","provider"},"given":{…},"produced":{…}\|null}`. Logic: a new function in `control_plane/teams.py` (or `node_history.py`) using the same clone→origin join as `_latest_invocation_by_origin` / `list_team_runs`, `_cost_by_invocation`, owner via `_require_library_team`. No migration. |
| FOCUS-64 | Open a run on the canvas | **EXISTS** | `GET /api/runs/{run_id}`, `/graph`, `/tasks` (the App run view via `runId`). |
| FOCUS-65 | Verdict / summary text | **EXISTS** | `invocations[].outcome`, `outcome_detail` (verdict reasons, the work brief, or the failure reason). |
| FOCUS-66 | Documents + versions given, memory, skills | **PARTIAL** | Memory given: **EXISTS** (`context_manifest.memory[{id,polarity}]`). Skills given: derivable from the run clone's `nodes[].skills` (an immutable snapshot; library refs resolved live, failures in `resolution_warnings`). Document versions given: **MISSING**. `read_latest_prd_step` / `read_named_documents_step` return content only; the manifest records part names + tokens. **Proposal:** add `"documents":[{"name","document_id","version_no"}]` to the manifest. Use NEW recorded steps (`read_latest_prd_versioned_step`, `read_named_documents_versioned_step`) returning `{content, document_id, version_no}` — never change the return shape of existing DBOS steps, since in-flight workflows replay recorded outputs. Thread the list into `compile_context(read_versions=…)` → `CompiledContext.manifest()`. For historical rounds, fall back to "latest version with `created_at ≤ started_at`". No migration (JSONB). |
| FOCUS-67 | What it produced | **PARTIAL** | Verdict: reconstructible as `{"verdict": outcome, "reasons": outcome_detail}` (the raw file isn't stored). Spec/named document written: derivable from `document_versions.idempotency_key` (`{run}:pm-prd-v1`, `{run}:spec:{node}:{iter}`, `{run}:doc:{name}:{node}:{iter}`). Files: only in the `outcome_detail` brief and `DesktopNodeJob.files_changed`. **Proposal:** compute `produced` server-side in B above. Optionally, persist `files_changed` on `agent_invocations` (migration: `files_changed JSONB NULL`). |
| FOCUS-68 | Tokens, $, duration, billing route | **PARTIAL** | `cost.{prompt_tokens,completion_tokens,cost_usd}`, `started_at`/`ended_at` **EXIST**. Billing route: not exposed. Derivable from `desktop_node_jobs.invocation_id` (subscription + `provider`) else API key; the actual model is `cost_records.model_used` (fallback may swap). **Proposal:** `runs_on` + `model_used` in B. |
| FOCUS-71…73, DOCS-3, 5, 14, 15, 20 | Run document list with latest version, writer, readers | **PARTIAL** | `GET /api/runs/{run_id}/documents` → `documents[].{id,title,doc_type,name,created_at,updated_at}` only. Missing: latest `version_no` / time / author, "is shared spec", writer, readers. **Bug:** `Document.updated_at` never changes (`add_version` inserts only a `DocumentVersion`; `onupdate` never fires), so "updated" times are wrong. **Proposal (additive):** each item gains `"is_shared_spec": id==run.pm_document_id`, `"version_count"`, `"latest_version":{"version_no","created_at","author":{…}}`, `"written_by":[{"node_id","clone_node_id","role_name"}]`, `"read_by":[{"node_id","role_name"}]`. The response gains `"run":{"run_id","idea","status","created_at","live"}`. Logic: `documents/service.py` `list_run_documents_with_usage(run_id)`. Writers = the root node for the spec (`_team_root_node_id`) plus nodes whose `config.writes_to == name`. Readers = agent nodes whose `reads_from` contains the name, or (for the spec) whose `reads_from` is empty. Also bump `documents.updated_at` in `add_version` / `find_or_create_run_document`. |
| DOCS-1, 2, 13 | Team run list for "Change" | **PARTIAL** | `GET /api/teams/{team_id}/runs` → `runs[].{run_id,status,idea,created_at,cost_total_usd}` covers DOCS-13. "3 rounds" / the node's own outcome per run needs FOCUS proposal B. |
| DOCS-4 | Writes / entry status for this node | **EXISTS** | Client: `config.writes_to`, start node = no incoming edge (App `startNodeId`), verdict branches = `edges[].conditions.when` from the node. |
| DOCS-10 | Document count + which run | **EXISTS** | `GET /api/teams/{team_id}/runs`[0] (or `TeamSummary.last_run.run_id`), then `GET /api/runs/{run_id}/documents` (`documents.length`). |
| DOCS-18…23 | Document + versions + author labels + change notes | **PARTIAL** | `GET /api/documents/{id}` → `{id,title,doc_type,name,created_at,updated_at,versions[{id,version_no,content,created_by,created_at}]}`. `created_by` is a raw token: `"agent:entry"`, `"agent:{clone_node_id}"`, `"human"`. Missing: an author label ("Product manager" / "You"), a change note ("First draft", "Updated acceptance after review"), and the document's run. **Security gap:** `GET /api/documents`, `GET /api/documents/{id}` and `POST …/versions` have **no owner check** (any signed-in user can read and write any document by id; `GET /api/documents` lists everyone's). **Proposal:** a `_require_owned_document(session, doc_id, owner)` guard (doc → `run_id` → `Run.owner_id`, or `Run.pm_document_id == doc.id` for legacy) → 404. Make `GET /api/documents` owner-scoped (or remove it; the FE doesn't use it). Each version gains `"author":{"kind":"agent\|human","node_id","role_name","label"}` and `"note"`. The document gains `"run_id"`, `"is_shared_spec"`, `"editable"`. **Migration (0041+):** `document_versions.note TEXT NULL`, `document_versions.author_node_id UUID NULL`. Writers fill them: `record_entry_spec_step` → "First draft" / "Revised in round {n}"; `write_named_document_step` → "Round {n}"; human → "Edited while the run was live". When NULL, derive the note at read time from `idempotency_key`. |
| DOCS-19 | Copy as Markdown | **EXISTS** | `versions[].content` is the markdown. |
| DOCS-26 | Editable gating | **PARTIAL** | Run status: `GET /api/runs/{run_id}` (`run.status`, `workflow_status`); client `isPrdEditable`. The server does **not** enforce it: `POST /api/documents/{id}/versions` accepts edits on finished runs and on any document. **Proposal:** 409 `{"detail":{"code":"run_finished"}}` when the run is terminal. Keep accepting named documents of live runs (the executor re-reads them too); the UI limits Edit to the spec (OQ-7). |
| DOCS-29, 30 | Save a live edit; stale-version conflict | **PARTIAL** | `POST /api/documents/{id}/versions {content}` → `{document_id,version_no,content,created_at}` (no `id` / `created_by` / `author`). No concurrency check: if an agent appends v4 meanwhile, the human save silently becomes v5 on top. **Proposal:** body `{"content","base_version_no"?: int,"note"?: str}` → 409 `{"detail":{"code":"stale_version","latest_version_no":4,"latest_author":{…}}}` when `base_version_no != max`, plus owner 404 and `run_finished` 409. The response is the full version dict (incl. `id`, `author`, `note`). Logic: `documents/service.add_version(…, expected_base=…)` inside the same transaction as the `max(version_no)` read. |
| DOCS-27 | What the run does with the edit | **EXISTS** | A new `DocumentVersion(created_by="human")`. At every agent entry the executor re-reads the latest version: `read_latest_prd_step` for default readers, `read_named_documents_step` for `reads_from`. Both are recorded DBOS steps, so replay-stable. The agent working when you save does **not** see the edit (its instruction was compiled at its start); the next agent to start — or the same agent's next rework round — does. At a PRD approval gate (`awaiting_human`), the edit reaches the Engineer after approval. A later entry-agent refine reads the human version, then appends its own. Subscription (Desktop) jobs get the same server-compiled instruction (`DesktopNodeJob.instruction`). Nothing is pushed to running agents. |
| DOCS-33…36 | Diff two versions | **EXISTS (data)** | There is no server diff endpoint, and none is needed: `GET /api/documents/{id}` returns every version's full `content`, and the diff runs client-side. |

---

## 4. Desktop bridge gaps

None of these screens **require** a new `window.tvashtrDesktop` method:
- **Copy as Markdown** can use `navigator.clipboard.writeText`. Desktop serves the app from a local
  `http://127.0.0.1` origin, which counts as secure. On the website, fly.dev is https.
- **⌘S**: Electron sets no application `Menu`, and the default menu binds nothing to ⌘S, so a
  renderer key handler is enough.
- **"Open this run on the canvas"** and **"Open Memory in Toolkit →"** are in-app navigation.
- **Live edits** are compiled server-side at agent start, including for subscription jobs, so the
  Desktop runner needs no change.

Optional, only if clipboard access is ever blocked in the sandboxed renderer:
- `window.tvashtrDesktop.clipboard.writeText(text: string): Promise<void>`: preload
  `ipcRenderer.invoke("tvashtr:clipboard:write", text)`, main `clipboard.writeText(text)`. Declare
  it in `frontend/src/vite-env.d.ts` as an optional member.

Desktop-vs-website differences in this area:
- App header: "Tvashtr Desktop" pill + macOS title strip vs "tvashtr.fly.dev".
- Model coverage line: a subscription line on Desktop vs "Uses your xAI API key" on the website
  (OQ-3).
- Runs cost line: "$0.00 · Grok subscription" appears only for Desktop-launched runs whose job ran
  on the runner; website runs always say "{provider} API key".
- Shortcut label: "⌘S" on macOS vs "Ctrl S" on Windows/Linux (Desktop can run on either).
- "Follow the repo’s rules files" reads "When working on a real folder": a local folder on Desktop,
  a cloned GitHub repo on the website (the server applies `project_rules` in both).

---

## 5. Frontend mapping

**Built today:**
- `panel/DrawerShell.tsx` has the drawer ⇄ modal chrome: `panelMode: "drawer" | "modal"`, the
  "Open as a pop-up"/"Dock to the side" toggle, a scrim, and focus trap + Escape via
  `useModalDialog`.
- `panel/TeamNodePanel.tsx` (1378 lines) is one long, untabbed form. It owns all draft state, the
  field-by-field dirty check, the PATCH (`updateTeamNode`), gate/terminal/domain_query branches,
  inline add-provider, the model hints, `SkillsSection`, `ToolsSection` and `NodeMemorySection`,
  and a "Last run" block (`LastRun`, latest round only).
- `panel/SidePanel.tsx` has the run-view drawer. Its `PrdDocuments` is a chip picker over
  `getRunDocuments`, and it renders `PrdView`.
- `panel/PrdView.tsx` holds the version chips, a plain-text read view (`tv-prd__content`, **not**
  rendered markdown) and a TipTap editor (`PrdEditor`, dirty-aware "Save new version") for the
  latest version when `isPrdEditable`.
- `lib/prdEditor.ts` has the shared TipTap + tiptap-markdown config and round-trip helpers.
- `panel/RunDiff.tsx` has `DiffPatch` (a colored unified-diff renderer).
- `panel/ContextManifest.tsx` has the per-round token table.
- `components/LastRun.tsx` renders the round list and cost line.
- `panel/EventFeed.tsx`, `NodeChat.tsx` and `RunMemory.tsx` are run-view tabs.
- `App.tsx` has the toolbar and `panelMode` state, and switches between authoring and run view on
  `runId`.

**Keep / reuse:**
- `useModalDialog`: needs a dialog stack (see below).
- `prdEditor.ts`: unchanged; add toolbar commands `toggleHeading({level:1|2})`, `toggleBold`,
  `toggleItalic`, `toggleBulletList`, `toggleCode`/`toggleCodeBlock`, all in StarterKit.
- `PrdEditor`'s baseline/dirty logic.
- `DiffPatch` line styling.
- `SkillsSection`/`ToolsSection` data helpers (`enabledOf`, `domainsOf`, source labels,
  project_rules toggle).
- `NodeMemorySection` + `MemoryFact` (fact row, pin/edit/delete, confirm/discard).
- `LastRun` outcome labels.
- `lib/topology.emitContract`, `lib/engines.credentialTreatment` / `subscriptionCoverLabel`,
  `lib/status.isPrdEditable` / `isRunTerminal`, `lib/time.formatRelativeTime`.

**Rebuild:**
- **`TeamNodePanel` → a node-editor controller plus tab views.** Pull the draft state and dirty
  logic into a hook such as `useNodeDraft(node)`. It should return `{draft, set(field), changes:
  FieldChange[], discard(), undo(field), save()}`, and both the drawer and the focus layout share
  it, so docking keeps the draft. The per-field `changes` list feeds the "Changed" dots, "N unsaved
  changes" and Review changes.
- **Tab views:** `SetupTab` (Instructions + SettingsColumn), `SkillsToolsTab` (list + detail
  layout), `MemoryTab` (filter rail + grouped lists), `RunsTab`, `DocsTab`. Gate, terminal and
  domain_query nodes keep a single-body layout with no tabs.
- **`DrawerShell`:** add a `"focus"` mode (1240 px dialog), status/capability/model badges, a ⋯
  menu slot, a tabs slot and a sticky footer slot. Rename the "Open as a pop-up" affordance to
  "Focus mode".
- **`PrdView`:** split it into `DocumentViewer` (three panes: `DocRail`, `DocBody`, `VersionList` +
  `WhoUsesIt`). Replace the plain-text view with TipTap `editable:false` so viewing and editing
  render identically. `DocEditor` = PrdEditor + toolbar + footer "saves as v{n}".
- **`SidePanel.PrdDocuments`:** replace with the shared `DocumentsDrawer` + `DocumentViewer`. The
  run view should also get the toolbar "Documents" button.

**New components:**
- `InstructionsEditor`: a textarea with a synced line-number gutter, current-line overlay, caret →
  "Line/column" and a chars/tokens counter. There is no code-editor dependency today; keep it a
  textarea.
- `ReviewChangesView`, `FieldDiff` (a line diff; reuse `DiffPatch` styles).
- `TemplatesDialog`, `AgentPreviewView`.
- `RunRoundsRail`, `RoundDetail` ("What it was given / produced / Cost").
- `RunPickerMenu`: shared by Docs "Change", the Documents drawer and the Runs rail.
- `DocumentCard`: the Shared card / "Written by agents" card.
- `DocumentsDrawer` (360 px aside), `CanvasDocChip` (TeamCanvas overlay on the writer's out-edge).
- `CompareView`: a block/line diff over markdown lines, rendered through the same markdown
  renderer.
- `useSaveShortcut` (⌘S/Ctrl+S with preventDefault).
- New `lib/api.ts` clients: `getNodeTemplates`, `previewNodeContext`, `getNodeRuns`, the enriched
  `DocumentMeta` / `DocumentVersion` (author, note), and `addDocumentVersion(id, content,
  {baseVersionNo, note})` with 409 handling via `ApiError`.

**Dependencies:** there is no diff library. Either add `diff` (jsdiff) to `package.json` or write a
small LCS line diff in `lib/diff.ts`, used by Review changes, Compare and the "+x −y" counters.
Markdown rendering reuses TipTap (already a dependency). Compare can render per-line markdown
through the same `Editor` in read-only mode, or a `markdown-it` instance (a transitive dependency
of tiptap-markdown; add it explicitly if imported).

**Shared primitives the designs reuse:**
- Line `Tabs` with counts.
- `Badge`: neutral / outline / accent / info / success / warning / danger, with an optional dot.
- `Switch`; `IconButton` (sm, outline, `active`); `Button` (primary / secondary / ghost / tint,
  size sm); segmented control (`tv-seg`, exists).
- ⋯ `role=menu` popover; "Changed" dot; sticky save footer; dark `role=status` toast ("Reviewer
  template applied", "Copied as Markdown").
- `role=alertdialog` confirm (delete agent, replace instructions, unsaved changes).
- Right-side sheet (360/384 px) and centered dialogs (1240/860 px).
- Relative-time labels; inline-code rendering in plain text (backticks → `<code>`).

`frontend/src/design-system/` holds only CSS tokens; there are no React DS components yet, so
these primitives must be built (or promoted from `tv-*` classes).

**Dialog stacking:** `useModalDialog` attaches a **document-level** keydown listener for each active
dialog. With the Templates dialog open over the focus view, both handlers fire, so Escape closes
both and the two focus traps fight. Add a module-level dialog stack so only the top-most dialog
handles Escape/Tab.

---

## 6. Open questions / ambiguities

- **OQ-1: "above your instructions" is wrong for the backend.** `compile_context` sends the
  instructions first, then remembered lessons, the idea, the spec (or Reads documents), the rework
  note, the report-only note and the remember protocol. Skills go separately as agent context.
  *Recommend:* change the copy to "Added at run time, after your instructions: the idea + the
  latest spec". Order the Preview sections the way the compiler does (Instructions → Lessons → Idea
  → Spec/Reads → [Rework note] → [Report-only note]), with Skills as a separate "Given as context"
  block. Reordering the compiler would break its golden test and C4 prefix caching.
- **OQ-2: The Preview shows 4 parts; the agent gets more.** A read-only agent also receives the
  REPORT-ONLY note; lessons are injected; Reads replace the spec; rework rounds add feedback;
  brownfield runs add a repo map. *Recommend:* use the server preview (FOCUS-40 proposal). Show every
  part, collapse the less important ones, and show a total token count vs budget.
- **OQ-3: Focus-SetupWeb shows "Your Grok subscription · runs on this computer" on the website.**
  Hosted runs always use API keys (`credentialTreatment` → "byok"; the server pre-flight ignores
  subscriptions unless `desktop_target`). *Recommend:* use `Web-Setup` copy "Uses your xAI API
  key", or the Panel-ModelWeb "No key yet …" state.
- **OQ-4: How do you reach "Review N changes"?** "2 unsaved changes" is a plain span in the design,
  and Save stays in the footer on the review screen. *Recommend:* make "N unsaved changes" a link
  button that opens the review; "Save ⌘S" saves directly from anywhere.
- **OQ-5: Templates — "your team’s template library" and what they replace.** Only four
  code-resident presets exist. In Flow-Templates-3 the Model also shows "Changed" after applying.
  *Recommend:* v1 serves the four code-resident templates, and applying one replaces **only** the
  instructions. The Model dot in that frame is an earlier edit. Account-saved templates come later
  (the skill-library pattern).
- **OQ-6: "Remove spec" can't mean "reads nothing" today** (`reads_from: []` = default).
  *Recommend:* the null-vs-empty semantics in the FOCUS-24 row.
- **OQ-7: Which documents can be edited live?** The design says only the shared spec. The backend
  accepts any document and re-reads named documents at the next agent start. *Recommend:* show
  "Edit" only for the shared spec in v1; the server stays permissive for live runs.
- **OQ-8: Docs-Viewer shows "Edit" while the canvas shows all agents "Waiting"** (the run may not be
  live). *Recommend:* show Edit only when the run is live. Otherwise hide it and show "This run has
  finished — start a new run to use a changed spec" in its place.
- **OQ-9: "Save as v4" when an agent writes v4 first.** *Recommend:* the `base_version_no` → 409
  flow (DOCS-30), and update the label live ("saves as v{latest+1}").
- **OQ-10: What "next step" means.** The agent that is working at save time never sees the edit.
  *Recommend:* keep the banner, and add the tooltip "The agent working now finishes with the old
  version; the next agent to start gets yours."
- **OQ-11: Compare pair selection** isn't shown. *Recommend:* DOCS-36 (selected = to, click another
  = from, default = previous). Compare is disabled on v1.
- **OQ-12: The reader count doesn't match the reader badges.** The count says "read by all 3
  agents", but the "Read by" badges list only Engineer + Reviewer. *Recommend:* count every agent
  that gets the document in context (the entry agent re-reads the spec on refine rounds), and list
  the writer under "Written by" only.
- **OQ-13: The sample data disagrees with itself.** The Reviewer's Setup › Reads shows only "spec",
  but its Docs tab says it reads build-notes. *Recommend:* derive both from the same `reads_from`.
  Nothing to design.
- **OQ-14: Writes on an agent with verdict branches.** The executor ignores `writes_to` there and
  logs a RunWarning. *Recommend:* disable "Choose" with the hint "Agents that route on a verdict
  report through Runs, not a document", and add the validity warning.
- **OQ-15: Runs → "Earlier runs" shows "Round —".** *Recommend:* one collapsed row per earlier run
  (the agent's final outcome + date). Clicking it expands that run's rounds in the rail and updates
  the rail header 'Run “{idea}”'.
- **OQ-16: Focus Docs tab vs drawer Docs tab.** The focus tab has no "Change" run picker. *Recommend:*
  make the rail footer 'Run “…” · 31m ago' the run picker (the same `RunPickerMenu`).
- **OQ-17: The "Skills & tools 4" count** doesn't match the 3 skills + 2 tools on screen.
  *Recommend:* count = skills + enabled tools (here 5), or show no count; the design value is
  sample data.
- **OQ-18: Memory's "Not repo-specific" group under "This agent"** needs node notes without a repo,
  which the backend forbids today. *Recommend:* the memory analyst's decision; the FOCUS-58 row
  proposes a node-only tier.
- **OQ-19: The footer on the Memory tab when Setup is dirty.** The design shows only "Memory changes
  save right away". *Recommend:* while Setup/Skills are dirty, the dirty footer (count + Save) shows
  on every tab, including Memory, and the memory hint moves into the Memory tab body.
- **OQ-20: Documents drawer vs node drawer.** Both dock on the right. *Recommend:* they are
  mutually exclusive, and the Document viewer / focus view open as dialogs above either.
- **OQ-21: Where the canvas doc chips go** (the design has absolute positions only). *Recommend:*
  anchor each chip at the midpoint of the writer's first outgoing edge. Hide chips when the team has
  no run, or when the toolbar Documents toggle is off.
- **OQ-22: Change notes like "Updated acceptance after review"** read like model-written summaries.
  *Recommend:* deterministic server notes ("First draft", "Revised in round {n}", "Round {n}",
  "Edited while the run was live"), with no extra LLM calls. An LLM summary could come later.
