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
} as const;

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
