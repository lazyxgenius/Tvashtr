# Desktop bridge v5 — contract

Phase 2 of the frontend revamp (plan `../2026-09-25-frontend-revamp.md`; analyses
`../../specs/2026-09-25-revamp-analysis/engines.md` §4 B1–B5/B7, `home-run.md` §4, `panel.md` §4
item 1). Code: `desktop/electron/` (`main.cjs`, `preload.cjs`, `deepLink.cjs`, `unsavedGuard.cjs`,
`runner/engineController.cjs`, `harness/enginePrefs.cjs`, `repos/*`). Types:
`frontend/src/vite-env.d.ts` (`TvashtrDesktopBridge`).

## Feature detection

`window.tvashtrDesktopInfo = { shell: "electron", version: 5, platform }`. Every v5 namespace is
optional in the types — check `tvashtrDesktopInfo.version >= 5` (or the method) before using it.

| Namespace | Method | New in |
|---|---|---|
| `engines` | `getStatus`, `connect`, `disconnect`, `refresh`, `onStatus` | ≤ v3 (behaviour changed, below) |
| `engines` | `cancelConnect` | v5 |
| `navigation` | `onNavigate`, `consumePending` | v5 |
| `repos` | `pickFolder`, `inspect`, `recent.{list,add,remove}`, `prepareRun`, `bringBackBranch` | v5 |
| `app` | `setUnsavedChanges` | v5 |

