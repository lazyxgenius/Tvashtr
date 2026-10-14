# Brief — M-desk-4: money and time that tell the truth on the Desktop

Architect: Tvashtr Sidechat-21, 2026-10-10 (operator: "proceed"). Path:
`/Users/adimac/Desktop/Tvashtr/prompts/m-desk-4.md`. `prompts/` is untracked: never commit it. Where
this brief and `prompts/CLI-RULES.md` differ, this brief wins (CLI-RULES' numbers are out of date).
Read `prompts/m-desk-3.md` and `prompts/m-desk-2.md` too: their rulings and rules hold unless this
brief says otherwise. **The work list is `prompts/m-desk-4-sweep.md`** (M-desk-3's G4 sweep, rows
S1–S3, D1–D23, K1–K8, every file:line checked at `1b38668a`).

## Why

On the Desktop, agents run on the owner's Claude and Grok subscriptions (M-desk-routes, -2, -3). But
many Desktop screens still price that work in dollars ("Done in 4m · $0.00", "$0.0000" per round,
Resume's "You only pay for the steps that run again"), say lanes run at once when they take turns,
or tell a Desktop user a key is what runs a Claude/Grok model. M-desk-3's sweep found 34 such rows,
most on screens the demo film shows (scenes 3.x, 4.x, 6.x, 8.1); one of them (S1) is a real bug: in a
running task-set compare, a lane queued behind the other shows "Working" instead of "Waiting for
your … subscription — one job at a time".

**What the user gets:** in the Desktop app, money figures cover real money only (API-key spend);
work that ran on a subscription says which subscription did it and how long it took; Resume talks
about work saved, not dollars saved; budgets say they count API-key spend; estimates count the
turns lanes take; a queued lane says it is waiting. The website is unchanged.

## Where things are

- Branch `feat/m-desk-4` from `main` @ **`02488987`** (V0, gate fix, M-desk-routes, M-desk-2, the DBOS
  cron fix and M-desk-3 merged). Create it in your worktree with
  `git switch -c feat/m-desk-4 02488987` and confirm the sha. Alembic head `0053`; the freeze hook
  covers `0001`–`0053`.
- Floors (M-desk-3): `make test` 3485 passed / 1 xfailed; vitest 268 files / 2732; desktop 143/0;
  owner sweep 201.
- What a run already knows: `runs.desktop_target`, `runs.desktop_subscriptions` (M-desk-routes),
  the Desktop jobs per step (`desktop_jobs`: run, purpose, provider), metered cost per invocation
  (`cost_records`), work time (D3, M-desk-routes). Reuse `credential_gate.desktop_routes`,
  `desktop_jobs.fresh_subscription_ids`, `desktopRepos.ts` (`isDesktopApp`, `desktopQuery`,
  `onSubscriptions`, `subscriptionsText`), and M-desk-2/-3's `shared` rule.
- The video filming session (V1) runs in the main checkout and owns :8000, :5173 and the one
  Tvashtr Desktop, with its window recording on screen.

## Rulings (final)

- **H1 — Price only real money.** On the Desktop, a money figure for work that ran wholly on
  subscriptions names the subscription instead of "$0.00" ("on your Claude subscription"; two:
  "on your Claude and Grok subscriptions"). Mixed work shows the API-key spend and names the
  subscription ("$0.12 + your Claude subscription"). Work only on keys, and the website: today's
  text. Where a line has a time slot it keeps it ("Done in 4m · on your Claude subscription").
  Rows, cards and chips keep their place and label; only the value's wording changes — nothing is
  removed or moved (additive rule). Which work ran where is decided from what really happened (the
  run's Desktop jobs per step), never guessed from the model name after the fact. Applies to D1–D8,
  D10–D14, D16, D23 and D9.
- **H2 — Resume talks about work, not money (D17–D19), on the Desktop when the skipped and
  re-run steps ran on subscriptions:** confirm → "Skips 12 min of finished work." and "Only the steps
  that run again use your Claude subscription." (mixed: "… use your Claude subscription and your
  keys."); the Activity "Next: resume from …" line → "… Tvashtr skips the work that is done, so it
  doesn't run again." Website and key-only runs: today's text.
- **H3 — Budgets count API-key spend (D15, D20–D22).** The dollar figures stay (they are real
  money). On the Desktop only, each budget or spend surface says what it counts: composer Options →
  "Counts API-key spend. Work on your Claude and Grok subscriptions isn't billed here."; the Spend
  card → "Each run stops at $5.00 of API-key spend unless you change its budget."; Running now →
  "$0.00 of $5.00 on keys"; Edit task set → the minutes as H5 and the dollar figure only for the
  key part (H1).
- **H4 — The queued lane (S1), a bug.** In a Desktop task-set compare, a cell whose run waits for the
  other lane's job shows M-desk-routes' waiting line, as one-task lanes already do (`compare._cell`
  → `_current(..., desktop=…)`). Reproduce-first.
- **H5 — Estimates count the turns (S2, S3).** On the Desktop, when the lanes of a compare (or the
  task pairs of a set) share a subscription, the minutes add up the work that must take turns
  instead of assuming it runs at once; lanes that share none keep today's figure. One rule in the
  backend estimate functions, used by every surface that shows those minutes (Compare start, the
  save dialog's set line, Edit task set).
- **H6 — Keys copy names the subscription first (K1–K8), on the Desktop, for anthropic/xai models
  when that subscription is connected and fresh:** e.g. K1 → "Works for website runs. On this Mac,
  Claude runs use your Claude subscription first."; K5–K7 → say the model runs on the subscription
  on this Mac (K7: a subscription run doesn't fall back to the backup model — say what really
  happens; read the code first); K8 → name "Connect Claude in Engines" as the first remedy when the
  CLI isn't connected. Website: unchanged. Exact strings are yours, drawn on the boards first and
  kept short, plain and consistent with M-desk-2's.
- **H7 — Claude Design first.** Before code, draw each changed Desktop screen as a Desktop variant
  beside its original board, on the canvas where that screen was designed (read the canvas with
  your Artifact tool first and follow the Design type's instructions; never the main canvas).
  Group strings that share a screen onto one board. Publish, then build from the boards. List every
  board added or changed.
- **H8 — Out of scope.** Domains, memory notes and AI checks stay on keys (D7 of M-desk-routes). No
  ship. No migration expected (if one is truly needed: `0054` + the freeze bump as the last
  commit, and the FINAL REPORT says why). If a row of the sweep turns out true on the Desktop when
  you read the code, leave it and say why.

## Rules

1. Everything in `prompts/m-desk-routes.md` "Rules" 1–12 holds (additive only, invariants, security,
   reproduce-first, tests, no push, commits by name, helpers ≤ 2, safe state), with these changes:
   your branch is `feat/m-desk-4`; your test database is **`tvashtr_gate_desk4`** (created on the
   Postgres server in `.env`'s `DATABASE_URL`, migrated to `0053`); time box **6 hours**.
2. **No live stack, no Desktop app, no subscription use** — exactly as `m-desk-3.md` rule 2: never
   start anything on :8000 or :5173, never launch Electron, never touch
   `~/Library/Application Support/tvashtr-desktop/`. Your visible proof is the design-parity
   harness on its own Vite port (above 5190; check it is free first).
3. **Invariants (prove each):** `team_run.py` byte-identical to `e30b8bd9` (blob `94eda1bb9fbb`) and the
   DBOS application version unchanged (`3011d7ac…`, computed without a database); `desktop/electron/
   runner/runner.cjs` unchanged (`15e977ad71f2`); `EngineAdapter.run()` unchanged; `desktop/` diff 0
   lines; migrations `0001`–`0053` untouched; the one-job-per-provider rule untouched; no assertion
   or expect line removed (grep against `02488987`); every website string byte-identical (prove it
   with the harness's website renders: 0 px diff against `02488987`).
4. **Reproduce-first**, shown failing on `02488987`, then passing: (n) H4's queued cell; (o) H5's
   minutes for shared and unshared lanes and for a set; (p) the server fields that tell the FE which
   work ran where (a subscription-only run, a mixed run, a website run), at least for the run view,
   a round, Resume and a compare; (q) FE: each changed string shows its Desktop variant only in the
   case its ruling names, and the website text is byte-identical.
5. **Parallel rules:** work only in your worktree; never edit, run or stop anything in the main
   checkout (you may read the briefs there and load its `.env` per command with `DATABASE_URL`
   overridden to your database; never copy, print or edit `.env`). Your ledger is `STATE.md` in
   YOUR worktree (never commit it).

## Acceptance (echo each as it completes)

1. The boards of H7 published (canvas + version for each).
2. Reproduce-first (n)–(q) failing on `02488987`, then passing.
3. Gates: `make test` on `tvashtr_gate_desk4` ≥ 3485 passed / 1 xfailed; vitest ≥ 268 files / 2732;
   `tsc -b`; the build; desktop tests 143/0; `make lint` clean on every changed file; the owner
   sweep ≥ 201.
4. **Visible proof** through the design-parity harness (`desktop: true` scenarios beside the
   existing ones): every new board shot, the app at zero size/type drift against it, one
   screenshot per changed string (Desktop variant), and the website renders at 0 px diff.
5. The sweep table again, one line per row: fixed (board, file) / left true (why).
6. Invariants: each item of rule 3 with its proof.
7. Then `DIFF:` `git diff --stat 02488987...feat/m-desk-4`; `READY_TO_MERGE feat/m-desk-4 <sha>`; the
   eight-section FINAL REPORT (CLI-RULES §4.7), listing every board added or changed.

## Stop with NEEDS_HUMAN (in STATE.md and echoed in chat, with the FINAL REPORT) when

- a fix would need `team_run.py` changed, the Desktop runner changed, the DBOS version changed, or a
  live stack/Desktop run;
- a board can't be published;
- a second, unknown problem needs a broad or unproven change.

A contained, proven fix with a regression test may proceed.
