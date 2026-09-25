# Toolkit: Skills and Memory, gap analysis

Area: `toolkit-skills-memory` (prefixes `SKILL-`, `MEM-`). Analysis only. Nothing in the repo was changed.

Screens covered: Toolkit-Skills, Toolkit-SkillPresets, Toolkit-SkillEditor, Toolkit-SkillFromRepo, Toolkit-MemoryInbox, Toolkit-MemoryActive, Toolkit-AddMemory, and flows TkF-SkillTabs, NewSkill, SkillSource, Presets, SkillMenu, FromRepo, SkillsEmpty, Review, Inbox, Filters, NoteActions, Archive, AddMemory, MemoryEmpty.

Design data read from the raw HTML (`project/*.dc.html`), because the outlines leave it out:
- `skillTabs = [{mine,"Your skills",count}, {presets,"Presets"}]`
- `memTabs = [{inbox,"Inbox",count}, {active,"Active",count}, {archive,"Archive"}]`. Archive has no count.
- `editTabs = Edit | Preview`
- `forces = [{require,MUST},{prefer,SHOULD},{allow,MAY},{context,CONTEXT},{avoid,SHOULD NOT},{forbid,MUST NOT}]`. These match the backend polarity values exactly.
- `scopes = ['All scopes','Account','Repo','Agent']`
- `forceFilter = ['Any force', …6 labels]`
- `repos = ['All repos', 'lazyxgenius/trade_mcp', …]`

The left nav is not a tab strip. "Toolkit" is an expandable group whose sub-items are Tools 3 / Skills 3 / Memory "2 new" / Secrets "1 missing", each with a pill badge. Under the list is a note: "Toolkit holds what any team’s agents can use. Switch things on per agent in its **Skills & tools** tab."

---

## 1. Screens

**Toolkit-Skills (Your skills tab).** Page title "Skills" with the subtitle "Reusable know-how. Write a skill once, or pull skills from a GitHub repo, then add them to any agent." The header has two buttons: "Add from GitHub" (secondary) and "New skill" (primary). Below are pill tabs "Your skills 3 | Presets", then a "Search skills" input. The table has columns Skill / Loads by default / Used by / Updated / ⋯:
- The Skill cell shows the name plus a source badge: "Written here" (neutral) or "org/skills @ main" (outline).
- The load column shows "Always on", "Agent decides", or "When triggered" followed by the trigger words (e.g. "auth, secrets").
- Used by shows "2 agents · 1 team", "1 agent · 1 team", or "Not used yet".
- Updated shows "Sep 23" or "Just now".

Rows are sorted by name (NewSkill-5 inserts "api-conventions" at the top). The screen is the same on Desktop and the website.

**TkF-SkillTabs-1→2 / Toolkit-SkillPresets.** Clicking "Presets" hides "Add from GitHub" and the search box. Each preset is a card: title, green "Free" badge, one-line description, "Add" (primary) or a disabled "In your skills" (secondary), and "Preview" (ghost). The three presets are Caveman (terse), TDD discipline and YAGNI, the same ones the backend ships.

**TkF-Presets-1→2.** "Preview" on YAGNI opens a centered dialog (w640, `role=dialog`, aria-label "YAGNI preset") with the title, a "Free preset" badge, the SKILL.md markdown, "Close", and "Add to your skills". Adding closes the dialog, the card button becomes "In your skills" (disabled), and a dark toast says "YAGNI added to your skills."

**TkF-NewSkill-1→5 (New skill).** A full page with the breadcrumb "Skills › New skill". The name input (w360, placeholder "name (e.g. house-style)") sits next to "Cancel" and "Save skill". Save is disabled while the name and content are empty and enabled once both are filled.

The page has two columns:
- **Left: SKILL.md card.** It has Edit/Preview pill tabs. Edit is a line-numbered monospace editor (placeholder "SKILL.md content…", about 300px tall). Preview renders the markdown (h1 plus bullets).
- **Right column (340px).** "Loads by default" is a segmented control (Always on | When triggered | Agent decides; default Always on) with helper text "The full skill goes into every prompt." Choosing "When triggered" changes the helper to "Loads only when the conversation mentions a trigger word." and shows a "Trigger words" input (helper "Separate with commas."). "Source" is a second segmented control: Written here | GitHub repo.

After "Save skill" the user is back on the list. The new row shows "When triggered endpoint, route" (only the first two of three trigger words), "Not used yet", and "Just now". A toast says "api-conventions saved. Add it to agents from their Skills & tools tab." with a "Choose agents" action.

**TkF-SkillSource-1.** Switching Source to "GitHub repo" replaces the SKILL.md card with a "From a GitHub repo" card:
- Repository (placeholder `https://github.com/org/skills`)
- Version (optional; helper "A branch, tag or commit. Pinning keeps runs repeatable."; default "main")
- Only these skills (optional; helper "Leave empty to add every skill in the repo."; placeholder "review-*, pytest-*")

The load-mode control stays visible.

**Toolkit-SkillEditor (existing skill).** Breadcrumb "Skills › house-style", the name as a code-font title, and "Discard" (ghost) plus "Save changes" (primary). The layout matches New skill, but the load-mode helper reads "Each agent can change this in its own Skills & tools tab." A third section, "Used by", lists one badge per agent: "Reviewer · Indicator sprint team", "Engineer · Indicator sprint team".

**TkF-SkillMenu-1→3.** The ⋯ button (aria-label "More actions for house-style") opens a `role=menu` (w240) with Edit, Duplicate, Turn on for agents…, and Delete skill. "Delete skill" opens an `alertdialog` (w500): "Delete house-style? Reviewer and Engineer in Indicator sprint team use it. They lose it on their next run. You can’t undo this." with Cancel (ghost) and "Delete skill" (secondary). Confirming shows the toast "house-style deleted." with no undo.

**TkF-FromRepo-1→3 / Toolkit-SkillFromRepo.** "Add from GitHub" opens a right-side dialog (aside w540 over a scrim, aria-label "Add skills from GitHub"). The header reads "Add skills from GitHub" / "Pull SKILL.md files from a repo" with a Close button.
- **Step 1.** Repository and Version fields, Cancel, and "Find skills". A typo (`…/skils`) puts an error on the Repository field: "We couldn’t find that repo. Check the name, or install the GitHub App on it if it’s private."
- **Step 2.** The Version field gains its helper, an "Only these skills" field appears, and a summary reads "Found 4 skills at main @ 1a2b3c4". Below is a checkbox list with every skill checked (pytest-review, house-style-py, api-conventions, commit-messages), the footnote "Skills update when you change the version.", Cancel, and "Add 4 skills".
- **Step 3.** The drawer closes. New rows show the badge "lazyxgenius/skills @ main", "Agent decides", "Not used yet", and "Just now". The toast says "4 skills added from lazyxgenius/skills."

**TkF-SkillsEmpty-1/2.** A search with no matches shows "No skills match “docker”" / "Try another word, or write it as a new skill." with "Clear search" and "New skill". An empty library shows "No skills yet" / "Skills teach agents your team’s way of doing things. Start from a free preset, pull from GitHub, or write your own." with "Browse presets" and "New skill".

**Toolkit-MemoryInbox / TkF-Review-1→2.** Page title "Memory", subtitle "What your agents learned across runs. Keep what’s useful, pin what matters, and remove what’s wrong.", and an "Add memory" button (primary).

