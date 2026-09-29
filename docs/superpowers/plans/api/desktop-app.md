# API contract — Tvashtr Desktop app screens (area `desktop_app`)

Backend for `docs/superpowers/specs/2026-09-25-revamp-analysis/desktop-app.md` §3. Code:
`backend/tvashtr/routes/desktop_app.py` (routes), `control_plane/desktop_auth.py`,
`control_plane/desktop_release.py`, `control_plane/desktop_jobs.py::release_job`,
`control_plane/provider_directory.py`; the GitHub callback's desktop branch is in `auth.py`.
No schema. Everything is additive: no existing key or behaviour changed.

Status (2026-09-27): SHIPPED — browser sign-in (start / callback branch / return page /
exchange), `GET /api/desktop/release`, job release, `provider_directory[].serves_models`, the
`spec_only` template, `use_plans` on `POST /api/teams`, `GET /api/templates?for=desktop`.
Desktop setup does NOT offer `spec_only` yet (see "The Spec only team").

---

## Browser sign-in (DT-6..DT-10) — public, hosted mode only

Stateless PKCE. Desktop main makes `verifier` (32 random bytes, base64url, no padding),
`challenge = base64url(sha256(verifier))` (RFC 7636 S256, 43 chars) and its own `state`
(`^[A-Za-z0-9_-]{16,64}$`). The verifier never leaves Desktop main.

### `GET /api/auth/desktop/start?challenge=&state=&account=current|github`
Opened in the user's **default browser** (not the app window). `account` defaults to `github`.

| Case | Answer |
|---|---|
| `hosted_mode` off | 404 `{"detail":"Not found"}` |
| `challenge` not `^[A-Za-z0-9_-]{43}$`, `state` not `^[A-Za-z0-9_-]{16,64}$`, or `account` not `current`/`github` | 400 HTML return page "This link doesn't work" / "This sign-in link is broken. Go back to Tvashtr Desktop and try again." (links bare `tvashtr://auth/done`, no auto-open) |
| `account=current` and this browser holds a valid `tv_session` | 200 HTML consent page "Continue as <login>?" / "Tvashtr Desktop asked to sign in with the account this browser uses: <login>. Continue only if you started this from Tvashtr Desktop." — button **Continue as <login>** = `tvashtr://auth/done?code=<code>&state=<state>` (NOT opened by itself: a click is required), link **Use a different account** = this `start` with `account=github`. No GitHub step (the handoff) |
| otherwise | 302 → `https://github.com/login/oauth/authorize?client_id=…&redirect_uri=<public_base_url>/api/auth/github/callback&state=<signed desktop state>` (+ `&prompt=select_account` when `account=github`, so GitHub shows its account picker) and `Set-Cookie: tv_desktop_flow=<nonce>; Max-Age=900; HttpOnly; SameSite=Lax; Path=/api/auth` |

The signed desktop state is itsdangerous, salt `tv-desktop-state`, valid 15 minutes, payload
`{"c": challenge, "s": state, "n": nonce}` — `n` equals the `tv_desktop_flow` cookie, which binds the
sign-in to the browser that started it (independent review, revamp-finish). A state without `n`
(signed before the binding) reads as expired.

### `GET /api/auth/github/callback` (changed in place, additive)
New optional query params `state` and `error`. When `state` verifies as a desktop state:

| Case | Answer |
|---|---|
| the browser has no `tv_desktop_flow` cookie matching the state's `n` (a state replayed into another browser) | 200 return page "This sign-in expired"; link `…?error=expired&state=<s>`; nobody is signed in |
| `error=access_denied` (the user cancelled on GitHub) | 200 return page "Sign-in cancelled" / "Nothing was changed. Go back to Tvashtr Desktop."; link `tvashtr://auth/done?error=cancelled&state=<s>`; no cookie |
| any other `error` (e.g. `redirect_uri_mismatch`), or no `code` | 400 return page "Sign-in didn’t finish"; link `…?error=failed&state=<s>`; no cookie |
| the desktop state is older than 15 minutes | 200 return page "This sign-in expired" / "This sign-in has expired. Sign in again."; link `tvashtr://auth/done?error=expired&state=<s>`; no cookie |
| `code` present | the normal GitHub find-or-link + installations, the browser gets `tv_session`, then 200 return page "You're signed in" / "Go back to Tvashtr Desktop to continue. You can close this tab."; link `tvashtr://auth/done?code=<code>&state=<s>` |
| GitHub exchange fails | 400 return page "Sign-in didn’t finish" / "GitHub didn’t sign you in. Go back to Tvashtr Desktop and try again."; link `tvashtr://auth/done?error=failed&state=<s>`; no cookie (Desktop shows "Sign-in didn't finish" at once). The website's callback (no desktop state) still answers 400 `{"detail":"GitHub sign-in failed."}` |

