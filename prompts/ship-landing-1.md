# Brief — Ship the new landing page (+ Prune 1, Film D1) to production (Fly only)

Architect: Tvashtr Sidechat-26, 2026-10-31. Path: `/Users/adimac/Desktop/Tvashtr/prompts/ship-landing-1.md`.
Model: **Sonnet 5.5, effort high**, Code tab, auto mode. The operator is on the **Claude Pro plan**.
`prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md` and `design/` belong to the architect: never stage
or commit them. Where this brief and `prompts/CLI-RULES.md` differ, this brief wins. The steps follow
the Ship Protocol of `prompts/m1-m11.md` §6, adapted below; the last ship's brief
`prompts/ship-desk-0.27.0.md` is the template. **This session builds nothing.** It gates, pushes `main`,
and deploys on the operator's approval.

## What ships (checked by the architect on disk, 2026-10-31)

- Production today: `origin/main` = **`6b35addc`** → Fly **v46** (image
  `deployment-01M52DHZM26THGADX25RFFSG65` — the rollback target), Desktop `desktop-v0.27.0`, alembic
  head **`0053`**.
- Local `main` = **`8cf90334`**, a fast-forward of `origin/main` by **60 commits**: film V3 + V3b
  (`video/**`), **Prune 1** (32 commits: dead code, one uncalled route, ten duplicate groups — audited
  PASS 10-20), **Film D1** (`video/demo/**`, an additive `video/v3/voice.py` option), the **new landing
  page** (`frontend/src/pages/website/**`, `AuthGate.tsx` lazy-loads the app, `index.html` preview tags,
  `frontend/public/{og.png,robots.txt,media/*}`, `gsap` 3.15.0 + `@gsap/react` 2.1.2) and two docs
  commits.
- **No migration** (`git diff origin/main..main -- backend/alembic` empty; head stays `0053`).
  **`team_run.py` unchanged** (blob `9a22d313d5c9`), `@DBOS.` decorators 75 = 75 → the DBOS application
  versions should be unchanged (local `3011d7ac…`, fly `c7320dd5…`): prove it. Drain live runs anyway.
