# F3 — Auth wizard (M-frontend, the last major slice)

**Owner:** Claude Code. **Architect:** Tvashtr-47. **Type:** FRONTEND ONLY — no migration, no new endpoint, executor byte-intact.

## Outcome
Replace the standalone centered login card (`LoginScreen.tsx`) with a single guided **auth wizard** whose visual+copy source of truth is `design/Tvashtr Frontend Overhaul/AuthWizard.dc.html`. The wizard reuses the EXISTING `login()` / `register()` calls from `api.ts` (reskin the door, don't rebuild the lock). It collects two onboarding answers (role + what-you're-building) on the sign-UP path only; those answers are held in the wizard's own state for the flow's recap chips and are then **DISCARDED** — nothing is persisted, nothing is threaded into the Dashboard.

## The flow (a single component state machine)
Two modes, toggled inside the wizard (the mockup's "Already have an account? Sign in" / "New here? Create an account"). `initialMode` (prop) seeds it: `"register"` → sign-up; `"login"` → sign-in.

**IMPORTANT — account step is FIRST (this reorders the mockup, which put it last):**

- **Sign-up:** Step 1 **Create account** → Step 2 **Your role** → Step 3 **What you're building** → **Success** ("You're in" / "Enter Tvashtr") → `onAuthed(user)`.
- **Sign-in:** Step 1 **Create account** (in sign-in copy) → **Success** → `onAuthed(user)`.

Rules:
- The account step (step 1) calls `register(email,password)` (sign-up) or `login(email,password)` (sign-in). On SUCCESS it holds the returned `AuthUser` in state and ADVANCES (sign-up → role; sign-in → success). It does **NOT** call `onAuthed` yet.
- `onAuthed(heldUser)` fires **only** at the final **"Enter Tvashtr"** button (both paths). This keeps the whole wizard a self-contained logged-out-view experience; `AuthGate`'s contract is unchanged (it swaps to the Dashboard when `onAuthed` fires).
- A slim 3-segment **progress bar** shows on the sign-up path only (fills step 1→2→3). No progress bar on sign-in.
- **Back navigation:** account step's only "leave" is the `onBack` prop (→ landing) plus the mode toggle. Role step (step 2) has NO back (registration already happened at step 1 — do not offer a path back to re-register). Building step (step 3) Back → role step. Success has no back.
- **Continue gating:** on role/building steps, the primary button is disabled until a card is selected (mockup's `nextOk`). The account step's submit is disabled while a request is in flight (`busy`), same as `LoginScreen` today.
- **Refresh mid-wizard is fine & expected:** after register at step 1 the user is authed server-side; a page refresh re-runs `getMe` → the app lands them on the Dashboard (questions skipped). Do NOT try to persist wizard progress.

## The two questions (copy — from the mockup)
**Q1 "What's your role?"** — three single-select cards:
- **Engineer** — "Ship reviewed code into a real repo"
- **Founder** — "Idea → spec → prototype, fast"
- **Solo builder** — "Run a small studio of agents"

**Q2 "What are you building?"** — two single-select cards (⚠ NO repo-path field, and DROP the mockup's "we'll inspect the repo and suggest a stronger worker model" line — we can't do that yet):
- **A fresh idea** — "Start from a blank canvas"
- **Against my repo** — "Point a team at an existing codebase"

The selected values are kept in state only for the brand-panel recap chips; on "Enter Tvashtr" they are discarded (see §Persistence).

## Copy deltas vs the mockup (apply these; otherwise follow the mockup verbatim)
1. Account step comes FIRST (mockup ordered it last) — remap the brand-panel per-step copy to our order. Sensible mapping using the mockup's own phrases:
   - Account (sign-up): eyebrow "Welcome" · headline "Compose your team." · sub "Author and run your own team of AI agents — create your account to begin."
   - Account (sign-in): eyebrow "Welcome back" · headline "Pick the thread back up." · sub "Your teams and runs are right where you left them."
   - Role: eyebrow "Step 2 of 3" · headline "Who's at the loom?" · sub "Tell us your role — it just sets the scene. Nothing here is saved."
   - Building: eyebrow "Step 3 of 3" · headline "What are we weaving?" · sub "A fresh idea or your own codebase — the canvas fits either."
   - Success: eyebrow "Ready" · headline "The loom is warm." · sub "Your canvas is ready — let's compose your first team."
2. DROP the repo-path input + its "we'll inspect the repo…" helper entirely.
3. The mockup's sign-up success sub ("your tailored team is on the canvas") is an over-promise now (we don't tailor) — use the honest sub above.
4. Keep the loom/weaving voice for the brand panel (that's the intended tone for this screen).

## Visual translation (the mockup is a Claude-Design "DC" file — translate it to the real stack)
- Translate the inline-styled `DCLogic` mockup into a real React function component + real CSS classes. **Do NOT ship inline style objects** — author `.tv-authwiz__*` classes in a new labeled section of `frontend/src/index.css`, following the existing `.tv-dash__*` reskin precedent already in that file (search `.tv-dash__`). Tokens only.
- **Two-panel layout:** left brand panel (loom copy + recap chips + progress), right form panel. On narrow screens the layout **must** fold to a single column — hide/stack the brand panel ≤ ~720px so the form is usable on a phone (mirror the F4 landing-hardening discipline: don't ship a two-column layout that breaks on mobile).
- **Tokens are all present already** (verified): colors in `tokens/colors.css` (`--accent`, `--accent-contrast`, `--coral-100/200/500/700`, `--surface-card`, `--border-hairline`, `--border-strong`, `--focus-ring`, `--panel-300/400`, `--ink-700`, `--text-secondary`, `--text-tertiary`, `--danger`); radius/shadow/motion in `tokens/spacing.css` (`--radius-sm/md/lg/xl`, `--shadow-xs/sm/md`, `--shadow-focus`, `--ease-standard`, `--dur-fast`). Map the mockup's literal px radii (11/12/13/16px) to the nearest radius tokens; map its `0 0 0 3px var(--focus-ring)` selected ring to `--shadow-focus`. **Add NO new tokens; do not edit any `tokens/*.css` file.**
- **Icons:** use `lucide-react` (already a dependency). Map the mockup's sprite ids → lucide: `#i-terminal`→`Terminal`, `#i-building`→`Building2`, `#i-code`→`Code2`, `#i-pen`→`PenLine`, `#i-git`→`GitBranch`.
- **Reduced motion:** wrap the step-transition/animation styles in `@media (prefers-reduced-motion: reduce)` resets (same as the landing).

## Accessibility
- The account step MUST keep `aria-label="Email"` and `aria-label="Password"` on the inputs and the same submit button text ("Create account" in sign-up mode, "Sign in" in sign-in mode) + the mode-toggle buttons, so existing/ported auth-form tests and the `AuthGate` "Email field appears" assertion keep working.
- The option cards must be keyboard-focusable with an accessible name (the card title) and an indicated selected state (`aria-pressed` or a radiogroup with `aria-checked`). Continue disabled until a selection.
- Error text stays in a `role="alert"` region (as `LoginScreen` has today).

## Error handling (port exactly from LoginScreen)
Map `ApiError.status` on the account step: 401 → "Incorrect email or password." · 409 → "That email already has an account — try logging in." · 422 → "Enter a valid email and a password of at least 8 characters." · else → "Something went wrong. Is the backend running?". Clear the error on input change and on mode switch.

## Persistence (the wall)
- role + building live in component state ONLY. On "Enter Tvashtr", call `onAuthed(user)` and let them fall out of scope. **Do not** add a prop to pass them to the Dashboard, **do not** add any field/endpoint/localStorage. The Dashboard is not modified by this slice.

## Files
**Create:**
- `frontend/src/components/AuthWizard.tsx` — the new component. Exports the component AND `export type AuthMode = "login" | "register";` (moved here from LoginScreen). Props: `{ onAuthed: (user: AuthUser) => void; initialMode?: AuthMode; onBack?: () => void }` (same shape LoginScreen had).
- `frontend/src/components/AuthWizard.test.tsx` — see §Tests.

**Delete (absorbed):**
- `frontend/src/components/LoginScreen.tsx`
- `frontend/src/components/LoginScreen.test.tsx`

**Edit (small, surgical):**
- `frontend/src/components/AuthGate.tsx` — swap the `LoginScreen` import + its one JSX usage for `AuthWizard`; re-point the `AuthMode` import to `./AuthWizard`. `handleAuthed`, routing, and the 401 seam are UNCHANGED.
- `frontend/src/components/LandingPage.tsx` — line 4: re-point `import type { AuthMode } from "./LoginScreen"` → `"./AuthWizard"`. Nothing else in the landing changes.
- `frontend/src/index.css` — add the `.tv-authwiz__*` section (tokens only). The existing `.tv-auth*` block may be reused where it fits (the account form can lean on `.tv-field` / `.tv-launch__input` / `.tv-btn` / `.tv-seg`), but the wizard's new structure (panels, cards, progress) gets `.tv-authwiz__*` classes.

**MUST NOT touch:** `frontend/src/lib/api.ts` (the wizard reuses `login`/`register`/`AuthUser`/`ApiError` as-is — assert it's byte-unchanged vs `main`); any `backend/**`; any `alembic/**`; `frontend/src/design-system/tokens/*.css`; `frontend/src/components/Dashboard.tsx`; the executor (`team_run.py`, `graph_validity.py`).

## Tests (vitest)
Re-baseline first: run `make test-frontend` on the branch BEFORE writing code and record the starting count (HANDOVER notes merged `main` ≈ 191, but re-measure).

`AuthWizard.test.tsx` must PORT the behaviors from the deleted `LoginScreen.test.tsx` AND add wizard-specific ones. All interaction via `fireEvent` (repo convention). Stub `fetch` like the old test did. Cover:
1. Renders the account step first with Email + Password + the mode toggle (sign-in default when `initialMode` omitted OR when `"login"`).
2. Sign-in submit → `POST /api/auth/login` → after clicking through to "Enter Tvashtr", `onAuthed(user)` is called with the user. (Assert the fetch URL/method AND the eventual `onAuthed`.)
3. Sign-up submit → `POST /api/auth/register` → the wizard ADVANCES to the role question and `onAuthed` is NOT yet called.
4. Full sign-up happy path: register → pick a role → Continue → pick a building card → Continue → "Enter Tvashtr" → `onAuthed(user)` fires exactly once.
5. Continue is disabled on the role step until a card is picked (and on the building step until a card is picked).
6. 401 on sign-in → inline `role="alert"` "Incorrect email or password." and `onAuthed` NOT called.
7. 409 on sign-up → inline alert "already has an account".
8. Sign-in path does NOT render the role/building questions (goes account → success).

`AuthGate.test.tsx`: verify it still passes with the real `AuthWizard` mounted (the "Start building" → Email-field-appears assertion should hold because the account step is first). Update the stale "login screen" comment wording only if needed; do not weaken assertions.

`App.test.tsx`, `App.addDownstream.test.tsx`, `Dashboard.test.tsx`: must remain green untouched.

## Acceptance / evidence (Claude Code runs ALL of it to green — do not hand anything to the human)
Echo each into the chat as it passes:
1. `make test` — backend floor **336** still green (this slice is FE-only; prove it didn't disturb backend).
2. `make lint` — clean.
3. `make test-frontend` — all green; report the before/after test count (the delete removes ~5 LoginScreen tests, the new file adds ≥8; net non-negative).
4. Frontend build succeeds (`npm run build` in `frontend/` or the Makefile's FE build target).
5. **Byte-intact proofs** (paste the command output): `git diff --stat main -- frontend/src/lib/api.ts` → EMPTY; `git diff --stat main -- backend alembic` → EMPTY; `git diff --stat main -- frontend/src/design-system/tokens` → EMPTY; `git diff --stat main -- frontend/src/components/Dashboard.tsx` → EMPTY. And confirm `git diff --stat main -- backend/app/team_run.py backend/app/graph_validity.py` → EMPTY (adjust paths if the executor lives elsewhere — grep for them first).
6. **Playwright self-sign-off with a screenshot per check** (bring up the stack: `make db-up && make migrate && make seed && make backend` + the frontend dev server; the seeded account is `operator@tvashtr.local` / `tvashtr-dev`). Because the seeded operator already exists, drive REGISTER with a fresh throwaway email (e.g. `f3+<timestamp>@tvashtr.local`). Capture:
   - (a) landing → click "Get started" → the wizard **account step** renders (two-panel on desktop width). Screenshot.
   - (b) register with the throwaway email/password → the **role** step renders with the progress bar on segment 2. Screenshot.
   - (c) pick "Engineer" → Continue enables → click → the **building** step renders (progress segment 3). Screenshot.
   - (d) pick "A fresh idea" → Continue → the **success** step ("You're in" / "Enter Tvashtr"). Screenshot.
   - (e) click "Enter Tvashtr" → the **Dashboard** renders (the teams table). Screenshot.
   - (f) log out → landing → click "Sign in" → the account step in sign-in copy → sign in as the just-created account → success → Enter Tvashtr → Dashboard, WITHOUT the role/building questions appearing. Screenshot of the success step (no progress bar) proving the sign-in path skips the questions.
   - (g) narrow the viewport to ~390px on the account step → the brand panel is hidden/stacked and the form is usable (mobile fold). Screenshot.
7. A `READY_TO_MERGE` line with the branch name and final test counts.

## Stop conditions
- Write `NEEDS_HUMAN` to `STATE.md` and stop if: a required token/class genuinely doesn't exist and the fix would need a NEW token or a `tokens/*.css` edit (it shouldn't — all are present); the executor path can't be located to prove it's untouched; or any acceptance item needs a broad/unproven change to pass. A contained, regression-guarded fix within the FE scope above may proceed.
- Hard turn cap: 40. Commit only the files listed in §Files (plus the CSS) on a branch `feat/f3-auth-wizard`; do NOT commit `PROJECTPLAN.md`, `HANDOVER.md`, or `prompts/*.md` (the architect owns those). Do NOT push (the operator merges).