Without a desktop state (absent, forged, foreign) the callback behaves exactly as before (302 to
the website).

The one-time `code` is itsdangerous, salt `tv-desktop-code`, valid 5 minutes, payload
`{"u": user_id, "c": challenge}`. It names exactly one user and is useless without the verifier.

### The return page (all variants)
Server HTML, `Content-Type: text/html`, `Cache-Control: no-store`,
`Referrer-Policy: no-referrer` (+ `<meta name="referrer" content="no-referrer">`). A button
**Open Tvashtr Desktop** whose `href` is the link; when the link carries a result it also runs
`window.location.href = <link>` once. The link ALWAYS starts with `tvashtr://auth/done` — any
other value is replaced by the bare `tvashtr://auth/done` (no open redirect).

### `POST /api/auth/desktop/exchange`
Called by Desktop main through the loopback proxy (which rewrites `Set-Cookie` onto the local
origin).

Request: `{"code": "<from the tvashtr://auth/done link>", "verifier": "<PKCE verifier>"}`

200 (`Set-Cookie: tv_session=…`, `Cache-Control: no-store`) — the `UserOut` of `/api/auth/me`:
```json
{"id": "7b0c…", "email": "lazyxgenius@users.noreply.github.com", "github_login": "lazyxgenius", "display_name": "lazyxgenius"}
```
Errors:
- 404 `{"detail":"Not found"}` — `hosted_mode` off
- 400 `{"detail":"This sign-in has expired. Sign in again."}` — bad, forged or > 5-minute-old
  code, or the account no longer exists
- 400 `{"detail":"This sign-in belongs to another app window. Sign in again."}` — the verifier is
  malformed (`^[A-Za-z0-9._~-]{43,128}$`) or doesn't hash to the code's challenge
- 422 — body missing `code`/`verifier`

---

## `GET /api/desktop/release` (DT-43) — public
The latest Tvashtr Desktop release on GitHub (`settings.desktop_release_repo`, env
`TVASHTR_DESKTOP_RELEASE_REPO`, default `lazyxgenius/Tvashtr`): `/releases/latest` if its tag is
`desktop-v*`, else the first non-draft, non-prerelease `desktop-v*` in `/releases?per_page=20`.
Cached in process 10 minutes (failures too); 3 s timeout per GitHub call; never errors.

