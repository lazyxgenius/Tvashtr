# Domains — gap analysis (area `domains`, prefix `DM-`)

Round 2 of the frontend revamp. Analysis only; no code was changed.

Screens covered (the 86 names under `domains` in `design/revamp-export/render/areas.json`):
`Dm-List`, `Dm-ListEmpty`, `Dm-NewDialog`, `Dm-Sources`, `Dm-Ask`, `Dm-Quality`, `Dm-Teams`, `Dm-Settings`,
`Dm-QueryNode`, `Dm-AgentAccess`, `Dm-BeforeAfter`, `DmF-Index`, `DmF-First-1`, `DmF-First-2`, `DmF-First-3`,
`DmF-First-4`, `DmF-First-5`, `DmF-NoKey-1`, `DmF-NoKey-2`, `DmF-NoKey-3`, `DmF-NoKey-4`, `DmF-Drag-1`,
`DmF-Drag-2`, `DmF-Drag-3`, `DmF-Drag-4`, `DmF-Fail-1`, `DmF-Fail-2`, `DmF-Fail-3`, `DmF-Fail-4`,
`DmF-Preview-1`, `DmF-Preview-2`, `DmF-DelFile-1`, `DmF-DelFile-2`, `DmF-DelFile-3`, `DmF-Filter-1`,
`DmF-Filter-2`, `DmF-Filter-3`, `DmF-Ask-1`, `DmF-Ask-2`, `DmF-Ask-3`, `DmF-Ask-4`, `DmF-NoAns-1`,
`DmF-NoAns-2`, `DmF-Follow-1`, `DmF-Follow-2`, `DmF-Model-1`, `DmF-Model-2`, `DmF-Model-3`, `DmF-SaveTest-1`,
`DmF-SaveTest-2`, `DmF-SaveTest-3`, `DmF-Qual-1`, `DmF-Qual-2`, `DmF-Qual-3`, `DmF-Qual-4`, `DmF-Qual-5`,
`DmF-Tune-1`, `DmF-Tune-2`, `DmF-Tune-3`, `DmF-Tune-4`, `DmF-Embed-1`, `DmF-Embed-2`, `DmF-Embed-3`,
`DmF-Embed-4`, `DmF-Piece-1`, `DmF-Piece-2`, `DmF-Piece-3`, `DmF-Step-1`, `DmF-Step-2`, `DmF-Step-3`,
`DmF-Step-4`, `DmF-Step-5`, `DmF-Agent-1`, `DmF-Agent-2`, `DmF-Agent-3`, `DmF-Canvas-1`, `DmF-Canvas-2`,
`DmF-Canvas-3`, `DmF-Canvas-4`, `DmF-Menu-1`, `DmF-Menu-2`, `DmF-Menu-3`, `DmF-Menu-4`, `DmF-Find-1`,
`DmF-Find-2`, `DmF-Find-3`. Every one was read as outline, raw HTML (data arrays, colours) and PNG.

Design data taken from the raw HTML (every `Dm*` file carries the same `renderVals()`):
- `dTabs = Sources (count 14) · Ask · Quality · Use in teams (count 3) · Settings`; `dTabsNew` = Sources 3, no
  Use-in-teams count.
- `sortOpts = Recently updated · Name · Most used · Needs attention first`.
- `statusOpts = All files · Ready · Reading · Needs attention`; `typeOpts = All types · PDF · Markdown · Text ·
  HTML` (defined, used by no board).
- `templateOpts = Support · 600-character pieces · Legal · 500… · Financial · 700… · Scientific · 1,000… ·
  Blank · 800-character pieces`.
- `embedOpts = OpenAI text-embedding-3-small · OpenAI text-embedding-ada-002 · OpenRouter text-embedding-3-small
  · Gemini embedding-001 · Hugging Face BGE-small (free)` (exactly the five backend `EMBEDDING_PRESETS`).
- `genOpts = Account default · Groq gpt-oss-120b · OpenAI gpt-4o-mini · OpenRouter gpt-4o-mini · Custom…`
  (exactly the FE `GENERATION_PRESETS` + custom).
- `placeOpts = At the start, before Product manager · After Product manager · After Engineer · Before
  Reviewer`; `missOpts = Keep going and say so in the spec · Stop the run and tell me`.
- `compareOpts = Previous run · Sep 24, 10:02 · Run 3 · Sep 22 · Meaning search · Run 2 · Sep 20 · Legal
  pieces`; `langOpts = English` (defined, used by no board).
- Nav status dots (7 px): `--sage-500` ready, `--coral-500` reading, `--amber-500` needs attention,
  `--stone-300` empty.

Code read:
- **Docs:** `docs/superpowers/specs/2026-09-25-frontend-revamp-design.md`,
  `plans/2026-09-25-frontend-revamp.md`, `briefs/frontend-slice-brief.md`, `briefs/backend-slice-brief.md`,
  `plans/api/{engines,desktop-bridge,teams,nodes,runs}.md` (and the domain lines of the rest),
  `HANDOVER-2026-09-25-revamp.md`, round-1 `engines.md` (model), `toolkit-skills-memory.md`, `panel.md` §5 and
  its Domains rows, `specs/2026-09-15-polyrag-domains-tvashtr-design.md`, `plans/2026-09-15-polyrag-domains-
  phase{1,2,3,4a,4b,5,6,7}.md` (goals, locked constraints, file maps), `plans/2026-09-22-domains-{groq-embed,
  guided-path,multi-embed}.md`, `prompts/revamp-e2e.md` (Phase 2 and its special rules).
- **Backend:** `routers.py` (all `/api/domains*` routes, `/api/domain-templates`, the domain_query branches of
  node PATCH and node POST), `control_plane/{domains,domain_embedding,domain_ingest,domain_files,
  domain_chunking,domain_ask,domain_retrieve,domain_eval,domain_mcp,domain_query_node}.py`,
  `control_plane/team_run.py` (`domain_query_step` + the `run_team` domain_query branch),
  `control_plane/node_tools.py` (`domains_mcp_url`, `_domains_opt_in`, `build_mcp_config`),
  `control_plane/graph_validity.py` (codes), `control_plane/teams.py::account_default_model`,
  `control_plane/toolkit.py::list_agents`, `routes/toolkit.py`, `routes/__init__.py`, `main.py` (revamp
  router list, `/mcp/domains` mount), `models.py` (`Domain`, `DomainDocument`, `DomainChunk`,
  `DomainMessage`, `DomainEvalCase`, `DomainEvalRun`, `User.preferences`), `metering.py` (call sites).
- **Frontend:** `components/{DomainsPage,DomainConfigForm,DomainEvalPanel,DomainGuidedPath,NewDomainDialog}.tsx`,
  `lib/domains.ts`, `lib/api.ts` (domain clients), `lib/nav.ts`, `lib/workspaceStatus.ts`,
  `lib/desktopDownload.ts`, `pages/Workspace.tsx`, `pages/shell/Shell.tsx`, `pages/badgeLoaders.ts`,
  `pages/home/{paletteItems,CommandPalette}.ts(x)` (domain rows), `panel/TeamNodePanel.tsx` (domain_query
  branch), `panel/ToolsSection.tsx` (Domains MCP switch), `canvas/AgentNodeCard.tsx` (`DomainQueryCard`),
  `canvas/paletteItems.ts`, `components/LastRun.tsx`, `design-system/components/*` (exports),
  `vite-env.d.ts`, `e2e/revamp-shell.spec.ts`.
- **Desktop:** `desktop/electron/main.cjs` (navigation guards, deep links), `electron/deepLink.cjs`,
  `desktop/scripts/local-server.cjs` (the `/api` proxy), `desktop/package.json`.

Findings in today's code that the design exposes (each is picked up in §3):
1. **Switching between two same-size reading models keeps the old vectors.** `update_domain` clears
   embeddings only when the dimension changes. `openai/text-embedding-3-small` → `openai/text-embedding-ada-002`
   (both 1536) keeps 3-small vectors while questions are embedded with ada-002, so search silently returns
   noise.
2. **A Query domain node's answer never reaches the next agents.** `run_team` closes the invocation with the
   answer and moves on; nothing writes it into the spec. The design says "Adds the answer and its sources to
   the spec, so the Writer and Reviewer read them."
3. **Uploading does not start reading.** Reading only happens on `POST /ingest`. The design says "New files are
   read automatically."
4. **The agent tools need a domain id.** `domain_ask`/`domain_retrieve` take `domain_id`, and
   `tool_config.tvashtr.domains: true` opens every domain. The design picks domains per agent and "finds the
   domain by name".
5. **"Look wider, then keep the best" does nothing today.** `apply_rerank` is a passthrough, so with Meaning
   or Exact-words search the switch returns the same 8 passages.
6. **Piece size and overlap are not validated.** A size of 0 or an overlap ≥ size saves and then fails every
   file at read time.
7. **Ask and Query-domain costs are not on the run ledger.** `ask_domain` never calls `record_cost`, so a
   run's spend leaves out its Query domain steps.
8. **Node and agent asks land in the user's chat.** `ask_domain` always writes `DomainMessage` rows, so Query
   domain nodes and MCP asks show up in Ask history.

---

## 1. Screens

**Surfaces.** Every `Dm-*`/`DmF-*` board is drawn in Desktop mode: the 30 px ink title strip "Tvashtr — the
living canvas" with traffic lights sits above the shell. No website variant is drawn. Domains has one backend
(hosted, PolyRAG on Fly); Desktop proxies `/api` to it (`desktop/scripts/local-server.cjs`). So **every screen
exists on both surfaces** with the same content: on the website the page renders without the title strip, at the
same size (the Home precedent). No screen is Desktop-only or website-only. The few behaviour differences are
listed in §4 (dropping files into the Electron window, "Download original", subscription-run agents).

Two boards are **not screens**:
- **Dm-BeforeAfter: rationale only.** "Before" is a placeholder image with the caption "Today: one long page of
  hints, an Ingest button to remember, and IDs the user can’t see." "After — What changes on Domains" lists six
  changes: Guided path → a live setup strip; Upload + Ingest → Add files; Chat → Ask with numbered sources; Eval
  → Quality; Config → Settings in plain words; New: Use in teams.
- **DmF-Index: index board.** "Domains flows … 21 flows, 74 screens", one row per flow with its screen count,
  and the legend "A coral ring marks what you click on that screen."

### List and first time

**Dm-List: the Domains list (both surfaces).** Left nav: Home, **Domains** as an expanded group (chevron,
`aria-current`), one child per domain (Support docs · sage dot, Vendor contracts · coral dot, Research papers ·
amber dot, Q3 filings · stone dot), Engines, Toolkit. The nav foot says "**Domains** are libraries of your own
files. You and your agents ask them questions and get answers with sources." The header shows only logo,
"Connected" and the avatar (no ⌘K button; see OQ-1). Main column:
- h1 "Domains", lede "Libraries of your own files. You and your agents ask them questions and get answers with
  sources.", primary md **New domain** (+).