The v5 calls answer only the app's own page (the loopback origin). GitHub's sign-in pages load in
the same window and get the preload too; there `repos.*` rejects ("This page can't use Tvashtr
Desktop."), `consumePending` resolves `null`, and `cancelConnect` resolves `null`.

## Errors

`repos.*` rejects with a plain `Error` whose `message` is written for the user — show it as is (no
"Error invoking remote method…" prefix). Codes don't survive Electron's context bridge, so branch
on the method you called, not on the error. Messages:

| When | `message` |
|---|---|
| path isn't a string / not absolute | `Choose a folder on this computer.` |
| folder missing | `That folder doesn't exist any more.` |
| path is a file | `That isn't a folder.` |
| not a git work tree (`prepareRun`, `bringBackBranch`) | `This folder isn't a git repository.` |
| git not found on PATH | `Git isn't installed on this computer, or Tvashtr can't find it.` |
| base branch unknown / invalid name | `Branch "<baseRef>" isn't in this folder's repository.` |
| bundle over 200 MB | `This branch is too big to send to Tvashtr (<n> MB; the limit is 200 MB).` |
| upload 401/403 | `Sign in to Tvashtr, then try again.` |
| upload 413 | `This branch is too big to send to Tvashtr (the limit is 200 MB).` |
| upload other 4xx with a `detail` | `Tvashtr didn't accept the folder: <detail>` |
| upload network error / 5xx | `Couldn't send the folder to Tvashtr. Check your connection and try again.` |
| run id not a UUID | `That run id isn't valid.` |
| ship-bundle 401/403 | `Sign in to Tvashtr, then try again.` |
| ship-bundle 404 | `Tvashtr has no result for this run to bring back yet.` |
| ship-bundle over 512 MB | `The run's result is too big to bring back (over 512 MB).` |
| ship-bundle other 4xx with a `detail` | `Couldn't get the run's result: <detail>` |
| ship-bundle network error / 5xx | `Couldn't download the run's result from Tvashtr. Check your connection and try again.` |
| bundle unreadable | `The run's result from Tvashtr couldn't be read.` |
| bundle lacks the branch | `The run's result doesn't contain branch tvashtr/<runId>.` |
| branch exists at another commit | `A branch named tvashtr/<runId> already exists in this folder with different commits. Rename or delete it, then bring the result back again.` |
| `git fetch` failed (e.g. the base commits were deleted locally) | `Couldn't add branch tvashtr/<runId> to this folder: <git's first error line>` |
| anything unexpected | `Something went wrong on this computer. Try again.` |

`engines.*` never rejects for a probe failure (see `refresh`); `connect` can still reject if the
Terminal login can't be opened (unchanged).

---

## `navigation` — `tvashtr://` deep links

```ts
navigation.onNavigate(cb: (target: TvashtrDeepLinkTarget) => void): () => void
navigation.consumePending(): Promise<TvashtrDeepLinkTarget | null>
// TvashtrDeepLinkTarget = { path: string; params?: { connect?: "claude" | "grok" } }
```

`path` is the app's hash address without the `#` — set `location.hash = "#" + path` or feed it to
`parseRoute()` in `lib/nav.ts`. Only these links do anything; every other link (other pages,
extra path segments, credentials, ports, non-UUID team ids, >2 KB) is ignored and logged:

| Link | `target` |
|---|---|
| `tvashtr://home` | `{path:"/home"}` |
| `tvashtr://engines/overview` | `{path:"/engines"}` |
| `tvashtr://engines/subscriptions` | `{path:"/engines/subscriptions"}` |
| `tvashtr://engines/keys` | `{path:"/engines/keys"}` |
| `tvashtr://engines/<any of the above>?connect=claude` | `+ params:{connect:"claude"}` (also `grok`; any other value is dropped) |
| `tvashtr://toolkit/tools` · `skills` · `secrets` | `{path:"/toolkit/tools"}` etc. |
| `tvashtr://toolkit/memory` | `{path:"/toolkit/memory/inbox"}` |
| `tvashtr://teams/<uuid>` | `{path:"/teams/<uuid, lower-case>"}` |

`connect` means **highlight that card** — never start Connect from a link. Case, a trailing slash
and `tvashtr:///…` / `tvashtr:…` spellings are tolerated.

Delivery: the window is shown, un-minimised and focused (on macOS a closed window is reopened).
Each link is delivered exactly once:
- while the page has an `onNavigate` subscriber, it is called straight away;
- a link that arrived before any subscriber (cold start, mid-reload) is handed to the **first**
  subscriber when it subscribes, or returned by `consumePending()` — whichever comes first.
  A newer unseen link replaces an older one.

Recommended renderer wiring (F0): subscribe once at the app root and `navigate(parseRoute("#" +
target.path))`; pass `params.connect` to the Engines page as a highlight.

Website side: `window.location.href = "tvashtr://engines/subscriptions?connect=claude"` opens the app
(installed builds only; dev runs don't register the scheme unless
`TVASHTR_DESKTOP_REGISTER_PROTOCOL=1`).

---

## `engines` (changed behaviour + `cancelConnect`)

```ts
engines.cancelConnect(provider: "claude" | "grok" | "codex"): Promise<SubscriptionStatus>
```
Stops re-checking a pending sign-in when the window regains focus (Connect starts that for 30
minutes) and resolves the cached status, unchanged. It can't close the Terminal window. Unknown
provider → a `disconnected` status.

- **Disconnect is sticky across relaunch.** After `disconnect(p)`, `p` stays `state:
  "disconnected"` at launch, on `refresh(p)` and on window focus, without asking its CLI (which is
  still signed in), and the runner claims no jobs for it; its server mirror row is cleared again at
  each launch. Only `connect(p)` clears this (stored in `userData/engine-prefs.json`).
- **`refresh` never rejects.** If the CLI check throws, `refresh` resolves
  `{provider, connected:false, state:"error", account_hint:null, source:"harness", checked_at}` —
  also cached for `getStatus`, pushed to the server mirror and to `onStatus`. Show ENG-37's Error
  state and offer Refresh again.

`SubscriptionStatus` keys are unchanged: `provider, connected, state, account_hint, source,
checked_at`.

---

## `repos` — local-folder runs (P10)

Every path argument must be an absolute path to an existing directory. Git runs through `execFile`
with argument arrays (no shell), the enriched PATH the vendor CLIs use, prompts and hooks off.

### `repos.pickFolder(): Promise<{path, displayPath} | null>`
Native "Choose a folder" dialog (directories only). `null` when cancelled. `displayPath` shows the
home dir as `~` (`/Users/ada/code/trade_mcp` → `~/code/trade_mcp`).

### `repos.inspect(path): Promise<TvashtrRepoInspection>`
```json
{ "is_git": true, "current_branch": "main", "branches": ["main", "feature/login"],
  "tracked_file_count": 214,
  "subpaths": [{ "path": "backend", "file_count": 120 }, { "path": "web", "file_count": 80 }],
  "remote_url": "https://github.com/ada/trade_mcp.git" }
```
- `current_branch` is `null` on a detached HEAD. `branches` are local branches (the Base branch
  options). `subpaths` are top-level tracked folders, sorted, max 100 — the Scope options; same rules
  as the server's `repo_subpaths`, so a picked scope passes `create_run`. `remote_url` is `origin`
  with any `user:token@` removed, or `null`.
- Not a repo, a missing folder, or a folder **inside** a repo (the bundle and Scope are relative to
  the repository's top) are results, not rejections:
  `{"is_git": false, "error": "This folder isn't a git repository."}`,
  `"That folder doesn't exist any more."`,
  `"This folder is inside the git repository at ~/code/trade_mcp. Choose that folder instead."`.
- Rejects only for a non-string / relative path.

### `repos.recent.list(): Promise<TvashtrRecentFolder[]>`
```json
[{ "path": "/Users/ada/code/trade_mcp", "displayPath": "~/code/trade_mcp", "branch": "main", "available": true },
 { "path": "/Users/ada/old/app", "displayPath": "~/old/app", "branch": null, "available": false }]
```
Up to 8, most recent first, re-checked on every call (`available:false` once moved/deleted;
`branch` null when unavailable, detached or not git). Stored in `userData/recent-folders.json`.

### `repos.recent.add(path): Promise<void>` / `repos.recent.remove(path): Promise<void>`
`add` moves the folder to the top (it must exist; the 9th-oldest drops off). `remove` forgets a
folder whether or not it still exists. Nothing is added automatically — call `add` when a run
launches on a folder.

### `repos.prepareRun({path, baseRef, label?}): Promise<{snapshot_id, size_bytes}>`
1. Checks `baseRef` is a local branch, then `git bundle create <tmp> refs/heads/<baseRef>` — only
   that branch's history; never `HEAD` or other branches.
2. Refuses a bundle over 200 MB.
3. `POST /api/desktop/repo-snapshots` through the loopback proxy with the UI's `tv_session`
   cookie, multipart fields `bundle` (filename `repo.bundle`), `label`, `base_ref`; 15-minute
   timeout. `label` defaults to the `~` path and is capped at 200 chars.
4. Resolves the server's `{snapshot_id, size_bytes}`; the temp bundle is always deleted.

Then launch with `POST /api/runs { …, desktop_target: true, local_repo: { snapshot_id, label,
base_ref, subpath } }` (B-LOCAL).

### `repos.bringBackBranch({path, runId}): Promise<{branch}>`
1. Validates `runId` (UUID) and that `path` is a git work tree — before downloading.
2. `GET /api/runs/<runId>/ship-bundle` (cookie as above) streamed to a temp file, max 512 MB.
3. Reads the bundle's `refs/heads/tvashtr/<runId>`. If that branch already exists locally at the
   **same** commit → resolves (safe to call twice); at a different commit → rejects (never moves
   it). Otherwise `git fetch --no-tags <bundle> refs/heads/tvashtr/<runId>:refs/heads/tvashtr/<runId>`.
4. Never checks out, never touches the working tree, the index or the current branch.

Resolves `{ "branch": "tvashtr/7c9e6679-7425-40de-944b-e07fc1f90ae7" }`.

---

## `app.setUnsavedChanges({dirty, agentName?}): void`

Fire-and-forget. While `dirty`, closing the window, reloading, or quitting (⌘Q / last window on
Windows/Linux) shows a native dialog:

- message `You have unsaved changes to <agentName>.` (or `…to an agent.`), detail
  `If you close now, those changes are lost.`
- buttons **Keep editing** (default, Esc) · **Discard and close**.

Keep editing cancels the close/quit; Discard proceeds and clears the flag. Send `{dirty:false}` after
Save or Discard, and on unmount. The page need not register `beforeunload`; if it does and blocks
an unload, the same dialog is shown instead of Electron's silent block. The flag resets when the
page navigates to a new document or crashes. `agentName` is trimmed to 80 chars.

---

## Assumptions about B-LOCAL (built in parallel)

Coded against the plan's contract; the lead should check these against B-LOCAL's
`docs/superpowers/plans/api/` doc when merging:
- `POST /api/desktop/repo-snapshots` takes multipart `bundle` + `label` + `base_ref` and returns JSON
  with a string `snapshot_id` (and `size_bytes`); errors carry FastAPI `detail` (a string, or an
  object with `message`); 413 means too large.
- The uploaded bundle holds exactly `refs/heads/<base_ref>` and **no `HEAD`** — the server should
  clone/fetch that ref explicitly (`git clone --branch <base_ref> <bundle>` works).
- `GET /api/runs/{id}/ship-bundle` streams a bundle containing `refs/heads/tvashtr/<run_id>` (full or
  with prerequisites the user's repo has — both tested); 404 while there is none.
