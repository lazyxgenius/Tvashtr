/**
 * The `repos.*` bridge for local-folder runs from Desktop (home-run.md §4, P10), minus the native
 * folder picker (main.cjs). Every method validates its path (absolute, existing directory) and
 * throws RepoError with a message the UI can show as is.
 *
 *   inspect(path)                   → branch, branches, file count, scopes (or {is_git:false, error})
 *   recent.list/add/remove          → "Recent folders"
 *   prepareRun({path, baseRef, label}) → bundle the base branch, upload it → {snapshot_id, size_bytes}
 *   bringBackBranch({path, runId})  → download the result bundle, fetch it in as tvashtr/<runId>
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { RepoError, requireDirectory, displayPath, UUID_RE } = require("./common.cjs");
const { inspectRepo } = require("./inspect.cjs");
const { createRecentFolders } = require("./recent.cjs");
const { createBaseBundle, fetchResultBranch, MAX_BUNDLE_BYTES } = require("./bundle.cjs");

/** A result bundle is the base plus the run's commits; allow some headroom over the upload cap. */
const MAX_RESULT_BYTES = 512 * 1024 * 1024;

const mb = (n) => Math.ceil(n / (1024 * 1024));

function isAuthError(e) {
  return e && (e.status === 401 || e.status === 403);
}

/**
 * @param {{
 *   git: ReturnType<typeof import("./common.cjs").createGit>,
 *   api: { uploadRepoSnapshot: Function, downloadShipBundle: Function },
 *   userDataDir: string,
 *   home?: string,
 *   tmpRoot?: string,
 *   maxBundleBytes?: number,
 *   maxResultBytes?: number,
 *   log?: (m: string) => void,
 * }} deps
 */
function createRepoService({
  git,
  api,
  userDataDir,
  home = os.homedir(),
  tmpRoot = os.tmpdir(),
  maxBundleBytes = MAX_BUNDLE_BYTES,
  maxResultBytes = MAX_RESULT_BYTES,
  log = () => {},
}) {
  const branchOf = async (dir) => {
    const out = await git.tryRun(dir, ["symbolic-ref", "--short", "-q", "HEAD"]);
    return out && out.trim() ? out.trim() : null;
  };
  const recent = createRecentFolders({ userDataDir, branchOf, home });

  async function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "tvashtr-bundle-"));
    try {
      return await fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async function requireGit(repo) {
    const inside = await git.tryRun(repo, ["rev-parse", "--is-inside-work-tree"]);
    if (!inside || inside.trim() !== "true") {
      throw new RepoError("not_git", "This folder isn't a git repository.");
    }
  }

  function uploadError(e) {
    log(`[repos] upload failed: ${e && e.message ? e.message : e}`);
    if (isAuthError(e)) return new RepoError("not_signed_in", "Sign in to Tvashtr, then try again.");
    if (e && e.status === 413) {
      return new RepoError(
        "too_large",
        `This branch is too big to send to Tvashtr (the limit is ${mb(maxBundleBytes)} MB).`,
      );
    }
    if (e && e.status >= 400 && e.status < 500 && e.detail) {
      return new RepoError("upload_failed", `Tvashtr didn't accept the folder: ${e.detail}`);
    }
    return new RepoError(
      "upload_failed",
      "Couldn't send the folder to Tvashtr. Check your connection and try again.",
    );
  }

  function downloadError(e) {
    log(`[repos] result download failed: ${e && e.message ? e.message : e}`);
    if (isAuthError(e)) return new RepoError("not_signed_in", "Sign in to Tvashtr, then try again.");
    if (e && e.status === 404) {
      return new RepoError("not_found", "Tvashtr has no result for this run to bring back yet.");
    }
    if (e && e.code === "too_large") {
      return new RepoError(
        "too_large",
        `The run's result is too big to bring back (over ${mb(maxResultBytes)} MB).`,
      );
    }
    if (e && e.status >= 400 && e.status < 500 && e.detail) {
      return new RepoError("download_failed", `Couldn't get the run's result: ${e.detail}`);
    }
    return new RepoError(
      "download_failed",
      "Couldn't download the run's result from Tvashtr. Check your connection and try again.",
    );
  }

  return {
    inspect: (p) => inspectRepo(p, { git, home }),

    recent: {
      list: () => recent.list(),
      add: (p) => recent.add(p),
      remove: (p) => recent.remove(p),
    },

    /** @param {{ path: unknown, baseRef: unknown, label?: unknown }} args */
    async prepareRun(args) {
      const { path: p, baseRef, label } = args || /** @type {any} */ ({});
      const repo = requireDirectory(p);
      const shownLabel =
        typeof label === "string" && label.trim() ? label.trim().slice(0, 200) : displayPath(repo, home);
      return withTempDir(async (dir) => {
        const bundle = await createBaseBundle({
          repoPath: repo,
          baseRef,
          outFile: path.join(dir, "base.bundle"),
          git,
          maxBytes: maxBundleBytes,
        });
        let res;
        try {
          res = await api.uploadRepoSnapshot({
            file: bundle.file,
            label: shownLabel,
            baseRef: String(baseRef),
          });
        } catch (e) {
          throw uploadError(e);
        }
        if (!res || typeof res.snapshot_id !== "string" || !res.snapshot_id) {
          throw new RepoError("upload_failed", "Tvashtr didn't accept the folder. Try again.");
        }
        return {
          snapshot_id: res.snapshot_id,
          size_bytes: typeof res.size_bytes === "number" ? res.size_bytes : bundle.size_bytes,
        };
      });
    },

    /** @param {{ path: unknown, runId: unknown }} args */
    async bringBackBranch(args) {
      const { path: p, runId } = args || /** @type {any} */ ({});
      const repo = requireDirectory(p);
      if (typeof runId !== "string" || !UUID_RE.test(runId)) {
        throw new RepoError("invalid_run", "That run id isn't valid.");
      }
      await requireGit(repo);
      return withTempDir(async (dir) => {
        const file = path.join(dir, "result.bundle");
        try {
          await api.downloadShipBundle(runId, file, { maxBytes: maxResultBytes });
        } catch (e) {
          throw downloadError(e);
        }
        return fetchResultBranch({ repoPath: repo, bundleFile: file, runId, git });
      });
    },
  };
}

module.exports = { createRepoService, MAX_RESULT_BYTES };
