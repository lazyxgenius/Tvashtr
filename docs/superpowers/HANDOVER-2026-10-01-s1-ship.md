# Handover — s1-ship: Security S1 shipped, then the Connectors parity (2026-10-01)

Brief: `prompts/s1-ship-connectors-parity.md` (architect Sidechat-16), worked to its `/goal`. The `ponytail`
skill loaded (the Skill tool returned "Launching skill"; the SessionStart hook also said "PONYTAIL MODE ACTIVE").
Clock: start 17:14:57 IST; T+1:45 18:59:57; T+3:15 20:29:57; T+3:30 20:44:57; T+4:00 21:14:57.

| Ship | main sha | Fly release | Desktop tag | DMG check |
|---|---|---|---|---|
| Security S1 (backend only) | e39717b (deployed 17:47–17:49) | v30 | none: frontend and `desktop/` unchanged | n/a |
| Connectors parity (ruling 4) | df57ba1 (deployed 18:28–18:30) | v31 | desktop-v0.14.0 | app 0.14.0 bundles `index-DHL2gkob.js` = live |

## Changed

On `fix/security-s1` (fast-forwarded into `main`):
- `8be8c74` — ruling 3: the four spike proof routes (`POST/GET /api/spike/hello-durable[/{id}]`,
  `POST/GET /api/spike/generate-doc[/{id}]`) answer 404 `{"detail": "Not found"}` in hosted mode, before any sign-in
  check: a pure ASGI middleware `_SpikeProofOffWhenHosted` in `backend/tvashtr/main.py`. Local mode and
  `GET /api/spike/run-events/{run_id}` are unchanged. New `backend/tests/test_spike_hosted_off.py`. The six existing
  tests that call these routes ran under the repo `.env`'s `TVASHTR_HOSTED_MODE=true`; they now pin local mode, with
  their assertions unchanged (`test_auth.py`, `test_doc_writer_api.py` ×2, `test_owner_scope_account_misc.py` ×2,
  `test_owner_scope_public_auth_desktop.py`).
- `818a67e` — from the independent review: the middleware matches each route exactly (or `<route>/…`), and the hosted
  404 test stubs the model call so a regression can't spend the key.
- `e39717b`, `7a7f6fd` — `docs/superpowers/HANDOVER-2026-10-01-security-s1.md`: the rulings, ruling 3's fix, the ship
  row and the live smoke.

On `fix/connectors-parity` (from `main` 7a7f6fd, fast-forwarded into `main`):
- `a6ececf` — ruling 4's three design-governed items, each with a vitest: the row ⋯ menu is 242px so its rows are 230
  (`ConnectorRowMenu.tsx`); the connect sheet's header shows the 42px provider tile (`Sheet` gains an additive `icon`,
  `ConnectorTile` a `md` size); the "Read only / Only with read & write" box (`AccessAllows` in `connectParts.tsx`, the
  canvas's Supabase list only). The access-step test checks the box where it checked the description (the design
  governs); a new test pins the description for a connector without a list.
- `2e5deea` — `docs/superpowers/parity/connectors.txt` re-shot: 86 renders, waivers W1–W4 naming ruling 4, every
  drift covered, every "not found" item noted.
- `a70aaaa` — from the independent review: the tile only on "Connect <name>" (no board draws Sign in again / Replace
  key / Change project with it), the access box only where Read & write is offered; the record's W4 narrowed.
- `c842f81` — `docs/superpowers/HANDOVER-2026-09-30-connectors.md`: parity summary and ship row. `df57ba1` —
  `desktop/package.json` (+ lock) 0.14.0.

Local only: deleted the untracked strays `backend/DEMO_PROOF.md` and `backend/docs/DEMO_PROOF.md` (after
`git ls-files --error-unmatch` showed both untracked); the checkout is on `main`.

## Verified (actual results)

Item 1 (ruling 3), reproduce-first:
- On 186c4a8 the new test failed 4/4 with `assert (200, {'workf...'}) == (404, {'detail': 'Not found'})`; the hosted
  `POST generate-doc` even started a real model call (`LiteLLM completion() model= deepseek-chat`). After the fix:
  `test_spike_hosted_off.py` 6 passed + the guard's 2 (`test_every_route_is_in_the_sweep`, `…names_a_test_that_exists`);
  the affected files 67 passed. The review fix's exact-match test failed 2/2 on 8be8c74's middleware, then 68 passed.
- `grep -rnE "spike/(hello-durable|generate-doc)" frontend/src frontend/e2e desktop` → no match (exit 1);
  `git diff -- backend/tvashtr/routers.py` empty (run-events untouched).

Item 2 (S1 gates, one at a time, nothing else running):
- `make test DATABASE_URL=…/tvashtr_s1ship` (fresh DB): 2925 passed, 1 xfailed on 8be8c74; **2927 passed, 1 xfailed** on
  the final head e39717b (9:50). The gate DB held 918 runs vs the dev DB's 13,868, so the gate DB was the one used.
