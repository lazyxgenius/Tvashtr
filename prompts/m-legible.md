# M-legible — the backend already knows; tell the user

**One root cause, five surfaces.** The backend returns correct status codes and structured,
actionable payloads. The frontend throws them away and substitutes a wrong guess. Every item below
is "stop discarding information we already have", not "compute something new".

Read this whole file before writing code. Each item states the CURRENT behaviour (verified on disk
at main `8b608e2`), the REQUIRED behaviour, and what the user sees change.

---

## 1. LaunchPanel — one message for two different problems

**File:** `frontend/src/components/LaunchPanel.tsx` (~line 413) and its `useEffect` (~line 113).

**Current.** `GET /api/github/repos` returns `{repos, installation_count}` and the client type
`GithubReposResponse` (`lib/api.ts:425`) already declares both. The panel stores ONLY `res.repos`
and discards `installation_count`. It then renders a single message whenever `repos.length === 0`:

> No repositories available on your GitHub App installation. [Add repositories on GitHub →]

That advice is wrong half the time. `installation_count === 0` means the App is installed NOWHERE —
adding repos is impossible and the link is a dead end. Worse, the fetch's `.catch(() => setRepos([]))`
collapses a network/500 failure into the same "no repos" message.

**Required.** Keep `installation_count` in state alongside `repos`, and render THREE distinct states:

- `installation_count === 0` → "You haven't installed the Tvashtr GitHub App on any account yet."
  with the INSTALL link (`githubInstallUrl` — the same URL the landing/auth path uses; if the panel
  has no access to it, thread it in from the existing config the app already fetches).
- `installation_count > 0 && repos.length === 0` → keep today's wording and the
  "Add repositories on GitHub →" manage link. This is the case that advice actually fits.
- the fetch REJECTED → a distinct third message: "Couldn't reach the server to list your
  repositories." Do NOT reuse either message above. Track the rejection in its own state flag.

**User sees:** a person who never installed the App is told to install it, instead of being sent to
a repo-picker for an installation that does not exist.

---

## 2. A failed launch shows the backend's real reason

**Files:** `frontend/src/lib/api.ts` (~line 404) and `frontend/src/App.tsx` (~line 714).

**Current.** `runTeam` does `if (!res.ok) throw new Error(...)` — it never reads the response body,
so the backend's `detail` is destroyed at the client layer. `App.tsx handleLaunch` then does
`catch { setError(true) }` — a bare boolean — and renders a fixed string:

> Couldn't start the run — is the backend running?

A 422 (invalid graph) or 429 (run ceiling hit) means the backend answered perfectly well. The
message is actively misleading and sends the user to check a server that is fine.

**Required.**
- In `runTeam`, on `!res.ok`, parse the JSON body defensively and throw an `ApiError` (the class at
  `lib/api.ts:190`) carrying the status AND the backend's message. FastAPI's `detail` is sometimes a
  string and sometimes an object with a `message` key — handle both, and fall back to the current
  generic text if the body is absent or unparseable. Extend `ApiError` additively if it needs to
  carry more than `message`; do not change its existing two-arg constructor shape for other callers.
- In `App.tsx`, replace the `error: boolean` state with the message string (or null) and render it.
  Keep the "is the backend running?" text ONLY for a genuine network failure (no status).

**User sees:** hitting the run ceiling says so, and says how long to wait, instead of accusing the
backend of being down.

---

## 3. `deepseek` is missing from the provider suggestions

**File:** `frontend/src/components/Dashboard.tsx:42`.

`PROVIDER_SUGGESTIONS = ["openrouter", "openai", "gemini", "groq", "nvidia_nim"]`. `deepseek` is the
product's own default agent model (`.env TVASHTR_AGENT_MODEL=deepseek/deepseek-chat`) and is absent
from the datalist, so the one key a new user most needs is the one the UI never suggests. Add it.
One-line change; keep the existing order and append or insert sensibly.

---

## 4. The GitHub installation backfill — the stranded-account bug

**Files:** `backend/tvashtr/control_plane/github_app.py`, `backend/tvashtr/routers.py` (~2754).

**Current.** Installation discovery runs in EXACTLY one place: `auth.py github_callback`, which calls
`github_app.list_user_installations(user_token)`. That needs a GitHub **user token**, which exists
only during the OAuth code exchange and is never stored. So:

- an account that signed in before discovery existed, or
- an account whose discovery hit the `except GithubAppError: … continuing sign-in` path,

has ZERO `github_installations` rows and **no route in the product can ever create one**. Deploying
does not help. Only signing out and back in does, and nothing tells the user that.

**Required — discover from the APP side, which needs no user token.** Add a sibling to
`list_user_installations`:

- `list_app_installations() -> list[dict]` — `GET /app/installations`, authenticated with the App
  JWT (`mint_app_jwt()`), paginated exactly like the existing helpers (`per_page=100`, capped at
  `_MAX_REPO_PAGES`, defensive on response shape). Each element carries `id` and an `account` object
  with the installing user/org's `id` and `login`.
- A backfill that matches those to accounts with NO user token at all: for each installation, if
  `account.id` equals a `users.github_user_id` (the column already exists — see the `users` table),
  upsert a `GithubInstallation(owner_id=<that user>, installation_id=<id>)`. Reuse the existing
  find-or-relink semantics in `auth.py` (~line 268) rather than inventing a second rule.

**Where it fires.** Make the read SELF-HEALING: in `GET /api/github/repos`, when the owner has zero
`GithubInstallation` rows, run the backfill ONCE and re-read before returning. Only on the zero-row
path — a user with installations must pay no extra GitHub call. A backfill failure must NOT 500 the
endpoint: log and fall through to the honest `{repos: [], installation_count: 0}`.

**NO migration.** `GithubInstallation` and `users.github_user_id` both already exist. Alembic head
stays `0031`.

**User sees:** a stranded user opens the launch panel and their repos are simply there. No
sign-out, no support ticket, no dead-end link.

---

## 5. A failed round must read as failed

**File:** `frontend/src/components/LastRun.tsx`.

**Current.** Line 73 already renders `outcome_detail`, so the failure reason M-fail now persists
shows up for free. But a failed invocation has `outcome === null`, and `outcomeLabel(null)` returns
`"—"`, with the tone from `reviewerVerdictLabel(null)`. A node that died reads as an unremarkable
round with an em dash next to it.

**Required.** `LastRunRound` (line 9) is a structural subset of `NodeInvocation`, which ALREADY
carries `status: string` (`running | done | failed | stopped`, `lib/api.ts:56`). Add `status` to
`LastRunRound` as an OPTIONAL additive field, pass it from the run-view caller, and when it is
`"failed"` render the label "Failed" with the danger tone.

Scope this to the RUN view only. The authoring view's `last_run` object does not carry `status` and
extending that contract is OUT of scope — leave its em dash alone.

**User sees:** the node that killed the run is visibly the failure, with its reason underneath,
instead of a grey row with a dash.

---

## Invariants

- **No migration.** Alembic head stays `0031`.
- **No backend behaviour change outside `github_app.py` + the `/api/github/repos` handler.**
  `team_run.py` and everything under `engines/` are untouched — prove with an empty diff.
- **Owner-scoping is absolute.** The backfill must never link an installation to an account whose
  `github_user_id` does not match `account.id`. Account A must never see account B's repos. Add a
  test that proves a non-matching installation creates NO row.
- **No secret ever logged or returned** — no App JWT, no installation token, no user token.
