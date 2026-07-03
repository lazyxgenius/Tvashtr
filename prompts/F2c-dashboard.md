# F2c — The dashboard reskin: one teams table with status + spend, the template picker, delete, + the status-pill rider (frontend)

**Runs LAST, after F2a + F2b + F2-delete are merged.** Frontend-only. **NO backend change, NO
migration** (the backend is already done). `api.ts` is touched ONLY additively (one type extension).

**Outcome.** Reskin the dashboard to the target `design/Tvashtr Frontend Overhaul/Dashboard.dc.html`
with the operator's model — **one unified teams table** where each team carries its latest run's
status and its total spend (a run is a team that ran). Wire the **template picker** on create and
**delete** (which now stops+removes per F2-delete). Remove the orphaned `TeamsRail`. Fold in the
canvas **status-pill overflow** fix as a rider.

Read first: the current `frontend/src/components/Dashboard.tsx`, `AuthGate.tsx` (routing:
`onOpenTeam` → canvas, back-arrow → dashboard), `frontend/src/lib/api.ts` (the shapes below), and the
`Dashboard.dc.html` target. Reskin the RUNNING component onto the design — keep it drivable + tests
green; the backend contract is the wall (only the additive type below).

---

## 1. `api.ts` — the ONE additive change

Extend `TeamSummary` (F2b now returns these) — additive only, nothing else in `api.ts` changes:
```ts
last_run: { status: string; at: string; run_id: string } | null;
spend_usd: number;
```

## 2. The dashboard, reskinned to `Dashboard.dc.html`

Match the mockup's LOOK (extend.css tokens + the shared `.tv-*` primitives + the existing `.tv-dash__*`
classes; the mockup styles via inline recipes — port them to classes in the `.tv-dash__*` convention;
extend base tokens, never edit them). Structure:

- **Greeting header** — the Tvashtr wordmark + the account avatar/email/Log out (as today), and a
  greeting line ("Good to see you" — derive a friendly handle from the email if you like; no new PII).
- **Stat strip — three chips, all REAL from the teams list:** **Teams in your library** (count) ·
  **Active runs** (count of teams whose `last_run.status` is non-terminal) · **Total spend**
  (`$` + sum of every team's `spend_usd`). *(This replaces the mockup's "spend this week" with a real
  lifetime total — no invented number.)*
