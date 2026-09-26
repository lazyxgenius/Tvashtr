/** The Setup tab's derived copy (PANEL-28, PANEL-49/51). */

/** "Added at run time: the idea + the latest spec" — what the executor puts next to the
 *  instructions, from the agent's Reads. The entry agent starts from the idea alone. */
export function runtimeBanner(opts: {
  isEntry: boolean;
  readsFrom: string[];
  readsDefault: boolean;
}): string {
  const lead = "Added at run time: the idea";
  if (opts.isEntry) return lead;
  if (opts.readsFrom.length > 0) {
    const names = opts.readsFrom.map((n) => (n === "spec" ? "the latest spec" : n));
    return `${lead} + ${names.join(" + ")}`;
  }
  return opts.readsDefault ? `${lead} + the latest spec` : lead;
}

export const FILE_ACCESS_HINT = {
  readOnly: "Same agent loop with read-only tools. Only its report leaves the sandbox.",
  edits:
    "Full agent loop. It can change files in the repo. Memory → Remember what it learns is now available.",
  entry: "The first agent writes the shared spec the team reads, so it stays read-only.",
  /** An agent that routes on a verdict pulls back only its verdict file, whatever its access
   *  (team_run `_resolve_pull_paths`), so its edits never leave the sandbox. */
  editsVerdict:
    "Full agent loop. Its edits stay in the sandbox. Memory → Remember what it learns is now available.",
} as const;

/** Flow-Access-1 (Q6). The design says its changes "can end up in the pull request"; for an agent
 *  that routes on a verdict (the only one asked) the executor pulls back the verdict file alone. */
export const ACCESS_CONFIRM_BODY =
  "It gets write tools in its sandbox, but its edits stay there: only its verdict leaves, so they never reach the pull request. Reviewers usually stay read-only.";

/** Q3: an agent that routes on a verdict can't author a document (the executor ignores it). */
export const WRITES_VERDICT_HINT = "Its verdict goes to Runs.";
export const WRITES_VERDICT_WARNING =
  "It routes on a verdict, so it can’t write a document. Its verdict goes to Runs.";

/** PANEL-56: a Writes name no agent uses yet. */
export const NEW_DOCUMENT_TOAST = "New document. Other agents can add it to their Reads.";

export const TIPS = {
  instructions:
    "Who this agent is and how it works. This is its whole identity: edit it, then run the team.",
  model: "Only models proven to run a full build are listed.",
  images: "Let it send and read images. Text-only models ignore this.",
  fileAccess: "Can it change files in the repo?",
  reads: "Documents it reads before it starts, in order. Default: the spec.",
  writes:
    "The one document this agent creates. By default, the entry agent writes the spec and others write nothing.",
  backup: "Leave as None for no backup.",
  outputFormat: "An advisory JSON Schema for this agent’s output.",
} as const;

export const BACKUP_HINT = "Used once if the main model fails (bad key, provider down).";
export const OUTPUT_FORMAT_HINT =
  "Optional. If the output doesn’t match, the run logs a warning. It won’t fail.";
