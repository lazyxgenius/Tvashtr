/**
 * The agent drawer's draft, as plain data: seed it from a saved node, see which parts changed, and
 * build the PATCH that sends ONLY those parts (spec §4.7: `prompt`/`model` are applied only when
 * sent, so a stale drawer never clobbers a Toolkit-side attach of tools or skills).
 * `useAgentDraft` (the React hook) wraps these; the focus view shares the same draft.
 */
import type { TeamGraphNode } from "../lib/api";
import type { AgentPatch } from "../lib/api/nodes";
import { checkSchema } from "./setup/schemaCheck";

export interface AgentDraft {
  prompt: string;
  model: string;
  /** `config.title` ("" = use the role's built-in name). */
  title: string;
  /** `config.description` ("" = use the role's built-in blurb). */
  description: string;
  editsAllowed: boolean;
  multimodal: boolean;
  readsFrom: string[];
  /** false = reads nothing when `readsFrom` is empty (`config.reads_default: false`). */
  readsDefault: boolean;
  writesTo: string;
  fallbackModel: string;
  /** The output-format JSON Schema as text ("" = none). */
  outputSchema: string;
  skills: unknown[] | null;
  toolConfig: Record<string, unknown> | null;
}

/** The parts of the draft the UI marks as changed (Changed dots, "N unsaved changes"). */
export type ChangeGroup =
  | "instructions"
  | "name"
  | "model"
  | "images"
  | "fileAccess"
  | "reads"
  | "writes"
  | "backupModel"
  | "outputFormat"
  | "skills"
  | "tools";

const GROUP_FIELDS: Record<ChangeGroup, (keyof AgentDraft)[]> = {
  instructions: ["prompt"],
  name: ["title", "description"],
  model: ["model"],
  images: ["multimodal"],
  fileAccess: ["editsAllowed"],
  reads: ["readsFrom", "readsDefault"],
  writes: ["writesTo"],
  backupModel: ["fallbackModel"],
  outputFormat: ["outputSchema"],
  skills: ["skills"],
  tools: ["toolConfig"],
};

/** How each group reads in "You changed the instructions and the model." */
const GROUP_PHRASE: Record<ChangeGroup, string> = {
  instructions: "the instructions",
  name: "the name",
  model: "the model",
  images: "images",
  fileAccess: "file access",
  reads: "what it reads",
  writes: "what it writes",
  backupModel: "the backup model",
  outputFormat: "the output format",
  skills: "skills",
  tools: "tools",
};

const cfgOf = (node: TeamGraphNode): Record<string, unknown> =>
  (node.config as Record<string, unknown> | null) ?? {};
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Default File access when a node predates `edits_allowed`: workers edit, thinkers don't. */
export function editsAllowedOf(node: TeamGraphNode): boolean {
  return node.edits_allowed ?? node.kind === "agent";
}

export function seedDraft(node: TeamGraphNode): AgentDraft {
  const cfg = cfgOf(node);
  const schema = cfg.output_schema;
  return {
    prompt: node.prompt ?? "",
    model: node.model ?? "",
    title: text(cfg.title),
    description: text(cfg.description),
    editsAllowed: editsAllowedOf(node),
    multimodal: cfg.multimodal === true,
    readsFrom: Array.isArray(cfg.reads_from)
      ? cfg.reads_from.filter((s): s is string => typeof s === "string")
      : [],
    readsDefault: cfg.reads_default !== false,
    writesTo: text(cfg.writes_to),
    fallbackModel: text(cfg.fallback_model),
    outputSchema: schema && typeof schema === "object" ? JSON.stringify(schema, null, 2) : "",
    skills: Array.isArray(node.skills) ? node.skills : null,
    toolConfig: node.tool_config ?? null,
  };
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Which groups differ between the saved baseline and the draft, in display order. */
export function changedGroups(base: AgentDraft, draft: AgentDraft): ChangeGroup[] {
  return (Object.keys(GROUP_FIELDS) as ChangeGroup[]).filter((g) =>
    GROUP_FIELDS[g].some((f) => !same(base[f], draft[f])),
  );
}

/**
 * The saved node changed under an open draft (a graph refetch): take the new saved value for every
 * field the user hasn't touched, keep the ones they have.
 */
export function rebaseDraft(
  oldBase: AgentDraft,
  draft: AgentDraft,
  newBase: AgentDraft,
): AgentDraft {
  const out = { ...newBase };
  for (const f of Object.keys(newBase) as (keyof AgentDraft)[]) {
    if (!same(oldBase[f], draft[f])) (out as Record<string, unknown>)[f] = draft[f];
  }
  return out;
}

/** Review changes' "Undo this change": the saved values of one group's fields. */
export function revertGroup(base: AgentDraft, group: ChangeGroup): Partial<AgentDraft> {
  return Object.fromEntries(GROUP_FIELDS[group].map((f) => [f, base[f]]));
}

/** "the instructions and the model" / "the instructions, the model and images". */
export function describeChanges(groups: ChangeGroup[]): string {
  const words = groups.map((g) => GROUP_PHRASE[g]);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Why the draft can't be saved yet, or null. Empty instructions only block a save that sends them
 * (a new agent can save its model or name before it has instructions). */
export function draftProblem(base: AgentDraft, draft: AgentDraft): string | null {
  if (!same(base.prompt, draft.prompt) && !draft.prompt.trim())
    return "Instructions can’t be empty.";
  // The same check the Output format editor runs (its Done is disabled on any of these).
  if (checkSchema(draft.outputSchema).state === "error") {
    return "The output format isn’t a valid JSON Schema.";
  }
  return null;
}

/** The PATCH body for exactly the changed parts. Call only when `draftProblem(base, draft)` is null. */
export function patchFor(base: AgentDraft, draft: AgentDraft): AgentPatch {
  const out: AgentPatch = {};
  const changed = (f: keyof AgentDraft) => !same(base[f], draft[f]);
  if (changed("prompt")) out.prompt = draft.prompt;
  if (changed("model")) out.model = draft.model.trim();
  if (changed("title")) out.title = draft.title.trim() || null;
  if (changed("description")) out.description = draft.description.trim() || null;
  if (changed("editsAllowed")) out.edits_allowed = draft.editsAllowed;
  if (changed("multimodal")) out.multimodal = draft.multimodal;
  if (changed("readsFrom")) out.reads_from = draft.readsFrom;
  // `null` removes the key (the default: read the spec); `false` = reads nothing.
  if (changed("readsDefault")) out.reads_default = draft.readsDefault ? null : false;
  if (changed("writesTo")) out.writes_to = draft.writesTo.trim();
  if (changed("fallbackModel")) out.fallback_model = draft.fallbackModel.trim() || null;
  if (changed("outputSchema")) {
    out.output_schema = draft.outputSchema.trim()
      ? (JSON.parse(draft.outputSchema) as Record<string, unknown>)
      : null;
  }
  if (changed("skills")) out.skills = draft.skills;
  if (changed("toolConfig")) out.tool_config = draft.toolConfig;
  return out;
}
