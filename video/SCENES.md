# The demo film's scenes (V1)

Every scene of the storyboard (`prompts/video-v1.md`) as a take script that re-records by name:
`make -C video take SCENE=<id>` (`DRY=1` to rehearse; `"<id>*"` for a scene's parts). Takes land in
`video/takes/v1/<take>/` (`take.mp4` 2880×1800 · 30 fps, `take.json`, `poster.png`); the review files
are `video/out/v1/contact-sheet.png` and `video/out/v1/ch2-preview.mp4`. How the camera works:
`video/README.md`.

## Status

Generated from the takes on disk (`node video/camera/sheet.mjs scenes-table`). "clip" = a filmed
take; "dry" = rehearsed up to the named spend (a run scene's launch point, or a replay of the F5
proof recording); budgets are the scene's own and the plan's chapter budget — raw takes run longer
on purpose (record more, V4 trims).

<!-- scenes-table -->

## Scene by scene: how it is filmed, and what doesn't match the story

Modes: LIVE (the real Desktop on tvashtr_film) · SAMPLE (fixtures in the real Desktop) · WEB
(Chromium) · RUN (scripted; spends in V2, rehearsed `--dry` in V1) · REPLAY (a recording of a real
run) · MAC (the operator, Recordly) · MOTION (V5). "Pre-wired" = built off camera through the app's
API before the take, because filming it reliably isn't possible (named per scene).

**0.1 PR on GitHub** — RUN/WEB, `scenes/0.1.mjs`. trade_mcp is **private**: the PR page needs the
operator's GitHub session (`node video/camera/github-login.mjs` once; saved to the ignored
`video/out/github-session.json`). Until then the take stops with "BLOCKED". The V1 proof PR is
https://github.com/lazyxgenius/trade_mcp/pull/51 (V2 films the hero run's PR).
**0.2 title** — MOTION (V5).
**1.1 Sign in with GitHub; install the App** — MAC (below): the Desktop's sign-in opens the system
browser, which the camera can't film.
**1.2 Engines** — LIVE. Overview → Subscriptions (Claude and Grok **Connected**) → API keys (the one
key, DeepSeek, shown `•••• <last4>`). The Terminal sign-in is MAC-2. "A backup model" is per agent
(Advanced → Backup model), filmed in 2.5 on the Engineer. Seen once: the Desktop's launch probe
read Grok as "Needs login" while `grok models` answered in 1 s — the pre-roll now uses the app's own
Refresh (never a Terminal sign-in) and stops NEEDS_HUMAN if still not Connected.
**1.3 Toolkit** — LIVE. Web fetch (Browse → Add), a secret by name `EXCHANGE_API_KEY` (a placeholder
value, deleted after the take), and `mcp-builder` imported from `anthropics/skills` (the only public
skills repo checked; trade_mcp is an MCP server). The dialog finds 19 skills; the take keeps only
mcp-builder. **Product finding:** in a run, that library skill fails to load — the run view's banner
reads "repo produced no skills (… filter='mcp-builder')" (proof run 610661d5). V2 must drop the skill
from the Engineer or wait for a fix.
**1.4 Connectors: Linear** — SAMPLE (`fixtures/connectors.mjs`). No Linear account: the browser half
never happens (window.open / shell.openExternal stubbed in the take), the connection turns
connected on the 3rd poll; the tool list is a guess at Linear's MCP tools (not on screen).
**1.5 Domains** — SAMPLE (`fixtures/domains.mjs`, three tiny real PDFs). The sample adds a Hugging
Face reading key the film account doesn't have; the answer text, latency and passages are sample
content; the answer model shows as "deepseek deepseek-chat" (the server's label). Operator item: an
embeddings key (HF or OpenAI) to film it live.
**2.1 New team from a template** — LIVE. New team → "PM → Engineer ⇄ Reviewer" → name → Create team.
**2.2 PM's instructions; Edits allowed off** — LIVE. One line typed into the PM's instructions;
"Edits allowed off" is the PM's **locked** Read-only (the entry agent can't edit files, so it can't
be switched on camera); Save.
**2.3 A Query domain feeding the PM** — LIVE, via Domains › Exchange API docs › Use in teams › "Add
as a step in a team". **Mismatch:** a Query domain can't come *before* the PM (the first node must
be a thinker: `root_not_thinker`), so it sits PM → Query domain → PRD gate and feeds the spec the
Engineer and Reviewer read. The domain has no files and no embeddings key on the film account:
**a run through this step would fail** (V2 must add a key + files, or film the hero run without it —
the proof run did).
**2.4 Spec gate; Engineer tools and skills; Reviewer loop; guardrail; Ship and Stop** — LIVE. The
gate card reads **"PRD approval"**, not "Spec approval". The guardrail is **two gates** (a gate has
one check): their cards read the raw kinds `secret_leak_scan` and `diff_touches_forbidden_paths`,
and the path is the glob `servers/**`. Pre-wired: the two gates (plain approval gates, wired
Reviewer → gate → gate → Ship / Stop); their checks are set on camera. The Engineer's Skills & tools
tab notes that tools aren't used on a Claude-subscription run (skills are added to its
instructions). "Up to 3 rounds" is visible only on the group frame (2.7); the loop arc reads
"changes requested".
**2.5 A model per agent** — LIVE. Engineer and PM → claude-sonnet-5; the Engineer's backup model
DeepSeek (the Desktop notes Claude runs use the subscription and don't switch to it); Reviewer →
claude-sonnet-5 → the same-model hint ("Reviewer and Engineer both run …") → grok-4.7.
**2.6 Remember; budget; failure path → Fixer** — LIVE. The label is **"Remember what it learns"**
(not "I learn"). There is **no budget control on the canvas**: the $5.00 is the composer's "Budget
for this run" (3.1's Run options; the server default). Pre-wired: an unconfigured new agent between
the Engineer and the Reviewer (a downstream "+" lands it on top of the Reviewer, and the Fixer → Reviewer
edge needs a drag); on camera it is renamed Fixer, given the Engineer template and DeepSeek, and its
path becomes "If it fails or times out". **Story mismatch:** the Fixer never runs for a stalled
Desktop job — the stall sweep fails such a run instead of taking the failure path.
**2.7 Tidy; group the loop; v1; Test this agent** — LIVE. Tidy, select Engineer + Reviewer, Group
"Review loop" (frame: "Engineer ⇄ Reviewer · up to 3 rounds"), the header "v1 · saved just now"
(layout changes aren't versions), then More actions → Test this agent → Tests → Run all 1 — a real
replay of the Reviewer on its Grok subscription (V1's one test). Before any run the Reviewer has no
rounds, so its test comes from a CSV (setup). Order changed so a `--dry` rehearsal covers all but
the spend.
**3.1 Home composer** — RUN, record "hero" (V2). The task, trade_mcp, Run options: branch main,
Scope `core`, Budget $5.00 → Launch, then the whole hero run is recorded (3.2–3.6 are replays of it).
On a fresh account Desktop Home shows the ready card instead of the composer; the flow handles it.
**3.2 Live run view** — REPLAY of "hero" from the launch (V2); V1: rehearsed on the proof
recording, and the F5 proof is its "proof" (record) and "replay" parts.
**3.3 Gate → Needs you → fix one line → approve** — REPLAY from the gate (V2); rehearsed on proof.
**3.4 Engineer on Claude; Reviewer on Grok; round 1 back, round 2 approved** — REPLAY (V2). "Its own
copy of the repo" has no visible copy (the raw log names "Running on this computer with your own
Claude Code"). Rounds are the real run's: the proof run needed 3 rounds then the escalation gate.
**3.5 Retrying → backup switch** — SAMPLE (`fixtures/retrying.mjs`). **Not reachable live:** a
Desktop subscription job never emits retry/backup events (only the API-key gateway path does), and
the film account has no second provider for a backup. V4 must caption it as an illustration or drop it.
**3.6 Guardrail passes; Ship; PR; Done** — REPLAY (V2). A passing guardrail writes no Activity line
(its card turns Approved).
**3.7 Changes; Ask; cost per round; Memory** — LIVE on the newest finished run (V2: hero; V1
rehearsed on the proof run, stops before the Ask's Send). Memory review mode is switched on in setup
so new memories wait for Keep/Discard.
**4.1 Quiet → Stalled → Failed** — RUN (V2): stack with `QUIET=20 STALLED=60 FAIL=180`; the
Engineer's CLI is paused through the Desktop's own process tree (SIGSTOP). The Mac notification is
MAC-3.
**4.2 Resume** — RUN (V2) on 4.1's failed run. The confirm's sections are "Kept", "Runs again" and a
"Skips N min of finished work" line — there is no "saved" heading ("Safe:" is in the failed callout).
**5.1 Start the next run from this** — RUN (V2) on the hero run: "Add a DEMA indicator", carry
spec/decisions/memories/summaries, Start from the PR branch. Recent tasks exist only in Home's
composer: part `5.1-recent`.
**6.1 Tests** — RUN. Make this a test (round 1, an AI check) → tests from a CSV (the column mapped
on camera) → Run all (a spend: V1's one test went to 2.7). "Check the AI check" opens only from a
failed AI-check result, after Run all.
**6.2 History** — SAMPLE (`fixtures/history.mjs`) + part `6.2-save` (RUN, V2). **Mismatch:** chapter
2 ends at v1 (nothing is saved there) while 6.2 is "2 changes since v7": V2 must either save v2…v7
through the story or relabel 6.2 (the sample assumes chapter 2's edits were saved one by one).
**6.3 Compare; task set; Restore** — RUN (V2; compares and task sets spend). The task set
"Indicators" with hidden checks is saved on camera; the compare stops before "Start compare".
**7.1 My agents** — LIVE. Save the Reviewer as "Strict Reviewer" → another team ("Bugfix squad") →
Templates → Strict Reviewer → Undo → again → "Based on Strict Reviewer v1".
**7.2 Team file; Import on a second account** — LIVE with `HOSTED=0 video/stack/up` (the email
sign-up exists only on a self-hosted backend; hosted mode offers only GitHub). The panel's lock line
reads **"No secrets or sign-ins inside"**. Account B finishes this Mac's first-run setup the moment
it is created (a camera hook on the sign-up response, not product code); each re-take makes a new
`lazyx.teammate+<n>@tvashtr.local`.
**8.1 Home** — SAMPLE (`fixtures/home.mjs`) + part `8.1-web` (WEB, the same Home on the website).
The local-folder run ("Branch tvashtr/…") is sample data; **product layout bug:** a long branch name
squeezes that Recent runs row (the idea disappears). The composer placeholder still says "Add an RSI
indicator with tests" (product copy).
**8.2 end card** — MOTION (V5).

### Across the film

- **Money on subscriptions:** the live proof run's toolbar read "$0.00 + your Claude and Grok
  subscriptions" (the mixed wording) with no API-key work in it.
- **Escalation:** in the proof run the Grok Reviewer asked three rounds running for the agents'
  scratch files (`REPORT.md`, `TVASHTR_REMEMBER…`) to be removed; the run parked at the Escalation
  gate, which V1 approved through the app's API ("ship the last build as-is") so the recording could
  end — PR #51 carries those files. V2's hero run may hit the same.
- **Local paths on screen:** an Activity line shows the Desktop job's temp path
  (`…/runner-jobs/<id>/prompt.txt`).
- **Team names:** each scene rebuilds "Indicator sprint team"; a same-named team that already has
  runs is renamed "… (earlier)" (deleting would delete its runs). For V2's clean account,
  `video/stack/reset` first.


## Before V2 (measured in V1)

**What a real run costs on the subscriptions** — the F5 proof run (one README line, the full film
team without the domain step): PM spec 0.6 min · Engineer round 1 0.2 min · Grok Reviewer 6.5 min ·
Engineer round 2 2.8 min · Reviewer 4.4 min · Engineer round 3 3.0 min · Reviewer 7.2 min · (the
Escalation gate, then Ship) — **30m 42s** to PR #51. The Grok Reviewer is the slow seat (4–7 min a
round); every one of its three rejections was about the agents' scratch files, not the change.

**Real work per scene in V2** (V1 measured what it could; the rest is estimated from the proof run):

| scene | real work | expected time |
|---|---|---|
| 3.1 (records the hero run; 3.2–3.6 are replays of it) | 1 run: "Add a Hull moving average indicator" | 30–45 min (2–3 rounds) |
| 3.7 | 1 Ask (the Reviewer, Grok) | 1–3 min |
| 0.1 | none (the hero PR's page; operator GitHub session) | — |
| 4.1 | 1 run: "Add a TRIX indicator", Engineer paused (stack with QUIET=20 STALLED=60 FAIL=180) | ~6 min to Failed |
| 4.2 | 1 run: the resume of 4.1 | 20–35 min |
| 5.1 | 1 run: "Add a DEMA indicator" from the hero run | 30–45 min |
| 6.1 | the Reviewer's tests (a round test + 3 CSV tests) on Grok | ~8 min |
| 6.2 save | "Save and run tests" (4 tests) on Grok | ~8 min |
| 6.3 | Compare v7/v8 on one task (2 runs) + the "Indicators" set (2 tasks × 2 versions = 4 runs), lanes taking turns on the subscriptions | 2–3 h |
| 2.7 (re-take only) | 1 test replay (V1 used it: passed) | ~2 min |

**Suggested sittings:** (1) `video/stack/reset`, then 3.1 → 3.2/3.3/3.4/3.6 replays → 3.7 → 0.1
(≈1 h 15 min, one run); (2) stack with the stall knobs: 4.1 → 4.2 (+ MAC-3) (≈45 min, two runs);
(3) 5.1 → 6.1 → 6.2 save (≈1 h, one run + tests); (4) 6.3 unattended (2–3 h, six runs — check the
plans' usage caps first); MAC-1/MAC-2 any time.

**V2 must fix or decide first:**
1. **The Query domain step would fail the hero run** (no embeddings key, no files in "Exchange API
   docs"): give the account an OpenAI or Hugging Face key plus real exchange-API PDFs (then 1.5 can
   be live too), or run the hero on the team without the domain step (as the proof did).
2. **The mcp-builder library skill doesn't load at run time** (the run view's banner): take it off
   the Engineer before the hero run, or wait for a product fix.
3. **The Reviewer rejects over the agents' scratch files** (`REPORT.md`, `TVASHTR_REMEMBER*`): add
   one line to the Reviewer's instructions (a team edit, not product) — or expect the Escalation
   gate again.
4. **Version numbering:** chapter 2 ends at v1, 6.2 says "2 changes since v7" — save versions
   through the story or relabel 6.2.
5. **0.1:** the operator runs `node video/camera/github-login.mjs` once (trade_mcp is private).
6. **7.2** needs `HOSTED=0 video/stack/up` (restart the backend), then back to hosted.
7. **The hero record take paces the replays:** a replay holds at each gate the page approved until
   the camera clicks it, but any drawer or tab a later scene opens must also have been opened in the
   record take (3.4's Engineer drawer wasn't in the proof recording) — add those views to 3.1's flow
   before V2 records.
8. `video/stack/reset` before V2, so the account holds only the film's own teams and runs.

## Operator items

### MAC shots (record with Recordly; Tvashtr frontmost; `caffeinate -dimsu` running)

Each script names the app, the visible label to click and what should show. Record at 1440×900 if
Recordly lets you pick a window size; V4 cuts them in beside the camera's takes.

**MAC-1 — 1.1 Sign in with GitHub; install the GitHub App on trade_mcp** (the GitHub side; the
Desktop opens the system browser, which the camera can't film)

1. Quit every Tvashtr Desktop. Open Tvashtr Desktop signed out (the Welcome page): heading
   **"Welcome to Tvashtr"**.
2. Start Recordly on the whole screen (the Desktop and the browser will both show).
3. Tvashtr: click **"Sign in with GitHub"**. The Desktop shows **"Finish signing in in your
   browser"** (buttons "Open the browser again", "Copy the sign-in link", "Cancel").
4. Browser (opened by itself): GitHub's **"Authorize Tvashtr"** page (the app is `tvashtr-dev` on
   the local stack) → click the green **"Authorize …"** button. If GitHub asks which account, pick
   **lazyxgenius**.
5. Browser: the Tvashtr page **"Open Tvashtr Desktop"** → click it; macOS asks **"Open Tvashtr?"**
   → **"Open Link"**. The Desktop moves on by itself (signed in).
6. Install the App on trade_mcp: Tvashtr → Home → the composer's repo button (shows
   "Pick a folder") → **"Install the Tvashtr GitHub App →"** (or, when it is already installed,
   **"Add repositories on GitHub →"**).
7. Browser: github.com **"Install Tvashtr"** (or "Configure") → **"Only select repositories"** →
   pick **lazyxgenius/trade_mcp** → **"Install"** (or "Save").
8. Back in Tvashtr, open the repo picker again: **lazyxgenius/trade_mcp · main** is listed under
   "GitHub App repos". Stop recording.

Note: the App is already installed on trade_mcp for this account, so GitHub shows "Configure" and
"Save" rather than "Install". On the local stack the GitHub OAuth callback is
`http://localhost:8000/api/auth/github/callback` (the dev App); for the website flavour use the
production app at https://tvashtr.fly.dev with the installed Tvashtr Desktop.

**MAC-2 — 1.2 Claude and Grok connected with your own sign-in (opens Terminal)**

The Desktop opens Terminal only when the CLI is signed out (an already signed-in CLI just shows
"Connected"). Recording this means signing the CLI out first and back in on camera — your call.

1. In a plain Terminal (not inside the Claude app): `claude auth logout` (Grok: `grok logout`).
2. Start Recordly on the whole screen.
3. Tvashtr → **Engines** → **Subscriptions** → the **Claude** card shows **"Needs sign-in"** →
   click **"Connect"**.
4. Terminal opens by itself with the line **"Signing in to Claude Code — follow the prompts
   below."** The Tvashtr card shows **"Waiting for sign-in"** and the callout "Finish signing in to
   Claude in the Terminal window that just opened…".
5. Terminal: follow the prompts (choose your **Claude subscription**, not an API key); the browser
   opens claude.ai → **"Authorize"**. Never film the code/token Terminal may print — cover or crop
   that part, or stop and restart recording around it.
6. Terminal prints **"When you're done, switch back to Tvashtr — it re-checks automatically."**
   Switch back: the card turns **"Connected" · "Claude Max · via Claude Code"** (Grok: "Grok
   subscription"). Stop recording.

**MAC-3 — 4.1 the Mac notification ("Indicator sprint team stalled")**

1. In the run view of the 4.1 take (V2), when the notifications ask shows, click **"Turn on"**
   (keep "When a run stalls or fails" ticked). macOS may ask **"“Electron” Would Like to Send You
   Notifications"** (the dev Desktop is "Electron"; the installed app is "Tvashtr") → **"Allow"**.
   That macOS permission is yours to grant (V1 never clicks it).
2. Start Recordly on the top-right of the screen before the Engineer goes Stalled.
3. The banner shows **"Indicator sprint team stalled"** — "No update for N minutes. Nothing
   shipped; finished steps are saved." (later "Indicator sprint team failed" is suppressed when
   the stall was already announced). Click it: Tvashtr opens the run. Stop recording.

### Other operator items

- **A throwaway API key** for the "add a key" moment of 1.2 (V1 shows the DeepSeek key masked only;
  no real key is typed on camera).
- **Linear** (1.4) and **an embeddings key** (1.5) if those scenes should be filmed live instead of
  from sample data.
- **The Claude CLI sign-in**: check `claude auth status` from a plain Terminal before V2's runs
  (inside the Claude app it reads the app's own sign-in).
