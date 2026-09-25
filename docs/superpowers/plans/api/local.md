# B-LOCAL API contract — Desktop local-folder runs

Slice B-LOCAL of the frontend revamp (plan `../2026-09-25-frontend-revamp.md`, analysis
`home-run.md` P10 and §4, spec §4.6). Tvashtr Desktop talks to the hosted backend, which never reads
a path on the user's computer, so a folder run works like this:

1. Desktop makes a `git bundle` of the chosen base branch and uploads it
   (`POST /api/desktop/repo-snapshots`) → `snapshot_id`.
2. Desktop launches with `POST /api/runs {…, desktop_target: true, local_repo: {snapshot_id, …}}`.
3. The run clones the bundle on the server, works on branch `tvashtr/<run_id>` and, at Ship, stores
   a bundle of that branch instead of opening a PR.
4. Desktop downloads it (`GET /api/runs/{run_id}/ship-bundle`) and runs
   `git fetch <file> tvashtr/<run_id>:tvashtr/<run_id>` inside the user's folder. It never checks the
   branch out, so the working tree is never touched.

Every endpoint needs a signed-in session (`tv_session` cookie; 401 otherwise) and is owner-scoped:
another account's snapshot or run is a 404. Every refusal from this slice has
`detail = {"code": "…", "message": "…", …}`. `message` is a readable sentence the UI can show
as-is, and `code` is stable for Desktop to branch on.

| Method | Path | New / changed |
|---|---|---|
| POST | `/api/desktop/repo-snapshots` | new |
| POST | `/api/runs` | changed (`local_repo`) |
| GET | `/api/runs/{run_id}` | changed (`run.local_repo_label`) |
| GET | `/api/runs/{run_id}/ship-bundle` | new |

---

## POST `/api/desktop/repo-snapshots`

Stores a bundle of the base branch as a `source` snapshot (Postgres `repo_snapshots`).

**Request:** `multipart/form-data`

| Field | Type | Required | Notes |
|---|---|---|---|
| `bundle` | file | yes | Output of `git bundle create <file> <base_ref>`. It must be a **complete** bundle, not a thin `a..b` one. |
| `base_ref` | text | yes | The branch the bundle was made from: `main` or `refs/heads/main`. The bundle must contain `refs/heads/<base_ref>`. |
| `label` | text | no | How the UI names the folder, for example `~/code/trade_mcp`. Whitespace is collapsed and it is capped at 300 characters. |

The size cap is `TVASHTR_LOCAL_REPO_BUNDLE_MAX_BYTES` (default 200 MB). If the request's
`Content-Length` is over the cap (plus 64 KB for the multipart envelope), it is refused before the
body is read. A chunked upload is refused once the bytes read pass the cap.

Each upload also deletes the caller's source snapshots that are older than 24 hours and were never
used by a run (a snapshot that a live run has claimed is never deleted).

**Response `201`:**
```json
{
  "snapshot_id": "5b0c8f7e-3f7a-4a51-9d52-1f0f7f4f2a10",
  "size_bytes": 1843201,
  "label": "~/code/trade_mcp",
  "base_ref": "main",
  "head_sha": "1fb4cff4e17bf52e28c106bbc09f9ecdc13bc030",
  "created_at": "2026-09-25T13:40:12.512093+00:00"
}
```
`head_sha` is the commit `base_ref` points to in the bundle.

**Errors**

| Status | `code` | `message` (exact) | Extra keys |
|---|---|---|---|
| 413 | `bundle_too_large` | `This folder's history is too big to send (over 200 MB).` (the number follows the setting) | `max_bytes` |
| 422 | `bundle_missing` | `Send the folder's git bundle as multipart field bundle.` | |
| 422 | `bundle_invalid` | `That file isn't a git bundle.` (also sent for an empty file) | |
| 422 | `bundle_incomplete` | `The bundle leaves out older history. Make it from the whole branch (git bundle create <file> <branch>).` | |
| 422 | `base_ref_missing` | `Say which branch the bundle was made from (base_ref).` | |
| 422 | `base_ref_invalid` | `<base_ref> isn't a valid branch name.` | |
| 422 | `base_ref_not_in_bundle` | `The bundle doesn't contain the branch <base_ref>.` | `base_ref`, `branches` (the branches it does contain) |

---

## POST `/api/runs` — `local_repo`

New optional body key. Everything else is unchanged. Validation happens before the team is cloned,
so a refused launch leaves nothing behind.

```json
{
  "team_graph_id": "…",
  "idea": "Add an RSI indicator with tests",
  "desktop_target": true,
  "budget_cap_usd": 5.0,
  "local_repo": {
    "snapshot_id": "5b0c8f7e-3f7a-4a51-9d52-1f0f7f4f2a10",
    "label": "~/code/trade_mcp",
    "base_ref": "main",
    "subpath": "indicators"
  }
}
```