- **ONE teams table** (the mockup's grid, adapted to real columns):
  - **Team** = `name` — the row is clickable and calls `onOpenTeam(team_graph_id)` (opens the canvas).
  - **Nodes** = `node_count`.
  - **Status** = from `last_run`: `null` → a muted **"Not run yet"** pill; else map `last_run.status`
    to a status pill — *Running / Awaiting you / Completed / Failed / Stopped / Over budget* (reuse
    the existing `StatusPill` + the design's status colors; keep the labels human).
  - **Spend** = `$` + `spend_usd.toFixed(2)`.
  - **Created** = `created_at` (formatted / relative).
  - **A delete button** on the row (see §4).
  - Empty state (no teams — rare, since the backend seeds) → the mockup's empty prompt.
- **Provider keys section** — reskin the EXISTING add/remove/list (`listProviders`/`addProvider`/
  `removeProvider`) to the mockup's look. Behavior unchanged.

No separate runs table — the run shows on its team's row. (If the operator later wants per-run
history, that's a future click-into-a-team; NOT this slice.)

## 3. The template picker on "New team"

Replace today's hardcoded `createTeam("review_loop","New team")` → immediate-open with a picker:
clicking **New team** opens a warm pop-up dialog (the same premium pop-up language F1c established —
dimmed dashboard behind) containing a **name field** (default "New team", editable) and **starting-point
cards**:
- A **Blank** card the FE adds — "Start from an empty canvas — one thinker into Ship. Wire the rest
  yourself." (maps to `createTeam("blank", name)`).
- One card per template from `getTemplates()` (F2a now returns four): render its `name` + `description`;
  selecting highlights it.

**Create team** → `createTeam(selectedKey, name)` → `onOpenTeam(created.team_graph_id)` (lands on the
canvas in authoring mode). Cancel/close dismisses. It's a NEW component (e.g. `NewTeamDialog.tsx`)
rendered by `Dashboard`.

## 4. Delete (the endpoint now stops + removes — F2-delete)

The row delete button opens a small confirm pop-up (same premium pop-up language):
- Names the team — "Delete **{name}**?"
- "This permanently deletes the team and its run history, and can't be undone."
- **If** `last_run.status` is non-terminal, add: "**A run is in progress — deleting will stop it.**"
- **Cancel** (default) / a red **Delete**.

Confirm → `deleteTeam(team_graph_id)` → reload the teams list (`getTeams`). (Deleting your last team
re-seeds a fresh "My team" on reload — the backend's never-empty posture; that's expected.)

## 5. Rider — the canvas status-pill overflow fix

In `frontend/src/canvas.css`, add `flex-wrap: wrap;` to the `.rf-node__meta` rule. (The card is a
fixed 216px; on WORKER cards capability + engine + the status pill overflow the row and clip the pill's
label; wrapping drops the pill to its own right-aligned line — its `margin-left:auto` keeps it
right-aligned.) Touch ONLY that one rule — the F1a–c node/chrome/edge recipes stay intact. The greyed
model line ellipsizing at the bottom is BY DESIGN — not part of this fix.

## 6. Remove the orphaned TeamsRail

Delete `frontend/src/components/TeamsRail.tsx` + `TeamsRail.test.tsx`. FIRST grep `frontend/src` to
confirm nothing imports `TeamsRail` (team management moved off the canvas rail in Pass 1 — `App.tsx` +
`AuthGate` don't import it). If anything still does, STOP and report it.

---

## 7. Invariants / do-not-touch (verify on disk)

- **`api.ts` ADDITIVE only** — the diff vs `main` is EXACTLY the two `TeamSummary` fields above,
  nothing else.
- **NO backend change, NO migration.** Nothing under `backend/`; alembic head stays `0018`.
- **The canvas is untouched except the one `.rf-node__meta` line.** `canvas.css` diff = that single
  rule; NO other node/chrome/edge recipe changes. No canvas `.tsx` changes.
- **Base design tokens byte-untouched** — extend only.

## 8. Tests

- **Re-point `Dashboard.test.tsx`** to the new DOM — it must still assert REAL behavior: lists the
  account's teams, clicking a team calls `onOpenTeam` with its id, add/remove provider still work.
- **Add** a picker test: New team → the dialog shows Blank + the templates → pick one + a name →
  `createTeam` called with the right key + name → `onOpenTeam` called with the new team's id.
- **Add** a delete test: row delete → the confirm names the team → Cancel closes with no call; Delete →
  `deleteTeam` called with the id → the list reloads. Cover the in-progress extra-warning line.
- **Add** a render test: a team with a `last_run` shows the mapped status pill + its `$spend`; a
  never-run team shows "Not run yet" + `$0.00`; the stat strip shows the right counts + total.
- Deleting `TeamsRail.test.tsx` removes its 5 tests, so the vitest count MOVES — set the F2c floor
  from a FRESH `make test-frontend` at F2c start, then keep it green.

## 9. Acceptance / evidence (run it all yourself; echo each into the chat)

1. `make build-frontend` — `tsc --noEmit` strict clean + vite build ✓.
2. `make test-frontend` — green; report the new vitest count (note: −5 from TeamsRail, + the new
   dashboard/picker/delete tests).
3. `make lint` — clean.
4. **Playwright self-sign-off vs `Dashboard.dc.html`** (targeted `browser_evaluate` + screenshots, NOT
   a whole-tree snapshot — it hangs on React Flow): (a) the dashboard — greeting + the three stat chips
   + the teams table (a team showing a status pill + a `$spend`) + the providers section; (b) the
   picker — New team → the dialog with Blank + the four templates → pick one + name → lands on the
   canvas; (c) delete — row delete → the confirm dialog naming the team. A screenshot per check.
5. **Playwright self-sign-off for the RIDER** on the canvas — screenshot a thinker node + BOTH worker
   nodes cycling the status set (Waiting / Working… / Done / Failed / Stopped), proving NO tag clips on
   any node.
6. **Diffs** — echo the additive-only `api.ts` diff; the single-line `canvas.css` diff; and that the
   TeamsRail files are deleted.
7. Branch `feat/f2c-dashboard`; end with a `READY_TO_MERGE` line.

## 10. Stop conditions
- A contained FE reskin that stays inside this brief → proceed to green.
- Any need for a BACKEND change, a new endpoint, a migration, or a canvas change beyond the one rider
  line → write `NEEDS_HUMAN` to `STATE.md` with specifics and STOP.
- Hard cap: 30 turns. On the cap, write the blocking reason to `STATE.md` and stop.
