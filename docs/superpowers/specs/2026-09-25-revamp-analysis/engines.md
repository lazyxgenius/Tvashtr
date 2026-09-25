# Engines — gap analysis (area `engines`, prefix `ENG-`)

Screens covered: `Eng-Overview`, `Eng-OverviewWeb`, `Eng-Subs`, `Eng-SubsWeb`, `Eng-CardStates`, `Eng-Keys`,
`Eng-AddKeyPick`, `Eng-AddKey`, `Eng-BeforeAfter`, `Eng-Flow-{Grok,Codex,Key,Blocked}-*`, and every `EnF-*`
flow (OvAddKey, OvConnect, ClaudeRefresh, ClaudeDisconnect, ClaudeApiKey, WebDesktop, PickProvider,
OtherProvider, SaveErrors, Suggest, Embeddings, KeyUsed, FirstTime).

Code read: `frontend/src/components/EnginesShelf.tsx`, `lib/engines.ts`, `lib/credentialGate.cases.json`,
`lib/desktopDownload.ts`, `lib/api.ts` (providers/subscriptions/config), `components/Dashboard.tsx`,
`AppShell.tsx`, `AuthGate.tsx`, `App.tsx` (credential gate + "Open Engines"), `panel/TeamNodePanel.tsx`
(inline add key), `DesktopDisclosure.tsx`; backend `routers.py` (`/api/providers*`,
`/api/engines/subscriptions*`, launch pre-flight helpers, domain ingest), `main.py` (`/api/config`),
`models.py` (`ProviderCredential`, `EngineSubscriptionStatus`, `DesktopRunnerHeartbeat`, `AgentNode`),
`control_plane/{credentials,credential_gate,provider_models,desktop_jobs,domain_embedding,domains,teams}.py`,
`desktop_runner_routes.py`; Desktop `electron/main.cjs`, `preload.cjs`, `harness/{claude,grok,codex,
terminalLogin,statusStore,pathDetect}.cjs`, `runner/{engineBoot,statusSync,runner}.cjs`, `desktop/package.json`.

Note: `PROVIDER_SUGGESTIONS` no longer exists in `Dashboard.tsx`. Provider suggestions now come from
`providerSuggestions()` in `lib/api.ts`, which reads the `/api/config` `provider_catalogue`. The repo
has no `credentialGate.ts` module. The shared rule lives in `engines.ts::missingProvidersForModels`
and `control_plane/credential_gate.py`, and `credentialGate.cases.json` tests both.

---

## 1. Screens

**Eng-Overview: Overview on Desktop.** The left nav shows **Engines** as an expandable group. Its children are
**Overview** (warn badge "2 to fix"), **Subscriptions** ("1 of 2") and **API keys** ("3"). **Toolkit**
follows the group. A footer blurb explains Engines. The main column opens with the title "Engines", a lede and
two header buttons: **Subscriptions** (secondary) and **Add API key** (primary). Two surface cards follow. The
first is **Tvashtr Desktop**, with the status "Tvashtr Desktop is open on this computer". The second is
**Website (hosted)**, with the status "Always available". Next is a table, **Providers your teams use**, with
one row per provider. Each row has a Provider cell (monogram tile + slug), a Used by cell ("roles · team"), a
Tvashtr Desktop cell and a Website (hosted) cell. Each cell shows how that surface is covered, or a warning
with a tint fix button ("Add key" / "Connect"). Under the table a line lists saved keys no team uses. The
last section, **Can your teams run?**, has one line per team with a Desktop verdict and a Website verdict.

**Eng-OverviewWeb: Overview on the website.** The layout matches the Desktop Overview. The Desktop card
instead says "Not open on this computer" and has a **Download Tvashtr Desktop** button. The anthropic row's
Desktop cell reads "Claude subscription (on Desktop)". The xai Desktop cell still shows "Grok needs login"
with a **Connect** button. That button can't work on the web; see OQ-2.