- A three-step "how it works" strip with a Close IconButton ("Hide how domains work").
- "Search domains" input (w280); "Sort" label + Select (w220, "Recently updated").
- A 3-column card grid. Each card: serif name (link), status badge, template badge, ⋯ ("More actions for
  <name>"), three icon lines (files, quality, usage), a rule and "Updated 2 hours ago" / "Created Sep 23".
  Sample states: Ready, Reading ("6 files · reading 4 of 6", "No test questions yet", "Not used yet"), Needs
  attention ("9 files · 1 needs attention", "60% found the right file", "Used in 1 team"), Empty ("No files
  yet", "—", "Not used yet").

**Dm-ListEmpty / DmF-First-1: no domains yet (both).** The nav has no domain children. A large card: coral book
tile, h2 "Give your agents your own documents", body "Put your help docs, contracts or papers in a domain. Ask
it questions and see the exact passage behind every answer. Then let your teams use it too.", primary **New
domain**, ghost **How domains work**. Then "Or start from a template" with four cards (Support · "Help center and
product docs" · "600-character pieces"; Legal · "Contracts and policies" · 500; Financial · "Filings and investor
docs" · 700; Scientific · "Papers and methods" · "1,000-character pieces"). Last, a key hint strip: "You’ll need
an API key for a reading model, like OpenAI. There’s also a free Hugging Face option for testing." + link
**Check Engines**. First-1 rings **New domain**.

**Dm-NewDialog / DmF-First-2: New domain, step 1 (both).** Dialog w720 (`role=dialog`, "New domain") over the
list (or the empty page in First-2):
- Header "New domain" / "Step 1 of 2 · Name it and pick what kind of files it holds" + Close.
- Input "Name" (placeholder "e.g. Support docs").
- "Starting point": five radio cards in a 3-column grid — Support "Help center and product docs"
  "600-character pieces" (selected, coral), Legal "Contracts and policies · precise sources" 500, Financial
  "Filings, metrics, investor docs" 700, Scientific "Papers and methods · more context" 1,000, Blank "Start
  from defaults and tune it yourself" 800.
- A sunk line "Files are read with **OpenAI text-embedding-3-small** ✓ key saved" + link **Change**.
- Footer: ghost **Cancel**, primary **Next: add files** (ringed in First-2).

**DmF-First-3: step 2, add files (both).** Header "Step 2 of 2 · Add files to Support docs". A dashed drop zone:
upload tile, "Drop files here, or **choose files**" (link), "PDF, Markdown, text or HTML · up to 10 MB each · as
many as you like". A list of picked files (kind tile MD/PDF, mono name, size, remove ✕ "Remove <name>"). An info
callout "Reading starts as soon as the domain is created. It takes about a minute for small files." Footer:
ghost **Back** (left), ghost **Skip — add files later**, primary **Create and read 3 files** (ringed).

**DmF-First-4: the new domain reads its files (both).** The nav gains "Support docs" with a coral dot and
`aria-current`. Detail page: breadcrumb "Domains › Support docs", serif h1, info badge "Reading 3 files", outline
"Support template", meta "3 files · read with OpenAI text-embedding-3-small · created just now", secondary sm
**Use in a team**, outline ⋯. A **four-step setup strip**: ✓ "Reading key / openai key saved", spinner "Add
files / Reading 3 files…", "3 Test it / Ask a question when reading finishes", "4 Use it in a team / As a fixed
step, or give an agent access". Tabs (Sources 3). The Sources table has rows Ready 42 pieces, "Reading 64%" with
a coral bar, and "Waiting to read" (clock). Footer "3 files · reading 1 of 3".

**DmF-First-5: all read (both).** Badge Ready, meta "3 files · 179 pieces · read with …", the setup strip is
gone, all rows Ready, footer "3 files · 179 pieces". Dark toast "Support docs is ready. Ask it a question." with
action **Ask now**.

**DmF-NoKey-1…4: no reading key yet (both).**
1. Same step-1 dialog, but the key line is replaced by a warn callout: "**No openai key yet.** Files are read with
   OpenAI text-embedding-3-small, which needs one. You can create the domain now, but files wait until a key is
   added." with tint **Add openai key** (ringed) and ghost **Use the free Hugging Face model**.
2. The Engines **Add an API key** sheet (w520, `role=dialog`) opens over the dialog: subtitle "So Domains can
   read files with OpenAI text-embedding-3-small", Provider combobox showing `openai`, hint "Covers models that
   start with openai/, like openai/text-embedding-3-small.", password "API key" (ringed), lock note, footer
   "Used by Domains · reading files", Cancel, **Save key**.
3. Back in the dialog, the key line reads "key saved", and the dark toast "openai key saved" shows.
4. Same as 1, with **Use the free Hugging Face model** ringed. The result is not drawn (OQ-9).

### Sources

**Dm-Sources: Sources tab (both).** Detail header as above (Ready, "Support template", "14 files · 1,212 pieces ·
read with OpenAI text-embedding-3-small · updated 2 hours ago"). A one-line **summary strip**: "Reading key saved
(openai)", "14 of 14 files read", "12 test questions · 83% found the right file", "Used 3 times in 2 teams".
Line tabs Sources 14 · Ask · Quality · Use in teams 3 · Settings. Toolbar: "Search files" (w260), "Show" select
("All files"), primary sm **Add files** (upload icon). A dashed hint row: "Drop files here, or use **Add files**.
PDF, Markdown, text or HTML, up to 10 MB each. New files are read automatically." Table: File (kind tile + name
button) · Size · Pieces · Status (w240) · Added · ⋯ ("More actions for <file>"). Footer "Showing 7 of 14 files ·
1,212 pieces".

**DmF-Drag-1…4: add files by dragging (both).**
1. Dragging 4 files over the page: a coral dashed overlay over the tab body, upload tile, serif "Drop to add 4
   files to Support docs", "They’re read automatically. You can ask about them in about a minute."
2. New rows on top: "Reading 80%" (coral bar), "Uploading 45%" (amber bar), "Waiting to read", and
   video-guide.pdf 14.2 MB "Needs attention / Over 10 MB. Split it or compress it, then add it again." Footer
   "18 files · reading 1, uploading 1, waiting 1".
3. Two rows Ready, gdpr "Reading 70%". Footer "18 files · 1 needs attention". The ⋯ on the too-big row is ringed;
   dark toast "video-guide.pdf is 14.2 MB. The limit is 10 MB." + **Remove it**.
4. The too-big row is gone; meta "17 files · 1,282 pieces · … · updated just now"; footer "Showing 7 of 17
   files · 1,282 pieces"; toast "3 files added to Support docs". (The strip and tab count still say 14: design
   bug, OQ-5.)

**DmF-Fail-1…4: a file couldn’t be read (both).**
1. Header badge warning "1 file needs attention". The billing-faq.pdf row is tinted: "Needs attention / OpenAI
   rejected the key (401). **Fix key in Engines**".
2. After fixing the key, the row ⋯ opens a menu (w220): Preview pieces · **Re-read this file** (coral hover) ·
   Download original · Copy file ID · separator · Delete file… (danger).
3. Badge Ready; the row reads "Re-reading 40%".
4. Row Ready 86 pieces; toast "billing-faq.pdf is ready · 86 pieces".

**DmF-Preview-1/2: preview a file’s pieces (both).** Clicking a file name (ringed) opens a right sheet (w560,
`role=dialog`, labelled with the file name): serif title "refund-policy.md", "Markdown · 18 KB · 42 pieces ·
added Sep 12", Close, "Find in this file" input, then piece cards ("Piece 1 of 42" mono · "598 characters", the
text). The footer reads "Used in 6 of the last 20 answers" with ghost **Download original** and secondary
**Re-read**. The file's row is tinted behind the scrim.

**DmF-DelFile-1…3: delete a file (both).**
1. Row ⋯ → the same menu, cut at the bottom of the frame.
2. Dialog (w500) "Delete pricing-2026.pdf?": "Its 64 pieces leave Support docs. Answers stop citing it. 1 test
   question expects this file and will be flagged." + an info callout "Teams using Support docs keep working with
   the other 13 files." Buttons ghost **Cancel**, primary **Delete file** (trash icon).
3. The row is gone ("13 files · 1,148 pieces · … · updated just now"); toast "pricing-2026.pdf deleted" +
   **Undo**.

**DmF-Filter-1…3: search and filter files (both).**
1. "refund" in Search files keeps refund-policy.md **and billing-faq.pdf**, so search also matches file text.
   Footer "2 of 14 files match “refund”".
2. The Show listbox (w220): All files 14 ✓ · Ready 13 · Reading 0 · Needs attention 1.
3. "Needs attention" shows only troubleshooting.pdf: "Needs attention / No text found. It may be a scanned
   image. Export it as text-based PDF." Footer "1 file needs attention · **Show all files**".

### Ask

**Dm-Ask / DmF-Ask-3: an answer with numbered sources (both).** Two columns:
- **Left:** a lock line "Answers use only the files in Support docs. Nothing else." + ghost **Clear chat**. Then
  the user bubble (right-aligned) and an answer card: text with inline coral chips 1, 2, bold "30 days"; a
  "Sources" line "1 refund-policy.md · 2 billing-faq.pdf"; ghost **Copy**, **Save as test question**, **Show
  what search found**; meta "1.8 s · OpenAI gpt-4o-mini". A composer card at the bottom: textarea "Ask Support
  docs a question" (3 rows), chip button "Answer model: **Account default**" ⌄, Switch "Use earlier messages"
  (on), primary sm **Ask** (↑).
- **Right:** `aside` "Sources" (w340), "SOURCES FOR THIS ANSWER" with one card per cited passage: number chip,
  mono file name, "piece 3 of 42" or "page 4 · piece 17 of 86", the excerpt with the used phrase highlighted.
  The active card (1 in Dm-Ask) is coral-tinted with ghost **Open file** and **Copy passage**.

**DmF-Ask-1/2: empty Ask (both).** Centre: chat tile, serif "Ask Support docs anything", "Every answer lists the
files and passages it used. If the files don’t cover it, you’ll be told so.", four suggestion pills ("What is
the refund window?", "How do I set up SSO?", "What are the API rate limits?", "How do I export my data?"),
"Suggested from your file names". The aside is empty: file tile, serif "Sources show up here", "Click a number in
an answer to read the exact passage it came from." In Ask-2 the question is typed and **Ask** is ringed.

**DmF-Ask-4: click a number (both).** Chip 2 in the answer is ringed; source card 2 turns coral with **Open
file** / **Copy passage**.

**DmF-NoAns-1/2: the files don’t cover it (both).** The answer card is amber-tinted: "I couldn’t find this in
Support docs. The closest passages talk about annual plan pricing and education discounts, not non-profits." and
"Sources 1 pricing-2026.pdf · 2 billing-faq.pdf". There are no inline chips. Under the card: secondary **Add a
file about it** (upload icon) and ghost **Save as test question**; there is no Copy and no latency. The aside
shows the two closest passages with "page 2" / "page 7".

**DmF-Follow-1/2: a follow-up (both).** With "Use earlier messages" on, the second question gets an answer
headed by a small line "Used your earlier question for context", "2.1 s · OpenAI gpt-4o-mini", one source. The
frame shows both questions but only the second answer, and the aside numbers the source "2" while the answer
says 1 (design bugs, OQ-6).

**DmF-Model-1…3: change the answer model (both).**
1. The model chip is ringed.
2. A listbox (w380) opens upward: "Account default / Your default thinking model ✓ key saved" (selected),
   "Groq gpt-oss-120b / Fast, low cost / No groq key" (amber), "OpenAI gpt-4o-mini / Good default for cited
   answers ✓ key saved", "OpenRouter gpt-4o-mini / Billed through OpenRouter ✓ key saved", a separator,
   "Custom… / Type any provider/model name".
3. The chip reads "Answer model: OpenAI gpt-4o-mini"; toast "Answer model set to OpenAI gpt-4o-mini for this
   domain" + **Undo**.

**DmF-SaveTest-1…3: save an answer as a test question (both).**
1. **Save as test question** is ringed.
2. A right sheet (w520) "Save as a test question" / "Quality will check that search keeps finding this":
   - Input "Question" (prefilled)
   - "Files it should find": mono removable chips refund-policy.md ✕, billing-faq.pdf ✕, + ghost **Add file**,
     helper "Taken from the answer’s sources. Any one of them counts as found."
   - "Key words": chips "30 days" ✕ "refund" ✕, helper "All of these must show up in the passages found.
     Suggested from the answer."
   - an info callout "You don’t need the exact answer. Quality checks what search finds, not the wording."
   - footer "Quality · 12 test questions", ghost **Cancel**, primary **Save test**
3. Toast "Saved as test question 13" + **View in Quality**.

### Quality

**Dm-Quality: Quality tab (both).**
- Three score cards: "Found the right file" 83% / "At least one expected file was in the top 8 passages.";
  "Found the key words" 75% / "Every key word you listed showed up in the passages found."; "Test questions" 12
  / "Last run 2 hours ago · Meaning search · 8 passages".
- A row with "Compare with" + Select (w260, "Previous run · Sep 24, 10:02"), secondary **Add test question**
  (+), primary **Run all tests** (▷).
- A table: Question · Expected file (mono) · Key words · Right file · Key words · ⋯ ("More actions for
  <question>"). Result cells are success "✓ Found" or danger "✕ Missed" badges.

**DmF-Qual-1: no tests (both).** A dashed card: target tile, serif "Check that search finds the right files",
"Add questions you already know the answer to. Tvashtr checks whether search finds the file you expect and the
words you list. Run them again after you change a setting to see if it helped.", primary **Add test question**
(ringed), secondary **Pick from Ask history**.

**DmF-Qual-2/3: add a test question (both).**
2. A right sheet (w520) "Add a test question" / "Something you already know the answer to". Input "Question".
   "Files it should find" is a combobox showing "webhooks.md" with a listbox (w472): "webhooks.md 77 pieces" ✓,
   "integrations.html 288 pieces", "api-limits.html 73 pieces", "troubleshooting.pdf 201 pieces". Footer "Type
   to search 14 files", **Cancel**, **Add test**.
3. The file is a chip + **Add file**. Input "Key words" (Optional) "signature, secret", helper "Comma-separated.
   All must appear in what search finds." Footer "Question 8". Behind it, the Quality tab with 7 tests, score
   cards "—" and "Not run yet".

**DmF-Qual-4: running (both).** "Test questions 8 / Not run yet", **Run all tests** loading, and a coral banner
"Running 8 tests… about 20 seconds" with a progress bar. Result cells show "—".

**DmF-Qual-5: results and a miss opened (both).** 88% / 75% / "8 · Ran just now · Meaning search · 8 passages".
The webhook row is expanded: "What search found (top 3 of 8)", three rows (number, mono file, excerpt), and
"webhooks.md wasn’t in the top 8. Try “Both” search, or add “verify” as a key word."

### Settings and its flows

**Dm-Settings: Settings tab (both).** A two-column grid of cards:
- **HOW FILES ARE READ:**
  - "Starting point" Select ("Support · 600-character pieces"), helper "Sets the piece size below. You can still
    change it."
  - "Reading model" Select (w340), helper "Turns each piece into something search can compare." + "✓ openai key
    saved"
  - "Piece size" Input 600 + "characters", helper "Smaller pieces give sharper sources. Bigger pieces keep more
    context."
  - "Overlap" 100 + "characters", helper "Neighbouring pieces share this much, so sentences aren’t cut in half."
- **HOW ANSWERS ARE WRITTEN:** "Answer model" Select (w340, "Account default"), helper "Used by Ask and by Query
  domain nodes. Account default uses your default thinking model."
- **HOW SEARCH WORKS:**
  - "Search by" segmented Meaning | Exact words | Both, helper "Meaning finds paraphrases. Exact words finds
    names and codes. Both merges the two."
  - "Passages per question" Input 8, helper "How many passages an answer can use."
  - Switch "Look wider, then keep the best", helper "Looks at 20 passages first, then keeps the best 8."
  - Switch "Include related passages", helper "Adds up to 4 nearby passages that mention the same names. Off by
    default."
- **A danger card:** "Delete this domain" / "Removes its 14 files, pieces, chat and test questions. Teams using
  it will stop at that step." + secondary **Delete domain…** (trash).

The design renders the segmented control and the Reading-model select overflowing their cells (render bug; build
them to fit). There is no Save button until something changes.

**DmF-Tune-1…4: change search, see if it helped (both).**
1. "Both" is ringed. A sticky bar appears at the bottom: coral dot, "1 unsaved change", ghost **Discard**,
   primary **Save changes**.
2. The bar reads "1 unsaved change · Search by: Both" + amber "No re-read needed", and the primary button becomes
   **Save and run tests** (ringed).
3. The page switches to Quality with a coral banner "Running 12 tests with Both search…" and a progress bar. The
   old scores (83% / 75% / "Last run 2 hours ago · Meaning search · 8 passages") still show.
4. 92% "+8 vs previous run", 83% "+8 vs previous run", "12 · Ran just now · Both search · 8 passages". Two cells
   gain a small sage "fixed" after the Found badge.

**DmF-Embed-1…4: change the reading model (both).**
1. The Reading-model listbox (w460) lists the five models with "1536 · default" / "1536 · older" / "1536 · billed
   via OpenRouter" / "768 · Google AI Studio" / "384 · rate-limited, for testing". The right side shows "✓ key
   saved" or amber "No huggingface token".
2. After picking Gemini, a warn banner at the top of the tab: "**This re-reads all 14 files** with Gemini
   embedding-001 (about 2 minutes). Ask and team lookups pause until it’s done. Your gemini key is saved." The
   bar reads "1 unsaved change · Reading model" + amber "Re-reads 14 files" + **Save and re-read** (ringed). (The
   field hint still says "openai key saved": design bug.)
3. Confirm dialog (w520) "Re-read all 14 files?": "Search compares pieces read by the same model, so every file
   is read again with Gemini embedding-001. It takes about 2 minutes. Teams that look up Support docs meanwhile
   wait." + **Cancel** / **Save and re-read**.
4. The page lands on Sources:
   - header badge warning "Ask paused while re-reading" and meta "14 files · reading with Gemini embedding-001"
   - an info banner "Re-reading with Gemini embedding-001 · about 2 minutes left. Ask is paused until it’s done."
   - rows "Re-reading 91% / 82% / 73%", then "Waiting to read"
   - footer "Re-reading 14 files · 1 done"

**DmF-Piece-1…3: change the piece size (both).**
1. Piece size 400 (ringed). The bar reads "1 unsaved change · Piece size" + amber "Existing files keep 600",
   primary **Save**.
2. Dialog (w520) "Apply the new piece size to existing files?": "New files will use 400-character pieces. Your 14
   existing files still use 600 until they’re read again." Two checked Checkboxes, "Re-read all 14 files now
   (about 2 minutes)" and "Run tests afterwards", then **Cancel** / **Save**.
3. Sources: header badge info "Re-reading 14 files", rows "Re-reading 20%" and "Waiting to read", footer
   "Re-reading 14 files with 400-character pieces · tests run when done", toast "Saved. Re-reading 14 files, then
   running 12 tests."

### Use in teams

**Dm-Teams: Use in teams tab (both).** Three cards:
- **Ask it yourself** (chat tile): "Chat with the files and check sources while you curate this domain. Nothing
  runs in a team.", "Last question asked 2 hours ago.", ghost **Open Ask** (→).
- **A fixed step in a team** (book tile): "Adds a **Query domain** node. It asks one question every run and can
  pass the answer and its sources to the next agents.", a row "Look up support docs / Docs team · answer passed
  to the spec" + ghost **Open canvas** (↗), secondary **Add as a step in a team** (+).
- **Let an agent search it** (bolt tile): "The agent gets two tools: ask this domain, or pull matching passages.
  It decides when. It finds the domain by name.", rows "Product manager / Indicator sprint team · can search this
  domain" and "Reviewer / Support bot · can search this domain", each with **Open canvas**, and secondary **Give
  an agent access** (+).

A sunk strip closes the tab: "‹› For your own MCP clients or scripts: domain ID `dom_7f3a9c21-…`" + ghost
**Copy** (OQ-19).

**DmF-Step-1…5: add it as a step in a team (Step-1–3 both; Step-4/5 are the canvas, both).**
1. The fixed-step card shows "Not in any team yet."; **Add as a step in a team** is ringed.
2. Dialog (w560) "Add Support docs to a team" / "It becomes a Query domain node that asks one question every
   run." The "Team" combobox is open (listbox w512): "Docs team / Product manager → Writer → Reviewer" ✓,
   "Indicator sprint team / Product manager → Engineer → Reviewer", "Support bot / Triage → Reply → Reviewer".
   **Add step** is disabled.
3. Fields: Team Select "Docs team", "Where in the flow" Select ("After Product manager"), Input "Question to ask"
   ("What do our support docs say about {idea}?", helper "{idea} is replaced by the idea you launch the run
   with."), Switch "Pass the answer to the next agents" (on). **Add step** is enabled (ringed).
4. The Docs team canvas opens with the new node selected, placed between Product manager and Writer (card
   "QUERY DOMAIN / Look up support docs / Support docs / Passes the answer on"). The node drawer (w384) is on its
   Setup body (Dm-QueryNode) with a disabled **Save** and "Saved — this drives the next run you launch." Toast
   "Added after Product manager. Connected to Writer."
5. After a run, the card carries a success badge "Answered". The drawer header reads "Query domain / Look up
   support docs · run 14" and has tabs **Setup | Last run**. Last run shows:
   - "Round 1", badge "Answered", "1.9 s · $0.0012"
   - "Asked: “What do our support docs say about a self-serve refund button?”"
   - the answer with chips 1 and 2, and a nested "SOURCES FOR THIS ANSWER" box with two passage cards
   - "✓ Added to the spec · section “What the docs say”"

**DmF-Agent-1…3: let an agent search it (both).**
1. The agent card shows "No agent can search it yet."; **Give an agent access** is ringed.
2. Dialog (w560) "Let an agent search Support docs" / "Pick an agent. It can ask this domain whenever it needs to
   during a run." "Search agents and teams" input, then radio rows: Product manager "Indicator sprint team ·
   xai/grok-4.7" (selected, ringed), Engineer "Indicator sprint team · anthropic/claude-sonnet-5", Writer "Docs team
   · anthropic/claude-sonnet-5", Reviewer "Support bot · xai/grok-4.7". Buttons **Cancel** / **Give access**.
3. The agent card lists "Product manager / Indicator sprint team · can search this domain" and flashes. Toast
   "Product manager can now search Support docs" + **Open canvas**.

### Canvas

**Dm-QueryNode: the Query domain node drawer (both).** The canvas header shows back, primary **Run this team**,
"Docs team", "$0.00" and + ("Add to canvas"). There is no "Connected" label (a canvas-header variant; F5 owns it).
Nodes: PM → Query domain (selected) → Writer → Reviewer. The drawer (`aside` "Node settings", w384):
- header book tile, serif "Query domain" / "Look up support docs", Close
- lede "One cited lookup, every run. The answer and its sources show on the run log."
- Select "Domain" ("Support docs") + a status line "✓ Ready · 14 files · 83% found the right file"
- TextArea "Question to ask" + helper "{idea} is replaced by the idea you launch the run with."
- Switch "Pass the answer to the next agents" (on) + "Adds the answer and its sources to the spec, so the Writer
  and Reviewer read them."
- Select "If the domain has no answer" ("Keep going and say so in the spec")
- footer: disabled primary **Save** + "Saved — this drives the next run you launch."

**Dm-AgentAccess: an agent’s Tools tab with Domains (both).** Indicator sprint team; the PM card gains "Can search
Support docs". The drawer header reads "Product manager / Drafts the spec · xai/grok-4.7", with tabs **Setup |
Tools | Skills | Memory | Runs** (Tools active; this conflicts with the panel design, OQ-2). Its body:
- "DOMAINS THIS AGENT CAN SEARCH": Checkboxes Support docs "Ready · 14 files" ✓, Vendor contracts "Reading 4 of
  6", Research papers "1 file needs attention", Q3 filings "No files yet"
- an info callout "During a run this agent gets two tools: **ask a domain** (answer + sources) and **find
  passages** (no answer). It picks the domain by name — no IDs needed."
- "OTHER TOOLS": REMOTE github (on), LOCAL fetch (web pages) (off)
- footer **Save** + "Unsaved changes"

**DmF-Canvas-1…4: add a Query domain node yourself (both).**
1. + opens the "Add to canvas" menu (w300): Agent, Gate, Ship, Stop, **Query domain** (book icon, ringed).
2. An unconnected card "QUERY DOMAIN / Query domain / Pick a domain" with a warn badge "Needs a domain". The
   drawer Domain combobox is open (w344): "Support docs / Ready · 14 files", "Vendor contracts / Reading 4 of
   6", "Research papers / 1 file needs attention", "Q3 filings / No files yet — can’t be used", separator,
   "New domain…". Question defaults to "{idea}". **Save** is enabled with "Unsaved changes". (The header already
   says "Look up support docs": design bug.)
3. Picked: the card becomes "Look up support docs / Support docs". The drawer shows the status line and the
   question "What do our support docs say about {idea}?". **Save** is ringed.
4. The card has a warn badge "No way out"; a warn banner reads "**Can’t run yet.** Look up support docs has no
   way out. Drag from its right edge to the next node." + secondary **Show me** (ringed).

### List menu and search

**DmF-Menu-1…4: ⋯ menu, rename and delete (both).**
1. Card ⋯ → menu (w210): Open, Ask a question, Rename, Duplicate settings, Copy domain ID, separator, Delete…
2. Dialog (w460) "Rename domain", Input "Name" ("Q3 2026 filings"), **Cancel** / **Save name**.
3. Dialog (w500) "Delete Vendor contracts?": "This removes its 6 files, their pieces, the chat history and test
   questions. It can’t be undone." Input "Type the domain name to confirm" (filled), **Cancel** / primary
   **Delete domain** (trash).
4. The card and the nav child are gone; toast "Vendor contracts deleted" (no Undo).

**DmF-Find-1…3: search and sort (both).**
1. "contr" leaves Vendor contracts.
2. "filings 2025" shows a dashed empty card "No domains match “filings 2025”. **Clear search**".
3. The Sort listbox (w220): Recently updated ✓, Name, Most used, Needs attention first.

---

## 2. Behaviour requirements

### Navigation and shell
- **DM-1** In the left nav, **Domains** is a collapsible group (chevron) like Engines/Toolkit:
  - its children are one row per domain: name (13 px) + a 7 px status dot — `--sage-500` Ready, `--coral-500`
    Reading or re-reading, `--amber-500` Needs attention or waiting for a key, `--stone-300` Empty
  - the group is open whenever a `#/domains…` address is showing
  - the parent has `aria-current="page"` on the list; the domain's child has it on that domain's pages
  - no count badge
  - child order: see OQ-3
- **DM-2** In the Domains section the nav foot reads "**Domains** are libraries of your own files. You and your
  agents ask them questions and get answers with sources." (in place of the Shortcuts card).
- **DM-3** Addresses:
  - `#/domains` (list)
  - `#/domains/<id>` (detail on Sources)
  - `#/domains/<id>/ask|quality|teams|settings`
  - `?file=<documentId>[&piece=<n>]` opens the file preview over the current tab
  - ⌘K "Open the <name> domain" goes to `#/domains/<id>`
  - an unknown id shows "This domain doesn’t exist any more." + **Back to Domains** (proposed)
- **DM-4** Live data: while any file is uploading, waiting, reading or re-reading, or a test run is running, the
  list, nav dots and detail poll every 3 s. Otherwise they refresh on mount and on window focus. Counts in the
  tabs, strip and meta line always update together; several frames leave them stale (OQ-5).

### List (Dm-List, DmF-Find, DmF-Menu)
- **DM-5** Header: h1 "Domains", lede "Libraries of your own files. You and your agents ask them questions and
  get answers with sources.", primary md **New domain** (+).
- **DM-6** The how-it-works strip has three cells:
  - "1. Add your files" / "PDF, Markdown, text or HTML. They’re split into pieces and read."
  - "2. Ask with sources" / "Every answer shows the exact passages it used."
  - "3. Use it in a team" / "As a fixed step, or let an agent search when it needs to."
  - IconButton "Hide how domains work" hides it for this account (preference `domains_howto_hidden`)
- **DM-7** "Search domains" (w280) filters by name, case-insensitive substring. No match shows a dashed card "No
  domains match “<q>”." + link **Clear search**.
- **DM-8** "Sort" Select (w220): **Recently updated** (default; last activity, newest first), **Name** (A–Z),
  **Most used** (uses, then name), **Needs attention first** (needs attention → waiting for a key → reading →
  ready → empty, then recently updated).
- **DM-9** Card: serif name (link to `#/domains/<id>`), status badge, outline template badge (Support · Legal ·
  Financial · Scientific · Blank), IconButton "More actions for <name>", three icon lines and a footer.
  - status badges: success-dot "Ready", info-dot "Reading", warning-dot "Needs attention", neutral "Empty";
    proposed warning-dot "Waiting for a key"
  - footer: "Updated <relative>" (last activity) or, with no files, "Created <Mon D>"
- **DM-10** Files line: "14 files · 1,212 pieces" (ready) · "6 files · reading 4 of 6" (N = files already read)
  · "9 files · 1 needs attention" · "No files yet". Proposed: "3 files · waiting for an openai key".
- **DM-11** Quality line: "83% found the right file" (latest finished run's `hit_at_k`, rounded) · "No test
  questions yet" · "—" (no files). Proposed: "12 test questions · not run yet".
- **DM-12** Usage line: "Used 3 times in 2 teams" (N uses = Query domain steps + agents with access, M distinct
  library teams) · "Used in 1 team" (one use) · "Not used yet". Agents with the legacy "all domains" switch
  count for every domain.
- **DM-13** Card ⋯ menu (w210): **Open**, **Ask a question** (→ Ask tab), **Rename**, **Duplicate settings**,
  **Copy domain ID**, separator, **Delete…** (danger). Escape/outside click closes it; arrow keys move.
- **DM-14** Rename dialog (w460): "Rename domain", Input "Name" (prefilled, selected), **Cancel** / **Save
  name**. Proposed errors: empty "Give this domain a name."; clash "You already have a domain named
  “<name>”." Save updates the card, nav, breadcrumb and h1.
- **DM-15** Delete dialog (w500): "Delete <name>?", "This removes its <n> files, their pieces, the chat history
  and test questions. It can’t be undone."
  - Input "Type the domain name to confirm"; **Delete domain** (primary, trash) stays disabled until the trimmed
    text equals the name
  - on success: toast "<name> deleted" (no Undo); the card and nav child go; on the detail page, go to
    `#/domains`
  - add one line when the domain is in use (proposed): "<Step> in <Team> will need another domain before the
    team can run." (OQ-14)
- **DM-16** Duplicate settings creates "<name> copy" with the same template and settings, no files. Proposed
  toast "Copied the settings to “<name> copy”." + **Open**.
- **DM-17** Copy domain ID puts the raw UUID on the clipboard. Proposed toast "Domain ID copied."

### Empty and first time
- **DM-18** With no domains, the page shows the empty card (DM copy in §1: "Give your agents your own documents"
  …, **New domain**, **How domains work**) and "Or start from a template" with Support / Legal / Financial /
  Scientific. Each card has its short line and "<n>-character pieces" pill.
- **DM-19** A template card opens the New domain dialog with that template picked.
- **DM-20** The key hint reads "You’ll need an API key for a reading model, like OpenAI. There’s also a free
  Hugging Face option for testing." **Check Engines** goes to `#/engines/keys` (the embeddings section,
  ENG-6). Hide the hint when the account already holds a key for any reading model.
- **DM-21** **How domains work** opens a Dialog with the DM-6 steps (proposed; the design draws no target).

### New domain dialog (Dm-NewDialog, DmF-First-2/3, DmF-NoKey)
- **DM-22** Step 1 (w720, `role=dialog`, "New domain"): header "New domain" / "Step 1 of 2 · Name it and pick
  what kind of files it holds", Close.
  - Input "Name", placeholder "e.g. Support docs", autofocus
  - "Starting point": five `role=radio` cards with the §1 copy, Support picked by default (or the template from
    DM-19)
  - footer: **Cancel**, **Next: add files**
- **DM-23** Reading-model line: "Files are read with **<model label>** ✓ key saved" + link **Change**. Change
  swaps the line for the Reading-model picker (the DM-82 listbox), so a model can be chosen before creating.
- **DM-24** With no key for the model's provider, a warn callout replaces the line: "**No <p> key yet.** Files
  are read with <model label>, which needs one. You can create the domain now, but files wait until a key is
  added." with tint **Add <p> key** and ghost **Use the free Hugging Face model**. The HF button is hidden
  when HF is already the model.
- **DM-25** **Add <p> key** opens the Engines Add-key sheet (F2 `AddKeySheet`) with the provider picked:
  - subtitle "So Domains can read files with <model label>"
  - hint "Covers models that start with <p>/, like <model slug>."
  - footer "Used by Domains · reading files"
  - on save: the callout turns back into the key-saved line, toast "<p> key saved", and focus returns to the
    dialog
- **DM-26** **Use the free Hugging Face model** sets the model to `huggingface/BAAI/bge-small-en-v1.5`. HF still
  needs a (free) token, so if none is held the callout becomes: "**No huggingface token yet.** Hugging Face
  BGE-small is free, but it needs a free token from huggingface.co. You can create the domain now, but files
  wait until a token is added." + tint **Add huggingface token** (proposed; OQ-9).
- **DM-27** **Next: add files** validates the name (DM-14 errors under the field). A missing key does not block.
- **DM-28** Step 2: header "Step 2 of 2 · Add files to <name>".
  - drop zone "Drop files here, or **choose files**" + "PDF, Markdown, text or HTML · up to 10 MB each · as many
    as you like"
  - the list: kind tile, mono name, size, IconButton "Remove <name>"
  - callout "Reading starts as soon as the domain is created. It takes about a minute for small files."
  - footer: **Back**; **Skip — add files later**; primary **Create and read <n> files** ("1 file" singular;
    disabled at 0, where Skip is the path)
  - a picked file over 10 MB or of another type is listed with a danger note ("Over 10 MB." / "Only PDF,
    Markdown, text or HTML.") and not uploaded (proposed)
- **DM-29** Creating a domain:
  - `POST /api/domains` with name, template and reading model, then uploads each file with a progress bar,
    then goes to `#/domains/<id>`
  - reading starts by itself (DM-43)
  - the nav child appears with a coral dot
  - a failed create keeps the dialog open with "Couldn’t create the domain — is the backend running?"
- **DM-30** The first-read view:
  - header badge info "Reading <n> files" and meta "<n> files · read with <model label> · created just now"
  - the four-step setup strip (DM-37)
  - when every file is done: toast "<name> is ready. Ask it a question." + **Ask now** (→ Ask tab)

### Detail header, strips and tabs
- **DM-31** Header: breadcrumb "Domains" › <name>; serif h1; status badge; outline "<Template> template"; meta
  line; secondary sm **Use in a team** (switches to the Use in teams tab); outline IconButton "More actions for
  <name>" opens the DM-13 menu without "Open".
- **DM-32** Header badges:
  - success-dot "Ready"
  - info-dot "Reading <n> files" / "Re-reading <n> files"
  - warning-dot "<n> file needs attention" / "<n> files need attention"
  - warning-dot "Ask paused while re-reading" (a full re-read, no ready pieces left)
  - neutral "Empty"
  - proposed warning-dot "Waiting for a <p> key"
- **DM-33** The meta line joins "<n> files", "<p> pieces" (ready), "read with <model label>" (or "reading with
  <model label>" during a full re-read), and "updated <relative>" or "created just now".
- **DM-34** The summary strip shows on the Sources tab only, once the setup strip is gone (OQ-4). Four items with
  check icons:
  - "Reading key saved (<p>)" (warn icon "No <p> key" when missing)
  - "<r> of <n> files read"
  - "<c> test questions · <x>% found the right file" (or "No test questions yet")
  - the DM-12 usage phrase
- **DM-35** Line Tabs: **Sources** (count = files), **Ask**, **Quality**, **Use in teams** (count = uses,
  hidden at 0), **Settings**.
- **DM-36** Detail sub-pages are addresses (DM-3). Changing tab replaces history (no Back pile-up).
- **DM-37** The setup strip shows until the first read finishes. Its four cells:
  - (✓/warn) "Reading key" / "<p> key saved" or "No <p> key" + **Add key**
  - (spinner/✓) "Add files" / "Reading <n> files…" or "<n> files read"
  - "3" "Test it" / "Ask a question when reading finishes"
  - "4" "Use it in a team" / "As a fixed step, or give an agent access"

### Sources tab
- **DM-38** Toolbar: "Search files" (w260), Show Select (DM-47), primary sm **Add files** (upload icon; opens a
  multi-file picker, `accept=.pdf,.md,.txt,.html`).
- **DM-39** Hint row: "Drop files here, or use **Add files**. PDF, Markdown, text or HTML, up to 10 MB each. New
  files are read automatically." During a full re-read an info banner sits above it: "Re-reading with <model
  label> · about <n> minutes left. Ask is paused until it’s done."
- **DM-40** Dragging files anywhere over the tab body shows the overlay: "Drop to add <n> files to <name>" /
  "They’re read automatically. You can ask about them in about a minute."
- **DM-41** Table columns: File (kind tile PDF/MD/HTML/TXT + name button) · Size (KB/MB, one decimal ≥ 1 MB) ·
  Pieces (count or "—") · Status (w240) · Added ("Just now" under a minute, else "Mon D") · ⋯ ("More actions for
  <file>"). Newest added first.
- **DM-42** Status cell:
  - "✓ Ready"
  - "Reading <p>%" (coral bar) / "Re-reading <p>%" (a file read before)
  - "Uploading <p>%" (amber bar, browser upload)
  - "◷ Waiting to read"
  - "⚠ Needs attention" + reason (danger text) + optional fix link
  - proposed "◷ Waiting for a <p> key" + **Add key**
- **DM-43** Needs-attention reasons (humanised from the stored error):
  - key rejected: "<Vendor> rejected the key (401). **Fix key in Engines**" (→ `#/engines/keys`)
  - no text: "No text found. It may be a scanned image. Export it as text-based PDF."
  - over 10 MB (never uploaded): "Over 10 MB. Split it or compress it, then add it again."
  - proposed: rate limit "<Vendor> is busy right now. Re-read it in a minute."; wrong type "Only PDF, Markdown,
    text or HTML files can be read."; anything else "Couldn’t read this file: <first line of the error>."
- **DM-44** Rows needing attention are tinted danger-50; a row being re-read is tinted coral-50 (Fail-3).
- **DM-45** Footer variants:
  - "<n> files · <p> pieces"; with a filter or search "Showing <k> of <n> files · <p> pieces" (OQ-7)
  - "<n> files · reading <r> of <n>" (first read)
  - "<n> files · reading <a>, uploading <b>, waiting <c>" (only non-zero parts)
  - "<n> files · <k> needs attention"
  - "<k> of <n> files match “<q>”"
  - "<k> file needs attention · **Show all files**"
  - "Re-reading <n> files · <d> done"
  - "Re-reading <n> files with <size>-character pieces · tests run when done"
- **DM-46** "Search files" matches file names and file text (case-insensitive). A text-only match needs no badge.
- **DM-47** The Show listbox (w220): "All files <n>", "Ready <n>", "Reading <n>" (reading + waiting +
  uploading), "Needs attention <n>". The picked option has a ✓.
- **DM-48** Uploads:
  - dropped or picked files are checked client-side (≤ 10 MB, allowed type) and uploaded two at a time with
    progress
  - the server starts reading by itself
  - a rejected file stays as a local row until removed, with toast "<file> is <size>. The limit is 10 MB." +
    **Remove it**
  - after a batch: toast "<n> files added to <name>" (singular "1 file added to <name>")
- **DM-49** Row ⋯ menu (w220): **Preview pieces**, **Re-read this file**, **Download original**, **Copy file
  ID**, separator, **Delete file…** (danger). A local-only rejected row offers only **Remove**.
- **DM-50** **Re-read this file** marks the row "Re-reading 0%" and reads it again. On success: toast "<file> is
  ready · <n> pieces". A failure returns the row to Needs attention.
- **DM-51** The preview sheet (w560, `role=dialog`, labelled with the file name):
  - serif name; "<Kind> · <size> · <n> pieces · added <Mon D>"; Close
  - "Find in this file" (filters pieces; proposed empty "No pieces mention “<q>”.")
  - piece cards "Piece <i> of <n>" · "<chars> characters", excerpt ("…" when cut), paged by 50 with **Show
    more** (proposed); with `piece=<n>` it scrolls to and highlights that piece
  - footer "Used in <k> of the last <m> answers" (m ≤ 20; hidden with no answers), ghost **Download original**,
    secondary **Re-read**
  - opens from a file name, **Preview pieces**, or **Open file** in Ask
- **DM-52** **Download original** saves the uploaded bytes under their stored name (same window; see §4 D2).
- **DM-53** Delete file dialog (w500) "Delete <file>?":
  - text "Its <n> pieces leave <domain>. Answers stop citing it." + "<k> test question expects this file and
    will be flagged." (plural "<k> test questions expect…"; omitted at 0)
  - info callout "Teams using <domain> keep working with the other <n−1> files." (at n−1 = 0: "<domain> will
    have no files, so teams using it can’t get answers until you add one.", proposed)
  - **Cancel** / primary **Delete file** (trash)
  - on confirm the row hides at once; toast "<file> deleted" + **Undo** (≈6 s); the delete is committed when the
    toast closes (OQ-12)
- **DM-54** A test question whose expected file was deleted shows the file as "<name> (deleted)" with a warn
  badge "File deleted" in Quality (proposed copy).

### Ask tab
- **DM-55** Layout: thread + composer (left), `aside` "Sources" (w340, right). The lock line reads "Answers use
  only the files in <name>. Nothing else." + ghost **Clear chat**.
- **DM-56** Empty thread:
  - chat tile, serif "Ask <name> anything", "Every answer lists the files and passages it used. If the files
    don’t cover it, you’ll be told so."
  - up to four suggestion pills + "Suggested from your file names"; a pill fills the composer and asks
  - the empty aside reads "Sources show up here" / "Click a number in an answer to read the exact passage it came
    from."
- **DM-57** Composer:
  - TextArea placeholder "Ask <name> a question" (3 rows); Enter asks, Shift+Enter is a newline (proposed)
  - the chip button "Answer model: **<label>**" ⌄ (DM-63)
  - Switch "Use earlier messages" (default on, per session)
  - primary sm **Ask** (↑); disabled while empty or pending; pending shows loading and a proposed "Searching
    <name>…" placeholder bubble
- **DM-58** Answer card:
  - the answer as light Markdown (bold, lists, code) with inline number chips at the model's citation markers
  - "Sources" line: chip + mono file name per cited source, joined by "·"
  - ghost **Copy** (answer text, markers removed), **Save as test question**, **Show what search found**
  - meta "<s> s · <model label>" (e.g. "1.8 s · OpenAI gpt-4o-mini")
- **DM-59** Numbering: sources are only the passages the answer cites, numbered 1…m in order of first mention.
  Cards in the aside use the same numbers (Follow-2's "2" is a design bug, OQ-6).
- **DM-60** Aside cards:
  - number chip, mono file name, meta "piece <i> of <n>" or "page <p> · piece <i> of <n>" (PDFs), excerpt
  - the part of the excerpt closest to the cited sentence is highlighted (OQ-10)
  - the active card is tinted coral with ghost **Open file** (preview sheet at that piece) and **Copy passage**
  - clicking a chip in the answer, a chip in the Sources line or a card makes it active and scrolls it into view
  - the aside shows the latest answer's sources, or the answer the user last clicked in
- **DM-61** **Show what search found** switches the aside to "WHAT SEARCH FOUND" (all passages retrieved, in rank
  order, with score-less numbering 1…k and "piece"/"page" meta). A proposed ghost **Back to sources** returns.
- **DM-62** Not covered (the model says the files don't answer):
  - amber answer card "I couldn’t find this in <name>." followed by the model's short note, and "Sources" = the
    two closest passages
  - no inline chips, no **Copy**, no latency line
  - under the card: secondary **Add a file about it** (Sources tab with the file picker open) and ghost **Save as
    test question**
- **DM-63** Answer model listbox (w380, opens upward from the chip):
  - "Account default" / "Your default thinking model" + tag (✓ "key saved" or amber "No <p> key", for the model
    the default resolves to)
  - "Groq gpt-oss-120b" / "Fast, low cost"; "OpenAI gpt-4o-mini" / "Good default for cited answers";
    "OpenRouter gpt-4o-mini" / "Billed through OpenRouter" — each with its key tag
  - separator, "Custom…" / "Type any provider/model name" (swaps in an Input "provider/model", Enter saves)
  - the account default's resolved model shows as a tooltip/second line "Now <model label>" (OQ-11)
  - NIM is never offered (it serves no seat)
- **DM-64** Picking a model saves it for the domain (same setting as Settings › Answer model). Toast "Answer model
  set to <label> for this domain" + **Undo** (puts the previous value back).
- **DM-65** Follow-ups: with "Use earlier messages" on, the next question uses the earlier turns (§3, the
  Ask row). The answer shows the small line "Used your earlier question for context" when earlier turns were used.
  Off: the question stands alone.
- **DM-66** Errors (inline under the composer, proposed copy):
  - missing key "Add a <p> key to ask — <p> reads the question" / "…writes the answer" + **Add <p> key** (F2
    sheet)
  - no ready files "Add files and wait for them to be read before asking." + **Go to Sources**
  - re-reading "Ask is paused while <name> re-reads its files." (composer disabled)
  - provider failure "<Vendor> didn’t answer. Try again." (the 502 text in a tooltip)
  - network "Couldn’t reach Tvashtr — is the backend running?"
- **DM-67** **Clear chat** empties the thread at once with toast "Chat cleared." + **Undo** (≈6 s; the delete is
  committed when the toast closes, OQ-12).

### Save as a test question
- **DM-68** The sheet (w520) "Save as a test question" / "Quality will check that search keeps finding this":
  - Input "Question" (the asked question)
  - "Files it should find": mono chips of the cited files ✕ + ghost **Add file** (file combobox, DM-71) + helper
    "Taken from the answer’s sources. Any one of them counts as found."
  - "Key words": chips ✕ + a type-to-add input, prefilled with suggestions from the answer (OQ-15) + helper "All
    of these must show up in the passages found. Suggested from the answer."
  - info callout "You don’t need the exact answer. Quality checks what search finds, not the wording."
  - footer "Quality · <n> test questions", **Cancel**, primary **Save test**
  - the question may not be empty; at least one file or one key word is required (proposed error "Add a file or
    a key word, so there’s something to check.")
- **DM-69** Saved: toast "Saved as test question <n>" + **View in Quality**. From a not-covered answer the files
  start empty.

### Quality tab
- **DM-70** With no test questions: the dashed card "Check that search finds the right files" + copy (§1) +
  **Add test question** + **Pick from Ask history**.
- **DM-71** Add test sheet (w520) "Add a test question" / "Something you already know the answer to":
  - Input "Question"
  - "Files it should find": a file combobox (listbox w472, "<file> / <n> pieces", search by name, ✓ picked,
    footer "Type to search <n> files"); picked files become chips + **Add file**
  - Input "Key words" (Optional), helper "Comma-separated. All must appear in what search finds."
  - footer "Question <n+1>", **Cancel**, **Add test**
  - errors as DM-68; the 50-question cap shows "You can have up to 50 test questions." (proposed)
- **DM-72** Score cards:
  - "Found the right file" <x>% / "At least one expected file was in the top <k> passages."
  - "Found the key words" <y>% / "Every key word you listed showed up in the passages found."
  - "Test questions" <n> / "Last run <relative> · <Mode> search · <k> passages", or "Ran just now · …" under a
    minute, or "Not run yet"
  - before any run the percentages read "—"
  - when compared, "+8 vs previous run" / "−5 vs Run 3" (whole percentage points; "same as previous run" at 0;
    proposed wording beyond the design's "+8 vs previous run")
  - a metric with no scored cases shows "—" with "No key words to check yet." (proposed)
- **DM-73** "Compare with" Select (w260):
  - options "Previous run · <Mon D, HH:MM>" and "Run <n> · <Mon D> · <what differed>" ("Meaning search",
    "Exact words search", "Both search", "<size>-character pieces", "<model label>", "<k> passages")
  - disabled "No earlier run" when there is none
- **DM-74** Buttons: secondary **Add test question** (+), primary **Run all tests** (▷; loading while running;
  disabled with no questions).
- **DM-75** While running:
  - a coral banner with a progress bar: "Running <n> tests… about <t> seconds", or "Running <n> tests with <Mode>
    search…" when a settings save started it
  - result cells show "—"; the score cards keep the last results
  - cells fill in as cases finish (proposed)
- **DM-76** Table:
  - Question · Expected file (mono; "<file> +1" for several) · Key words ("a, b") · Right file · Key words · ⋯
  - result badges: success "✓ Found" / danger "✕ Missed" / "—" (not scored, or not run)
  - a small sage "fixed" (proposed danger "new miss") after a badge that changed against the compared run
- **DM-77** Clicking a row with a miss expands it:
  - "What search found (top 3 of <k>)" with three rows: number, mono file, excerpt
  - one hint: "<file> wasn’t in the top <k>." + "Try “Both” search." when the run wasn't Both (OQ-16)
- **DM-78** Row ⋯ menu (proposed): **Edit** (the DM-71 sheet, "Save changes"), **Delete** (no confirm; toast
  "Test question deleted." + **Undo**).
- **DM-79** **Pick from Ask history** (proposed): the DM-71 sheet with a question list from the chat, newest
  first. Picking one fills the question and its cited files.

### Settings tab
- **DM-80** Layout (two columns): left "HOW FILES ARE READ" and "HOW ANSWERS ARE WRITTEN"; right "HOW SEARCH
  WORKS" and the danger card. Copy as in §1.
- **DM-81** "Starting point" (templateOpts) sets the template and fills Piece size and Overlap with its defaults
  (support 600/100, legal 500/80, financial 700/100, scientific 1000/150, blank 800/100). The helper reads "Sets
  the piece size below. You can still change it."
- **DM-82** "Reading model" (w340):
  - a listbox (w460): label, "<dim> · default" / "older" / "billed via OpenRouter" / "Google AI Studio" /
    "rate-limited, for testing", and the key tag (✓ "key saved" / amber "No <p> key" / "No huggingface token")
  - the helper's tag follows the selected model's provider (Embed-2's "openai key saved" is a design bug)
- **DM-83** Piece size and Overlap are sm Inputs + "characters". Proposed errors: size "Use a number from 100 to
  4,000."; overlap "Use a number from 0 to <size − 1>." / "Overlap must be smaller than the piece size."
- **DM-84** "Answer model" is the DM-63 list as a Select (w340). The helper reads "Used by Ask and by Query domain
  nodes. Account default uses your default thinking model."
- **DM-85** "Search by" segmented Meaning | Exact words | Both (= dense | lexical | hybrid). "Passages per question"
  is top_k (proposed range 1–30: "Use a number from 1 to 30."). "Look wider, then keep the best" = rerank on
  (helper "Looks at <top_n> passages first, then keeps the best <k>."). "Include related passages" = graph-lite
  (helper, OQ-18).
- **DM-86** The danger card: "Delete this domain" / "Removes its <n> files, pieces, chat and test questions."
  plus the in-use sentence (OQ-14); **Delete domain…** opens the DM-15 dialog.
- **DM-87** Editing shows a sticky save bar (bottom of the tab):
  - coral dot, "<n> unsaved change(s)" + " · <field>: <value>" for a single change (e.g. "· Search by:
    Both"), + an amber impact note
  - ghost **Discard**
  - a primary action with its impact note:
    - search/answer-only changes: note "No re-read needed"; **Save changes**, or **Save and run tests** when
      the search changed and tests exist
    - reading model changed: note "Re-reads <n> files"; **Save and re-read**
    - piece size, overlap or starting point changed: note "Existing files keep <old size>"; **Save** (opens
      DM-90)
  - leaving the tab or page with unsaved changes asks "Discard your changes to Settings?" (proposed, reuses the
    unsaved guard)
- **DM-88** Changing the reading model shows a warn banner at the top of the tab: "**This re-reads all <n> files**
  with <model label> (about <t> minutes). Ask and team lookups pause until it’s done. Your <p> key is saved."
  (missing key: "…You don’t have a <p> key yet." + **Add <p> key**, and **Save and re-read** is disabled).
  Choosing the same model through a different route (OpenAI 3-small ↔ OpenRouter 3-small) needs no re-read (OQ-17).
- **DM-89** **Save and re-read** opens the dialog "Re-read all <n> files?": "Search compares pieces read by the same
  model, so every file is read again with <model label>. It takes about <t> minutes. Teams that look up <name>
  meanwhile wait." + **Cancel** / **Save and re-read**. Confirming saves, starts the re-read, and goes to Sources
  (DM-32/33/39/42).
- **DM-90** Saving a piece-size, overlap or starting-point change opens "Apply the new piece size to existing
  files?":
  - "New files will use <new>-character pieces. Your <n> existing files still use <old> until they’re read
    again."
  - Checkboxes "Re-read all <n> files now (about <t> minutes)" (on) and "Run tests afterwards" (on; hidden with
    no tests or when re-read is off)
  - **Cancel** / **Save**
  - with re-read on: go to Sources, toast "Saved. Re-reading <n> files, then running <c> tests." (or "Saved.
    Re-reading <n> files.")
  - with it off: toast "Saved. New files use <new>-character pieces."
- **DM-91** **Save and run tests** saves, goes to Quality, runs every test with the new setting and compares with
  the previous run (DM-72/76).

### Use in teams tab
- **DM-92** Three cards (copy in §1):
  - **Ask it yourself:** "Last question asked <relative>." or "No questions yet." (proposed), **Open Ask**
  - **A fixed step in a team:** one row per Query domain node using this domain — title / "<Team> · answer passed
    to the spec" (or "· answer on the run log only" when passing is off, proposed) + **Open canvas**
    (`#/teams/<team>?node=<node>`); empty "Not in any team yet."; **Add as a step in a team**
  - **Let an agent search it:** one row per agent with access — role title / "<Team> · can search this domain"
    (legacy all-domains agents: "· can search all your domains") + **Open canvas**; empty "No agent can search
    it yet."; **Give an agent access**
- **DM-93** The ID strip reads "Domain ID" + mono raw UUID + ghost **Copy** (OQ-19).
- **DM-94** Add-step dialog (w560) "Add <name> to a team" / "It becomes a Query domain node that asks one question
  every run.":
  - "Team" combobox (listbox w512: team name / pipeline "A → B → C" from `shape`); **Add step** stays disabled
    until a team is picked
  - after the pick: "Where in the flow" Select with "After <agent>" for each agent on the main path with one way
    out; default after the first agent (OQ-20)
  - Input "Question to ask", default "What do our <name, first letter lower-cased unless an acronym> say about
    {idea}?", helper "{idea} is replaced by the idea you launch the run with."
  - Switch "Pass the answer to the next agents" (on)
  - **Cancel** / **Add step**
  - a team with no agents lists as disabled "No agents yet" (proposed)
- **DM-95** Adding goes to `#/teams/<team>?node=<new>` with the node selected. Toast "Added after <agent>.
  Connected to <next>." (or "Added after <agent>." when nothing follows).
- **DM-96** Give-access dialog (w560) "Let an agent search <name>" / "Pick an agent. It can ask this domain
  whenever it needs to during a run.":
  - "Search agents and teams" filter
  - radio rows: role title / "<Team> · <model>"; agents that already have access show checked and disabled with
    "Can search it already" (proposed)
  - an agent whose model a Desktop subscription covers gets a second line "On Tvashtr Desktop with your
    <Claude/Grok> plan it can’t search domains yet." (honest copy, B-16)
  - **Cancel** / **Give access**
- **DM-97** Giving access: toast "<Role> can now search <name>" + **Open canvas**; the new row flashes.

### Canvas: Query domain node
- **DM-98** The "Add to canvas" menu (w300) lists Agent, Gate, Ship, Stop, **Query domain** (book icon). The new
  node has title "Query domain", question "{idea}", no domain, pass-to-spec on, "Keep going…".
- **DM-99** Card:
  - eyebrow "QUERY DOMAIN" (coral), title, the domain name (or "Pick a domain"), footer "Passes the answer on"
    when passing is on
  - badges: warn "Needs a domain", warn "No way out", success "Answered", proposed amber "No answer" and danger
    "Failed" after a run
  - the agent card of a node with access gains "Can search <name>" ("+<n>" for more)
- **DM-100** Drawer Setup body:
  - header: book tile, "Query domain", title; lede as §1
  - Domain combobox: options "<name> / <status line>" (Ready · <n> files; Reading <r> of <n>; <k> file needs
    attention; "No files yet — can’t be used" disabled), separator, **New domain…** (opens the New domain dialog;
    the new domain is picked)
  - the status line under the Select: "✓ Ready · <n> files · <x>% found the right file" (warn variants)
  - TextArea "Question to ask" + helper
  - Switch "Pass the answer to the next agents" + helper "Adds the answer and its sources to the spec, so the
    <downstream agent titles joined by ‘and’> read them."
  - Select "If the domain has no answer": Keep going and say so in the spec | Stop the run and tell me
  - footer **Save** + "Unsaved changes" / "Saved — this drives the next run you launch."
- **DM-101** Picking a domain on a node whose title is still the default renames it "Look up <name,
  first-letter rule>" and sets the question to the DM-94 default if it is still "{idea}".
- **DM-102** Validity: "Needs a domain" (`domain_query_no_domain`, also for a deleted domain) and "No way out"
  (`no_exit`). The canvas banner reads "**Can’t run yet.** <title> has no way out. Drag from its right edge to the
  next node." + **Show me** (F5 owns the banner; the text comes from the validity message).
- **DM-103** After a run, the drawer has tabs **Setup | Last run**; the header adds " · run <n>". Last run shows:
  - "Round <i>" + badge (Answered / No answer / Failed) + "<s> s · $<cost>"
  - "Asked: “<rendered question>”"
  - the answer with chips and a "SOURCES FOR THIS ANSWER" box (DM-60 cards)
  - "✓ Added to the spec · section “What the docs say”" (or "Not added to the spec" when passing is off, or the
    failure reason)
- **DM-104** Run behaviour:
  - covered: record the answer; with passing on, add a new spec version with a section "What the docs say"
    (question, answer, numbered sources with file and piece)
  - not covered + "Keep going": the section says "<domain> had no answer for: “<question>”" and the run
    continues
  - not covered + "Stop the run and tell me": the run fails with "<title> stopped the run: <domain> has no answer
    for “<question>”."
  - the domain is re-reading: wait up to 10 minutes, then fail with "<domain> was still re-reading its files."
  - errors (no key, no files) fail as today with the humanised reason

### Agent access (drawer)
- **DM-105** In the agent drawer's tools tab, a section "DOMAINS THIS AGENT CAN SEARCH" lists every domain as a
  Checkbox with its status description (as DM-100). The Save flow is the drawer's. It replaces the round-1
  single "Domains" switch (OQ-2).
- **DM-106** The info callout reads "During a run this agent gets two tools: **ask a domain** (answer + sources)
  and **find passages** (no answer). It picks the domain by name — no IDs needed." A subscription-covered model
  adds the DM-96 note.

### Cross-cutting
- **DM-107** Toasts are dark, bottom-centre, `role=status`, with at most one action. They last ≈6 s and pause on
  hover. Undo exists only where DM-53/64/67/78 say so.
- **DM-108** Loading and errors:
  - skeleton cards/rows while loading
  - a failed load shows an inline error "Couldn’t load your domains — is the backend running?" + **Retry** (tab
    variants "Couldn’t load the files." etc.)
  - every fetch reports to `backendStatus` (`reportFetchFailed` / `reportFetchOk`)
  - API answers are validated at the client boundary
- **DM-109** Accessibility:
  - tabs use the Tabs primitive (`role=tablist`)
  - tables use `scope=col` headers
  - badges carry text; progress bars are `role=progressbar` with a value
  - dialogs and sheets are labelled and trap focus
  - the file and model pickers use the combobox/listbox pattern
  - the drop zone has a keyboard path (**Add files** / **choose files**)
  - number chips are buttons labelled "Source <n>: <file>"
- **DM-110** Honest copy: never claim a subscription reads or answers (Domains always use API keys, on both
  surfaces); never list NIM; "key saved" only when the key exists; percentages come from real runs.

---

## 3. Backend gap table

New routes go in a **new** `backend/tvashtr/routes/domains.py` (an `APIRouter`; the lead adds it to the revamp
router tuple in `main.py`). New logic goes in `control_plane/`: `domain_views.py` (summaries, phases,
humanised problems), `domain_read.py` (automatic reading), `domain_usage.py` (steps, agents, splice),
`domain_answers.py` (marker renumbering, coverage, follow-up query; pure). Existing endpoints in `routers.py`
change in place, additively. **Every route resolves the domain with `_owned_domain`; another account's domain,
document, case, run, team or node is a 404** (`"domain not found"`, `"document not found"`, `"case not found"`,
`"run not found"`, `"team not found"`, `"node not found"`).

| ID | Needs | Status | Where / proposal |
|---|---|---|---|
| DM-9–12, DM-1, DM-8, DM-33/34 | List and nav summary: file/piece counts by phase, quality, usage, last activity | **PARTIAL** | `GET /api/domains` returns `{domain_id,name,template,config,status,doc_count,created_at,updated_at}`. Add per item (computed in `domain_views.list_summaries`, grouped queries, owner-scoped): `files:{total,ready,reading,waiting,waiting_for_key,needs_attention}`, `pieces` (chunks of ready docs), `state` (`empty`\|`reading`\|`rereading`\|`paused`\|`needs_attention`\|`waiting_for_key`\|`ready`), `quality:{cases,last_run_at,hit_at_k,keyword_hit,retrieval_mode,top_k}` (latest completed run), `usage:{uses,teams,steps,agents}`, `last_activity_at` (max of domain and document `updated_at`), `reading_model:{slug,label,provider,dim,key_saved}`. Existing keys and `status` unchanged |
| DM-31–37, DM-63, DM-100 | Detail header, setup strip, answer model key state | **PARTIAL** | `GET /api/domains/{id}` gains the same fields plus `setup:{key,files_read,tested,used}`, `answer_model:{configured,resolved,label,provider,key_saved}` (`resolved` = `resolve_domain_generation_model`, `null` + `key_saved:false` when nothing resolves), `rereading:{total,done,eta_seconds}\|null`, `last_question_at` |
| DM-22, DM-29, DM-23 | Create with a chosen reading model; design template copy | **PARTIAL** | `POST /api/domains` accepts optional `embedding_model` (validated with `is_allowed_embedding_model`, stored in `config.embedding.model`). `GET /api/domain-templates` items gain `description` (dialog copy), `short` (empty-state copy), `piece_size`, `overlap`; the list is served in design order `support, legal, financial, scientific, blank`. Name rule: trimmed, 1–120 chars, unique per owner case-insensitively → 409 `"You already have a domain named “<name>”."` (new rows only; old duplicates stay) |
| DM-14, DM-81, DM-83, DM-85 | Rename, change starting point, validated numbers | **PARTIAL** | `PATCH /api/domains/{id}` accepts `template` (400 unknown). `validate_domain_config` adds: `chunking.size` int 100–4000 (`"Use a number from 100 to 4,000."`), `overlap` int 0…size−1 (`"Overlap must be smaller than the piece size."`), `retrieval.top_k` int 1–30, `rerank.top_n` ≥ top_k. Rename uses the name rule above. The response gains `reread:{needed:"none"\|"required"\|"optional", reason:"reading_model"\|"pieces"\|null}` |
| DM-88, finding 1 | Re-read on any reading-model change (bug) | **PARTIAL (bug)** | `update_domain` clears vectors only on a **dimension** change. Change the rule to "the underlying model differs": strip a routing prefix (`openrouter/openai/x` ≡ `openai/x`) and compare. When they differ, clear embeddings and set docs `pending`, as the dim path does. The same model through another route keeps its vectors (OQ-17). Put the helper `same_embedding_weights(a,b)` in `domain_embedding.py`; pin it with a test (3-small → ada-002 must clear) |
| DM-89/90/91, DM-50, DM-39 | Start a re-read of all or some files, then optionally run tests | **MISSING** | `POST /api/domains/{id}/reread {document_ids?: [uuid], run_tests_after?: bool}` → 202 `{reading:<n>, run_tests_after}`. It marks the docs `pending` and bumps `DomainDocument.version`; `version > 1` means "Re-reading". Then `domain_read.ensure_reading`. 409 `"This domain is already re-reading."` when a full re-read is running and all files were asked for |
| DM-29, DM-48, DM-39, finding 3 | Upload starts reading by itself; key-less domains wait; saving a key resumes | **MISSING** | New `control_plane/domain_read.py`: `ensure_reading(owner, domain)` takes a per-domain advisory lock. If the reading key is held and no read is active, it starts the new DBOS workflow `read_domain_files(owner, domain, run_tests_after)`. That workflow loops "take pending docs → read each → re-check pending under the lock" until none are left, so uploads during a read are picked up. It is called from `POST …/documents` (response gains `reading: "started"\|"queued"\|"waiting_for_key"`), `…/reread` and settings saves. **Key hook:** `POST /api/providers` (routers.py) calls `domain_read.resume_waiting(owner, provider)` best-effort after the upsert (never fails the key save). `POST /ingest` stays as is for old clients |
| DM-42, DM-45, DM-30 | Per-file reading progress, waiting vs reading, re-reading | **MISSING** (no schema) | The new workflow uses **new** steps (the old `ingest_*` steps stay for in-flight workflows). `prepare_document_step` extracts and chunks, deletes old chunks, and inserts every chunk with `embedding NULL` and `meta{filename, page, chunk_size}`. `embed_batch_step(doc, start, end)` fills 16 embeddings, records cost, and asserts the dim. `finish_document_step` sets ready/error. The document row derives: `pieces_total = count(chunks)`, `pieces_done = count(embedding not null)`, `progress = done/total`, `phase` (`waiting` when indexing with 0 chunks, `reading`/`rereading` by `version`). Retrieval already ignores non-ready docs. `GET …/documents` items gain `pieces`, `progress`, `phase`, `problem`, `kind`, `version` |
| DM-43, DM-42 | Humanised "Needs attention" reasons + fix link; waiting for a key | **MISSING** (derivable) | `domain_views.humanize_ingest_error(raw, provider)` returns `{kind:"key_rejected"\|"no_text"\|"rate_limited"\|"wrong_dim"\|"unsupported"\|"other", message, fix:"engines_key"\|null}` by matching the stored `error_message` (401/403/"invalid api key" → key_rejected; "no extractable text" → no_text; 429 → rate_limited …). Read-time only, no schema. `pending` + key missing → phase `waiting_for_key` |
| DM-46, DM-47 | File search in names **and text**; status counts | **MISSING** | `GET …/documents?q=&status=` (`status` ∈ `all\|ready\|reading\|needs_attention`). `q` matches `filename ILIKE %q%` OR `EXISTS chunk WHERE text_tsv @@ plainto_tsquery('english', q)` (GIN index from 0036). Response gains `counts:{all,ready,reading,needs_attention}` (unfiltered), `total_pieces` and per item `matched:"name"\|"text"` |
| DM-51 | Pieces of one file | **MISSING** | `GET /api/domains/{id}/documents/{doc}/pieces?q=&offset=0&limit=50` → `{document:{…item}, pieces:[{ordinal, number, chars, page, text}], total, used_in_answers:{count, of}}`. `used_in_answers` counts the last 20 assistant messages whose **cited** sources include the doc (via `domain_answers.cited_sources`) |
| DM-52, D2 | Download the original file | **MISSING** | `GET /api/domains/{id}/documents/{doc}/file` streams `absolute_path(storage_path)` with the stored `content_type` and `Content-Disposition: attachment; filename*=UTF-8''<filename>`. 404 `"The original file isn’t available any more."` when the bytes are gone |
| DM-53, DM-54 | Delete a file with impact; Undo | **EXISTS** (+FE) | `DELETE …/documents/{doc}` exists. Impact is FE-derived (pieces from the row, "<k> test questions" from `GET …/eval/cases` expected ids). Undo = the FE commits the DELETE when the toast closes (OQ-12). No backend change |
| DM-55–62, DM-65, finding 8 | Ask: cited-only renumbered sources, coverage, follow-ups, pieces and pages, model on reload, chat-only history | **PARTIAL** | `POST …/ask` accepts `use_history: bool` (default false). `ask_domain`: (a) the system prompt adds "If the excerpts do not answer the question, start with NOT_FOUND: and say in one sentence what the closest excerpts cover."; (b) with history, the last 3 turns go into the messages and the retrieval query is "<previous question> <question>"; (c) a `persist` flag, false for `domain_query_step` and the MCP tools (finding 8). Response gains `covered`, `sources:[{number, citation_index, document_id, filename, ordinal, piece_number, pieces_in_file, page, excerpt}]`, `answer_text` (marker renumbered, NOT_FOUND stripped), `used_history`, `model_label`. The raw text stays in `content`, so `covered`, `sources` and `answer_text` are derived at read time (`domain_answers`). `GET …/messages` items gain the same derived keys + `searched` (= `citations`) + `used_history`/`model` (from `meta`, schema S1; `null` for old rows) |
| DM-67 | Clear chat | **MISSING** | `DELETE /api/domains/{id}/messages` → 204 (owner-scoped). The FE sends it when the Undo toast closes |
| DM-56 | Suggested questions | **MISSING** (FE) | FE-only pure helper from file names (`refund-policy.md` → "What is the refund policy?"; `*faq*` → "What do the <x> FAQs cover?"). No backend |
| DM-63/64 | Answer model list with key state | **PARTIAL** | `GENERATION_PRESETS` exist FE-side. Key tags come from `GET /api/providers`; the account default's resolved model from DM detail `answer_model`. Serve `domain_generation_presets` in `/api/config` (label, tagline, slug, provider) so copy and slugs live in one place. Persist via `PATCH …` config (exists) |
| DM-68–71, DM-76, DM-54 | Test cases: names for expected files, flagged deletions, edit | **PARTIAL** | Cases exist (create/list/delete). `GET …/eval/cases` items gain `expected_files:[{document_id, filename\|null, exists}]`. **New** `PATCH /api/domains/{id}/eval/cases/{case_id}` (question, expected ids, keywords; same validation). 422 copy: `"Write the question first."`, `"Add a file or a key word, so there’s something to check."`, `"You can have up to 50 test questions."` |
| DM-72–77, DM-91 | Async test runs with progress, run history, compare, top passages per miss | **PARTIAL** | Sync `POST …/eval` and `GET …/eval/runs/latest` exist. **New** `POST /api/domains/{id}/eval/runs` → 202 run `{run_id, status:"running", progress:{done,total}}`, started as the DBOS workflow `run_domain_eval_workflow` with one step per case. Each step appends its result into `scores.per_case` (JSONB, no schema). Scores gain `config` (a snapshot of chunking, embedding, retrieval, generation at start) and per-case `top:[{number, document_id, filename, excerpt}]` (top 3). `GET …/eval/runs?limit=20` → `{runs:[{run_id, number, status, created_at, completed_at, hit_at_k, keyword_hit, retrieval_mode, top_k, config}]}` newest first (`number` = ordinal within the domain). `GET …/eval/runs/{run_id}` → full run. The compare labels and deltas are FE-derived |
| DM-85, finding 5 | "Look wider, then keep the best" must do something | **PARTIAL (dishonest)** | `apply_rerank` is identity. Implement a deterministic re-score over the candidate pool, with no model and no cost: the final order is RRF of the dense rank and `ts_rank` (exact-word overlap) within the `top_n` pool, then cut to `top_k`. It then does what the copy says for every mode, and Quality can measure it. Keep the knob names |
| DM-92, DM-12, DM-97 | Where the domain is used | **MISSING** | `GET /api/domains/{id}/usage` → `{steps:[{team_id, team_name, node_id, title, pass_to_spec}], agents:[{team_id, team_name, node_id, role_name, title, model, scope:"this"\|"all", subscription:"claude"\|"grok"\|null}], last_question_at}`. Library teams only, owner-scoped; `subscription` from the catalogue mapping of the node's provider. Counts reuse the same helper in `domain_usage.py` |
| DM-94/95 | Add as a step (insert a Query domain node on an edge) | **MISSING** | `POST /api/domains/{id}/steps {team_id, after_node_id, prompt, pass_to_spec}` → 201 `{node_id, team_id, after:{node_id,title}, connected_to:{node_id,title}\|null}`. `domain_usage.insert_step` creates the `domain_query` node (`config:{domain_id, title:"Look up …", pass_to_spec, on_no_answer:"continue"}`), moves the single forward edge `after→next` to `after→new`, adds `new→next`, and positions it. 422 `"Pick where the step goes."` when `after_node_id` is a gate, terminal, verdict-emitting node or has several forward edges; 404 for another owner's team/node |
| DM-96/97, DM-105/106, finding 4 | Per-domain agent access; tools by name | **PARTIAL** | Stored today as `tool_config.tvashtr.domains: true` (all domains). Allow a list `["<uuid>",…]`, where `true` still means all (read-compatible). `GET /api/agents?domain_id=` (extend `toolkit.list_agents`; `enabled` = the list contains the id or is `true`). **New** `PUT /api/domains/{id}/agents {node_ids}` (full-set semantics like tools; a legacy `true` node that is removed becomes an explicit list of the other domains). `node_tools._domains_opt_in` accepts a non-empty list, and `build_mcp_config` adds header `X-Tvashtr-Domains: <ids>` (absent = all). `domain_mcp`: both tools gain `domain: str` (name or id; `domain_id` kept for old agents), resolved case-insensitively within the allowlist; an unknown name errors with "Domains you can search: Support docs, Vendor contracts." The context compiler adds one line "Domains you can search: <names> (tools domain_ask, domain_retrieve)" for such nodes (a test pins the text) |
| DM-98–104, finding 2 | Query domain node: pass to spec, no-answer policy, wait during re-read, cost, Last run data | **PARTIAL** | Node PATCH (`routers.py`, domain_query branch) accepts `pass_to_spec: bool` and `on_no_answer: "continue"\|"stop"` (422 otherwise) into `config`. Absent means `false`/`continue`, so existing nodes behave as today. `team_run.py` (new steps only, return shapes of existing steps untouched): **`domain_query_step_v2`** calls `ask_domain(…, persist=False)` and returns `covered`, `sources`, `answer_text`, `cost_usd`, `latency_ms`, `model`; it waits up to 10 min (DBOS sleep loop) while the domain is re-reading, records the ask's completion and embedding cost against the run (finding 7), and its manifest adds `question`, `covered`, `sources`, `spec_section`. **`append_domain_answer_to_spec_step(run_id, pm_document_id, node_id, section_md)`** writes a new spec version (author = the node, note "Added by <title>"). A not-covered "stop" marks the run failed with new `run_failure.DOMAIN_NO_ANSWER` ("<title> stopped the run: <domain> has no answer for “<q>”."). `GET /api/teams/{t}/nodes/{n}/runs` rounds gain `domain:{question, answer_text, covered, sources, latency_ms, cost_usd, spec_section}` for domain_query nodes. Invocation outcome `"no_answer"` joins `"answered"` |
| DM-102 | Needs a domain also for a deleted domain | **PARTIAL** | `graph_validity` flags `domain_query_no_domain` only for null ids. Also flag an id that isn't one of the owner's domains. The message "Pick a domain for <title>." stays in the validity copy |
| DM-15, DM-86 | Delete a domain and tidy references | **PARTIAL** | `DELETE /api/domains/{id}` exists. Also: set `config.domain_id = null` on the owner's domain_query nodes that used it, and remove the id from agents' `tvashtr.domains` lists (a legacy `true` is untouched). The response gains `steps_cleared`, `agents_cleared` |
| DM-16 | Duplicate settings | **MISSING** | `POST /api/domains/{id}/duplicate {name?}` → 201 summary (same template + config, no files). Name default "<name> copy", then "<name> copy 2"… under the name rule |
| DM-6 | Hide the how-it-works strip for the account | **PARTIAL** | `PATCH /api/account/preferences` whitelists keys (`control_plane/preferences.py`). Add `domains_howto_hidden: bool`. No schema (`users.preferences` JSONB) |
| DM-60 | Page numbers for PDF pieces | **MISSING** (no schema) | `prepare_document_step` keeps page offsets while joining PDF pages and stores `page` (first page of the piece) in `DomainChunk.meta`; citations and pieces return it. Old chunks have no page, so the UI omits "page <p> ·" |
| DM-72, DM-88/89, DM-39 | "about 2 minutes", "about 20 seconds" estimates | **MISSING** (derivable) | `rereading.eta_seconds` = remaining pieces ÷ a per-model rate constant (in `domain_embedding`, measured and pinned in a test). Test-run estimate = cases × median `per_case.latency_ms` of the last run (else 2.5 s). The copy says "about" |
| DM-104, D4 | Subscription-run agents and domain tools | **GAP (known B-16)** | Desktop subscription jobs carry no `mcp_config`, so those agents get no Domains tools (round-1 decision: say so + the existing `tools` run warning, which already mentions `domains`). No new backend; the copy (DM-96/106) states it |
| DM-110 | NIM never offered | **EXISTS** | No embedding or generation preset names NIM; `account_default_model` skips providers without a thinker seat |

**Contract note.** The slice writes `docs/superpowers/plans/api/domains.md` with every row above (method, path,
body, a realistic response, error codes with exact `detail`).

### Schema needs

The session may add one migration, `0042`, shared by every area. Domains needs **at most one column**:

| # | Change | Why | Avoidable without schema? |
|---|---|---|---|
| S1 | `domain_messages.meta JSONB NULL` holding `{model, used_history, source:"chat"}` | The answer meta "1.8 s · OpenAI gpt-4o-mini" and "Used your earlier question for context" must survive a reload. Neither is derivable: the domain's model setting can change later, and a follow-up can't be told from its text. | **Yes, with a visible downgrade.** Show the model and the follow-up line only for answers asked in this browser session; reloaded answers show latency only. The alternative of stuffing an object into the user row's `citations` (JSONB) avoids schema but changes that key's type. Rejected. **Recommend adding S1 to 0042** (nullable, no backfill, no index) |

Everything else the design needs fits existing columns or derived values:
- **Per-file progress:** chunk rows inserted with `embedding NULL`, then filled.
- **Re-reading vs reading:** `domain_documents.version`, unused today.
- **Page numbers and piece size per file:** `domain_chunks.meta` JSONB.
- **Needs-attention reasons:** humanised from `error_message` at read time.
- **Cited-only renumbered sources and "not covered":** derived from the stored answer text.
- **Test-run progress, history, compare, top passages and config snapshot:** `domain_eval_runs.scores` JSONB.
- **Agent allowlists:** `agent_nodes.tool_config` JSONB.
- **Query node options:** `agent_nodes.config` JSONB.
- **Hidden how-it-works strip:** `users.preferences`.
- **File delete / clear chat Undo:** client-side deferred commit.
- **Last activity, usage and quality summaries:** aggregates.
- **Owner attribution of ingest/Ask costs:** would need `cost_records.owner_id`. The design never shows them, so
  it is out of scope; only Query-domain costs move onto the run ledger, via `workflow_id`.

---

## 4. Desktop bridge gaps

Domains runs entirely on the hosted backend; Desktop reaches it through the loopback proxy
(`scripts/local-server.cjs`, streaming, no body limit). No new bridge method is needed. Two main-process fixes
and one optional allow-list entry:

- **D1: dropping a file outside a drop zone replaces the app (main-process fix, needed).** Chromium navigates the
  window to `file:///…/dropped.pdf` when a drop isn't handled. `attachNavigationGuards`'s `will-navigate` only
  bounces http(s) hosts (`localBounceTarget` returns `null` for `file:`), so the navigation goes through and the
  UI is gone.
  - main: in `will-navigate`, `event.preventDefault()` for any `file:` URL (and any non-http(s), non-loopback
    URL that isn't a GitHub auth URL); pin with a `node --test` on the guard helper
  - page: the Domains pages (and the shell) add window-level `dragover`/`drop` `preventDefault()` so a drop
    outside the zone does nothing on both surfaces
- **D2: "Download original" must stay in the window.** An `<a href="/api/…/file" download>` in the same window
  goes through the proxy with the session cookie. Electron shows its default save dialog (no `will-download`
  handler needed). Never `target=_blank` or `window.open`: `setWindowOpenHandler` hands those to
  `shell.openExternal`, and the system browser has no session → 401. A code comment + a unit test on the link
  props are enough. No bridge change.
- **D3 (optional): deep links to Domains.** `deepLink.cjs` allows home/engines/toolkit/teams only. Add
  `tvashtr://domains` → `/domains` and `tvashtr://domains/<uuid>` → `/domains/<uuid>` (UUID-checked, like
  teams). The design never opens Desktop at a domain, so this is parity with spec §3.2, not a blocker. It changes
  no bridge API (no `tvashtrDesktopInfo.version` bump) and needs a test case in the protocol parser suite.
- **Existing, keep:**
  - clipboard: "Copy passage", "Copy domain ID" and "Copy file ID" use `navigator.clipboard`, which works on the
    `http://127.0.0.1` secure context
  - uploads use XHR progress through the proxy; the 10 MB check is client-side first
  - file pickers: `<input type=file multiple>` opens the native picker in Electron
  - "Open canvas" and "Check Engines" are in-app hash links
- **Subscription agents:** Desktop subscription runs (Claude/Grok CLI) get no MCP tools, so no Domains tools (B-16
  in `panel.md`). DM-96/106 say so. No runner change in this area.
- **Session rules that don't apply here:** Domains has no Download button, no Mac install steps (so no
  `xattr -dr com.apple.quarantine /Applications/Tvashtr.app` line), no update screen, and never offers NVIDIA
  NIM.
- **Types:** `frontend/src/vite-env.d.ts` needs no change (no new bridge method). Contract
  `docs/superpowers/plans/api/desktop-bridge.md` gains a line for D1 and, if built, the D3 links.

---

## 5. Frontend mapping

**Today:**
- `components/DomainsPage.tsx` is one component with a list ↔ detail state machine and tabs Overview / Documents
  / Chat / Eval / Config, `window.confirm` deletes, a manual **Ingest** button that polls for 30 s, and plain
  lists.
- `NewDomainDialog.tsx` has a name + template buttons.
- `DomainConfigForm.tsx` is a form/raw-JSON editor with every knob.
- `DomainEvalPanel.tsx` takes expected document **ids** typed by hand and shows hit@k/keyword_hit.
- `DomainGuidedPath.tsx` is a five-step hint panel.
- `lib/domains.ts` holds the template labels, the embedding and generation presets (mirrors of the backend),
  `normalizeEmbeddingModel`, `embeddingSwitchNeedsReingest` and long hint strings.
- The domain clients sit in `lib/api.ts`.
- The canvas has `DomainQueryCard` (`canvas/AgentNodeCard.tsx`), the palette's "Query domain" entry, the
  `TeamNodePanel` domain_query branch (Domain select + prompt), and the `ToolsSection` "Domains MCP" checkbox;
  `LastRun` renders citations.
- `Workspace.tsx` routes `domains` to `DomainsPage`; `Shell.tsx` shows Domains as a flat item; `nav.ts` has only
  `#/domains`.

**New folder `frontend/src/pages/domains/`** (CSS in `pages/domains/domains.css`, exact px from the HTML):
- **Pages:**
  - `DomainsListPage.tsx`: header, `HowItWorksStrip`, search/sort, `DomainCard` grid, `DomainMenu`
  - `DomainsEmpty.tsx`: the empty card, template cards, key hint
  - `DomainDetailPage.tsx`: breadcrumb, header, `SetupStrip` / `SummaryStrip`, Tabs, tab outlet
- **Tabs:**
  - `SourcesTab.tsx`: `FilesTable`, `StatusCell`, `DropOverlay`, `FileMenu`, `useUploads` (XHR progress, local
    rejected rows)
  - `AskTab.tsx`: `AnswerCard`, `SourceChip`, `SourcesAside`, `AnswerModelPicker`, `Composer`, `useDomainChat`
  - `QualityTab.tsx`: `ScoreCards`, `CompareSelect`, `ResultsTable`, `MissDetail`, `RunBanner`, `useEvalRun`
  - `UseInTeamsTab.tsx`
  - `SettingsTab.tsx`: four cards, `SaveBar`, `useDomainSettingsDraft`
- **Dialogs and sheets:**
  - `NewDomainDialog.tsx` (two steps, NoKey callout, reuses F2 `AddKeySheet`)
  - `RenameDomainDialog.tsx`, `DeleteDomainDialog.tsx` (type-to-confirm)
  - `FilePreviewSheet.tsx`, `DeleteFileDialog.tsx`
  - `TestQuestionSheet.tsx` (add / edit / save-from-answer / pick from history)
  - `ReReadDialog.tsx`, `PieceSizeDialog.tsx`
  - `AddStepDialog.tsx`, `GiveAccessDialog.tsx`
- **Pure helpers:**
  - `domainFormat.ts` (tested): status/phase → badge and dot, files/quality/usage lines, footers, sizes, dates,
    "Used N times in M teams", compare labels and deltas, re-read impact, estimates, the default title and
    question, suggestions from file names, key-word suggestions
  - `answerMarkers.ts` (tested; the FE mirror of `domain_answers`, for in-flight rendering)
- **API client:** `frontend/src/lib/api/domains.ts` (typed, `ApiError`/`errorDetailFromBody`, shape-validated,
  `reportFetchOk/Failed`). Move the domain functions out of `lib/api.ts` and re-export them for old imports.

**Canvas and drawer (depends on F5 landing first):**
- `QueryDomainDrawer`, the Setup + Last run bodies inside F5's `NodeDrawer` shell, replaces the
  `TeamNodePanel` domain_query branch
- `DomainQueryCard` gets the new eyebrow/title/domain/footer and badges
- `DomainsChecklist` replaces F5's planned `DomainsSwitch` in the tools tab (OQ-2)
- the agent card line "Can search <name>"
- the palette entry label stays "Query domain" (icon book)

**Reuse from `design-system/components`:**
- `Button` (primary / secondary / ghost / tint / danger, sm/md, loading), `IconButton` (outline), `Badge`
  (success / info / warning / neutral / outline + dot)
- `Card`, `Checkbox` (also radio rows), `Field`/`Input`/`TextArea`, `Select`, `Switch`, `Tabs` (line, count),
  `Count`, `Kbd`
- `Menu` (⋯ with danger item + separator), `Popover`/listbox (model, file, team pickers), `ConfirmDialog`
  (delete file, re-read, piece size), `Dialog` (new domain, rename, delete domain, add step, give access),
  `Sheet` (file preview, test question, the F2 add-key sheet), `ToastProvider`/`useToast`
- shell: `pages/shell/Shell.tsx` (the page renders inside), `.pg-head*` classes for the header

**Missing primitives to add (shared):**
- a segmented control (Search by; the round-1 note says `.tv-seg` matches, but it must be ported to `ds-`)
- a progress bar
- a chip-with-remove (files and key words)
- a drop zone

**Replaces (delete once unused, with their `tv-domains*` CSS):**
- `components/DomainsPage.tsx`, `DomainConfigForm.tsx`, `DomainEvalPanel.tsx`, `DomainGuidedPath.tsx`,
  `NewDomainDialog.tsx`, and their tests (`DomainsPage.test.tsx` 629 lines, `DomainConfigForm.test.tsx`,
  `DomainEvalPanel.test.tsx`, `DomainGuidedPath.test.tsx`, `NewDomainDialog.test.tsx`)
- `lib/domains.ts` copy helpers (`domainsAskWhenToUseWhat`, `domainsChatAskHint`, `domainsQueryNodeHint`,
  `domainsMcpToggleHint`, `domainsMcpAccountToolsHint`, `domainsEval*`, `domainsGraphLiteConfigHint`). Keep the
  types, presets, `normalizeEmbeddingModel` and `providerOfEmbedding`. Replace `embeddingSwitchNeedsReingest`
  with the same-weights rule (OQ-17).
- `LastRun.domainQuery.test.tsx` moves to the Last run tab tests
- `ToolsShelf`'s Domains-MCP hint goes (F3)

**Nav and routes (`frontend/src/lib/nav.ts`):**
- `Route` `{ page: "domains" }` becomes `{ page: "domains"; domainId?: string; tab?: DomainTab; file?: string;
  piece?: number }` with `DomainTab = "sources" | "ask" | "quality" | "teams" | "settings"`
- `parseRoute` and `routeToHash` handle `#/domains/<id>[/<tab>][?file=&piece=]`; `sources` is the bare
  `#/domains/<id>`
- `sectionOf` is unchanged; `nav.test.ts` gains cases
- `paletteItems`/`CommandPalette`: the domain target navigates to `{page:"domains", domainId}` (drop the "no
  per-domain address yet" comment)

**Shell and badges:**
- `Shell.tsx` gets a Domains group: open on `sectionOf === "domains"`, children from a new `domains` loader
- `NavBadges` gains `domains?: {id, name, state}[]`, registered in `pages/badgeLoaders.ts`; `publishBadges` after
  create/rename/delete/read changes
- `NavFoot` gets the Domains text (DM-2)
- `Workspace.tsx` renders `DomainsListPage` / `DomainDetailPage` by route
- `e2e/revamp-shell.spec.ts` keeps passing: `#/domains` still marks the parent current

**Parity and tests:**
- scenarios in `scripts/design-parity/scenarios/domains.mjs` with fixtures that mirror the sample data; every
  board is shot in both modes
- the known design-file differences are explained in the report (OQ-1/5/6/7, the Settings overflow)
- vitest per flow (upload / progress / attention / re-read / preview / delete + undo / filter / ask +
  markers / not covered / follow-up / model + undo / save test / quality run + compare / settings save paths /
  add step / give access / query drawer / delete domain)
- a Playwright `domains.spec.ts` against the real stack: create → upload a small `.md` → ready → ask with a real
  key → save as test → run tests

---

## 6. Open questions and decisions

Each question below comes with a proposed decision; none is left open for a human.

- **OQ-1: the Domains boards' header has no ⌘K search button** (logo · Connected · avatar), while the shipped
  round-1 shell has the 420×36 search button.
  - **Decision:** keep the shipped shell; one frontend has one header
  - the parity report lists the header search as "only in app" for these boards
- **OQ-2: Dm-AgentAccess's drawer tabs (Setup | Tools | Skills | Memory | Runs) conflict with the panel design**
  (Setup | Skills & tools | Memory | Runs | Docs), and with its single "Domains" switch (PANEL-93).
  - **Decision:** F5's panel design owns the drawer
  - the Domains contribution is the "DOMAINS THIS AGENT CAN SEARCH" checklist + callout, which replaces the single
    switch inside "Skills & tools"
  - this board's parity report explains the tab-label difference
  - the product rule is "one frontend", and the panel has 100+ boards against this one
- **OQ-3: nav child order.** Design order equals the list's default "Recently updated", so the nav would reshuffle
  as files are read.
  - **Decision:** children follow creation order (stable); the list page has its own sort
  - the design sample matches either order
- **OQ-4: when the summary strip shows.** Dm-Sources has it; First-5 (ready, no tests, not used) has neither
  strip; Ask, Quality, Teams and Settings never show it; BeforeAfter says it "shrinks to a single line once the
  domain is ready".
  - **Decision:** the four-step setup strip shows until the first read finishes; after that, the one-line summary
    strip shows on the **Sources tab only**
  - First-5's missing line is treated as a frame omission (the app shows it; parity lists it as app-only)
- **OQ-5: stale counts in several frames** (Drag-2 "18 files" with tab 14; Drag-4 strip "14 of 14"; Fail-1 "14
  of 14 files read" while one needs attention; Fail-3 badge Ready while re-reading).
  - **Decision:** all counts are live and consistent (DM-4)
  - Fail-3's badge stays "Ready": a single-file re-read doesn't pause Ask; only a full re-read shows "Re-reading
    n files"
- **OQ-6: Follow-2 drops the first answer and numbers the source "2" in the aside while the answer says 1.**
  - **Decision:** the thread shows every turn; each answer numbers its own cited sources 1…m and the aside uses
    the same numbers
- **OQ-7: "Showing 7 of 14 files" with no filter or paging control.**
  - **Decision:** the table shows every file (the page scrolls); the footer reads "<n> files · <p> pieces"
  - "Showing k of n" appears only when a search or filter is active
  - parity lists the footer text difference on unfiltered boards as a sample-data crop
- **OQ-8: "Used 3 times in 2 teams" doesn't match the Teams tab** (1 step + 2 agents in 3 different teams).
  - **Decision:** N = steps + agents with access, M = distinct teams (DM-12); the sample strings are inconsistent
    data
- **OQ-9: "Use the free Hugging Face model" — what happens next?** HF BGE-small still needs a (free) token.
  - **Decision:** switch the model, then show the "No huggingface token yet…" callout with **Add huggingface
    token** (DM-26)
  - never imply "no key needed"
- **OQ-10: which words of a passage are highlighted.**
  - **Decision:** a deterministic FE heuristic: the sentence of the excerpt that shares the most content words with
    the answer sentence carrying that number (ties → first); no highlight under 2 shared words
  - no model call
- **OQ-11: "Account default · key saved" can be false.** The default resolves to the first held provider with a
  thinker seat, else the operator default, which the user may hold no key for.
  - **Decision:** the tag reflects the resolved model's provider ("No <p> key" when it resolves to nothing
    usable), with a second line "Now <model label>" so the user sees what "default" means
- **OQ-12: Undo for file delete and Clear chat** (the design shows Undo for delete; Clear chat has no feedback
  drawn).
  - **Decision:** client-side deferred commit: hide at once, send the DELETE when the toast closes (also on route
    change and `pagehide` via `fetch keepalive`), and restore on Undo
  - no soft-delete schema
  - Clear chat gets the same pattern and toast "Chat cleared."
- **OQ-13: Should Query domain nodes and agent tools write into the chat?** They do today (Phase 4a "audit
  trail"), but Ask says "Nothing runs in a team".
  - **Decision:** no; `persist=False` for node and MCP asks
  - the node's round manifest and the agent's tool result already record them
  - old rows stay until Clear chat
- **OQ-14: "Teams using it will stop at that step."** Actually, deleting a domain clears the steps' domain, so
  validity blocks the run before it starts.
  - **Decision:** honest copy "Removes its <n> files, pieces, chat and test questions. Teams that use it as a
    step can’t run until you pick another domain."
  - agents with access simply lose it
  - the Settings card and the delete dialog both use it (a copy deviation to report)
- **OQ-15: key-word suggestions "Suggested from the answer".**
  - **Decision:** a deterministic FE helper; no model call; the copy stays true
    - candidates are bold phrases and number+unit phrases ("30 days") from the answer, then answer words that
      also appear in a cited excerpt
    - stop-words are dropped; at most 3
- **OQ-16: the miss hint "or add “verify” as a key word".** No rule produces that word, and adding a key word
  makes the check harder.
  - **Decision:** keep "<file> wasn’t in the top <k>." and add "Try “Both” search." only when the run wasn't Both
  - drop the key-word advice (copy deviation)
- **OQ-17: when a reading-model change needs a re-read.** The design always re-reads; the old FE rule re-reads on
  a provider change; the backend clears only on a dimension change (finding 1).
  - **Decision:** re-read whenever the underlying model differs
  - OpenAI 3-small ↔ OpenRouter 3-small are the same weights: the bar says "No re-read needed" and nothing
    re-reads
  - the backend rule is fixed with the FE helper to match
- **OQ-18: "Adds up to 4 nearby passages that mention the same names."** Graph-lite adds passages from anywhere
  in the domain that share capitalised names, not nearby ones.
  - **Decision:** honest copy "Adds up to 4 more passages that mention the same names. Off by default." (a
    deviation)
  - "Look wider, then keep the best" keeps its design copy because the backend gains a real re-score (§3)
- **OQ-19: "For your own MCP clients or scripts: domain ID dom_7f3a…".** Ids have no `dom_` prefix; the MCP
  endpoint needs a Tvashtr session cookie; there are no personal API tokens.
  - **Decision:** show "Domain ID" + the raw UUID + Copy, and drop the MCP-client claim (a deviation)
  - personal API tokens are out of scope
- **OQ-20: the "At the start, before Product manager" placement.** The first agent writes the shared spec, and a
  Query domain node cannot be the graph root (validity).
  - **Decision:** placements are "After <agent>" for each agent on the main path with one way out
  - the default is after the first agent
  - "At the start" is omitted (a deviation); "Before Reviewer" is the same slot as "After <its predecessor>", so it
    is not listed twice
- **OQ-21: `pass_to_spec` default for nodes that exist today.** Their answers never reached the spec.
  - **Decision:** absent = off (no behaviour change for existing teams or in-flight runs)
  - new nodes (palette, Add step) start on, as designed
- **OQ-22: detecting "the files don’t cover it".**
  - **Decision:** the prompt asks for a leading `NOT_FOUND:` marker when the excerpts don't answer
  - an answer with that marker is not covered; the marker is stripped for display; the "closest passages" are the
    top two retrieved
  - no second model call
- **OQ-23: an answer with no citation markers but no NOT_FOUND.**
  - **Decision:** treat it as covered and show "Sources" = the top two retrieved with a small note "The answer
    didn’t point to a passage; these came up first." (proposed)
- **OQ-24: parallel vs sequential reading.** Embed-4 shows three files re-reading at once.
  - **Decision:** read one file at a time (provider rate limits, especially HF); other files show "Waiting to
    read"
  - the percentages stay per file
- **OQ-25: domain names must be unique** because agents find domains by name.
  - **Decision:** unique per account, case-insensitive, on create/rename/duplicate (409 copy in §3)
  - existing duplicates keep working: the MCP tools error on an ambiguous name and list both
- **OQ-26: the test-question cap (50)** exists in the backend but not in the design.
  - **Decision:** keep it; on the 51st "Add test" show "You can have up to 50 test questions."
- **OQ-27: Ask on a Desktop-only account** (a Claude/Grok subscription, no API keys).
  - **Decision:** state plainly that reading and answering need API keys on both surfaces (DM-20, DM-24, DM-66)
  - never suggest a subscription covers Domains
- **OQ-28: header ⋯ menu on the detail page** (not drawn).
  - **Decision:** Ask a question, Rename, Duplicate settings, Copy domain ID, separator, Delete… (DM-31)
- **OQ-29: "Delete file" and "Delete domain" confirm styles.** The design uses primary with a trash icon, while
  Engines chose danger (round-1 OQ-14) because its design used secondary.
  - **Decision:** keep the design's primary + trash here
  - the menu items stay danger-coloured

**NEEDS_HUMAN:** none. Every question above is answered by the design files plus the product rules.
The one cross-area call is S1, adding a column to the shared migration 0042; it belongs to the session lead.