- vitest 204 files / 2244 passed; `tsc --noEmit` exit 0; `npm run build` ok; desktop `pass 143 fail 0`;
  `docker build -t tvashtr-ship .` exit 0 (rebuilt on 818a67e).
- ruff on the 25 changed .py files: format "25 files already formatted"; check: 1 E501 at
  `tests/test_domain_mcp_tools.py:76`, unchanged since 9b041abf (2026-09-15) and failing the same on main (the old
  baseline, out of scope). No frontend file changed.
- `scripts/connectors_e2e.sh e2e/connectors.spec.ts e2e/domains.spec.ts e2e/revamp-shell.spec.ts`: 3 passed,
  `connectors-proxy-probe: PASSED`.
- Live Domains run-time check (`connectors_run_check.py --domains`, LOCAL sandbox, dev DB after `make seed`):
  `domains-run-check: PASSED` — run e1bb70b0 deepseek-chat SUCCESS, `domain_retrieve` reached the file through the run
  token, no login cookie in run_events / context_manifest (5,767 characters).
- Independent review of item 1 (a helper that built none of it): no bypass, no regression; two fixes taken (818a67e).
- `make demo-proof`: C1–C12 PASSED, PR https://github.com/lazyxgenius/trade_mcp/pull/31 (OPEN).
- Parity exempt (ruling 1): `git diff main -- frontend desktop | wc -l` → 0.

Item 3 (ship S1): `origin/main` unmoved (f6f8b3f); `git merge --ff-only` → `f6f8b3f..e39717b main -> main`; no
`tv-run-*` app and no run in the prod logs before the deploy; `fly deploy` exit 0, release_command `alembic upgrade
head` completed, **v30**. Smoke: `/health` `{"status":"ok","db":"ok"}`; live asset `index-DXwje35F.js` = local build;
`make deploy-smoke` 0 failed / 7; headless `#/welcome`, `#/signin` 200, 0 page errors; the four proof routes 404 with
no session (POST generate-doc was 401 on v29); `GET /api/spike/run-events/x` 401; `/mcp/domains` with no token and with
a `tv_session` cookie both "authentication required — no valid run token" (v29: "missing session cookie" / "invalid or
expired session"); 0 5xx, 0 tracebacks.

Item 5 (parity): 43 design shots (43 fonts-ok, canvas version 1790834788-b76f), 86 app shots. 16 renders at 0 drift;
on the other 70 every drift item is W1–W3 or a last-session note (a classifier checked every item and the counts:
0 unmapped, 0 mismatches). After the review fix, a full re-shot gave identical record lines. vitest/tsc/build passed.

Item 6 (ship the parity), all on the final code head a70aaaa unless said:
- make test 2927 passed, 1 xfailed (a6ececf; the backend is byte-identical to main through df57ba1).
- vitest 205 files / **2249 passed**; tsc ok; build ok; desktop 143/0 (also after the 0.14.0 bump); docker ok;
  eslint `--max-warnings 0` + prettier clean on the changed frontend files.
- e2e: connectors, domains, revamp-shell, tools-c7a 4 passed + `PROXY PROBE PASSED`; `tools_c7c_e2e.sh` 1 passed;
  `memory_shelf_e2e.sh` 1 passed (two other users of the shared Sheet).
- Independent review (a helper that built none of it): no critical/high; fixed the low and the record's medium
  (a70aaaa); the rest recorded below.
- `make demo-proof`: C1–C12 PASSED on 2e5deea (PR #32) and on a70aaaa (PR https://github.com/lazyxgenius/trade_mcp/pull/33,
  OPEN).
- Ship: `7a7f6fd..df57ba1 main -> main`; no migration, no `team_run.py` change, no backend file → no step-6 pause; no
  run in flight; `fly deploy` exit 0, release_command completed, **v31**. Smoke: `/health` ok; live asset
  `index-DHL2gkob.js` = local build; `/api/connectors` 401; `/oauth/client-metadata.json` 200; generate-doc still 404;
  deploy-smoke 0 failed / 7; `#/welcome`, `#/signin` 0 page errors; 0 5xx, 0 tracebacks.
- Desktop: tag `desktop-v0.14.0` → df57ba1 pushed; "Desktop Mac Release" run 36865776539 `completed success`;
  `releases/latest/download/Tvashtr-mac.dmg` redirects to desktop-v0.14.0 (106,893,592 bytes, published 13:03:48Z);
  mounted read-only (`hdiutil attach -nobrowse -readonly`): `Tvashtr.app` CFBundleShortVersionString **0.14.0**, its
  bundle carries `index-DHL2gkob.js` = the live site and the local build; detached.

Invariants (commands run at 18:35, f6f8b3f..df57ba1):
- `git diff --name-status f6f8b3f df57ba1 -- backend/alembic | wc -l` → 0 (no migration).
- `git diff f6f8b3f df57ba1 -- backend/tvashtr/control_plane/team_run.py | wc -l` → 0.
- No assertion weakened: `git diff 186c4a8 df57ba1 -- backend/tests frontend/src | grep -E '^-\s*(assert |expect\()'`
  lists only the two Supabase-description `expect`s in `ConnectSheet.test.tsx`, replaced in the same hunks by the box,
  its six exact items and the description's absence (the design governs, ruling 4; the independent review judged it not
  weakened). The other removed lines in f6f8b3f..186c4a8 are the previous S1 session's cookie-to-token swap.
