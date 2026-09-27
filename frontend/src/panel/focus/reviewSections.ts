/**
 * Review changes (Focus-ReviewChanges, FOCUS-30..34): one section per changed part of the draft,
 * in the order the Changed dots count them. Text parts (Instructions, Output format) get a unified
 * line diff with "+a −r lines"; single values (Model, Images, File access, Reads, Writes, Backup
 * model, Name) read old → new; Skills and Tools list what was added, removed or changed.
 */
import type { SkillLibraryItem, ToolLibraryItem } from "../../lib/api";
import type { AgentDraft, ChangeGroup } from "../agentDraft";
import { type DiffRow, diffLines } from "../setup/lineDiff";
import { followsRules, MODE_LABELS, skillRows } from "../skills/nodeSkills";
import { domainsOf, serversOf, toolRows } from "../tools/nodeTools";

export interface ReviewValue {
  text: string;
  /** A model slug: shown with its provider's letter tile. */
  model?: boolean;
}

export interface ReviewLine {
  op: "add" | "del" | "change";
  text: string;
}

export type ReviewSection = { group: ChangeGroup; title: string } & (
  | { kind: "text"; rows: DiffRow[]; added: number; removed: number }
  | { kind: "value"; location: string; before: ReviewValue; after: ReviewValue }
  | { kind: "lines"; location: string; lines: ReviewLine[] }
);

export interface ReviewContext {
  /** The built-in name and tagline (shown when `title` / `description` are ""). */
  builtInName: string;
  builtInDescription: string;
  skillLibrary: readonly SkillLibraryItem[] | null;
  toolLibrary: readonly ToolLibraryItem[] | null;
}

const TITLES: Record<ChangeGroup, string> = {
  instructions: "Instructions",
  name: "Name",
  model: "Model",
  images: "Images",
  fileAccess: "File access",
  reads: "Reads",
  writes: "Writes",
  backupModel: "Backup model",
  outputFormat: "Output format",
  skills: "Skills",
  tools: "Tools",
};

const LOCATIONS: Partial<Record<ChangeGroup, string>> = {
  name: "⋯ → Rename",
  model: "Setup → Model",
  images: "Setup → Images",
  fileAccess: "Setup → File access",
  reads: "Setup → Reads",
  writes: "Setup → Writes",
  backupModel: "Setup → Advanced",
  skills: "Skills & tools",
  tools: "Skills & tools",
};

const onOff = (on: boolean) => (on ? "On" : "Off");
const model = (slug: string, empty: string): ReviewValue =>
  slug.trim() ? { text: slug.trim(), model: true } : { text: empty };

function readsText(d: AgentDraft): string {
  if (d.readsFrom.length > 0) return d.readsFrom.join(", ");
  return d.readsDefault ? "spec (default)" : "Nothing";
}

function valueOf(group: ChangeGroup, d: AgentDraft): ReviewValue {
  switch (group) {
    case "model":
      return model(d.model, "No model");
    case "backupModel":
      return model(d.fallbackModel, "None");
    case "images":
      return { text: onOff(d.multimodal) };
    case "fileAccess":
      return { text: d.editsAllowed ? "Can edit files" : "Read-only" };
    case "reads":
      return { text: readsText(d) };
    default:
      return { text: d.writesTo.trim() || "Nothing" };
  }
}

function nameLines(base: AgentDraft, draft: AgentDraft, ctx: ReviewContext): ReviewLine[] {
  const lines: ReviewLine[] = [];
  const name = (d: AgentDraft) => d.title.trim() || ctx.builtInName;
  const tagline = (d: AgentDraft) => d.description.trim() || ctx.builtInDescription;
  if (name(base) !== name(draft)) {
    lines.push({ op: "change", text: `Name: ${name(base)} → ${name(draft)}` });
  }
  if (tagline(base) !== tagline(draft)) {
    lines.push({ op: "change", text: `Description: ${tagline(base)} → ${tagline(draft)}` });
  }
  return lines;
}

/**
 * Rows present on one side only are added / removed; a row on both whose `detail` differs changed,
 * and one whose other settings (`raw`: a skill's text, a server's env) differ was "edited". A change
 * none of that names is the order.
 */