Only on the Inbox tab there is a switch row: "Review new memories before they apply". When on, it reads "On: every new memory waits in the Inbox until you keep it." Turning it off changes the copy to "Off: new memories apply right away. Cautions from failed runs still wait here." and shows the toast "New memories now apply right away." with Undo.

Then come the pill tabs Inbox 2 / Active 14 / Archive. Each Inbox item has:
- a force badge
- the text
- a scope chip with an icon: "Reviewer · Indicator sprint team" (agent, clipboard icon) or "lazyxgenius/trade_mcp" (repo, GitHub icon)
- a provenance line: "From run “Add an RSI indicator” · round 3 · 31m ago" or "From a failed run · Sep 23 · a caution"
- the buttons Keep (primary), Edit, Discard

**TkF-Inbox-1→4.**
- Keep removes the item. Toast: "Kept. Reviewer uses it from the next run." with Undo.
- Edit turns the row into an inline editor: textarea (aria "Memory text", 3 rows), a Force select (value `forbid` = MUST NOT), a Scope select (value "Repo"), Cancel, Save.
- Discard clears the Inbox. Toast: "Discarded. You’ll find it in Archive." with Undo. The empty state reads "Inbox is clear" / "New memories from your runs show up here for you to keep or discard." with a "See Active" button. The nav badge drops from "Memory 2 new" to "Memory".

**Toolkit-MemoryActive / TkF-Filters-1→5.** A filter bar holds "Search memory" (w240), a Repo select (All repos / lazyxgenius/trade_mcp / lazyxgenius/cryptoground-mcp), a Scope select (All scopes / Account / Repo / Agent), and a Force select (Any force / MUST / SHOULD / MAY / CONTEXT / SHOULD NOT / MUST NOT).
- Each row has a force badge, text, scope chip ("lazyxgenius/trade_mcp", "Reviewer", or "Account · all repos"), and meta ("Confirmed 3× · pinned", "Confirmed 1× · Sep 24", "Added by you · Sep 20").
- Icon buttons: Pin/Unpin (a toggle with an active state), Edit, Delete.
- Filtering to SHOULD shows "1 of 14" and a "Clear filters" link.
- A search with no results shows "Nothing matches “docker”" / "Try another word, or clear the filters." with "Clear filters" and "Add memory".

**TkF-NoteActions-1→4.**
- Pinning the CONTEXT note moves it up under the other pinned note. Its meta becomes "Added by you · pinned". Toast: "Pinned. Pinned notes go to the agent first." with Undo.
- Edit opens the same inline editor (Force `prefer`, Scope "Agent").
- Saving changes the meta to "Edited by you · just now". Toast: "Saved. Agents see the new text on their next run."
- Delete opens an alertdialog: "Delete this memory? “The team ships to a Fly.io preview before the human merge gate.” Agents stop seeing it on their next run. You can’t undo this." with Cancel and "Delete memory".

**TkF-Archive-1→2.** Intro text: "Memories that were replaced or discarded. Agents don’t see these. You can restore a discarded one." There are two kinds of row:
- "… Replaced by a newer memory · Sep 22" with a "Superseded" badge (neutral) and no action.
- "… Discarded by you · Sep 21" with a "Discarded" badge (outline) and "Restore".

Restore shows the toast "Restored to Active." with an "Open Active" action.

**Toolkit-AddMemory / TkF-AddMemory-1→3.** A right-side dialog (w560, aria "Add memory"): "Add memory" / "A fact or rule your agents should keep in mind".
- A textarea labelled "What should agents remember?". Submitting it empty shows the error "Write the memory first."
- "Applies to": Every repo | One repo, plus a Repo select (defaults to `lazyxgenius/trade_mcp`).
- "How strongly": six radios with badge and description (MUST "Always do this." … MUST NOT "Never do this."), MUST selected by default.
- Footnote "Memories you add apply right away.", then Cancel and "Add memory".

The added memory lands second in Active, right after the pinned row. Toast: "Added. It applies to lazyxgenius/trade_mcp right away."

**TkF-MemoryEmpty-1.** On the Active tab with no memories: "Your agents haven’t learned anything yet" / "As agents run, useful facts about your repos show up in the Inbox. You can also add your own." with "Add memory". The nav badge reads just "Memory".

**Desktop vs website.** Every screen is identical in both shells, because the same SPA talks to the same hosted backend. Desktop proxies `/api` to tvashtr.fly.dev (`desktop/electron/main.cjs:252`). Behaviour differs underneath:
- Skills never reach Desktop subscription nodes (see SKILL-48).
- Learned memory needs an OpenAI BYOK key, which a subscription-only Desktop user often lacks (see MEM-37/38).
- Links to github.com must open in the OS browser on Desktop (see §4).

---

## 2. Behaviour requirements

### Skills
- **SKILL-1** Left nav: a "Skills" sub-item in the Toolkit group with a count badge equal to the number of library skills. It is `aria-current="page"` on the list, the Presets tab, New skill, and the editor.
- **SKILL-2** Page header: h1 "Skills" and the subtitle "Reusable know-how. Write a skill once, or pull skills from a GitHub repo, then add them to any agent."
- **SKILL-3** Header actions: "Add from GitHub" (secondary) only on the Your skills tab; "New skill" (primary) on both tabs.
- **SKILL-4** Pill tabs "Your skills" (with count) and "Presets".
- **SKILL-5** Search input with placeholder "Search skills" (w240), Your skills tab only. It filters rows client-side by name, case-insensitive.
- **SKILL-6** Table headers: Skill, Loads by default, Used by, Updated, and an unlabelled actions column.
- **SKILL-7** Skill cell: the name plus a source badge. Inline source shows "Written here" (neutral). Repo source shows "<owner>/<repo> @ <ref>" (outline), parsed from the URL.
- **SKILL-8** Loads-by-default cell: "Always on", "Agent decides", or "When triggered" followed by the first two trigger words in muted text, comma-separated.
- **SKILL-9** Used-by cell: "N agent(s) · M team(s)", pluralised, or "Not used yet".
- **SKILL-10** Updated cell: "Just now" if under a minute, otherwise a short date ("Sep 23").
- **SKILL-11** Rows sorted alphabetically by name.
- **SKILL-12** Row ⋯ IconButton with aria-label "More actions for <name>". It opens a `role=menu` with Edit, Duplicate, Turn on for agents…, and Delete skill. The menu is keyboard navigable and closes on Escape or an outside click.
- **SKILL-13** Clicking a row or menu → Edit opens the skill editor.
- **SKILL-14** No search results: title "No skills match “<query>”", body "Try another word, or write it as a new skill.", buttons "Clear search" (secondary; empties the input) and "New skill" (primary).
- **SKILL-15** Empty library: title "No skills yet", body "Skills teach agents your team’s way of doing things. Start from a free preset, pull from GitHub, or write your own.", buttons "Browse presets" (switches to the Presets tab) and "New skill".
- **SKILL-16** Loading state (skeleton rows) and load-error state for the list. Neither is designed.
- **SKILL-17** Presets tab: one card per preset with title, "Free" badge (success), description, action button, and "Preview" (ghost). The action is "Add" (primary) or a disabled "In your skills" (secondary) when the preset is already in the library.
- **SKILL-18** Preset preview dialog (w640, `role=dialog`, aria-label "<Title> preset"): title, "Free preset" badge, the SKILL.md rendered as markdown, "Close" (ghost), and "Add to your skills" (primary, hidden or disabled when already added). It closes on Escape and traps focus.
- **SKILL-19** Add preset creates a library skill. The card flips to "In your skills", the counts go up by one, and the toast says "<Title> added to your skills."
- **SKILL-20** Preset descriptions use the design copy: "Ultra-compressed output style that keeps technical substance.", "Red → green → refactor. Smallest code that makes the failing test pass.", "Smallest change that solves the asked problem, no speculative extras."
- **SKILL-21** New skill page: breadcrumb link "Skills" › "New skill"; name input (aria-label "Skill name", placeholder "name (e.g. house-style)", w360); "Cancel" (ghost) and "Save skill" (primary).
- **SKILL-22** "Save skill" is disabled until the name is filled and either the SKILL.md content (Written here) or a Repository (GitHub repo) is filled.
- **SKILL-23** SKILL.md card: the label "SKILL.md", Edit/Preview pill tabs, and a monospace editor with a line-number gutter and the placeholder "SKILL.md content…".
- **SKILL-24** The Preview tab renders the markdown as headings and bullets.
- **SKILL-25** "Loads by default" segmented control (aria-label "Default load mode"): Always on / When triggered / Agent decides. New skills default to Always on.
- **SKILL-26** Mode helper text:
  - Always on: "The full skill goes into every prompt."
  - When triggered: "Loads only when the conversation mentions a trigger word."
  - Agent decides: not shown in these screens; the sibling screens use "Listed; the agent opens it when it needs it".
  - On an existing skill the helper is "Each agent can change this in its own Skills & tools tab."
