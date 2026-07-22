/**
 * Durable readback of a greenfield run's shipped file content for Playwright live gates.
 *
 * WHY THIS EXISTS. The three live gates used to assert a run's ship by shelling out to
 * `git -C backend/.tvashtr_workspaces/<run_id> show ship-<run_id>:<file>` once the run was over.
 * Since persist-then-reap, that directory is deleted in `run_team`'s `finally` — so the specs
 * race the reaper, and `execFileSync` throws on a missing directory when they lose.
 *
 * WHAT SURVIVES: `run_artifacts.files` — the whole stored `compute_run_diff` dict, served
 * byte-for-byte by `GET /api/runs/{id}/diff` (the same surface the run's "Changes" tab renders).
 * These helpers read that product surface so the gates assert what the user actually sees.
 *
 * Mirror of `scripts/_ship_readback.py` (`added_file` / the durable stand-in for `git show`).
 * Total: unknown run, missing artifact, absent path, or non-"added" status → null, so a gate
 * fails its OWN assertion rather than exploding inside this helper.
 */

import type { APIRequestContext } from "@playwright/test";

/** One file entry in the persisted compute_run_diff / `/diff` payload. */
export type ShipDiffFile = {
  path?: string;
  status?: string;
  patch?: string;
  additions?: number;
  deletions?: number;
};

/** Shape returned by `GET /api/runs/{id}/diff` (and stored in `run_artifacts.files`). */
export type ShipDiff = {
  run_id?: string;
  base_ref?: string | null;
  ship_branch?: string | null;
  files?: ShipDiffFile[] | null;
  total?: number;
};

/**
 * Reconstruct the content of an ADDED file from a persisted diff dict — the durable equivalent
 * of `git show <ship_tag>:<path>`.
 *
 * Returns null when the path is absent or its entry is not `status === "added"`, so a gate can
 * still FAIL on absence rather than silently comparing against an empty string.
 *
 * For a greenfield run every shipped file is `added` and its whole content is the patch's `+`
 * hunk lines. `+++ b/<path>` is a HEADER line (not content) and is excluded; so is git's
 * `\ No newline at end of file` marker, which does not start with `+`.
 */
export function addedFile(diff: ShipDiff | null | undefined, path: string): string | null {
  for (const entry of diff?.files ?? []) {
    if (entry == null || typeof entry !== "object" || entry.path !== path) continue;
    if (entry.status !== "added") return null;
    const body = (entry.patch ?? "")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1));
    return body.join("\n");
  }
  return null;
}

/**
 * Fetch `/api/runs/{runId}/diff` (owner-scoped; the logged-in e2e user owns the run) and return
 * the reconstructed content of an ADDED file, or null when there is no artifact / match / non-added.
 */
export async function shippedFile(
  request: APIRequestContext,
  runId: string,
  path: string,
): Promise<string | null> {
  const res = await request.get(`/api/runs/${runId}/diff`);
  if (!res.ok()) return null;
  let body: ShipDiff;
  try {
    body = (await res.json()) as ShipDiff;
  } catch {
    return null;
  }
  return addedFile(body, path);
}
