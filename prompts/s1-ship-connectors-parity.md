# Brief — Ship Security S1, then finish the Connectors screens

Architect: Tvashtr Sidechat-16, 2026-10-01 (~17:30 IST). Read this whole file before doing anything.

## Where things are (audited on disk by the architect)

- `main` = `origin/main` = `f6f8b3f`, live as Fly v29 / `desktop-v0.13.0`.
- `fix/security-s1` = `origin/fix/security-s1` = `186c4a8`, 13 commits ahead of `main`, 0 behind. The
  Mac checkout is ON this branch (`.git/HEAD`). It changes no screen (`git diff main fix/security-s1
  -- frontend desktop` is empty), adds no migration, and leaves `team_run.py` untouched; the migration
  hook now freezes `0001`–`0043`.
- The architect read the S1 code: Domains agents get a Bearer run token (own salt; names the run, the
  agent and the domains; refused once the run ends) and `/mcp/domains` accepts nothing else; a
  non-Featured connection can't use a Featured provider's sign-in site (`borrowed_signin`, and an
  older borrowed sign-in is dropped to `needs_signin` on first use); the owner sweep covers all 174
  routes with a guard test that fails on an unlisted or stale route; the six edited existing tests
  swap cookie checks for stricter token checks (nothing weakened).
- The previous session's own results (start 11:38 IST, finished ~13:02): `make test` 2,919 passed /
  1 xfailed; e2e Connectors, Domains, `revamp-shell` + the proxy probe; `make demo-proof` C1–C12 with
  PR `lazyxgenius/trade_mcp#30` (attempt 2); docker build; vitest 2,244, tsc, build, desktop 143. Not
  re-run by the architect: you re-run them as item 2.
- It stopped the ship on the Connectors parity gate (16 of 86 renders at 0 drift; record in
  `docs/superpowers/parity/connectors.txt`, splitter `scripts/design-parity/split-composite.py`,
  scenarios `scripts/design-parity/scenarios/connectors-*.mjs`). Ruling 1 below removes that block.
- Two untracked stray files sit in the checkout: `backend/DEMO_PROOF.md` and
  `backend/docs/DEMO_PROOF.md` (a LOCAL demo-proof agent wrote outside its workspace).
- Read before starting: `docs/superpowers/HANDOVER-2026-10-01-security-s1.md` and
  `docs/superpowers/parity/connectors.txt` (both on `fix/security-s1`), the "Ship Protocol" and "Hard
  rules" of `prompts/revamp-e2e.md`, `prompts/CLI-RULES.md`, `scripts/design-parity/README.md`, the end
  of `STATE.md`.

## 0. Time limit and stopping point — read first

- **Hard limit: 4 hours from your first command after the `/goal`.** Run `date` first, echo the start
  time and the deadline, and run `date` before each checklist item.
- **Checkpoints.** Item 3's `fly deploy` must start by T+1:45, or skip the deploy and record why. Item
  5 starts only after item 3's outcome is final. Item 6 runs only if item 5 is done and every gate is
  green by T+3:15. At T+3:30 start nothing new and go to item 7. At T+4:00 stop.
- **Three-attempt rule.** If one problem survives three distinct fix attempts (each with its output),
  record the evidence and what you tried, and move on.
- **Helpers.** At most 2 at once, each in its own git worktree with its own database and ports (the
  last session ran 6 in one checkout — don't).
- **Never run tests next to a live stack.** Any process that starts the app reaps run workspaces its
  own database doesn't know about; that broke demo-proof attempt 1 last time.
- **Safe state at the stop.** `main` changes only through the full Ship Protocol. No half-done merge
  or deploy. Your branches pushed. No servers, Vite, Playwright or background tasks running. The
  checkout on `main`, clean apart from the operator's untracked docs (`HANDOVER.md`, `PROJECTPLAN.md`,
  `prompts/`, `STATE.md`).
- **Evidence or nothing.** Never call anything fixed, shipped or deployed without the command and its
  actual output in the chat. Keep what you verified apart from what you assume.

## 1. Preflight (aim for 15 minutes)

1. Load the `ponytail` skill with the Skill tool. Say plainly in your first message, and in the
   handover, whether it loaded (the last report never said).
2. Confirm the state above with commands: the shas, the checkout's branch, the empty frontend/desktop
   diff, the two stray files untracked.
3. Echo the start time and deadline, the checklist with each item's acceptance criteria, and the
   blockers you expect.

## 2. Architect rulings — apply them; don't ask again

1. **S1 ships without waiting for the Connectors parity.** S1 changes no screen, and the cookie
   exposure it closes is live. A parity gate applies to the area a ship changes.
2. **The 18 accepted exceptions and the spike status routes keep answering exactly like an unknown
   id.** No change to 404. What matters is that B learns nothing about A's objects, and the tests
   prove that.
3. **The spike proof routes don't exist in hosted mode.** `POST /api/spike/hello-durable`,
   `GET /api/spike/hello-durable/{id}`, `POST /api/spike/generate-doc` and
   `GET /api/spike/generate-doc/{id}` answer 404 when hosted mode is on (production). `generate-doc`
   starts a model call on the server's default model with no owner and no limit, so any signed-in
   account could spend whatever key the server holds. `GET /api/spike/run-events/{run_id}` stays (the
   run view uses it). Without hosted mode (local), nothing changes, so the old scripts keep working.
   The sweep's route table and guard stay true.