200:
```json
{
  "version": "0.6.0",
  "tag": "desktop-v0.6.0",
  "published_at": "2026-09-30T10:12:00Z",
  "dmg_url": "https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg",
  "release_url": "https://github.com/lazyxgenius/Tvashtr/releases/tag/desktop-v0.6.0",
  "checked_at": "2026-09-30T10:20:04.512Z"
}
```
GitHub unreachable or no desktop release: the same keys with `version`, `tag`, `published_at`,
`release_url` = `null`. `dmg_url` is ALWAYS the stable `…/releases/latest/download/Tvashtr-mac.dmg`
(the frontend's `DESKTOP_MAC_DMG_URL`), never a versioned link.

---

## `POST /api/desktop-runner/jobs/{job_id}/release` (DT-45, DB-7) — session, owner-scoped
Desktop is quitting or restarting to update: hand its claimed job back to the queue. No body.

200:
```json
{"job_id": "3f1c9a52-…", "status": "queued"}
```
Effect: `claimed → queued`, `claimed_at` and `heartbeat_at` set to null, one node run-log
message `{"source":"tvashtr","text":"Tvashtr Desktop restarted — this step starts again when it's
back."}`. The relaunched runner re-claims it with the unchanged `POST /api/desktop-runner/claim`
(the provider is no longer blocked). Each claim writes its runner events in its own seq band
(`100 + k × 1 000 000 + seq` for the k-th claim, since the runner restarts `seq` at 0) and the
release note is the last seq of the released claim's band, so the node's log reads: first
attempt, note, second attempt — nothing dropped. If Desktop doesn't come back within
`desktop_runner_offline_seconds`, the node fails with "Tvashtr Desktop went offline — reopen it
and retry." as before.

Errors:
- 401 — no session
- 404 `{"detail":"job not found"}` — unknown id, not a UUID, or another owner's job
- 409 `{"detail":"This job isn't running on Tvashtr Desktop."}` — the job isn't `claimed`

---

## `GET /api/config` → `provider_directory[].serves_models` (DT-26, OQ-38) — additive
Every directory entry gains `serves_models: bool` — true when the model catalogue declares a
thinker or worker default for the provider, or a Domains embedding model uses it. When false,
`hint` is `"<name> serves no model Tvashtr can run right now."`:
```json
{"provider": "nvidia_nim", "monogram": "N", "name": "NVIDIA NIM", "label": "Open models on NVIDIA NIM",
 "example_model": null, "subscription": null, "embeddings": false,
 "hint": "NVIDIA NIM serves no model Tvashtr can run right now.", "serves_models": false}
```
Setup screens list such a provider disabled and never pre-pick it.

---

## `GET /api/templates?for=desktop` (DT-34, DT-35, OQ-27, OQ-29) — session, owner-scoped
Without `for` the answer is unchanged (`{templates: [4], blank}`, nodes `{id, kind, role, label}`).
With `for=desktop`:
- `templates` lists the same four (architect ruling 5, revamp-finish: the Desktop-only `spec_only`
  stays hidden and is NOT listed until its runs can end without shipping);
- every `shape.nodes[]` (templates and `blank`) gains `model` (slug or `null`) and `runs_on`
  (`"claude" | "grok" | "api_key" | null`), computed for THIS owner exactly as a
  `POST /api/teams {use_plans: true}` would stamp them. `runs_on` is the plan when the model's
  provider maps to a *connected* Claude/Grok plan (the engines mirror), else `"api_key"` when the
  owner holds a key for it, else `null` ("Needs setup"). Gates and terminals: both `null`.
```json
{"template": "two_node", "name": "…",
 "shape": {"nodes": [
   {"id": null, "kind": "thinker", "role": "pm", "label": "PM", "model": "xai/grok-4.7", "runs_on": "grok"},
   {"id": null, "kind": "gate", "role": "gate", "label": "…", "model": null, "runs_on": null},
   {"id": null, "kind": "worker", "role": "engineer", "label": "Engineer", "model": "anthropic/claude-sonnet-5", "runs_on": "claude"},
   {"id": null, "kind": "ship", "role": "ship", "label": "…", "model": null, "runs_on": null}],
  "loops": []}}
```
Model choice (`teams.plan_first_models`, pure): one plan → every model node uses it; both → a
worker prefers Claude, a thinker prefers Grok, and a `reviewer` uses the other vendor than the
model node before it (Plan, build, review = PM Grok · Engineer Claude · Reviewer Grok; Spec only =
PM Grok · Reviewer Claude); no plan → the BYOK defaults (unchanged).

Errors: 401 — no session.

## `POST /api/teams` → `use_plans` (DT-36) — additive
Body `{template, name, use_plans?: bool = false}`. With `use_plans: true` the model nodes get the
plan-first models above (the owner's connected plans only; none connected → the BYOK defaults).
`fallback_model` is still stamped from held keys. Response unchanged (the team summary).
`template` also accepts `spec_only` from any surface (`template_name` "Spec only").
Errors unchanged: 422 `"A team name is required."`, 400 `"unknown template"`, 401.

### The Spec only team
PM (entry thinker, its REPORT.md is the spec) → Reviewer (worker, `edits_allowed: false`,
verdict-emitting, reviews the spec against the idea) → Stop, on `approved` and on anything else.
No Ship node: no code change, no PR. KNOWN GAPS (walk changes in `team_run.py`, outside this
slice): a run ends `rejected` at the Stop terminal even when approved (pinned by a strict xfail in
`tests/test_desktop_templates.py`), and there is no rework loop (a loop back to the entry PM
leaves the team without a start node). Because of both, Desktop setup's First team step leaves
the designed "Spec only" card out (a first run would read Stopped), and `?for=desktop` no longer
lists it (ruling 5); `POST /api/teams {template:"spec_only"}` still builds it for when the walk
supports it.