- **SKILL-27** When triggered shows a "Trigger words" input (helper "Separate with commas."). It is split on commas, trimmed, and empty entries dropped.
- **SKILL-28** "Source" segmented control (aria-label "Source"): Written here / GitHub repo.
- **SKILL-29** Source = GitHub repo replaces the SKILL.md card with a "From a GitHub repo" card: Repository (placeholder "https://github.com/org/skills"), Version (optional, helper "A branch, tag or commit. Pinning keeps runs repeatable.", default "main"), and Only these skills (optional, helper "Leave empty to add every skill in the repo.", placeholder "review-*, pytest-*").
- **SKILL-30** Save skill persists the skill and returns to Your skills, where the new row shows "Just now" and "Not used yet". The toast says "<name> saved. Add it to agents from their Skills & tools tab." with a "Choose agents" action that opens SKILL-45 for that skill.
- **SKILL-31** Cancel returns to the list and drops the draft. A dirty-draft confirm is not designed.
- **SKILL-32** Existing-skill editor: breadcrumb "Skills › <name>", the name as a code-font title, "Discard" (ghost) and "Save changes" (primary). It has the same SKILL.md, Loads by default, and Source controls, pre-filled.
- **SKILL-33** Editor "Used by" section: one neutral badge per referencing agent, "<Role> · <Team>".
- **SKILL-34** Save changes persists the name, content, mode, triggers and source. Agents get the change on their next run, because references are live. A toast is not designed; proposed: "<name> saved. Agents use it from their next run."
- **SKILL-35** Discard reverts unsaved edits (or leaves the page).
- **SKILL-36** Skill name rules: required, unique per account, kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`, ≤64 characters, which the SDK enforces for SKILL.md). Error copy is not designed.
- **SKILL-37** Add-from-GitHub dialog shell: aside w540 over a scrim, `role=dialog`, aria-label "Add skills from GitHub", header "Add skills from GitHub" / "Pull SKILL.md files from a repo", and a Close IconButton. It traps focus and closes on Escape.
- **SKILL-38** Step 1: Repository input (URL), Version (optional, default "main"), "Cancel" (ghost), and "Find skills" (primary; busy state while scanning).
- **SKILL-39** Repo not found or not accessible: field error "We couldn’t find that repo. Check the name, or install the GitHub App on it if it’s private."
- **SKILL-40** Found state: the Version helper, the "Only these skills" input, the summary "Found N skills at <ref> @ <short-sha>", a checkbox per skill (all checked), the footnote "Skills update when you change the version.", "Cancel", and "Add N skills" with N = checked count (disabled at 0).
- **SKILL-41** "Only these skills" live-filters the found list with comma-separated globs. The count and the button label update with it.
- **SKILL-42** Add creates one library skill per checked skill, with badge "<owner>/<repo> @ <ref>" and load mode "Agent decides". The dialog closes and the toast says "N skills added from <owner>/<repo>."
- **SKILL-43** Busy and error states for Add (partial failure, name collision). Not designed.
- **SKILL-44** Menu → Duplicate creates a copy with a unique name (e.g. "house-style-copy"). The result UI is not designed; proposed: open the copy in the editor.
- **SKILL-45** Menu → "Turn on for agents…" (also the toast's "Choose agents") opens a picker of all agents, grouped by team, with checkboxes showing which already use the skill. Saving attaches or detaches the skill.
- **SKILL-46** Menu → Delete skill opens an alertdialog (w500) titled "Delete <name>?". When the skill is used, the body is "<Role> and <Role> in <Team> use it. They lose it on their next run. You can’t undo this.". Buttons: "Cancel" (ghost), "Delete skill" (secondary). The unused variant is not designed; proposed: "No agents use it. You can’t undo this."
- **SKILL-47** After delete the row disappears, the counts drop, and the toast says "<name> deleted." with no undo. Agents referencing the skill lose it; there must be no "(removed from library)" leftovers in their Skills tab.
- **SKILL-48** Runtime promise: a skill turned on for an agent reaches it on its next run in its load mode, whether the agent runs on the web (hosted OpenHands) or on Desktop (Claude or Grok subscription).

### Memory
- **MEM-1** Left nav: a "Memory" sub-item whose badge reads "N new" (N = memories awaiting review). There is no badge when N = 0.
- **MEM-2** Page header: h1 "Memory", subtitle "What your agents learned across runs. Keep what’s useful, pin what matters, and remove what’s wrong.", and an "Add memory" button (primary) on every tab.
- **MEM-3** Pill tabs: Inbox (count of pending), Active (count of active), Archive (no count).
- **MEM-4** Default tab: Inbox when N > 0, otherwise Active. The design implies this; it does not specify it.
- **MEM-5** Inbox tab only: a review switch row. Title "Review new memories before they apply". Copy when on: "On: every new memory waits in the Inbox until you keep it." Copy when off: "Off: new memories apply right away. Cautions from failed runs still wait here." The switch's aria-label is the title.
- **MEM-6** Switching off shows the toast "New memories now apply right away." with Undo. The switch-on toast is not designed; proposed: "New memories now wait in the Inbox." with Undo. The toggle is optimistic and rolls back on error.
- **MEM-7** Inbox item: force badge, text, scope chip, provenance line, and actions Keep (primary), Edit (ghost), Discard (ghost).
- **MEM-8** Force badge labels and variants: MUST=danger, SHOULD=warning, MAY=info, CONTEXT=neutral, SHOULD NOT=warning, MUST NOT=danger.
- **MEM-9** Scope chip:
  - agent: clipboard icon, "<Role> · <Team>" (the Active tab shows just "<Role>")
  - repo: GitHub icon, "<owner>/<repo>"
  - account: "Account · all repos"
- **MEM-10** Provenance for a memory learned in a run: "From run “<run title>” · round <N> · <relative time>".
- **MEM-11** Provenance for a caution from a failed run (negative force, non-success run): "From a failed run · <date> · a caution".
- **MEM-12** Keep promotes the memory. The item leaves the Inbox; the Inbox, Active and nav counts update. Toast: "Kept. <Role> uses it from the next run." with Undo, which puts it back in the Inbox.
- **MEM-13** Edit (Inbox and Active) switches the row to an inline editor: textarea (aria "Memory text", 3 rows), Force select (6 options), Scope select (Account / Repo / Agent), "Cancel" and "Save". Blank text cannot be saved.
- **MEM-14** Discard shows the toast "Discarded. You’ll find it in Archive." with Undo, which returns it to the Inbox.
- **MEM-15** Empty Inbox: title "Inbox is clear", body "New memories from your runs show up here for you to keep or discard.", button "See Active" (switches tab).
- **MEM-16** Active filter bar: "Search memory" input (w240); Repo select (w220; "All repos" + repos); Scope select ("All scopes", Account, Repo, Agent); Force select ("Any force", MUST, SHOULD, MAY, CONTEXT, SHOULD NOT, MUST NOT). The filters combine with AND.
- **MEM-17** When any filter is set, show "<shown> of <total>" and a "Clear filters" link.
- **MEM-18** Active row: force badge, text, scope chip, and meta "<provenance> · <pinned|date>". Provenance is "Confirmed N×" (learned), "Added by you" (manual), or "Edited by you" (after a user edit). The last part is "pinned" or a date / "just now".
- **MEM-19** Active sort order: pinned first, then newest first.
- **MEM-20** Pin/Unpin IconButton toggles with an active state and aria-label "Pin" or "Unpin". Pinning shows the toast "Pinned. Pinned notes go to the agent first." with Undo, and the row moves into the pinned group. The unpin toast is not designed.
- **MEM-21** Saving an edit shows the toast "Saved. Agents see the new text on their next run." and the meta becomes "Edited by you · just now".
- **MEM-22** Delete opens an alertdialog (w500): "Delete this memory?", the quoted content, "Agents stop seeing it on their next run. You can’t undo this.", then "Cancel" and "Delete memory" (secondary). The row is removed afterwards; the toast is not designed.
- **MEM-23** No results: title "Nothing matches “<query>”", body "Try another word, or clear the filters.", buttons "Clear filters" (secondary) and "Add memory" (primary).
- **MEM-24** No memories at all: title "Your agents haven’t learned anything yet", body "As agents run, useful facts about your repos show up in the Inbox. You can also add your own.", button "Add memory".
- **MEM-25** Archive intro: "Memories that were replaced or discarded. Agents don’t see these. You can restore a discarded one."
- **MEM-26** Archive rows:
  - superseded: "Replaced by a newer memory · <date>" and a "Superseded" badge (neutral), no action
  - rejected: "Discarded by you · <date>" and a "Discarded" badge (outline) plus "Restore" (ghost)
- **MEM-27** Restore shows the toast "Restored to Active." with an "Open Active" action that switches tab.
- **MEM-28** Add-memory dialog shell: aside w560, `role=dialog`, aria "Add memory", header "Add memory" / "A fact or rule your agents should keep in mind", Close button. Escape closes it and focus is trapped.
- **MEM-29** Textarea labelled "What should agents remember?" (3 rows).
- **MEM-30** "Applies to" segmented control: Every repo | One repo. One repo shows a Repo select (aria "Repo") with a sensible default.
- **MEM-31** "How strongly" radio group (name `force`, MUST selected by default):
  - MUST "Always do this."
  - SHOULD "Do this unless there’s a good reason."
  - MAY "Allowed, not required."
  - CONTEXT "A background fact, no instruction."
  - SHOULD NOT "Avoid unless there’s a good reason."
  - MUST NOT "Never do this."
- **MEM-32** Footnote "Memories you add apply right away." A manual add bypasses the Inbox even when review is on.
- **MEM-33** Submitting empty shows the field error "Write the memory first."
- **MEM-34** Add closes the dialog. The new row appears in Active (top of the unpinned group) and the toast says "Added. It applies to <repo> right away." The every-repo variant is not designed; proposed: "Added. It applies to every repo right away."
- **MEM-35** Cancel, Close and Escape discard the draft.
- **MEM-36** Error and busy states for every memory mutation (load failure, save failure, a 502 from the embedding call, a 404 race). Not designed.
- **MEM-37** Runtime promise: pinned memories are always injected, ahead of other memories ("Pinned notes go to the agent first.").
- **MEM-38** Runtime promise: runs teach memories that show up in the Inbox or Active and carry over to the next run on the same repo, on both the web and Desktop.

---

## 3. Backend gap table

| ID | Needs | Status | Where / proposal |
|---|---|---|---|
| SKILL-1 | Skill count on every Toolkit page (nav badge) | PARTIAL | Derivable from `GET /api/skill-library` → `skills.length` (routers.py:2162), but the nav needs it on every sub-page. Propose `GET /api/toolkit/summary` → `{"tools":int,"skills":int,"memory":{"inbox":int,"active":int,"archive":int},"secrets_missing":int}`, shared with the Tools/Secrets analyst. Skills: `SELECT count(*) FROM skill_library WHERE owner_id=?`. Memory: `SELECT status,count(*) FROM node_memories WHERE owner_id=? GROUP BY status`. Logic in `control_plane/node_library.py` + `memory.py`. |
| SKILL-4 | "Your skills" count | EXISTS | `GET /api/skill-library` → `skills[]` length. |
| SKILL-7 | Source type, repo URL, ref for the badge | EXISTS | `GET /api/skill-library` → `skills[].source.type`, `.url`, `.ref` (`_skill_library_to_dict`, routers.py:2102). The client parses owner/repo from the URL. |
| SKILL-8 | Default load mode + trigger words | PARTIAL | Inline: `source.mode` (`always`/`trigger`/`agent`) + `source.triggers` exist, and node_skills.py:167–193 honours them. **Repo sources have no mode**; the SDK's per-file behaviour applies. Proposal: extend the repo source to `{"type":"repo","url","ref","filter"?,"mode"?:"always"\|"trigger"\|"agent","triggers"?:[...]}`. In `node_skills._resolve_repo`, apply the override to each loaded Skill: always → `trigger=None, is_agentskills_format=False`; trigger → `KeywordTrigger(keywords)`; agent → `is_agentskills_format=True`. Validate in `SkillLibraryBody` (routers.py:2081). |
| SKILL-9 | "Used by N agents · M teams" | MISSING | Nothing counts library references. Refs live as `{"type":"library","id":…}` elements in `agent_nodes.skills` (JSONB). Add `node_library.skill_usage(owner_id) -> dict[skill_id, list[{node_id, role_name, team_id, team_name}]]`: one query `AgentNode ⨝ TeamGraph WHERE TeamGraph.owner_id=? AND TeamGraph.is_library AND AgentNode.skills IS NOT NULL`, parsing the JSON in Python (or `jsonb_array_elements`). Run-snapshot clones (`is_library=false`) are excluded. Extend `GET /api/skill-library` items with `"usage":{"agents":int,"teams":int}`. |
| SKILL-10 | "Updated" date | PARTIAL | `skill_library.updated_at` exists (models.py:999, migration 0023) but `_skill_library_to_dict` returns only `id,name,source,created_at`. Add `"updated_at": item["updated_at"].isoformat()` in `list_owner_skills` + serializer. |
| SKILL-17 | Preset list (title, description, badge, attachable) | EXISTS | `GET /api/skill-presets` (main.py:196) → `skills[].{key,name,title,description,badge,attachable,source}`. "In your skills" is derived client-side by name match, as SkillsShelf.tsx:292 does today. |
| SKILL-18 | Preset SKILL.md for Preview | EXISTS | `GET /api/skill-presets` → `skills[].source.content`. |
| SKILL-19 | Add preset | EXISTS | `POST /api/skill-library {name, source}` → `{id,name}`. Caveat: this is an upsert on name, so an existing user skill with the same name is overwritten silently (see SKILL-36). |
| SKILL-20 | Preset copy | PARTIAL | `tool_skill_catalog.py:85,97` say "Vendored ultra-compressed…" and "…asked problem — no speculative extras." Change them to the design strings. |
| SKILL-25/26/27 | Persist inline mode + triggers | EXISTS | `POST/PATCH /api/skill-library` with source `{"type":"inline","name","content","mode","triggers"?}`. Resolver: `node_skills._resolve_inline`. There is no server-side validation of mode/triggers yet (see SKILL-36 proposal). |
| SKILL-29 | Save a GitHub-repo skill (optional version, comma-separated glob filter) | PARTIAL | The source shape `{"type":"repo","url","ref","filter"}` exists, but: (a) there is no validation at save time, and a missing `ref` only fails at run time ("repo skill needs a ref", node_skills.py:207); (b) `filter` is ONE `fnmatch` pattern (node_skills.py:212), while the design wants a comma list like "review-*, pytest-*"; (c) there is no mode (SKILL-8). Proposal: validate `url` as `https://github.com/<o>/<r>`; default `ref` to the repo's `default_branch` (resolved via GitHub API, or "main"); in `_resolve_repo`, split the filter on commas and match any; add mode/triggers. |
| SKILL-30 | Create skill | EXISTS | `POST /api/skill-library` → `{id,name}`. Proposal: return the full serialized row (incl. `updated_at`, `usage`) so the list updates without a refetch. |
| SKILL-32 | Load an existing skill into the editor | EXISTS | Content, mode and triggers come from the list payload (`skills[].source`). Optionally add `GET /api/skill-library/{id}` → full row + `used_by` (see SKILL-33). |
| SKILL-33 | "Used by" badges "<Role> · <Team>" | MISSING | Add `GET /api/skill-library/{id}` → `{"id","name","source","created_at","updated_at","used_by":[{"node_id","role_name","team_id","team_name"}]}`, backed by `skill_usage()` (SKILL-9). |
| SKILL-34 | Save changes | PARTIAL | `PATCH /api/skill-library/{id}` exists (routers.py:2188). A rename to a name that already exists hits `uq_skill_library_owner_name` → an unhandled IntegrityError → **500**. Catch it in `update_owner_skill` → 409 `{"detail":"A skill named <name> already exists."}`. The FE must also keep `source.name` in sync with the row name for inline skills (the resolver names and dedups by `source.name`). |
| SKILL-36 | Unique, validated names | MISSING | `create_owner_skill` (node_library.py:167) **upserts** on `(owner,name)`, so "New skill" with an existing name silently replaces it. Proposal: `POST /api/skill-library?on_conflict=error` (default for the new UI) → 409; 422 unless the name matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is ≤64 characters; 422 unless inline `content.strip()` is non-empty, `mode ∈ {always,trigger,agent}`, and `mode=trigger` has ≥1 trigger. Keep `on_conflict=replace` for the preset path in `SkillsSection.tsx`. |
| SKILL-38/39/40/41 | Scan a GitHub repo for SKILL.md files at a ref, with resolved SHA | MISSING | Nothing exists server-side (SkillsShelf only stores a URL; the SDK's `load_public_skills` clones only at run time, inside the worker). New `POST /api/skill-library/scan`, body `{"url":"https://github.com/lazyxgenius/skills","ref":"main"?}`. Response 200: `{"repo":"lazyxgenius/skills","url":…,"ref":"main","sha":"1a2b3c4d…","short_sha":"1a2b3c4","skills":[{"name":"pytest-review","path":"skills/pytest-review/SKILL.md","description":str\|null,"in_library":bool}]}`. Errors: 404 `{"detail":"repo_not_found"}` (UI shows the design copy); 422 `{"detail":"ref_not_found"}`; 422 `{"detail":"no_skills"}`; 502 GitHub unreachable. Logic in a new openhands-free `control_plane/skill_repo.py` using `github_app._http`: parse owner/name; use the owner's installation token if `find_repo_in_installations(owner_installation_ids, full_name)` matches, otherwise call unauthenticated (public repos; watch the 60/h IP rate limit). Calls: `GET /repos/{o}/{r}` (404 → not found) → `GET /repos/{o}/{r}/commits/{ref}` (sha) → `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1` → keep paths matching `skills/*/SKILL.md` and `skills/*.md`, to mirror the SDK loader, which only reads `<repo>/skills/` (skill.py:1088) → fetch each file (cap about 50) for frontmatter `name`/`description`. The "Only these skills" filter is applied client-side to this list. |
| SKILL-42 | Add N skills from one repo, one row per skill | PARTIAL | This can be done as N× `POST /api/skill-library` with `{"type":"repo","url","ref","filter":"<exact name>"}`, but there is no repo mode (SKILL-8), no SHA, and it upserts over same-named skills. Proposal: `POST /api/skill-library/import`, body `{"url","ref","sha","skills":["pytest-review",…],"mode":"agent","on_conflict":"skip"\|"replace"}` → `{"added":[{"id","name"}],"skipped":["api-conventions"]}`. Each row's source is `{"type":"repo","url","ref","filter":name,"mode":"agent","resolved_sha":sha}`, created in one transaction in `node_library.py`. |
| SKILL-44 | Duplicate | PARTIAL | The client can `POST` a copy after computing a unique name from the list. Cleaner: `POST /api/skill-library/{id}/duplicate` → `{"id","name":"house-style-copy"}` (suffix `-copy`, `-copy-2`, …). |
| SKILL-45 | Turn on for agents (bulk attach/detach) | MISSING | Today the only path is `PATCH /api/teams/{team_id}/nodes/{node_id}` (routers.py:2942), which requires `prompt`+`model` on each call and replaces the whole `skills` list. Proposal: `GET /api/skill-library/{id}/agents` → `{"agents":[{"team_id","team_name","node_id","role_name","enabled":bool}]}` (all owner library-team nodes with `kind IN ('completion','agent')`). `PUT /api/skill-library/{id}/agents` with body `{"node_ids":[…]}`: append `{"type":"library","id":id}` to listed nodes that lack it and remove it from unlisted owner library nodes; returns the same list. Logic in `node_library.py`. Coordinate with the agent Skills & tools owner for the per-agent mode override `{"type":"library","id","mode"?,"triggers"?}`, which would need `node_skills._resolve_library_source` to apply the override. |
| SKILL-46 | Delete impact ("Reviewer and Engineer in Indicator sprint team use it") | MISSING | Served by `GET /api/skill-library/{id}` → `used_by` (SKILL-33). |
| SKILL-47 | Delete skill + agents lose it | PARTIAL | `DELETE /api/skill-library/{id}` exists (204). It leaves dangling `{"type":"library","id"}` refs: the resolver skips them with a run warning (node_skills.py:146) and the node drawer shows "(removed from library)" (SkillsSection.tsx:52). Proposal: in `delete_owner_skill`, also strip the ref from every owner library-team node's `skills` in the same transaction. Response stays 204. |
| SKILL-48 | Skills reach the agent on both web and Desktop runs | PARTIAL | Web/hosted OpenHands: EXISTS (`AgentTask.skills` → `AgentContext(skills=…)`, team_run.py:1250, openhands_*_adapter). **Desktop subscription nodes: MISSING.** `DesktopRunnerAdapter.run` enqueues only `task.instruction` (engines/desktop_runner_adapter.py:63–74), so `task.skills` is silently dropped for Claude/Grok-on-Desktop nodes. Proposal v1: in `desktop_runner_adapter`, fold skills into the instruction with the existing thinker bridge (`node_skills.inject_skills_into_prompt`, trigger-matched against the instruction). v2: add a `desktop_node_jobs.skills JSONB` column (migration 0041) and have the runner (`desktop/electron/runner/workspace.cjs`) write `.claude/skills/<name>/SKILL.md` so Claude Code gets native agent-decides disclosure. Also **private-repo skills fail at run time**: `load_public_skills` clones with plain git (node_skills.py:209). Clone App-installed repos with an installation token via `github_app._clone_and_scrub` into a cache dir, then use `load_skills_from_dir`. |
| MEM-1 | Pending count for the "N new" nav badge | PARTIAL | Derivable from `GET /api/memories?status=pending_review` length. Propose the `GET /api/toolkit/summary` `memory.inbox` count (see SKILL-1), or `GET /api/memories/counts` → `{"inbox":int,"active":int,"archive":int}` in `memory.py`. |
| MEM-3 | Tab counts | EXISTS | List lengths: `GET /api/memories` (active by default), `?status=pending_review`. The summary endpoint would avoid loading lists. |
| MEM-5/6 | Review switch read/write + Undo | EXISTS | `GET /api/memory/review-mode` → `review_mode`; `PATCH /api/memory/review-mode {review_mode}` (routers.py:2398–2425). The "Off" copy matches `_status_for` (memory_distill.py:174): failed-run negatives are always `pending_review`. |
| MEM-8 | Force | EXISTS | `memories[].polarity` ∈ `require\|prefer\|allow\|context\|avoid\|forbid` (DB CHECK, migration 0026). The labels in `lib/memory.ts POLARITY_META` already equal the design labels. |
| MEM-9 (repo/account) | Scope + a readable repo label | PARTIAL | `tier` and `repo_key` exist (`memory._to_dict`). **Defect:** `repo_key = run.repo_path` (memory_distill.py:743, memory_review.py:216, team_run.py:600). In hosted mode, which is what both website and Desktop use (routers.py:1024 forbids `repo_path`), `repo_path` is the per-run clone dir `<repo>/.tvashtr_clones/<run_id>` (clone_reaper.py:64, team_run.py:294–297). So each run gets a unique `repo_key`: repo-tier memories never match the next run, the Repo filter shows paths, and "lazyxgenius/trade_mcp" cannot be shown. Proposal: use `repo_key = run.github_repo or run.repo_path` in all three sites. Migration 0041 data fix: `UPDATE node_memories m SET repo_key=r.github_repo FROM runs r WHERE m.source_run_id=r.id::text AND r.github_repo IS NOT NULL AND m.repo_key LIKE '%/.tvashtr_clones/%'`. Serialize `"repo_label"`: the github full name as-is, or the basename of a self-hosted path. |
| MEM-9 (agent) | "Reviewer · Indicator sprint team" for agent-scoped memories | MISSING | Only `node_id` (the authored origin node uuid) is returned. Add `"agent":{"node_id","role_name","team_id","team_name"}\|null` to `_to_dict`, batch-resolved in `list_memories`: `AgentNode.id IN (…) ⨝ TeamGraph`. A dangling id gives `role_name:null`. The same field drives "Kept. Reviewer uses it…" (MEM-12). |
| MEM-10 | Run title, round N, time | PARTIAL | `source_run_id` and `created_at` exist. The run title (`runs.idea`) and status are only obtainable by joining client-side with `GET /api/runs` (`_run_summary`: `idea,status`). **Round is MISSING:** `source_invocation_id` exists in the schema (models.py:1060) but is **never written**; `memory_distill._insert` (line 533) doesn't set it. Proposal: in `distill_run`, build `role → (last invocation id, iteration, authored node id)` from `agent_invocations ⨝ agent_nodes` for the run (extend `_role_authored_ids`); in `_insert`, set `source_invocation_id` from `cand.node_role` and a new column `source_node_id uuid NULL` (the learner, even for repo-tier facts). Migration 0041 adds `node_memories.source_node_id`. Serialize `"source":{"kind":"run"\|"manual","run_id","run_title":idea[:120],"run_status","run_succeeded":bool,"round":iteration\|null,"agent_role","team_name"}`, batch-joined in `list_memories`. Agent-remember captures (`memory_review.ingest_run_remembers`) carry no node, so the round stays null there. |
| MEM-11 | "From a failed run · … · a caution" | PARTIAL | Needs `source.run_status` / `run_succeeded` (MEM-10 proposal) plus the polarity sign (`avoid`/`forbid`). Today it is derivable only by the client join with `GET /api/runs`. |
| MEM-12 (keep) | Keep a pending memory | EXISTS | `POST /api/memories/{id}/promote` → row + `action` ∈ `promote\|promote_merged\|promote_supersede` (memory_review.py:85). |
| MEM-12 (undo) | Undo Keep | MISSING | No endpoint turns active back into pending. Proposal: `POST /api/memories/{id}/requeue` → row (`status:"pending_review"`), in `memory_review.requeue()`: from `active` set `pending_review` and restore any row with `superseded_by=id AND status='superseded'` to `active` (reverses `promote_supersede`); from `superseded` with `superseded_by=X` (reverses `promote_merged`) set `pending_review`, clear `invalid_at`/`superseded_by`, and decrement `X.confirmation_count`; from `rejected` set `pending_review`, clear `invalid_at`. Otherwise 404. |
| MEM-13 (text/force) | Edit content + force | EXISTS | `PATCH /api/memories/{id} {content?, polarity?}` (re-embeds only on a content change; 422 on blank content or bad polarity; 502 on an embed failure). |
| MEM-13 (scope) | Change scope Account / Repo / Agent | MISSING | `UpdateMemoryRequest` (routers.py:2235) has no scope fields. Proposal: add `"scope":"account"\|"repo"\|"agent"` and optional `"repo_key"`. Server resolution in `memory.update_memory`: account → `(NULL,NULL)`; repo → `(repo_key ?? row.repo_key ?? source run repo, NULL)`; agent → `(that repo, row.node_id ?? row.source_node_id)`. 422 `"This memory has no repo to scope to."` or `"…no agent to scope to."` when unresolvable. Tier validation via `memory_tier`. |
| MEM-14 (discard) | Discard | EXISTS | `POST /api/memories/{id}/reject` → tombstone (`status:"rejected"`, `invalid_at`). |
| MEM-14 (undo) | Undo Discard, back to the Inbox | MISSING | `POST /promote` would send it to Active, not the Inbox. Use `POST /api/memories/{id}/requeue` (see above). |
| MEM-16 | Repo filter options + client filtering | PARTIAL | Filters can run client-side over `GET /api/memories` (all active rows, unpaged; `repo_key`, `tier`, `polarity`, `content`). The Repo options need a clean identity (MEM-9 defect) and labels. Proposal: `GET /api/memory/repos` → `{"repos":[{"repo_key","label","memory_count"}]}`: the distinct `repo_key` over the owner's memories ∪ distinct `runs.github_repo` ∪ the `GET /api/github/repos` full names (hosted). |
| MEM-17 | "N of M" | EXISTS | Client count over the active list. |
| MEM-18 | Meta: confirmed N×, added by you, pinned, date | EXISTS | `confirmation_count`, `source_run_id` (null means manual), `pinned`, `created_at`/`valid_from`. |
| MEM-20 | Pin / Unpin / Undo | EXISTS | `POST /api/memories/{id}/pin` and `/unpin` → row. |
| MEM-21 (save) | Save edit | EXISTS | `PATCH /api/memories/{id}`. |
| MEM-21 (edited) | "Edited by you · just now" | MISSING | `updated_at` also moves on pin, confirm and status changes, so it cannot mean "edited". Migration 0041 adds `node_memories.edited_at timestamptz NULL`. `memory.update_memory` sets it when content, polarity or scope changes (not on a pin). Serialize `"edited_at"`. |
| MEM-22 | Delete | EXISTS | `DELETE /api/memories/{id}` → 204 (a hard delete, memory.py:252). |
| MEM-26 | Archive rows (superseded / rejected + date) | EXISTS | `GET /api/memories?status=superseded` and `?status=rejected` → `status`, `invalid_at` (MemoryShelf already does the two calls). `superseded_by` is not serialized; add it (`_to_dict`) for a future "replaced by …" link. |
| MEM-27 | Restore discarded | EXISTS | `POST /api/memories/{id}/promote` (accepts `rejected`, memory_review.py:57). Handle `action:"promote_merged"`, where the row is retired into an existing fact. |
| MEM-30 | Repo options in Add memory + default | PARTIAL | Same as MEM-16: `GET /api/memory/repos`. Create must use the normalized key (`owner/name`). Today the shelf asks for a raw "Repo path". |
| MEM-31 | Force on create | EXISTS | `POST /api/memories {content, repo_key?, polarity}` (default `context`; the design defaults to MUST, so the client sends `require`). |
| MEM-34 | Create memory (applies right away) | EXISTS | `POST /api/memories` → row with `status:"active"` regardless of review mode (memory.py:161). It embeds with the operator `.env` key (`api_key=None`). |
| MEM-37 | Pinned memories always injected first | PARTIAL | HOT/pinned injection exists (memory_retrieval.py:133). **Bug:** `retrieve_for_node` wraps everything in one `try`. When the owner has no OpenAI key, the cold-query embed (`resolve_owner_api_key`, team_run.py:615) raises and the whole call returns `[]`, **dropping the pinned facts too**. Fix: wrap `embed_query` separately and fall back to `hot` (+ optional recency-ranked cold). |
| MEM-38 | Runs teach memories that carry across runs (web + Desktop) | PARTIAL | Distillation and agent-remember exist (memory_distill.distill_run, memory_review.ingest_run_remembers; Desktop sidecars carry `TVASHTR_REMEMBER.jsonl`, desktop_runner_adapter.py:32). But (a) distillation is **skipped** for owners without an OpenAI key (memory_distill.py:757–766, `resolve_owner_api_key(owner, "openai/gpt-4o-mini")`), which is common for Desktop subscription-only users, so their Inbox never fills; (b) the hosted `repo_key` defect (MEM-9) prevents carry-over. Proposal: fix (b) as above. For (a), either use the operator key for distill and embedding (as the manual path does) or surface a "needs an OpenAI key" hint (see open questions). |

Row tally: **23 EXISTS · 18 PARTIAL · 11 MISSING** (52 rows).

**New migration (next head after `0040_desktop_job_machine`).** `0041_memory_provenance`:
- `node_memories.source_node_id uuid NULL`
- `node_memories.edited_at timestamptz NULL`
- the repo_key data fix above
- optionally `desktop_node_jobs.skills jsonb NULL` for the Desktop skills v2

No skill_library schema change is needed, because repo `mode`/`triggers`/`resolved_sha` live in the `source` JSONB.

---

## 4. Desktop bridge gaps

No new `window.tvashtrDesktop` method is required for these screens. Notes:

1. **External GitHub links.** Repo badges and "install the GitHub App" links must be `target="_blank"` / `window.open`. Electron's `setWindowOpenHandler` then routes non-auth URLs to `shell.openExternal` (main.cjs:272–279). A plain same-window `<a href="https://github.com/...">` is **not** intercepted: `localBounceTarget` returns null for github.com (main.cjs:236), so the whole app window would navigate to GitHub. GitHub App install URLs (`/installations/new`, `/apps/<slug>/installations`) stay in the window on purpose (`isGithubAuthUrl`, main.cjs:208) and bounce back afterwards. That is correct for the "install the GitHub App" path.
2. **Skills on Desktop subscription nodes (runtime, not preload).** If v2 of SKILL-48 is chosen, the Electron **runner** (`desktop/electron/runner/workspace.cjs`) must write `job.skills` into the job workspace as `.claude/skills/<name>/SKILL.md` (Claude Code) before launching the CLI, and exclude those files from the returned patch. This needs no renderer bridge.
3. **Optional, not in the design:** "Add skills from a folder" on Desktop, e.g. importing `~/.claude/skills`. It would need `tvashtrDesktop.skills.pickFolder(): Promise<{path: string} | null>` and `tvashtrDesktop.skills.readFolder(path: string): Promise<{name: string; content: string}[]>` (IPC `tvashtr:skills:pickFolder` / `tvashtr:skills:readFolder` in main.cjs, using `dialog.showOpenDialog` + fs). Recommend deferring it.

---

## 5. Frontend mapping

**Today:**
- `Dashboard.tsx:608–620` renders `view === "tools"` as one long page: `<SecretsShelf/> <ToolsShelf/> <SkillsShelf/> <MemoryShelf/>`.
- `AppShell.tsx` has a flat `NAV` with `DashView = "home"|"domains"|"engines"|"tools"`.
- `SkillsShelf.tsx` is a single shelf: name input, an Inline/Repo segmented control, a textarea, a mode segmented control, trigger input, preset chips, and a chip list with Edit and ✕.
- `MemoryShelf.tsx` puts everything on one page: add form, review switch, pending list, Account / This repo / Per-node sections, and a "Show archived" toggle. `MemoryFact.tsx` is a row with manage/pending/archived variants.
- `lib/memory.ts` holds the polarity vocabulary and bucketing.
- `panel/SkillsSection.tsx` is the per-agent skills list and library picker. It also upserts presets into the library by name.
- `panel/NodeMemorySection.tsx` and `panel/RunMemory.tsx` reuse `MemoryFact`.

**Keep:**
- All `lib/api.ts` skill-library, preset and memory client functions (lines 847–919, 1487–1630). Extend the types with `updated_at`, `usage`, `agent`, `source`, `repo_label` and `edited_at`, and add clients for the new endpoints.
- `lib/memory.ts` `POLARITY_META` / `POLARITY_ORDER`: the labels already match the design and the order matches the radios and filter.
- `lib/time.ts formatRelativeTime` for "31m ago" and "just now". "Just now" in the Skills Updated column needs a capitalized variant.
- `lib/useModalDialog.ts` (focus trap + Escape) for every dialog and drawer.
- `lib/prdEditor.ts` `PRD_EDITOR_EXTENSIONS` (TipTap + tiptap-markdown) for read-only SKILL.md Preview. No new dependency is needed.
- CSS `tv-seg` (segmented) and `tv-switch`.
- The logic in the current shelves (optimistic review toggle with rollback, guard/refresh patterns, trigger parsing) can be moved into the new components.

**Rebuild or replace:**
- `SkillsShelf.tsx` becomes a `SkillsPage` (header, tabs, search, `SkillsTable`, empty states) plus:
  - `SkillPresetsGrid` + `PresetPreviewDialog`
  - `SkillEditorPage`, one component for New and Edit modes: name, `SkillMdEditor` (line-numbered textarea + Preview tab), `LoadModeControl` (segmented + helper + trigger input), `SkillSourceControl` (Written here / GitHub repo fields), `UsedByBadges`
  - `AddFromGithubDrawer` (find → found → add state machine)
  - `SkillRowMenu`, `DeleteSkillDialog`, `AgentPickerDialog` (Turn on for agents / Choose agents)

  The editor is a sub-view (e.g. `DashView "toolkit/skills/edit"` + skill id). There is no router today (state-driven views only), so the breadcrumb "Skills" link sets the view. Per the frontend `CLAUDE.md` (one screen = one route file), New/Edit skill and the Skills list should each be their own component file.
- `MemoryShelf.tsx` becomes a `MemoryPage` (header, tabs, Add memory) plus `MemoryInboxTab` (review switch, list, empty), `MemoryActiveTab` (`MemoryFilterBar` with "N of M" + Clear filters, list, no-results, empty), `MemoryArchiveTab`, and `AddMemoryDrawer`.
- `MemoryFact.tsx` becomes a new `MemoryRow`, built from `ForceBadge`, `ScopeChip` (agent/repo/account icon variants), `MemoryMeta`, `MemoryInlineEditor` (text + Force + Scope), and per-tab actions (Keep/Edit/Discard, icon Pin/Edit/Delete, Restore). Keep `MemoryFact` as a thin wrapper, or migrate `RunMemory.tsx` / `NodeMemorySection.tsx` to `MemoryRow`, because they import it today. The inline delete-confirm in MemoryFact is replaced by an alertdialog.
- `AppShell.tsx`: the Toolkit group with sub-items and badges (Tools / Skills / Memory / Secrets), the footer note, and extended `DashView` values. This is shared with the Tools/Secrets analyst.
- Tests to rewrite: `SkillsShelf.test.tsx`, `MemoryShelf.test.tsx`, `MemoryFact.test.tsx`, parts of `Dashboard.test.tsx`, `memory.test.ts` (bucketing is no longer used by the page; keep it only if the agent drawer still uses it).

**Shared primitives the designs rely on.** Only tokens exist in the repo (`design-system/tokens/*.css`); none of the `<DS.*>` components do.
- **Tabs** (pill, with optional count)
- **Badge** variants neutral / outline / success / warning / info / danger. `panel.css` has only neutral, accent, outline and danger.
- **Button** (primary / secondary / ghost, sizes) and **IconButton** (with `active`)
- **Input** (label, helper, optional marker, error, multiline)
- **Select**: a custom listbox, per the Filters flows
- **Switch**: exists
- **SegmentedControl**: exists (`tv-seg`)
- **⋯ Menu** (`role=menu`)
- **AlertDialog** that shows the impact (Delete skill / Delete memory)
- **Dialog** (preset preview)
- **Right-side Drawer/Sheet** (w540 / w560 over a scrim; Add from GitHub, Add memory)
- **Toast host**: dark, `role=status`, with one action button (Undo / Choose agents / Open Active) and auto-dismiss. Undo must call the reversal endpoint, not just hide the toast.
- **EmptyState** (title, body, up to two actions)
- **Filter bar** with a result count and Clear
- **Line-numbered code editor**
- **Markdown preview**

Most of these are shared with the Tools/Secrets and agent-drawer analysts.

---

## 6. Open questions / ambiguities

1. **One library row per repo, or per skill?** The editor's "GitHub repo" source (SkillSource-1) has "Only these skills" and a user-given name, which is the existing one-row-many-skills `{type:"repo",filter}` model. "Add from GitHub" creates one row per skill. **Recommend:** support both. Import writes one row per skill (`filter` = exact name). The editor's repo source is a "bundle" row, and its load mode and Used by apply to the whole bundle.
2. **"Skills update when you change the version."** At run time a branch ref (`main`) is live: the SDK re-fetches after its TTL. **Recommend:** store `ref` (shown in the badge) plus `resolved_sha` from the scan, and resolve at run time from `resolved_sha`, which makes the copy true and runs repeatable. Add an "Update to latest" action later. Otherwise change the copy.
3. **Name collisions** (New skill, preset Add, import, rename): none are designed, and today's POST silently overwrites. **Recommend:** 409, with an inline field error "You already have a skill called <name>." In the import list, mark existing names "Already in your skills" and leave them unchecked.
4. **Per-agent load-mode override** ("Each agent can change this in its own Skills & tools tab"): there is no field for it today. **Recommend** `{type:"library", id, mode?, triggers?}` on the node, with the override applied in `_resolve_library_source`. This is owned jointly with the agent-drawer analyst.
5. **`project_rules` source type** (existing "Repo rules") has no place in the design. **Recommend:** don't offer it in Toolkit (it belongs to the per-agent tab). Render existing rows with a neutral badge "Repo rules" and mode "Always on".
6. **Delete skill button style:** the design uses `secondary`, not danger. **Recommend** following the design.
7. **Inbox Edit → Save:** does Save also Keep? **Recommend:** Save only edits, and the item stays in the Inbox until Keep. Proposed toast: "Saved."
8. **Scope select in the inline editor:** "Agent" needs a known agent, and "Repo" needs a known repo. The `scopes` list in the design also carries "All scopes", a copy-paste from the filter. **Recommend:** options Account / Repo / Agent, with Agent disabled unless the memory has `node_id` or `source_node_id`, and Repo disabled unless a repo is known.
9. **Repo filter semantics:** should picking a repo include Account-scoped ("all repos") memories? **Recommend:** yes. Treat the filter as "applies to this repo" (account + that repo + its agents); the Scope filter narrows further.
10. **Which date the Active meta shows** ("Confirmed 1× · Sep 24"): creation or last confirmation? **Recommend** `created_at` for now. Add `last_confirmed_at` if the product wants recency.
11. **Keep or Restore when promote merges or supersedes** (`action: promote_merged | promote_supersede`). **Recommend** extra toasts: merged → "Already known. Confirmed the existing memory."; supersede → "Kept. It replaces an older memory that said the opposite."
12. **Users without an OpenAI key** (typical for Desktop subscriptions) never get learned memories, and pinned facts can be dropped (MEM-37 bug). **Recommend:** fix the retrieval bug unconditionally. For learning, decide between an operator-paid distill/embed (like the manual path) and an empty-state hint "Learning from runs needs an OpenAI key. Add one in Engines." (copy to confirm).
13. **Delete on a learned memory is a hard delete** (as designed), so the distiller may re-learn it on a later run. A reject tombstone would prevent that. **Recommend:** keep the design's hard delete but log it for review. Point users to Discard (Inbox) for wrong lessons.
14. **Agent label:** the Inbox says "Reviewer · Indicator sprint team" but Active says "Reviewer". **Recommend** "<Role> · <Team>" everywhere, truncated. When the authored node has been deleted, show "Removed agent".
15. **Toasts that aren't designed:** review switched on, unpin, memory deleted, skill "Save changes", add memory to every repo, unused-skill delete body. Proposed copies are in the requirements above.
16. **"When triggered" with no trigger words:** the skill would never load. **Recommend** disabling Save with the helper turning into an error "Add at least one trigger word." (copy to confirm).
17. **Version left empty** in Add from GitHub: **recommend** defaulting to the repo's `default_branch` (scan resolves it) rather than a literal "main".