4. **Connectors parity.**
   - **The app governs** (add one `# waiver` line per item, naming this ruling): the leading-icon gap
     (the design-system Button's 8px gap; the frames draw the icon flush only because the canvas Button
     wraps icon and label in one span); the drawer's access select (the app's small Select keeps its
     label whole; the frame's clips it to "Read onl"); the dialog's "Team" label (the shared Field
     label, 14px); "Signed in to Supabase." without the organization name (the app doesn't know it,
     so the honest copy stays).
   - **The design governs** (build it, as the boards draw it): the row ⋯ menu's rows are 230px wide
     (CnF-Changes-4); the connect sheet's header shows the 42px provider tile left of "Connect <name>"
     (CnF-Connect-2..4, -7, -8, -10, -11, CnF-Changes-7); the sheet shows the "Read only / Only with
     Read & write" box that says what each access allows (CnF-Connect-2).
   - All three are already in the approved canvas, so there is no new design work: implement what the
     boards draw. If anything else turns out to need a new design, don't build it — record it for the
     operator (any new design is done first in the existing canvas
     https://claude.ai/artifact/V6THVh3i7RFjMUtuS2dskK, which is at its 511-file limit).
   - The measurement artifacts the last session explained keep their `# note` lines.

## 3. Checklist — in this order

### 1. The spike proof routes are off in hosted mode (ruling 3), on `fix/security-s1`
Acceptance: a test showing the four routes answer 404 in hosted mode, failing on `186c4a8` first, then
passing; a test that they still work without hosted mode; `GET /api/spike/run-events/{run_id}`
unchanged; `grep` showing no frontend caller of the four routes; the owner-sweep guard test passing.

### 2. The step-1 gates on the `fix/security-s1` head — one at a time, never next to a live stack
`make test` on its own database; vitest; tsc; build; desktop tests; docker build; lint on changed
files; `scripts/connectors_e2e.sh` (spec + proxy probe), the Domains spec, `revamp-shell` and every
spec that drives a route S1 changed; the live Domains run-time check; an independent review of item 1's
change only (the rest was reviewed); `make demo-proof` C1–C12 with a real PR. Parity is exempt
(ruling 1): show `git diff main -- frontend desktop` empty instead. Echo each command and its result.

### 3. Ship S1 — backend only
Ship Protocol steps 2, 4, 5, 7 and 9 of `prompts/revamp-e2e.md`; steps 3 and 8 are skipped (no
Desktop release: the frontend and `desktop/` are unchanged — say so); there's no step-6 pause (no
migration, no `team_run.py` change). Before `fly deploy`, confirm no run is in flight on prod (no
`tv-run-*` Fly app; the logs show none). If one is, wait up to 20 minutes; if it's still running,
don't deploy, and record that. Smoke, in addition to the protocol's: `/mcp/domains` refuses a login
cookie and a request with no token; `POST /api/spike/generate-doc` answers 404; the live asset name is
still `index-DXwje35F.js` (the frontend didn't change). If the smoke fails, roll back to the v29 image
and record it.

### 4. Housekeeping
Delete `backend/DEMO_PROOF.md` and `backend/docs/DEMO_PROOF.md` after confirming they're untracked.
Put the checkout back on `main`.

### 5. Connectors parity (ruling 4) on `fix/connectors-parity`
Branch from `main` after S1 ships. If S1 didn't ship, branch from `fix/security-s1` and don't run
item 6. Build the three design-governed items, each with a test. Add the waiver lines. Re-shoot all
86 renders (`split-composite.py` + the `connectors-*` scenarios, web and Desktop).
Acceptance: every line in `docs/superpowers/parity/connectors.txt` is 0 size/type drift, or carries a
`# waiver` naming ruling 4, or a `# note` the last session wrote; vitest, tsc and build pass.

### 6. Ship the parity work — only if item 5 is done and every gate is green by T+3:15
The full Ship Protocol (steps 1–9), with the parity lines as a gate, `desktop/package.json` →
`0.14.0`, tag `desktop-v0.14.0`, and the DMG check. If S1 didn't ship in item 3, don't run this item.

### 7. Handover — always, at the stopping point
Commit `docs/superpowers/HANDOVER-2026-10-01-s1-ship.md` (on your branch; on `main` only through a
ship), add a `STATE.md` section, and echo the handover in the chat. Sections: **Changed** · **Verified
(actual results)** · **Assumed, not verified** · **Unfinished or blocked** (with evidence) · **Next
steps for a fresh session** (exact, in order, starting with branch and sha) · **Operator actions**.
Operator actions include rotating `TVASHTR_SESSION_SECRET`, but only once S1 is deployed and its smoke
passed. Why: it signed every login cookie handed to agents since 2026-09-15; they last 14 days and
can't be revoked any other way. What it does: everyone is signed out once, web and Desktop; connector
and Domains tokens of runs in flight stop; stored API keys are NOT affected (`TVASHTR_SECRET_KEY`).
When: with no run in flight. Also the one-time sign-in to each Featured provider.

## 4. Scope and invariants

- **Out:** new integrations of any kind; HubSpot, Google Drive/Docs/Sheets and every other not-ready
  connector stay "Coming soon"; migrations; `team_run.py`; Tools behind the proxy; x402 labels; the
  old lint baseline; `scripts/thinker_chain_e2e.sh`. Note anything else you find; don't fix it.
- **Blocked by design — record, don't attempt:** the secret rotation (a Fly secret: the operator's
  step); a real sign-in to any provider; anything that needs a password, key or account you don't
  have.
- **Invariants (show each with a command before the handover):** no migration file added;
  `git diff main -- backend/tvashtr/control_plane/team_run.py` empty; no existing assertion weakened;
  Fly secrets and production data untouched; own paths committed by name, never `design/`,
  `HANDOVER.md`, `PROJECTPLAN.md`, `prompts/`.