**Eng-Subs: Subscriptions on Desktop.** A green banner says Desktop "is open and checking in … Checked just
now". Three cards follow: Claude (C), Grok (G) and Codex (O). Each card shows:
- the name, plus an account line ("Claude Pro · via Claude Code", "Not signed in", "Not found on this
  computer")
- a status badge
- "Covers anthropic/* models · Desktop runs" and "Used by …"
- a state message and actions

In the sample, Claude is Connected with Refresh and Disconnect. Grok is Needs login with Connect. Codex has
Status only + Needs install, an Install Codex CLI link and "I've installed it — Refresh". The compliance
disclosure closes the page.

**Eng-SubsWeb: Subscriptions on the website.** The lede adds "Subscriptions run on your own computer. Open
Tvashtr Desktop to connect them. Website runs always use API keys." It is followed by **Open Tvashtr
Desktop** (secondary) and **Download** (ghost). The cards come from the server mirror, and every action is
disabled. Grok's button reads "Connect in Desktop". Messages change to web versions ("Connected on your
computer. It only runs agents from Tvashtr Desktop.", "Open Tvashtr Desktop to connect Grok.", "Status
appears when Tvashtr Desktop is open.").

**Eng-CardStates: reference sheet of card states.** Checking… (loading), On an API key, Desktop not checking
in, Error, Disconnected and Codex Status only. Each state has its message and main action.

**Eng-Keys: API keys, Desktop and website alike.** The page has a title, a lede ("Stored encrypted … last 4
characters … work on the website and on Tvashtr Desktop") and **Add key**. A warn banner reads "Your teams
also use anthropic and xai. Add keys to run them on the website." with one "+ provider" button per missing
provider. Next is the key table: Provider · Key "•••• 7d24" · Works on "Desktop · Website" · Used by · Added
"Sep 12" · a ⋯ button. It is sorted newest first. A **Domains embeddings** section closes the page ("huggingface
not added" + Add key).

**Eng-AddKeyPick and Eng-AddKey: the Add key sheet, on the right, 520 px wide.** The header reads "Add an
API key / For website runs, and Desktop runs without a subscription", with a Close button. The Provider
field is a combobox. Its open listbox has a search box, a description line per provider ("your teams use
it" / "Saved" tags) and a final "Other: type the model prefix" action. Below it:
- a hint: "Covers models that start with `anthropic/`, like anthropic/claude-sonnet-5."
- a password field for the key
- an encryption note, a Desktop-subscription note and "Used by …"
- Cancel and Save key buttons

In AddKeyPick, Save is disabled while the key is empty.

**Eng-BeforeAfter: rationale only.** It lists the problems the redesign fixes. The rule was explained three
times, nothing answered "can my team run?", cards didn't say what they cover, the provider was free text,
and removing a key gave no warning.

**Eng-Flow-Grok (1–3): connect Grok, Desktop.**
1. Click Connect.
2. The card shows "Waiting for sign-in", a neutral Checking… badge, the message "Finish signing in to Grok
   in the Terminal window that just opened, then come back. Tvashtr checks again automatically.", a loading
   Checking button and Cancel.
3. The card shows "SuperGrok · via Grok CLI", Connected, Refresh and Disconnect, plus the toast "Grok
   connected. xai models now run on this computer."

**Eng-Flow-Codex (1–3): Codex install.**
1. Needs install.
2. After Refresh: "Checked just now", a warning badge "Still not found", a warn callout about Dock PATH and
   "Refresh again".
3. After install: "Codex CLI found", badge Ready, "Codex can't run agents yet. You'll be ready when it can.",
   and the toast "Codex CLI found. It can't run agents yet."

**Eng-Flow-Key (1–4): add, remove, replace a key.**
1. Saved: an anthropic row appears at the top with "Just now". The banner shrinks to xai. The toast "anthropic
   key saved. Indicator sprint team still needs xai to run on the website." has an **Add xai** action.
2. The ⋯ menu: Replace key / See where it's used / Remove key (danger, after a divider).
3. The Remove alertdialog shows the impact.
4. The Replace alertdialog has a "New key" field.

**Eng-Flow-Blocked (1–2): run blocked, then fix in Engines.**
1. On the canvas (website) a warn status reads "Can't run on the website yet. No API key for anthropic or
   xai. Subscriptions only work on Tvashtr Desktop." with a primary **Open Engines**.
2. Engines opens on the web **Overview**.

**EnF-OvAddKey (1–5): Overview, add a key from a row.**
1. Click "Add key" on the anthropic row.
2. The sheet opens with anthropic already picked. The Desktop-subscription sentence is absent here.
3. Paste the key.
4. Overview updates: the row flashes [OK], the Website cell shows "API key •••• wQ3f", and the toast
   "anthropic key saved. Indicator sprint team still needs xai for the website." has an **Add xai** action.
   Design bug: the team line wrongly says "Website: ready".
5. Add xai: the Website cell shows "API key •••• 9Kx2", the team line shows "Website: ready", the nav shows
   "1 to fix", and the toast says "xai key saved. Indicator sprint team can now run on the website."

**EnF-OvConnect (1–3): Overview, connect from a row (Desktop).**
1. Click Connect on the xai row.
2. The Desktop cell shows "Checking…" and the toast says "A Terminal window opened. Sign in to Grok there,
   then come back."
3. The cell shows "Grok subscription", the row flashes, the team line shows "Desktop: ready", the nav shows
   "1 to fix", and the toast says "Grok connected. Indicator sprint team can run on this computer."

**EnF-ClaudeRefresh (1–3).**
1. Click Refresh.
2. The card shows a Checking… badge, "Checking that Claude Code is installed and signed in.", a loading
   Checking button and a disabled Disconnect.
3. The card is still connected, with "… Checked just now.", and the toast says "Claude is connected. Checked
   just now."

**EnF-ClaudeDisconnect (1–2).**
1. The alertdialog "Disconnect Claude?" shows the impact: "Engineer in Indicator sprint team uses anthropic
   models. Without Claude, it runs on your anthropic API key. You don't have one yet, so it can't run until
   you add a key or connect again. You stay signed in to Claude Code itself." It has Cancel and Disconnect.
2. The card shows "Not connected", a Disconnected badge, "Engineer now runs on your anthropic API key, if you
   have one. Connect to use your Claude plan again." and Connect. The toast "Claude disconnected." has an
   **Add anthropic key** action.

**EnF-ClaudeApiKey (1–3): Claude Code is on an API key.**
1. The card shows "Claude Code signed in with an API key", an info badge "On an API key", "Claude Code is
   using an API key, not your Claude plan. Connect to sign in with your plan instead." and Connect.
2. The card shows "Waiting for sign-in" and "… Choose your Claude plan, not an API key." with Checking and
   Cancel.
3. Connected; the toast says "Claude connected with Claude Pro."

**EnF-WebDesktop (1–3): website, open or get Desktop.**
1. The web Subscriptions page.
2. **Open Tvashtr Desktop** opens the alertdialog "Opening Tvashtr Desktop…": "Your browser may ask if it can
   open the Tvashtr app. Say yes. If nothing opens, you may not have the app yet." It has Cancel, Download
   Tvashtr Desktop and Try again.
3. **Download** opens the alertdialog "Get Tvashtr Desktop". It has a paragraph, three bullets, Not now and
   Download.

**EnF-PickProvider (1–4).**
1. The sheet opens with nothing picked: "Choose a provider". Save is enabled.
2. The list opens. It shows 7 providers + Other; Eng-AddKeyPick showed 9, including nvidia_nim and
   openrouter.
3. Typing "hug" leaves huggingface + Other.
4. Picked: the hint changes to "Used by Domains ingest for BGE-small embeddings. A free token from
   huggingface.co works." and the footer adds "Used by Domains ingest".

**EnF-OtherProvider (1–3).**
1. Click Other.
2. The provider shows "Other provider", and a new "Model prefix" field appears with helper text. Its value
   "mistral/" gives the error "Just the part before the slash: mistral."
3. Fixed ("mistral"); the footer adds "Covers mistral/… models".

**EnF-SaveErrors (1–2).**
1. Save with nothing filled in: a form error above Provider says "Enter a provider and an API key."
2. The backend can't be reached: "Couldn't save that key — is the backend running? Your key wasn't saved.
   Try again." The fields keep their values.

**EnF-Suggest (1–2).**
1. Clicking "+ xai" in the banner opens the sheet with xai picked. The hint reads "Covers models that start
   with xai/, like xai/grok-4." and the footer says "Used by Product manager, Reviewer".
2. Saved: an xai row appears, the banner shrinks to anthropic, and the toast "xai key saved. Add anthropic
   too, so Indicator sprint team can run on the website." has an **Add anthropic** action.

**EnF-Embeddings (1–2).**
1. Add key in the Domains embeddings section opens a sheet titled "Add an embeddings key" with huggingface
   picked.
2. Saved: a huggingface row appears with Used by "Domains ingest". The section shows "huggingface •••• f0Tk"
   and its button is gone. The toast "huggingface key saved. Domains can ingest documents now." has an
   **Open Domains** action.

**EnF-KeyUsed (1–4).**
1. The ⋯ menu on deepseek.
2. "See where it's used" opens a 320 px popover, "deepseek is used by", listing each node: role "Writer",
   "Docs team · deepseek/deepseek-chat" and an **Open** link. The footer says "Works for website runs and
   Desktop runs."
3. Replace: "The old key is deleted when you save. Writer uses the new one on its next run.", a New key
   field, Cancel and Replace key.
4. The toast says "deepseek key replaced. Writer uses it on its next run." Design omission: the row still
   shows •••• 7d24, but it must update.

**EnF-FirstTime (1–2): nothing set up yet (Desktop).**
1. The nav shows "Overview **New**", "Subscriptions 0 of 2" and "API keys" with no count. Overview becomes a
   chooser: "How do you want your agents to run? …", with the cards "Use my Claude or Grok plan" (primary
   **Connect a subscription**) and "Add an API key" (secondary **Add API key**), plus the disclosure.
2. Connect a subscription lands on Subscriptions. Claude shows Disconnected, Grok Needs login and Codex Needs
   install.

**Desktop vs website, summarised**
- **Overview Desktop card:** "open on this computer" on Desktop; "Not open" + Download on the web.
- **Subscription cells:** "(on Desktop)" suffix on the web.
- **Subscriptions page:** actions enabled on Desktop; disabled on the web, plus Open/Download buttons and
  web-specific messages.
- **Status source:** the live status comes from the Electron main process on Desktop and from the server
  mirror on the web.
- **Connect/Refresh/Disconnect:** Desktop only.
- **Unchanged on both:** the API keys page, the Add key sheet, errors and toasts.

---

## 2. Behaviour requirements

### Navigation and shell
- **ENG-1** Engines is a collapsible nav group (chevron) with the children **Overview**, **Subscriptions** and
  **API keys**. **Toolkit** follows as a separate item (Tools area). The nav foot text reads "Engines are the
  models your agents run on: your own subscription on Desktop, or an API key anywhere." with "Engines" in
  bold.
- **ENG-2** The Overview badge (warn) reads "N to fix". N is the number of (team × surface) pairs in "Can your
  teams run?" that are not ready. It moves 2 → 1 in OvAddKey-5 and OvConnect-3. The badge is hidden at 0 and
  reads "New" in the first-time state.
- **ENG-3** The Subscriptions badge reads "X of 2". X counts the connected runnable subscriptions (Claude,
  Grok); Codex is excluded. First time shows "0 of 2".
- **ENG-4** The API keys badge is the count of saved keys ("3"), with no badge when there are none.
- **ENG-5** All badges update live after connect, save or remove. Several design frames leave them stale;
  implement live updates.
- **ENG-6** Canvas **Open Engines** and **Configure providers** land on Engines › **Overview**
  (Blocked-2). Domains' "Open Engines" should land on **API keys** at the embeddings section.

### Overview
- **ENG-7** The page shows the h1 "Engines" and the lede "The models your agents run on. Use your own
  subscription on Tvashtr Desktop, or an API key anywhere." Header buttons: secondary **Subscriptions**
  (monitor icon) goes to the Subscriptions page; primary **Add API key** (+ icon) opens the Add key sheet
  with nothing picked.
- **ENG-8** The Desktop surface card reads "Tvashtr Desktop — Runs on this computer. Uses your Claude or Grok
  subscription first, or an API key."
  - On Desktop its status is "Tvashtr Desktop is open on this computer" (check icon).
  - On the web its status is "Not open on this computer" + secondary sm **Download Tvashtr Desktop**, which
    opens ENG-47.
  - On the web while the Desktop runner is fresh, see OQ-15.
- **ENG-9** The Website surface card reads "Website (hosted) — Runs on Tvashtr's servers, including Domains
  ingest and Ask. Needs an API key for every provider. Subscriptions don't work here." Its status is "Always
  available".
- **ENG-10** Section **Providers your teams use** is a table with the columns Provider | Used by | Tvashtr
  Desktop | Website (hosted). There is one row per distinct provider slug (`providerOf(model)`) across the
  models of all agent and completion nodes in the user's library teams. Suggested order: rows needing a fix
  first, then alphabetical.
- **ENG-11** The Provider cell shows a monogram tile (A anthropic, X xai, D deepseek, N nvidia_nim, R
  openrouter, O openai, G gemini, Q groq, H huggingface) + the slug. Monograms are not always the first letter.
- **ENG-12** The Used by cell reads "<role names joined by ', '> · <team name>", e.g. "Product manager,
  Reviewer · Indicator sprint team". The multi-team format is open (OQ-12).
- **ENG-13** The Tvashtr Desktop cell resolves in this order:
  - (a) The provider maps to a runnable subscription (anthropic→Claude; xai or grok→Grok) and it is
    connected: OK icon, "Claude subscription" / "Grok subscription". The web appends " (on Desktop)".
  - (b) Otherwise, with a key: OK icon, "API key •••• <last4>".
  - (c) Otherwise, if a runnable subscription exists: warn icon + a state phrase + a tint button.
    "Grok needs login" goes with **Connect**. Propose: "Claude on an API key" + Connect; "Grok not
    installed" + **Set up** (goes to Subscriptions); "Couldn't check Grok" + **Refresh**; "Not connected" +
    Connect.
  - (d) Otherwise (deepseek, openai — Codex can't run nodes, …): warn "No API key" + tint **Add key**.
  - While a connect is in progress: "Checking…" (OvConnect-2).
- **ENG-14** The Website (hosted) cell shows OK "API key •••• <last4>" when a key exists, else warn "No API
  key" + tint sm **Add key**.
- **ENG-15** A row's **Add key** opens the Add key sheet with that provider already picked (OvAddKey-2).
- **ENG-16** A row's **Connect** on Desktop calls `engines.connect(sub)`. The cell shows "Checking…" and
  the toast "A Terminal window opened. Sign in to Grok there, then come back." appears. When the connection
  succeeds, the cell shows "Grok subscription", the row flashes OK and the toast says "Grok connected.
  <Team> can run on this computer."
- **ENG-17** A row's **Connect** on the web can't connect. Recommended: open Desktop via deep link
  (ENG-46); see OQ-2.
- **ENG-18** After a key is saved from a row:
  - the row flashes OK and the Website cell becomes "API key •••• <last4>";
  - the team lines and the nav badge recompute;
  - the toast is "<p> key saved. <Team> still needs <q> for the website." + action **Add <q>**, or "<p> key
    saved. <Team> can now run on the website." when nothing else is missing.
- **ENG-19** A line under the table reads "Also saved, not used by any team yet: nvidia_nim , openrouter".
  It lists saved keys whose provider no team node uses, and is hidden when there are none.
- **ENG-20** Section **Can your teams run?** has one line per library team: team name, then "Desktop: <verdict>"
  and "Website: <verdict>", each with an OK or warn icon. A verdict is "ready" or a fix list:
  - Desktop: "connect Grok" for providers a runnable subscription could cover, "add <p> key" for the rest,
    joined by ", ".
  - Website: "add anthropic, xai keys" (plural) or "add xai key" (singular).
- **ENG-21** Verdicts use the shared launch rule, `missingProvidersForModels`, with `launchTarget: "hosted"`
  for Website and `"local"` for Desktop. The Desktop subscription input is the live Desktop status on
  Desktop, and mirror `connected` on the web (OQ-3).
- **ENG-22** Empty cases (proposed; not designed):
  - no team uses a model: "None of your teams use a model yet."
  - no library teams: hide both sections.
- **ENG-23** The updated row is highlighted briefly after any change (the [OK] row flash).

### Subscriptions: Desktop
- **ENG-24** The page shows the h1 "Subscriptions" and the lede "Run agents on your own Claude or Grok plan,
  from Tvashtr Desktop."
- **ENG-25** An OK banner reads "Tvashtr Desktop is open and checking in. Subscription runs stop when you quit
  it." + "Checked <relative time of the last runner poll>" ("Checked just now"). Proposed variant when polls
  fail (e.g. signed out): warn "Tvashtr Desktop can't reach Tvashtr right now. Subscription runs won't start."
- **ENG-26** The cards appear in a fixed order: Claude (C), Grok (G), Codex (O).
- **ENG-27** The card account line depends on the state:
  - connected: `account_hint` + " · via Claude Code" / " · via Grok CLI" ("Claude Pro · via Claude Code")
  - needs_login: "Not signed in"
  - needs_install: "Not found on this computer"
  - api_key: "Claude Code signed in with an API key"
  - disconnected: "Not connected"
  - after Connect, waiting: "Waiting for sign-in"
  - Codex installed: "Codex CLI found"
  - Codex after a Refresh that found nothing: "Checked just now"
- **ENG-28** The card meta reads "Covers anthropic/* models · Desktop runs" (Claude), "Covers xai/* models ·
  Desktop runs" (Grok) or "Covers openai/* models" (Codex, no "Desktop runs"). Then "Used by <roles · team>"
  or "Used by —" when no node uses a covered provider. Grok also covers `grok/*`.
- **ENG-29** Connected: success dot badge **Connected**; "Runs while Tvashtr Desktop is open." (+ " Checked
  just now." after a refresh); secondary **Refresh**, ghost **Disconnect**.
- **ENG-30** Needs login: warning dot badge **Needs login**; "Connect opens a Terminal window. Sign in to Grok
  there, then come back."; primary **Connect**.
- **ENG-31** Waiting for sign-in after Connect: neutral dot badge **Checking…**; "Finish signing in to Grok in
  the Terminal window that just opened, then come back. Tvashtr checks again automatically." The Claude
  api_key variant reads "Finish signing in to Claude in the Terminal window that just opened. Choose your
  Claude plan, not an API key." Buttons: primary loading **Checking** + ghost **Cancel**. The card
  re-checks automatically on window focus.
- **ENG-32** Cancel (while waiting) returns the card to its previous state and stops the auto re-check.
- **ENG-33** Refresh in progress: neutral dot **Checking…**; "Checking that Claude Code is installed and signed
  in."; secondary loading **Checking**; ghost **Disconnect** disabled. On success the toast is "Claude is
  connected. Checked just now."
- **ENG-34** Launch probe in progress (CardStates): neutral dot **Checking…**; "Looking for Claude Code on
  this computer."; secondary loading **Checking**.
- **ENG-35** On an API key: info badge **On an API key**; "Claude Code is using an API key, not your Claude
  plan. Connect to sign in with your plan instead." (CardStates has a different wording, OQ-20); primary
  **Connect**. Success toast: "Claude connected with <account_hint>." ("Claude connected with Claude Pro.").
- **ENG-36** Disconnected:
  - badge: neutral **Disconnected**
  - generic message: "Not connected. Connect opens a Terminal window where you sign in to Grok."
  - after a user disconnect: "<Roles> now runs on your <provider> API key, if you have one. Connect to use
    your Claude plan again."
  - action: primary **Connect**
- **ENG-37** Error: danger dot **Error**; "Couldn't check Grok. Try Refresh. If it keeps failing, reopen
  Tvashtr Desktop."; secondary **Refresh**.
- **ENG-38** Desktop not checking in: warning dot **Desktop not checking in**; "Connected, but Tvashtr Desktop
  hasn't checked in lately. Open it to run agents on your subscription."; secondary **Open Tvashtr Desktop**.
  The condition is mirror `connected && !runner_fresh` for Claude or Grok. The state mainly applies on the
  web.
- **ENG-39** Codex needs install: info **Status only** + neutral **Needs install**; "Install the Codex CLI,
  make sure it's on your PATH (npm global bin or Homebrew), then quit and reopen Tvashtr."; link **Install
  Codex CLI** (https://developers.openai.com/codex, opens externally); secondary **I've installed it —
  Refresh**. The Claude and Grok needs_install equivalents use their own install URLs ("Install Claude
  Code" / "Install Grok CLI").
- **ENG-40** When Refresh still finds nothing: warning badge **Still not found**, a warn callout "Apps opened
  from the Dock don't see your Terminal's PATH. Quit Tvashtr fully, reopen it, then Refresh." and secondary
  **Refresh again**. This is front-end state: needs_install came back after an explicit Refresh.
- **ENG-41** Codex found: success dot **Ready**; "Codex can't run agents yet. You'll be ready when it can.";
  secondary **Refresh**; toast "Codex CLI found. It can't run agents yet." (CardStates wording: "Codex can't
  run agents yet. Tvashtr only shows whether it's installed.")
- **ENG-42** Disconnect opens alertdialog "Disconnect Claude?" with an impact message:
  - "<Roles> in <Team> uses anthropic models. Without Claude, it runs on your anthropic API key. You don't
    have one yet, so it can't run until you add a key or connect again. You stay signed in to Claude Code
    itself."
  - variant with a key (proposed): "… it runs on your anthropic API key •••• <last4>. You stay signed in …"
  - variant with no users (proposed): "No team uses anthropic models. You stay signed in to Claude Code
    itself."
  - buttons: ghost **Cancel**, secondary **Disconnect**
- **ENG-43** After a disconnect, the toast is "Claude disconnected." with action **Add anthropic key** (only
  when no anthropic key exists). The disconnect must stick: the next app launch must not reconnect Claude on
  its own (see B1).
- **ENG-44** Grok connected toast on this page: "Grok connected. xai models now run on this computer."
- **ENG-45** The page footer shows `SUBSCRIPTION_DISCLOSURE` verbatim, on Desktop and on the web.

### Subscriptions: website
- **ENG-46** The web lede adds "Subscriptions run on your own computer. Open Tvashtr Desktop to connect them.
  Website runs always use API keys." It is followed by secondary sm **Open Tvashtr Desktop** and ghost sm
  **Download**.
- **ENG-47** **Download** (and every "Download Tvashtr Desktop" button) opens alertdialog "Get Tvashtr
  Desktop": "Tvashtr Desktop runs agents on this computer with your own Claude or Grok plan. After you
  install it, sign in with the same account and connect a subscription." Bullets: "Same teams, tools and
  keys as the website", "Runs use your subscription first, then API keys", "Runs stop when you quit the app".
  Buttons: ghost **Not now**, primary **Download** (goes to `DESKTOP_MAC_DMG_URL`).
- **ENG-48** **Open Tvashtr Desktop** fires the custom-protocol link and opens alertdialog "Opening Tvashtr
  Desktop…": "Your browser may ask if it can open the Tvashtr app. Say yes. If nothing opens, you may not have
  the app yet." Buttons: ghost **Cancel**, secondary **Download Tvashtr Desktop** (swaps to ENG-47), primary
  **Try again** (re-fires the link). Proposed: the dialog closes on its own once the runner heartbeat turns
  fresh.
- **ENG-49** Web cards render mirror state with every action disabled: Refresh and Disconnect disabled, Grok
  primary **Connect in Desktop** disabled, Codex **I've installed it — Refresh** disabled. Only "Open Tvashtr
  Desktop" in the not-checking-in state is enabled. Web messages: connected "Connected on your computer. It
  only runs agents from Tvashtr Desktop."; needs_login "Open Tvashtr Desktop to connect Grok."; Codex "Status
  appears when Tvashtr Desktop is open."
- **ENG-50** A mirror with no rows (Desktop never opened: every `checked_at` is null) needs a web variant.
  Proposed: "Not checked yet. Open Tvashtr Desktop to connect." (OQ-11).

### API keys page
- **ENG-51** The page shows the h1 "API keys", the lede "Stored encrypted for your account. We only ever show
  the last 4 characters. Keys work on the website and on Tvashtr Desktop." and a primary **Add key** (+ icon)
  that opens the empty sheet.
- **ENG-52** A suggested-keys warn banner lists providers used by team nodes that have no key:
  - two providers: "Your teams also use **anthropic** and **xai**. Add keys to run them on the website."
  - one provider: "Your teams also use **xai**. Add a key to run them on the website."
  - three or more: "a, b and c"
  - one secondary sm "+ <provider>" button per provider opens the sheet with it picked
  - hidden when the list is empty
- **ENG-53** The key table columns are Provider | Key | Works on | Used by | Added | actions:
  - Key: "•••• <last4>"
  - Works on: "Desktop · Website" (static)
  - Used by: "Writer · Docs team", "Domains ingest" or "Not used by any team"
  - Added: "Just now" under a minute, otherwise a short date ("Sep 12")
  - sorted newest first
- **ENG-54** The ⋯ IconButton (aria-label "More actions for <provider>") opens a 220 px menu with **Replace
  key**, **See where it's used**, a divider and **Remove key** (danger colour). The menu closes on Escape
  or an outside click and supports arrow keys.
- **ENG-55** See where it's used opens a popover (role dialog, aria-label "Where the <p> key is used"):
  - heading "<p> is used by"
  - one row per node: role name (bold), "<team> · <model>" and an **Open** link to that team's canvas with
    the node selected
  - Domains usage rows (proposed): "<domain> · embeddings (<model>)"
  - footer "Works for website runs and Desktop runs."
  - empty (proposed): "No team uses <p> yet."
- **ENG-56** Replace opens alertdialog "Replace the <p> key":
  - text: "The old key is deleted when you save. Agents use the new one on their next run.", or with one
    user "<Role> uses the new one on its next run."
  - Input label "New key", type password, placeholder "Paste the new key"
  - ghost **Cancel**, primary **Replace key**; empty input gives the proposed error "Paste the new key."
  - on success: the row's last4 (and Added) update and the toast is "<p> key replaced. <Role> uses it on its
    next run." (no-user variant: "<p> key replaced.")
- **ENG-57** Remove opens alertdialog "Remove the <p> key?":
  - text: "<Role> in <Team> uses <p>. <Team> can't run on the website, or on Desktop, until you add a key
    again. You can't undo this."
  - the Desktop clause must reflect subscription coverage, e.g. for anthropic with Claude connected: "…can't
    run on the website until you add a key again. On Desktop it still runs on your Claude subscription."
  - no-users variant (proposed): "No team uses <p>. You can't undo this."
  - ghost **Cancel**, **Remove key** (design uses secondary; OQ-14)
  - after removal: the row disappears, the banner and badges recompute, and the proposed toast is "<p> key
    removed." (no undo; the ciphertext is gone)
- **ENG-58** A save from this page adds a "Just now" row at the top and updates the banner. Toasts:
  - "anthropic key saved. Indicator sprint team still needs xai to run on the website." + **Add xai**
  - banner-origin variant: "xai key saved. Add anthropic too, so Indicator sprint team can run on the
    website." + **Add anthropic**
  - proposed for keys no team uses: "<p> key saved."
- **ENG-59** The **Domains embeddings** section reads "Domains embeddings — Domains ingest uses Hugging Face
  (BGE-small, a free token from huggingface.co) or Gemini embeddings. Add one of these keys to ingest
  documents."
  - no key: status "huggingface not added" + secondary sm **Add key**
  - with a key: "huggingface •••• f0Tk" and no button
  - should be data-driven (OQ-7)
- **ENG-60** The embeddings **Add key** opens the sheet titled "Add an embeddings key" (same subtitle) with
  huggingface picked. Hint: "Used by Domains ingest for BGE-small embeddings. A free token from
  huggingface.co works."; footer "Used by Domains ingest". Toast: "huggingface key saved. Domains can
  ingest documents now." + action **Open Domains**.

### Add key sheet (shared by Overview, API keys, banner, toast actions, embeddings)
- **ENG-61** The sheet opens from the right at 520 px (aria-label "Add an API key") over a scrim. Header
  "Add an API key" + "For website runs, and Desktop runs without a subscription" + IconButton "Close".
  Focus is trapped, Escape closes, and focus returns to the invoker.
- **ENG-62** The Provider field is a combobox button with `aria-expanded`. Empty it reads "Choose a provider";
  picked it shows monogram + slug; for Other it reads "Other provider".
- **ENG-63** The listbox (role listbox/option, `aria-selected`) has a search input, placeholder "Search
  providers", focused on open. Options show monogram, slug and a description with tags:
  - anthropic "Claude models", xai "Grok models", openai "GPT models"
  - gemini "Gemini models and Domains embeddings", groq "Fast open models"
  - huggingface "Domains BGE-small embeddings (free token)", openrouter "many models through one key"
  - tag "· your teams use it" for providers used by teams; "Saved" for providers that already have a key
    (e.g. "Saved · many models through one key")
  - order: team-used first, then the directory order
  - the final action **Other: type the model prefix** is always visible
- **ENG-64** Search filters case-insensitively on slug, label and description ("hug" leaves huggingface +
  Other). Keys: ↑/↓, Enter picks, Escape closes the list.
- **ENG-65** Picking a provider that already has a key turns the save into a replace. Proposed hint: "This
  replaces your saved <p> key (•••• <last4>)." The toast then says "replaced".
- **ENG-66** The hint after a pick reads "Covers models that start with `<p>/`, like <example model>."
  Embeddings-only providers (huggingface) use their own hint instead.
- **ENG-67** API key Input: label "API key", `type=password`, placeholder "Paste the key",
  `autocomplete="off"`. Enter submits. The value is cleared when the sheet closes.
- **ENG-68** The footer notes read:
  - always: "Saved encrypted. After you save, you'll only see •••• and the last 4 characters."
  - when the provider's runnable subscription is connected: "On Tvashtr Desktop your Claude subscription
    still runs first. This key covers website runs, and Desktop runs if you disconnect Claude."
  - then one of "Used by <roles · team>", "Used by Domains ingest" or "Covers <prefix>/… models" (Other)
- **ENG-69** Buttons: ghost **Cancel**, primary **Save key** (enabled-state policy: OQ-4). A pending save
  shows a loading state and disables both.
- **ENG-70** Other shows an Input label "Model prefix" with helper "The part before the slash in your model
  names, like mistral in mistral/large."
  - value containing "/": inline error "Just the part before the slash: <text before first slash>."
  - valid value: lowercased and trimmed
  - proposed extra error for other invalid characters: "Use letters, numbers, _ . or - only."
  - a known provider typed as Other snaps to it (proposed)
- **ENG-71** Saving with nothing filled in shows the form-level error (role alert, above Provider): "Enter a
  provider and an API key."
- **ENG-72** A network failure or 5xx shows the form-level error "Couldn't save that key — is the backend
  running? Your key wasn't saved. Try again." The sheet stays open and the values are kept.
- **ENG-73** A 422 shows the server's `detail` text inline (e.g. "A provider is required.", "An API key is
  required.", or the new prefix error). A 401 goes to the AuthGate seam.
- **ENG-74** A provider picked in advance (row, banner, toast action, embeddings, Suggest) opens the sheet
  already filled; the user can still change it.

### First time
- **ENG-75** When no key is saved and no subscription is connected (live on Desktop, mirror on the web),
  Overview becomes a chooser:
  - lede: "The models your agents run on. Pick at least one way to run before you launch a team."
  - section: "How do you want your agents to run? You can use both. Desktop tries your subscription first,
    then an API key."
  - card "Use my Claude or Grok plan — Runs on this computer from Tvashtr Desktop. No API key needed. Usage
    counts against your own plan." + primary **Connect a subscription**
  - card "Add an API key — Works on the website and on Desktop. Pay the provider per use. Good for hosted
    runs and Domains." + secondary **Add API key**
  - the disclosure
  - nav: "Overview New", "Subscriptions 0 of 2", "API keys" with no count
- **ENG-76** **Connect a subscription** goes to Subscriptions: the Desktop page, or the web page with
  Open/Download.

### Launch blocked
- **ENG-77** The canvas blocked banner ("Can't run on the website yet. No API key for anthropic or xai.
  Subscriptions only work on Tvashtr Desktop." + **Open Engines**) belongs to the canvas area, but it must
  land on Overview (ENG-6). Its provider list matches the 422 `missing_providers` / FE gate.

### Cross-cutting
- **ENG-78** Data loading:
  - pages show skeleton rows while providers, subscriptions and usage load
  - on failure, a proposed inline error "Couldn't load your engines — is the backend running?" with
    **Retry**
  - silent swallowing, as `EnginesShelf` does today, is not acceptable
- **ENG-79** Toasts are dark, bottom-centre, role status, with at most one action button, and auto-dismiss
  after about 6 s (they pause on hover or focus). None has an undo, because nothing in Engines can be undone.
- **ENG-80** Secrets are never shown beyond the last 4 characters and never stored client-side.
- **ENG-81** On Desktop the live bridge status (`getStatus` + `onStatus`) wins over the mirror. The web uses
  the mirror plus the runner freshness flag.
- **ENG-82** Usage data (Used by, verdicts) refreshes when the Engines pages mount and on window focus. Team
  edits happen on the canvas.
- **ENG-83** Accessibility: tables use `scope=col` headers; badges carry text, not colour alone; the ⋯ buttons
  have labels; dialogs use `role=alertdialog` / `dialog` with labels; the listbox uses the combobox pattern.

---

## 3. Backend gap table

| ID | Needs | Status | Where / proposal |
|---|---|---|---|
| ENG-4, ENG-53, ENG-19 | List of saved keys: provider, last4, added date | **EXISTS** | `GET /api/providers` → `providers[].provider`, `.key_last4`, `.created_at` (`routers._provider_to_dict`); sort newest-first on the FE |
| ENG-53, ENG-56 | "Added" after a replace; which key is current | **PARTIAL** | `ProviderCredential.updated_at` exists (`onupdate=func.now()`), but `_provider_to_dict` omits it and an upsert leaves `created_at` unchanged. Add `"updated_at": cred.updated_at.isoformat()` to the dict. No migration |
| ENG-58, ENG-65, ENG-72 | Add a key; know whether it was new or a replace | **PARTIAL** | `POST /api/providers {provider, api_key}` upserts on `(owner, provider)` → `{provider, key_last4}`. Extend the response to `{provider, key_last4, created_at, updated_at, replaced: bool}` (`replaced = existing is not None`). The FE `addProvider` should use `errorDetailFromBody` so 422 detail reaches ENG-73 |
| ENG-56 | Replace a key (old one deleted) | **EXISTS** | The same `POST /api/providers` upsert overwrites `secret_encrypted` + `key_last4`, so the old ciphertext is gone. Keys resolve per node at execution time (`team_run._owner_api_key`), so a running run picks up the new key on its next node |
| ENG-57 | Remove a key | **EXISTS** | `DELETE /api/providers/{provider}` → 204, idempotent. The FE `removeProvider` should use the ApiError detail |
| ENG-70, ENG-73 | "Other" prefix validation | **PARTIAL** | The server runs `provider_for_model(body.provider)`: "mistral/" silently becomes "mistral", and there is no charset check. Add to `add_provider`: after canonicalizing, require `re.fullmatch(r"[a-z0-9][a-z0-9_.-]{0,63}", provider)`, else 422 `detail: "Use just the model prefix — the part before the slash, like mistral."`. Put the helper `validate_provider_slug()` in `control_plane/credentials.py`. The FE keeps its stricter "/" error (ENG-70) |
| ENG-10–14, 19–21, 28, 52, 55, 57, 68, 42 | Which teams, nodes and models use each provider ("Used by", "Can your teams run?", suggested banner, remove/disconnect impact, "See where it's used") | **MISSING** | `GET /api/teams` has no node models. **New `GET /api/engines/usage`**, logic in a new `control_plane/engine_usage.py` (read-only, owner-scoped: `TeamGraph.is_library & owner_id`, join `AgentNode` where `kind in ('agent','completion') and model is not null`; plus `Domain` rows). Response: `{"teams":[{"team_id","name","nodes":[{"node_id","role_name","kind","model","provider","fallback_model","fallback_provider"}]}], "domains":[{"domain_id","name","embedding_model","embedding_provider","generation_model","generation_provider"}], "by_provider":{"<p>":{"teams":[{"team_id","name","roles":[...],"node_ids":[...]}],"domains":[{"domain_id","name","use":"embedding"\|"generation"}]}}}`. `provider` = `credentials.provider_for_model`; `embedding_model` = `normalize_embedding_model`; `generation_provider` only when `config.generation.model` is set (else null, because the account-default resolution is dynamic). The FE computes readiness with the existing parity-tested `missingProvidersForModels`. No migration |
| ENG-20, ENG-2 | Per-team readiness and the "N to fix" count | **MISSING** (derivable) | Derived on the FE from `/api/engines/usage` + `/api/providers` + subscription status using `missingProvidersForModels` (hosted/local). Optional server copy: add `hosted_missing[]`, `desktop_missing_if_open[]` per team in `/api/engines/usage` via `credential_gate.missing_providers_for_launch(byok=held_provider_slugs(owner), fresh_subscriptions=<mirror-connected ∩ RUNNER_SUBSCRIPTIONS>, desktop_target=True)` |
| ENG-11, ENG-63, ENG-66 | Provider picker directory: anthropic, xai, huggingface (not in the catalogue), labels, monograms, example model, subscription and embeddings flags | **PARTIAL** | `/api/config.provider_catalogue` has only openrouter, nvidia_nim, openai, gemini, groq and deepseek, with slugs and presets but no labels. **Add `provider_directory`** to `ConfigResponse` (main.py), sourced from a new `control_plane/provider_directory.py`: `[{"provider":"anthropic","monogram":"A","label":"Claude models","example_model":"anthropic/claude-sonnet-5","subscription":"claude","embeddings":false,"key_help_url":null}, {"provider":"huggingface","monogram":"H","label":"Domains BGE-small embeddings (free token)","example_model":"huggingface/BAAI/bge-small-en-v1.5","subscription":null,"embeddings":true,"hint":"Used by Domains ingest for BGE-small embeddings. A free token from huggingface.co works."}, …]`. The order sets the list order. For catalogue providers, `example_model` defaults to `thinker_default or worker_default`. Pin by test: every catalogue provider and every `EMBEDDING_CATALOGUE` provider appears in the directory |
| ENG-59, ENG-60 | Embedding providers (which keys make Domains ingest work) | **PARTIAL** | `domain_embedding.public_embedding_presets()` exists but is **not served**; the FE mirrors it in `lib/domains.ts`. Serve `embedding_presets` in `/api/config`, or add `GET /api/domain-embedding-presets`. Combine with `/api/engines/usage.domains[].embedding_provider` so the section names the providers the user's domains actually need (the default is `openai/text-embedding-3-small`, not HF; OQ-7). The ingest guard is `routers.post_domain_ingest` (422 `missing_providers`) |
| ENG-26–41, ENG-49, ENG-3 | Subscription status per engine (state, plan hint, checked_at) | **EXISTS** | `GET /api/engines/subscriptions` → `subscriptions[].{provider, connected, state, account_hint, source, checked_at, runner_fresh}`, always 3 rows (`claude`, `grok`, `codex`). Written by Desktop main via `PUT`/`DELETE /api/engines/subscriptions/{provider}` |
| ENG-38 | "Desktop not checking in" per card | **EXISTS** | Claude/Grok: `connected == true && runner_fresh == false`. `runner_fresh` is always false for codex (not in `RUNNER_SUBSCRIPTIONS`), so exclude codex |
| ENG-8, ENG-25, ENG-48, ENG-50 | Is Tvashtr Desktop open/checking in (independent of any subscription), last check-in time | **PARTIAL** | `desktop_jobs.runner_last_seen(owner)` / `runner_fresh(owner)` exist (table `desktop_runner_heartbeats`, window `desktop_runner_fresh_seconds` = 120 s) but are only exposed folded into each `runner_fresh`. Add a top-level field to `GET /api/engines/subscriptions`: `"runner": {"fresh": bool, "last_seen_at": iso\|null, "providers": ["claude","grok"]}`. The web polls it every 3 s while the "Opening Tvashtr Desktop…" dialog is open, so the dialog can close on its own |
| ENG-27 | Plan name for Grok ("SuperGrok") | **PARTIAL** | The Grok harness reports `account_hint: "Grok subscription"`; `grok models` exposes no plan, and the harness must not read `~/.grok`. Render "Grok subscription · via Grok CLI" (OQ-10). Claude's `planHint` → "Claude Pro" already exists |
| ENG-29–41 | State vocabulary is trustworthy | **PARTIAL** (minor) | `UpsertSubscriptionRequest.state` is free text. Validate it against `{"disconnected","needs_install","needs_login","api_key","connected","error"}` (422 otherwise). "checking" is FE-only and never stored |
| ENG-43 | Disconnect clears the web mirror | **EXISTS** | Desktop `engines:disconnect` → `statusSync.clear` → `DELETE /api/engines/subscriptions/{p}`. Stickiness is a Desktop gap (B1) |
| ENG-77 | Which providers block a launch | **EXISTS** | `POST /api/runs` 422 `detail.{message, missing_providers, missing_nodes, subscription_only[, desktop_target]}` (`_missing_credentials_detail` / `_desktop_missing_detail`); the FE gate already mirrors it |
| ENG-47 | Desktop download URL | **EXISTS** (FE) | `lib/desktopDownload.ts` `DESKTOP_MAC_DMG_URL` (GitHub Releases latest, Mac arm64 dmg), `DESKTOP_RELEASES_URL`. No backend needed |
| ENG-48 | Open Desktop from the website | **MISSING** (Desktop, not backend) | See B3 |
| ENG-55 | "Open" a node from "See where it's used" | **EXISTS** (data) / FE gap | `node_id`, `team_id` come from `/api/engines/usage`. The FE needs `onOpenTeam(teamId, {nodeId})` threaded through `AuthGate` → `App` (App has `selectedNodeId` state but no initial-node prop) |
| ENG-65 | Saved-provider tag in the picker | **EXISTS** | Derived from `GET /api/providers` |

No DB migration is required for any proposal above: `updated_at` already exists, and usage/readiness are
read-only queries.

---

## 4. Desktop bridge gaps

Today: `window.tvashtrDesktop = { engines: { getStatus, connect, disconnect, refresh, onStatus } }` and
`tvashtrDesktopInfo = { shell, version: 3 }` (`preload.cjs`). IPC handlers are in `main.cjs::registerEngineIpc`.

- **B1: sticky user disconnect (main-process behaviour; no new bridge method).**
  - Today `engines:disconnect` only clears the local store + mirror. On the next launch
    `runner/engineBoot.cjs::bootEngines` re-probes every provider, and because the CLI is still signed in
    ("You stay signed in to Claude Code itself"), Claude comes back **Connected**. That contradicts ENG-42
    and ENG-43.
  - Fix: persist a `userDisconnected` set in userData (e.g. `engine-prefs.json`, via a small module next to
    `statusStore.cjs`). `bootEngines` and `probe()` report `state: "disconnected"` for those providers
    without probing auth. `engines:connect` removes the flag.
  - The runner's `connectedProviders()` already reads the store, so it follows automatically.
- **B2: cancel a pending sign-in.**
  - Signature: `engines.cancelConnect(provider: SubscriptionProviderId): Promise<SubscriptionStatus>`.
  - Handler: IPC `tvashtr:engines:cancelConnect` deletes `pendingLogins[provider]` (stops the
    window-focus re-probe) and returns `cached(provider)`.
  - It can't close the Terminal window; the copy doesn't promise that.
- **B3: open Tvashtr Desktop from the website (custom protocol / deep link).** Nothing exists (no
  `setAsDefaultProtocolClient`, no `protocols` in `desktop/package.json`). Add:
  - electron-builder `build.protocols: [{ "name": "Tvashtr", "schemes": ["tvashtr"] }]` (writes
    `CFBundleURLTypes` on mac)
  - main: `app.setAsDefaultProtocolClient("tvashtr")`; `app.on("open-url", …)` (mac);
    `app.requestSingleInstanceLock()` + `second-instance` argv parsing (win/linux); focus/restore the window
  - an allowlisted target parser. Accept only `tvashtr://engines/{overview|subscriptions|keys}` with an
    optional `?connect=claude|grok`, which only highlights the card and never auto-runs Connect.
  - bridge: `navigation.onNavigate(cb: (t: { view: "engines/overview"|"engines/subscriptions"|"engines/keys"; connect?: "claude"|"grok" }) => void): () => void`
    and `navigation.consumePending(): Promise<DeepLinkTarget | null>` (cold start before the renderer
    mounts)
  - website side: `window.location.href = "tvashtr://engines/subscriptions"`, then the ENG-48 dialog, plus
    the runner-fresh poll to confirm
- **B4: Desktop runner state for the "open and checking in · Checked just now" banner (optional if the
  server `runner.last_seen_at` is used).**
  - Signatures: `runner.getState(): Promise<{ polling: boolean; lastPollOkAt: string | null; lastError: "unauthenticated" | "offline" | null }>`
    and `runner.onState(cb): () => void`.
  - Source: `runner.cjs::tickOnce` (record the success/failure time; `onPollOk` already exists).
- **B5: refresh must not reject (main-process behaviour).** `engines:refresh` → `probe()` →
  `harness.toStatus()` can throw, and the FE then keeps the stale status. Wrap it like `bootEngines` does:
  catch the error → `record(provider, errorStatus(provider))`. That drives ENG-37's Error state.
- **B6 (nice-to-have): relaunch for the Codex PATH fix.** `app.relaunch(): Promise<void>` →
  `app.relaunch(); app.quit()` would back a "Restart Tvashtr" button next to "Refresh again" (ENG-40). The
  design only tells the user to quit and reopen.
- **B7: type updates.** Add `cancelConnect`, `navigation`, `runner` and `app` to `TvashtrDesktopBridge` in
  `frontend/src/vite-env.d.ts`. Bump `tvashtrDesktopInfo.version` to 4 so the web frontend can
  feature-detect.
- **Existing, keep:** Connect opens the vendor login in Terminal (`terminalLogin.cjs`). The window-focus
  re-probe pushes `onStatus`. Install links open externally via `setWindowOpenHandler` →
  `shell.openExternal`. Codex Connect is not used by the design; hide it.

---

## 5. Frontend mapping

**Today:** `components/EnginesShelf.tsx` is one stacked panel: subscription cards plus a free-text BYOK form
(datalist) and chip list. `Dashboard.tsx` renders it for `view === "engines"`. `AppShell.tsx` has a flat
4-item nav with no groups or badges. `lib/engines.ts` holds the types, the sub↔provider mapping, the shared
gate (`missingProvidersForModels`), `SUBSCRIPTION_DISCLOSURE` and old copy helpers. `App.tsx` computes the
credential gate and routes "Open Engines" → `onBackToDashboard("engines")`. `panel/TeamNodePanel.tsx` has its
own inline add-key form.

**Keep:**
- **`lib/engines.ts`:** `SubscriptionStatus` and the provider/state types, `RUNNER_SUBSCRIPTIONS`,
  `subscriptionProviderForModel`, `modelProvidersForSubscription`, `missingProvidersForModels` (with the
  `credentialGate.cases.json` parity tests), `SUBSCRIPTION_DISCLOSURE` and `displayNameForSubscription`.
- **`lib/api.ts`:** `listProviders`, `addProvider`, `removeProvider` and `listSubscriptionStatuses`. Extend
  their types and error handling.
- **Other modules:** `desktopDownload.ts` constants and the `useModalDialog` focus trap.
- **`EnginesShelf` behaviour:** the Desktop bridge wiring (bridge detection, `onStatus` subscription,
  merging mirror + live) and the `INSTALL_URLS` map.

**Retire:** `enginesShelfSubtitle`, `enginesSubscriptionsCallout`, `enginesApiKeysLede`,
`enginesApiKeysEmpty` and the free-text provider datalist. `enginesNeedsInstallHint` is replaced by the new
copy. Existing `EnginesShelf.test.tsx` assertions on the old copy must be rewritten.

**New or rebuilt:**
- **Routing:** `DashView` gains `"engines/overview" | "engines/subscriptions" | "engines/keys"`, or an
  `engines` view with a sub-tab. `AppShell` needs nav **groups** (collapsible parent + children) and
  **badges** (warn/neutral count pills). `AuthGate`/`App` `onBackToDashboard` passes the sub-view.
- **`useEngines()`** hook, lifted to the Dashboard so the nav badges work on every page. It loads providers,
  subscriptions (bridge on Desktop, mirror + `runner` on the web), `/api/engines/usage` and the directory. It
  exposes `refresh()`, derived provider rows, team verdicts, `toFixCount` and `connectedSubCount`.
- **`lib/engineUsage.ts`** (pure, unit-tested): builds the rows, Desktop/Website cell states, team
  verdict strings, banner list, impact text for remove/disconnect, toast copy and pluralisation.
- **Pages:** `EnginesOverviewPage` (surface cards, providers table, "Can your teams run?", first-time
  chooser), `SubscriptionsPage` (Desktop/web variants + status banner), `ApiKeysPage` (banner, table,
  embeddings section).
- **`SubscriptionCard`:** a state machine covering connected, needs_login, waiting-for-sign-in (loading +
  Cancel), refreshing, launch-checking, api_key, disconnected, error, desktop-stale, needs_install,
  still-not-found and codex-ready, with web-disabled variants.
- **Sheet and dialogs:** `AddKeySheet` (right sheet; `ProviderCombobox` with search listbox and "Other"
  prefix mode; hint and footer; inline errors), `ReplaceKeyDialog`, `RemoveKeyDialog` and
  `DisconnectDialog` (alertdialogs that show the impact), `KeyUsagePopover`, `OpenDesktopDialog` +
  `GetDesktopDialog`.
- **`ToastHost` + `useToast()`:** dark toasts with one optional action; used across the app.
- **Reuse:** `TeamNodePanel` should reuse `AddKeySheet` instead of its own inline form.

**Shared primitives the designs use** (no React DS components exist today, only CSS tokens in
`design-system/tokens`):
- Button: primary, secondary, ghost, tint; sm; loading; disabled
- IconButton, Badge (success/warning/info/neutral/danger, with dot), Input (label, helper, error, password)
- Avatar, Logo, a monogram tile, OK/WARN Callout
- Table, the ⋯ Menu (with a danger item), Popover, Dialog/AlertDialog, the side Sheet, Combobox/Listbox with
  search
- Toast with action, nav group + badge, row flash highlight

---

## 6. Open questions / ambiguities

- **OQ-1: what "N to fix" counts.** The frames only fit a count of **(team × surface) pairs not ready** (2 →
  1 after either fix; three fix buttons ≠ 2). **Recommend** that definition, with both surfaces counted on
  both platforms.
- **OQ-2: the web Overview shows an enabled "Connect" in the xai Desktop cell.** The web can't connect.
  **Recommend** relabelling it "Open in Desktop" on the web. It fires the deep link
  `tvashtr://engines/subscriptions?connect=grok` and the ENG-48 dialog.
- **OQ-3: Desktop verdict on the web.** The launch gate requires `runner_fresh`, but the Overview asks "can it
  run on Desktop". **Recommend** the web use mirror `connected` (ignoring freshness) with the "(on Desktop)"
  suffix; Desktop uses the live status.
- **OQ-4: Save key enabled or disabled while fields are empty.** AddKeyPick disables it; PickProvider-1 and
  SaveErrors-1 enable it and show "Enter a provider and an API key." **Recommend** keeping it enabled and
  validating on click, for discoverability of the error.
- **OQ-5: picking an already-"Saved" provider in Add key.** The server upserts, so it silently replaces.
  **Recommend** the ENG-65 hint plus the "replaced" toast, rather than blocking.
- **OQ-6: an Other prefix with a slash.** The server would silently accept it as "mistral". **Recommend**
  keeping the designed FE error and adding the server charset validation. Also snap a typed known provider,
  and warn if the prefix is "claude"/"grok"/"chatgpt" ("Did you mean anthropic?").
- **OQ-7: the Domains embeddings copy is hard-coded to HF/Gemini.** The backend default embedding is
  `openai/text-embedding-3-small`, and openrouter also works. Adding an HF key doesn't make a domain on the
  default config ingest, so the toast "Domains can ingest documents now." could be false. **Recommend** a
  data-driven section: list the embedding providers the user's domains use (from `/api/engines/usage`), with
  key status for each. Show the HF/Gemini suggestion only when no domain exists. Only claim "can ingest" when
  every domain's embedding provider has a key.
- **OQ-8: Codex that is installed but not signed in.** The harness returns `needs_login`, while the design
  only knows "found = Ready". **Recommend** "Ready" when installed, whatever the login state (Codex is
  status-only and Tvashtr can't run it). Keep "Needs install" and "Still not found" as designed.
- **OQ-9: should Disconnect survive relaunch?** **Recommend** yes (B1). Otherwise the disconnect copy is
  wrong after the next launch.
- **OQ-10: "SuperGrok · via Grok CLI".** The plan name isn't available. **Recommend** "Grok subscription ·
  via Grok CLI". Claude keeps its real plan hint.
- **OQ-11: web Subscriptions for a user who never opened Desktop** (all rows default "disconnected",
  `checked_at` null). **Recommend** a neutral "Not checked yet" badge with the message "Open Tvashtr Desktop
  to connect.", not "Disconnected".
- **OQ-12: Used-by and toast formats for multiple teams.** The design shows only single-team strings.
  **Recommend** "Roles · Team; Roles · Team" truncated to "+N more" in cells. The popover lists every node.
  Toasts name one team if one is affected, else "2 teams can now run on the website."
- **OQ-13: fallback models.** Node `config.fallback_model` providers use keys too, but the launch gate ignores
  them. **Recommend** listing them in "See where it's used" as "(fallback)". They are excluded from verdicts
  and badges. The remove dialog adds "…also the fallback for Engineer" when relevant.
- **OQ-14: Remove confirm button style.** The design uses secondary, while the menu item is danger.
  **Recommend** a danger button for the destructive confirm.
- **OQ-15: "Not open on this computer" on the web.** The web can't detect "this computer"; it only knows the
  user's runner checked in. **Recommend** that when `runner.fresh` is true the web shows "Tvashtr Desktop is
  open on your computer · checked in <t>". Otherwise it shows the designed "Not open" + Download.
- **OQ-16: OvAddKey-4 shows "Website: ready" after adding only anthropic,** while the toast says xai is still
  needed. Treat the toast as correct; the verdict must stay "add xai key".
- **OQ-17: "Added" after Replace.** **Recommend** showing `updated_at`, since that is the current key's age,
  with the original `created_at` in a tooltip.
- **OQ-18: Mac-only download.** The DMG is arm64 Mac. **Recommend** that the Get Desktop dialog detect the
  platform. Non-Mac users get "Tvashtr Desktop is Mac-only for now" and a link to `DESKTOP_RELEASES_URL`.
- **OQ-19: the "Add an embeddings key" sheet reuses the subtitle** "For website runs, and Desktop runs without
  a subscription", which doesn't fit embeddings. **Recommend** "For Domains ingest and Ask, on the website
  and on Desktop."
- **OQ-20: two api_key messages** (CardStates: "…not your Claude subscription. Connect to sign in with your
  subscription." vs. flow: "…not your Claude plan. Connect to sign in with your plan instead."). **Recommend**
  the flow wording, "plan", which matches the rest of the page.
- **OQ-21: removing a key while a run is in progress.** The next node of that run fails with
  `NoCredentialError`. **Recommend** adding a line to the Remove dialog when an affected team has a
  non-terminal `last_run`: "A run of <Team> is in progress and will fail at its next <p> step."
- **OQ-22: the provider picker list length differs** (9 providers in AddKeyPick, 7 in PickProvider-2).
  **Recommend** listing the full directory, scrollable, with team-used providers first.
- **OQ-23: anthropic and xai keys have no model presets in `PROVIDER_CATALOGUE`,** so the node picker offers
  no quick-picks after a user adds them. This is the node-panel area, but the provider directory should give
  them `example_model` so hints still read correctly.
