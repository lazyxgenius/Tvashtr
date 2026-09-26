# API contract — the public website (area `website`)

Analysis: `docs/superpowers/specs/2026-09-25-revamp-analysis/website.md` §3 (B-2, B-3, B-4).
Router: `backend/tvashtr/routes/website.py` `public_router` (mounted WITHOUT `get_current_user`).
Logic: `control_plane/web_signin.py`, `control_plane/site_info.py`; the callback change is in
`auth.py::github_callback` / `_website_callback`. No schema. Tests: `tests/test_website_signin.py`,
`tests/test_public_site.py`.

Not built, by decision: B-5 handoff tokens (desktop-app.md §6 governs: the website only appends
`?from=web&login=<github_login>&host=<api host>` to its `tvashtr://` links), B-6 Windows waitlist
(OQ-9 → GitHub releases link), B-7 mobile magic link (OQ-10 → share / copy link),
`/api/config.github_signin_url` (the frontend knows the path).

## `GET /api/auth/github/start?next=<app address>` — public, hosted mode only

The website's "Continue with GitHub" is a plain link here (full-page navigation).

| Case | Answer |
|---|---|
| hosted mode off, or no GitHub client id configured | `404 {"detail":"Not found"}` |
| otherwise | `302 Location: https://github.com/login/oauth/authorize?client_id=…&redirect_uri=<public_base_url>/api/auth/github/callback&state=<nonce>` + `Set-Cookie: tv_oauth_state=<signed {n, next}>; HttpOnly; Max-Age=600; Path=/api/auth/github; SameSite=lax[; Secure when cookie_secure]` |

`next` is kept only when it matches `^/(?!/)[A-Za-z0-9/_?=&.%-]{0,300}$` (an app address such as
`/teams/<id>?node=x`); anything else is dropped silently (no open redirect). `app=desktop` /
`redirect_uri` are not accepted: Desktop signs in through `/api/auth/desktop/start` (desktop-app.md).

## `GET /api/auth/github/callback` — website branch (changed in place, additive)

Taken only when the request carries a `tv_oauth_state` cookie and `state` is not a Desktop state
(the Desktop branch is first and unchanged). Every answer is a `302` into the SPA and clears the
cookie (`Max-Age=0`, same path/attributes). `{frontend}` = `frontend_origin` (or the allow-listed
Desktop loopback origin header).

| Case | `Location` | Session |
|---|---|---|
| `error=access_denied` (the user cancelled on GitHub) | `{frontend}/#/signin?error=cancelled` | none |
| any other `error` | `{frontend}/#/signin?error=failed` | none |
| cookie forged / older than 10 min, or `state` missing or ≠ the cookie's nonce | `{frontend}/#/signin?error=expired` | none |
| no `code` | `{frontend}/#/signin?error=failed` | none |
| GitHub refuses the code (`GithubAppError`) | `{frontend}/#/signin?error=failed` (never the JSON 400) | none |
| signed in | `{frontend}/#/signin/done` or `…/#/signin/done?next=%2Fteams%2F<id>` | `tv_session` set |

No cookie (an older client, or the Toolkit's install return): byte-identical to before — `302
{frontend}` on success or no `code`, `400 {"detail":"GitHub sign-in failed."}` on an exchange
failure (pinned in `tests/test_github_endpoints.py`, `tests/test_desktop_auth.py`).

## `GET /api/public/site` — public

```json
{
  "repo_url": "https://github.com/lazyxgenius/Tvashtr",
  "stars": 128,
  "desktop": {
    "version": "0.7.0",
    "tag": "desktop-v0.7.0",
    "published_at": "2026-09-27T10:00:00Z",
    "dmg_url": "https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg",
    "release_url": "https://github.com/lazyxgenius/Tvashtr/releases/tag/desktop-v0.7.0",
    "checked_at": "2026-09-27T10:05:00Z"
  },
  "checked_at": "2026-09-27T10:05:00Z"
}
```

- `desktop` is `GET /api/desktop/release`'s answer verbatim (same fetcher and 10-minute cache;
  `dmg_url` is always the stable link). Unknown release → its keys are `null`.
- `stars` = GitHub `GET /repos/{TVASHTR_DESKTOP_RELEASE_REPO}` `stargazers_count`, cached 10 minutes
  per machine, 3 s timeout; `null` when GitHub can't say. Never a 5xx.
- The repo is `TVASHTR_DESKTOP_RELEASE_REPO` (default `lazyxgenius/Tvashtr`); no new setting.
- Minimum macOS is a frontend constant ("macOS 11 or later"), not served.
