/**
 * Local-folder runs (P10), the git half:
 *
 * - `createBaseBundle`: `git bundle create <tmp> refs/heads/<baseRef>` — ONLY the chosen base branch
 *   (never HEAD or other branches, so unrelated work never leaves the machine), capped at 200 MB.
 * - `fetchResultBranch`: the run's result bundle comes back as a NEW branch `tvashtr/<runId>` via
 *   `git fetch <bundle> refs/heads/tvashtr/<runId>:refs/heads/tvashtr/<runId>` — never a checkout,
 *   never the working tree or the current branch. If that branch already exists it must already
 *   point at the same commit (bringing it back twice is fine); anything else is refused, so an
 *   existing branch is never moved.
 */
const fs = require("fs");
const path = require("path");
const { RepoError, gitErrorLine, UUID_RE } = require("./common.cjs");

const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;

/**
 * A branch name git would accept, that can't be read as an option.
 * @param {unknown} ref
 */
function isPlausibleBranchName(ref) {
  return (
    typeof ref === "string" &&
    ref.length > 0 &&
    ref.length <= 255 &&
    !ref.startsWith("-") &&
    !ref.startsWith("refs/") &&
    // eslint-disable-next-line no-control-regex
    !/[\s\x00-\x1f\x7f~^:?*[\\]/.test(ref)
  );
}

/**
 * @param {{ repoPath: string, baseRef: unknown, outFile: string,
 *   git: ReturnType<typeof import("./common.cjs").createGit>, maxBytes?: number }} args
 * @returns {Promise<{ file: string, size_bytes: number }>}
 */
async function createBaseBundle({ repoPath, baseRef, outFile, git, maxBytes = MAX_BUNDLE_BYTES }) {
  const inside = await git.tryRun(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside || inside.trim() !== "true") {
    throw new RepoError("not_git", "This folder isn't a git repository.");
  }
  const notFound = () =>
    new RepoError("branch_not_found", `Branch "${String(baseRef)}" isn't in this folder's repository.`);
  if (!isPlausibleBranchName(baseRef)) throw notFound();
  const ref = `refs/heads/${baseRef}`;
  if ((await git.tryRun(repoPath, ["check-ref-format", ref])) === null) throw notFound();
  if ((await git.tryRun(repoPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) === null) {
    throw notFound();
  }

  try {
    await git.run(repoPath, ["bundle", "create", "--quiet", outFile, ref]);
  } catch (e) {
    if (e instanceof RepoError) throw e;
    throw new RepoError("bundle_failed", `Couldn't package the branch: ${gitErrorLine(e)}`);
  }
  const size = fs.statSync(outFile).size;
  if (size > maxBytes) {
    fs.rmSync(outFile, { force: true });
    const mb = (n) => Math.ceil(n / (1024 * 1024));
    throw new RepoError(
      "too_large",
      `This branch is too big to send to Tvashtr (${mb(size)} MB; the limit is ${mb(maxBytes)} MB).`,
    );
  }
  return { file: outFile, size_bytes: size };
}

/**
 * @param {{ repoPath: string, bundleFile: string, runId: string,
 *   git: ReturnType<typeof import("./common.cjs").createGit> }} args
 * @returns {Promise<{ branch: string }>}
 */
async function fetchResultBranch({ repoPath, bundleFile, runId, git }) {
  if (typeof runId !== "string" || !UUID_RE.test(runId)) {
    throw new RepoError("invalid_run", "That run id isn't valid.");
  }
  const inside = await git.tryRun(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside || inside.trim() !== "true") {
    throw new RepoError("not_git", "This folder isn't a git repository.");
  }
  const branch = `tvashtr/${runId.toLowerCase()}`;
  const ref = `refs/heads/${branch}`;

  let heads;
  try {
    heads = await git.run(repoPath, ["bundle", "list-heads", path.resolve(bundleFile)]);
  } catch (e) {
    if (e instanceof RepoError) throw e;
    throw new RepoError("bundle_invalid", "The run's result from Tvashtr couldn't be read.");
  }
  const tip = heads
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find((parts) => parts[1] === ref);
  if (!tip) {
    throw new RepoError("bundle_invalid", `The run's result doesn't contain branch ${branch}.`);
  }
  const bundleSha = tip[0];

  const existing = await git.tryRun(repoPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (existing !== null) {
    if (existing.trim() === bundleSha) return { branch };
    throw new RepoError(
      "branch_exists",
      `A branch named ${branch} already exists in this folder with different commits. ` +
        "Rename or delete it, then bring the result back again.",
    );
  }

  try {
    await git.run(repoPath, [
      "fetch",
      "--quiet",
      "--no-tags",
      "--recurse-submodules=no",
      path.resolve(bundleFile),
      `${ref}:${ref}`,
    ]);
  } catch (e) {
    if (e instanceof RepoError) throw e;
    throw new RepoError(
      "fetch_failed",
      `Couldn't add branch ${branch} to this folder: ${gitErrorLine(e)}`,
    );
  }
  return { branch };
}

module.exports = { createBaseBundle, fetchResultBranch, isPlausibleBranchName, MAX_BUNDLE_BYTES };