- `git diff --name-only f6f8b3f df57ba1 | grep -cE "^(design/|HANDOVER.md|PROJECTPLAN.md|prompts/)"` → 0.
- Fly secrets and prod data: no `fly secrets` command and no SQL against prod in this session; `fly releases` shows
  only v30 and v31 (this session's two deploys); the release_command ran `alembic upgrade head` with nothing to apply.

## Assumed, not verified

- `/mcp/domains` refusing a *real* prod login cookie: no prod session exists (`.playwright/prod-session.json`'s
  `tv_session` expired 2026-09-27), so the prod check used a non-real cookie. The local real-mount test
  (`test_domains_run_token.py::test_the_real_mount_refuses_a_login_cookie_and_takes_the_run_token`) covers a valid one.
- `make demo-proof-prod` not run (stale session, as above); no signed-in walk on the live site.
- The Supabase access list is the canvas's copy. The reviewer believes (unchecked) that a project-scoped Supabase MCP
  server turns off account-level tools like `list_projects`, and knows no "project settings" tool: "List projects and
  tables" / "Change project settings" may overstate. Copy is design-governed: for the architect.
- No production connection was audited for borrowed sign-ins (S1's own assumption, unchanged).

## Unfinished or blocked

- **Blocked by design (operator):** the `TVASHTR_SESSION_SECRET` rotation; real provider sign-ins.
- **Not built, recorded in `docs/superpowers/parity/connectors.txt`** (outside ruling 4's three items; the brief says
  note, don't fix): "Sign in again" on a round's skipped-connector line (app: "Sign in"); the LIN-214 write label
  (needs a `result_label` in the connector_call contract); agents' descriptions in Give agents access (the agents
  endpoint carries none); "Yesterday" (the shared formatter says "1d ago"); the 'Cf' registry tile ("Cl"); the
  connector page's "Signed in as · Organization" row (the app doesn't know it); access lists for connectors other than
  Supabase (new content); the Browse search box at 240px instead of 260 (tools.css's `.tk-search.ds-input` wins on load
  order); the Apify scenario fixture doubles its hint sentence.
- **Known, out of scope:** `make crash-demo` (`scripts/crash_resume_demo.sh`, `check_crash_result.py`) sends no
  session cookie, so it has answered 401 since accounts landed; with the repo `.env`'s hosted mode it now gets 404
  too. Hosted `/openapi.json` still lists the four proof routes, and a POST to an unknown route answers 405 where they
  answer 404. The guard's reason strings don't mention the hosted 404. The cross-database workspace reap (S1 Risks)
  is still open.
- A worktree `.claude/worktrees/tvashtr-housekeeping-07c107` (branch `claude/tvashtr-housekeeping-07c107` at 7a7f6fd)
  appeared during the session; this session didn't create it and left it alone.

## Next steps for a fresh session

1. `main` = `origin/main` = the commit that adds this file, on top of df57ba1 (live as Fly v31; desktop-v0.14.0).
   Branches `fix/security-s1` (7a7f6fd) and `fix/connectors-parity` (same commit as `main`) are pushed and merged.
2. Wait for the operator's rulings (below), then build what they rule on `fix/connectors-parity-2` from `main`:
   each item is small except LIN-214 and the agent descriptions (contract additions: APIs only add fields).
3. Re-shoot with the recipe in `connectors.txt` (split the four boards from the canvas into a scratch `DESIGN_DIR`
   with `support.js`, `tvashtr-tokens.css` and `ds/`; `shoot-design.mjs`; Vite on :5199; `shoot-app.mjs` with the five
   `connectors-*` scenarios; `parity.py`).

## Operator actions

1. **Rotate `TVASHTR_SESSION_SECRET` on Fly now** (S1 is deployed, v30 and v31, and its smoke passed). Why: it signed
   every login cookie handed to agents since 2026-09-15; they last 14 days and can't be revoked any other way. What it
   does: everyone is signed out once, web and Desktop; connector and Domains tokens of runs in flight stop; stored API
   keys are NOT affected (`TVASHTR_SECRET_KEY`). When: with no run in flight (Home › Running now empty).
2. Sign in once to each Featured provider on the live site.
3. Rule on (in the canvas https://claude.ai/artifact/V6THVh3i7RFjMUtuS2dskK, which is at its 511-file limit): "Sign in
   again" vs "Sign in"; the LIN-214 label; agents' descriptions in Give agents access; "Yesterday" vs "1d ago"; the 'Cf'
   tile; the connector page's "Signed in as · Organization" row; the access lists for the other connectors; the
   Supabase list's accuracy.
4. Unchanged and still yours: HubSpot and Google stay "Coming soon".