- **No Neon snapshot** (no migration, no executor change): a rollback is the v46 image alone.
- **No Desktop release** (architect's call): the Mac app shows none of the public pages, and its next
  release will leave out `media/`. No `desktop-v*` tag; `desktop/package.json` stays `0.27.0`. The
  Desktop 0.27.0 in users' hands keeps working: Prune 1's one deleted route is called by no `desktop-v*`
  tag (checked at its audit).
- **`lazyxgenius/Tvashtr` is PUBLIC.** Everything pushed becomes public. New binaries in the range are
  exactly: `frontend/public/media/{reel-1.mp4, reel-1-poster.webp, demo-2min.mp4,
  demo-2min-poster.webp}` and `frontend/public/og.png` (each checked frame by frame by the session that
  made it; the demo shows the private repo's name `lazyxgenius/trade_mcp`, accepted by the operator).
  Any other binary in the range → stop.

## Rules

1. **Auto mode**, never bypass. Production steps (`git push`, `fly deploy`) run only after the operator
   pastes back the approval line you post (step 5). If the classifier blocks a routine step, say in one
   line what you need and why; don't work around it.
2. **Push only `main`.** No other branch, no tag. Never force, never `reset --hard`, never rebase.
3. **The push guard:** the operator unsets it before launch; preflight proves
   `git config --get remote.origin.pushurl` prints nothing. Never change git config yourself.
4. **Fly:** the operator signs in before launch (`fly auth whoami`). Secrets: `fly secrets list` only.
5. **`.env` is fenced:** load it per command with `DATABASE_URL` overridden; never open, copy, print or
   edit it. Never print a connection string, key, token or cookie; never open CLI credential files.
6. **Production data:** read-only; any query prints counts and run ids only.
7. **One stack:** tests on their own database (`tvashtr_gate`), never next to a running stack, never on
   `tvashtr_film`.
8. **Three-attempt rule.** Time box 6 hours (waiting for the approval doesn't count). Pro plan: no
   subagents or workflows; update `STATE.md` after each step so a usage-limit pause loses nothing.
9. **Safe state at any stop:** nothing running, checkout on `main`, clean apart from the operator's
   files; production either on the new release with a passing smoke, or rolled back to v46's image with
   health confirmed.

## Steps (echo each evidence line as it completes)

1. **Preflight.** `git fetch origin`: `origin/main` must be `6b35addc` and `main` `8cf90334` (anything
   else → NEEDS_HUMAN). Push guard unset. `fly auth whoami` answers (signed out → NEEDS_HUMAN at once).
   Docker up; nothing on :8000/:5173. `fly status -a tvashtr` (v46, image as above).
2. **Gates on `8cf90334`** (echo each command and its decisive line):
   - `make test` on `tvashtr_gate` (one line proving the database): 0 failed, ≥ 3550 passed.
   - `cd frontend && npx vitest run` (≥ 2757; the one unhandled error at `CompareView.tsx:96` is known
     and pre-exists on `6b35addc` — say whether it still shows, and nothing else may), `npx tsc
     --noEmit`, `npm run build`; `cd desktop && npm test` (≥ 161).
   - `docker build -t tvashtr-ship .` — and confirm the image holds `/app/frontend/dist/media/reel-1.mp4`,
     `og.png` and `robots.txt`.
   - `make lint`: the Python part's 38-error baseline (identical on `6b35addc`), the frontend part clean.
   - Against a real local stack (clear stale runs and PENDING DBOS workflows first; e2e with
     `TVASHTR_HOSTED_MODE=false` where the spec needs the password form): `frontend/e2e/website.spec.ts`,
     `auth.spec.ts`, `revamp-shell.spec.ts`, `live-run.spec.ts`; then `make demo-proof` C1–C12 with a
     real PR (`make seed` first; up to 3 attempts for provider flakes — if every attempt fails on a
     provider's error, not the product's, record the decisive line and carry on; the operator decides at
     the approval). The app's screens now load lazily behind `AuthGate`: these specs are the proof they
     still open.
   - **Invariants across `6b35addc..8cf90334`:** alembic diff empty; `team_run.py` blob `9a22d313d5c9`;
     `@DBOS.` count 75 on both; the DBOS application versions computed for `8cf90334` equal
     `3011d7ac…`/`c7320dd5…`; the binaries list above is exact.
   - **`PUSH_SCAN`:** every text file the push adds or changes (`git diff 6b35addc 8cf90334 --name-only`,
     contents and the 60 commit messages) for keys, tokens, passwords, connection strings, cookies and
     session ids (`sk-…`, `ghp_…`, `gho_…`, `github_pat_…`, `xai-…`, `AKIA…`, `postgres://…:…@`,
     `-----BEGIN`, JWT-shaped strings, `Set-Cookie`/`Cookie:` values). Any hit → stop NEEDS_HUMAN with
     the path and line number only (never the value).
3. **Drain check.** (a) `fly apps list`: no `tv-run-*` app; (b) a read-only count on production through
   the running app (`fly ssh console -a tvashtr -C "<a short python using the app's own settings>"`) of
   runs queued or running and of Desktop jobs queued or claimed — counts and run ids only; runs parked
   at a human gate may stay (`team_run.py` unchanged); (c) `fly logs` quiet for 2 minutes.
4. **Measure the live landing before** (for comparison): Lighthouse mobile on
   `https://tvashtr.fly.dev/#/welcome` (`npx lighthouse@12` with Playwright's Chromium), four scores.
5. **Ask for the ship approval.** Echo a SHIP REQUEST: the `main` sha, every gate's decisive line, the
   drain result, "no migration (0053), team_run.py unchanged, app versions unchanged, no Neon snapshot,
   no Desktop release", and this line for the operator to paste back:
   `APPROVED landing-1 ship: push main 8cf90334, no Neon snapshot (no migration, team_run.py unchanged), drain live runs, fly deploy main to app tvashtr (alembic stays at 0053), roll back to v46's image if the smoke fails.`
   Wait. Act only on an approval naming this sha.
6. **On approval:** (a) re-run the drain check; any run queued or running → wait (re-check every 5
   minutes) up to 30 minutes, then ask the operator instead. (b) `git push origin main` (from
   `6b35addc` to `8cf90334`; anything refused → NEEDS_HUMAN). (c) `fly deploy -a tvashtr`; confirm the
   release command's `alembic upgrade head` was a no-op at `0053`.
7. **Smoke** (each PASS/FAIL with its line):
   - `/health` `{"status":"ok","db":"ok"}` and `/healthz`; `make deploy-smoke` 0 failed; `GET
     /api/runs/<any id>/graph` 401 without a session, never 500; 0 5xx and 0 tracebacks in `fly logs`
     for 5 minutes; a scheduled DBOS sweep logs normally on `c7320dd5…`.
   - The live `index.html`'s JS asset equals your local build's, and it carries the `og:` tags;
     `/og.png` 200 `image/png`; `/robots.txt` 200 with its two lines.
   - `curl -s -o /dev/null -D - -H "Range: bytes=0-1023" https://tvashtr.fly.dev/media/reel-1.mp4` →
     `206`, `Content-Range`, `video/mp4`; the same for `demo-2min.mp4`.
   - Headless Playwright on `https://tvashtr.fly.dev/#/welcome` in **Chromium and WebKit**: 0 page
     errors; the team picture visible; no `.mp4` request before a press; Reel 1 and the 2-minute demo
     each play past 2 s after their press; a screenshot of the first screen at 1440 and at 390 (open
     them and describe them in one line each).
   - "Start building — sign in with GitHub" reaches `#/signin`; its GitHub control leads to a `302`
     towards `github.com/login/oauth/authorize` (check the redirect's host only; never follow it into a
     sign-in, never print its query string).
   - Lighthouse mobile on the live landing, four scores, beside step 4's. Performance below 85 is
     reported, not a rollback reason.
   - `make demo-proof-prod` only if its saved session is still valid (say which); provider failures are
     recorded, not a rollback reason.
   **If a health, 5xx or page-error smoke fails:** `fly deploy --image
   deployment-01M52DHZM26THGADX25RFFSG65 -a tvashtr`, confirm health, write NEEDS_HUMAN and stop.
8. **Close.** Echo `SHIPPED: main=8cf90334 fly=v<N>`, then the eight-section FINAL REPORT (CLI-RULES
   §4.7) with a ship table and every evidence line, and the line: "Operator: put the push guard back —
   `git config --local remote.origin.pushurl DISABLED-no-push-during-video-work`".

## Stop with NEEDS_HUMAN (written to STATE.md and echoed, with the FINAL REPORT) when

- `origin/main` isn't `6b35addc`, `main` isn't `8cf90334`, the push guard is still set, or Fly is signed
  out;
- a gate fails for a product reason after three attempts, `PUSH_SCAN` finds anything, or the range holds
  a binary not listed above;
- runs stay queued or running after 30 minutes;
- the smoke fails (after the rollback);
- the classifier blocks a production step the approval named.