| `local_repo` key | Required | Notes |
|---|---|---|
| `snapshot_id` | yes | From the upload. It must be one of the caller's own `source` snapshots that no run has used yet. |
| `label` | no | Stored as `runs.local_repo_label`. Falls back to the upload's `label`, then to `"Local folder"`. |
| `base_ref` | no | If sent, it must equal the snapshot's `base_ref` (either `main` or `refs/heads/main` form). Omit it to use the snapshot's. |
| `subpath` | no | A top-level folder to scope the run to (leading and trailing `/` are stripped). `..`, `.` and `\` are refused. It is checked against the repository when the run clones it: if it is not a folder on `base_ref` there, the run uses the whole folder and records a run warning (`source_kind: "scope"` in `/graph`'s `resolution_warnings`). |

Rules:
- Only with `desktop_target: true`.
- Never together with `github_repo` or `repo_path`.
- A snapshot can start **one** run. It is claimed in the same transaction as the run insert, so if
  two launches race for one snapshot, one gets `snapshot_used`. A retry (including `retry_of_run_id`)
  needs a fresh upload, because the old snapshot is used.
- The run stores `local_repo_label`, `local_snapshot_id`, `base_ref`, `subpath`, and
  `desktop_target: true`. `repo_path` stays `null` until the clone step sets it to the server-side
  clone.

**Response `200`:** `{"run_id": "…"}` (unchanged).

**Errors** (in addition to the existing launch refusals)

| Status | `code` | `message` (exact) | Extra keys |
|---|---|---|---|
| 422 | `local_repo_exclusive` | `Choose a folder or a GitHub repository for the run, not both.` | |
| 422 | `local_repo_needs_desktop` | `Runs on a local folder start from Tvashtr Desktop.` | |
| 404 | `snapshot_not_found` | `That folder snapshot wasn't found. Choose the folder again.` (unknown id, malformed id, another account's snapshot, a result snapshot, or one purged after 24h) | |
| 422 | `snapshot_used` | `That folder snapshot was already used by another run. Launch again from Tvashtr Desktop to send a fresh one.` | |
| 422 | `base_ref_mismatch` | `The folder snapshot was taken from <snapshot base_ref>, not <sent base_ref>. Launch again to send a fresh one.` | `base_ref` |
| 422 | `subpath_invalid` | `<subpath> isn't a folder inside the repository.` | |

In self-hosted mode, `repo_path` together with `local_repo` gives `local_repo_exclusive`. In hosted
mode, the existing `repo_path is not accepted in hosted mode` and `github_repo is hosted mode only`
string refusals are still checked first.

---

## GET `/api/runs/{run_id}` and the run list — folder fields

`run` gains `local_repo_label` (`null` for every other run). The `target` object from B-RUNS already
describes a folder run:

```json
{
  "local_repo_label": "~/code/trade_mcp",
  "target": {"kind": "desktop_folder", "label": "~/code/trade_mcp", "base_ref": "main", "subpath": "indicators"},
  "repo_path": "/app/backend/.tvashtr_clones/<run_id>",
  "ship_branch": "tvashtr/<run_id>",
  "pr_url": null,
  "desktop_target": true
}
```
`GET /api/runs` rows carry the same `target`. `repo_path` is the server-side clone, so don't show it.
For Recent runs (Q21), show "Branch tvashtr/…" from `ship_branch` when
`target.kind == "desktop_folder"`.

Failure codes a folder run can record (`run.failure.code` / `failure_code`):

| code | when | message |
|---|---|---|
| `folder_clone` | The bundle could not be cloned: it is gone (for example, a recovery onto another server after it was consumed), or the clone failed. | `The folder snapshot for this run is no longer on the server. Start the run again from Tvashtr Desktop.` or `Couldn't open the folder snapshot: <git error>` |
| `folder_delivery` | Ship could not package `tvashtr/<run_id>`. | `Couldn't package the result branch for your folder: <error>` (the humaniser may prefix the Ship node's label) |

---

## GET `/api/runs/{run_id}/ship-bundle`

The finished folder run's `tvashtr/<run_id>` branch as a complete `git bundle` (all of the branch's
history, so it fetches into any clone of the folder). Only the run's owner can download it.

**Response `200`:** the bundle bytes.
- `Content-Type: application/x-git-bundle`
- `Content-Disposition: attachment; filename="tvashtr-<run_id>.bundle"`
- `X-Tvashtr-Branch: tvashtr/<run_id>`: the ref inside the bundle.
- `Content-Length` is set, so a progress bar can use it.

Bring it back without touching the working tree:
```sh
git -C <folder> fetch <file> tvashtr/<run_id>:tvashtr/<run_id>
```

**Errors**

| Status | `code` | `message` (exact) |
|---|---|---|
| 404 | `run_not_found` | `run not found` (unknown run or another account's) |
| 404 | `not_a_folder_run` | `This run didn't work on a folder from Tvashtr Desktop.` |
| 404 | `not_shipped` | `This run hasn't shipped a branch yet.` (still running, stopped, or failed before Ship) |

The bundle is stored when Ship runs, before the run is marked `completed`. So once a run reads
`completed` and `target.kind == "desktop_folder"`, the download is available.