function rowLines<R>(
  before: readonly R[],
  after: readonly R[],
  key: (r: R) => string,
  name: (r: R) => string,
  detail: (r: R) => string,
  raw: (r: R, side: "before" | "after") => string,
): ReviewLine[] {
  const lines: ReviewLine[] = [];
  const old = new Map(before.map((r) => [key(r), r]));
  const now = new Map(after.map((r) => [key(r), r]));
  for (const r of after) {
    const was = old.get(key(r));
    if (!was) lines.push({ op: "add", text: `${name(r)} · ${detail(r)}` });
    else if (detail(was) !== detail(r)) {
      lines.push({ op: "change", text: `${name(r)}: ${detail(was)} → ${detail(r)}` });
    } else if (raw(was, "before") !== raw(r, "after")) {
      lines.push({ op: "change", text: `${name(r)}: edited` });
    }
  }
  for (const r of before) {
    if (!now.has(key(r))) lines.push({ op: "del", text: name(r) });
  }
  return lines;
}

/** The group changed but no row says how: its order did. */
const orNewOrder = (lines: ReviewLine[]): ReviewLine[] =>
  lines.length > 0 ? lines : [{ op: "change", text: "Order changed" }];

function skillLines(base: AgentDraft, draft: AgentDraft, ctx: ReviewContext): ReviewLine[] {
  const rows = (d: AgentDraft) => skillRows(d.skills, ctx.skillLibrary);
  const lines = rowLines(
    rows(base),
    rows(draft),
    (r) => `${r.badge.label}:${r.libraryId ?? r.name}`,
    (r) => r.name,
    (r) => [MODE_LABELS[r.mode], ...r.triggers].join(" "),
    (r, side) => JSON.stringify((side === "before" ? base : draft).skills?.[r.index]),
  );
  if (followsRules(base.skills) !== followsRules(draft.skills)) {
    const on = (d: AgentDraft) => onOff(followsRules(d.skills));
    lines.push({
      op: "change",
      text: `Follow the repo’s rules files: ${on(base)} → ${on(draft)}`,
    });
  }
  return orNewOrder(lines);
}

function toolLines(base: AgentDraft, draft: AgentDraft, ctx: ReviewContext): ReviewLine[] {
  const rows = (d: AgentDraft) => toolRows(d.toolConfig, ctx.toolLibrary, null);
  const lines = rowLines(
    rows(base),
    rows(draft),
    (r) => r.key,
    (r) => r.name,
    (r) => `${r.enabled ? "On" : "Off"} · ${r.target}`,
    (r, side) =>
      r.source === "inline"
        ? JSON.stringify(serversOf((side === "before" ? base : draft).toolConfig)[r.name])
        : "",
  );
  if (domainsOf(base.toolConfig) !== domainsOf(draft.toolConfig)) {
    const on = (d: AgentDraft) => onOff(domainsOf(d.toolConfig));
    lines.push({ op: "change", text: `Domains: ${on(base)} → ${on(draft)}` });
  }
  return orNewOrder(lines);
}

export function reviewSections(
  base: AgentDraft,
  draft: AgentDraft,
  groups: readonly ChangeGroup[],
  ctx: ReviewContext,
): ReviewSection[] {
  return groups.map((group): ReviewSection => {
    const title = TITLES[group];
    const location = LOCATIONS[group] ?? "Setup";
    if (group === "instructions" || group === "outputFormat") {
      const [a, b] =
        group === "instructions"
          ? [base.prompt, draft.prompt]
          : [base.outputSchema, draft.outputSchema];
      return { group, title, kind: "text", ...diffLines(a, b) };
    }
    if (group === "name") {
      return { group, title, kind: "lines", location, lines: nameLines(base, draft, ctx) };
    }
    if (group === "skills") {
      return { group, title, kind: "lines", location, lines: skillLines(base, draft, ctx) };
    }
    if (group === "tools") {
      return { group, title, kind: "lines", location, lines: toolLines(base, draft, ctx) };
    }
    return {
      group,
      title,
      kind: "value",
      location,
      before: valueOf(group, base),
      after: valueOf(group, draft),
    };
  });
}

/** "+2 −1 lines". */
export const lineStats = (added: number, removed: number): string => `+${added} −${removed} lines`;
