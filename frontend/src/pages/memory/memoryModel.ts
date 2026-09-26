/**
 * Toolkit › Memory — the pure labels behind the page (no JSX): force badges, the scope chip,
 * provenance lines, Keep's toast, the inline editor's scope choices and its patch.
 */
import type { BadgeVariant } from "../../design-system/components";
import type {
  Memory,
  MemoryPatch,
  MemoryPolarity,
  MemoryScope,
  PromoteResult,
} from "../../lib/api/memory";
import { POLARITY_META, POLARITY_ORDER } from "../../lib/memory";
import { formatRelativeTime } from "../../lib/time";
import { agentLabel } from "../skills/skillsModel";

/** MEM-8: MUST / MUST NOT = danger, SHOULD / SHOULD NOT = warning, MAY = info, CONTEXT = neutral. */
export const FORCE_VARIANT: Record<MemoryPolarity, BadgeVariant> = {
  require: "danger",
  prefer: "warning",
  allow: "info",
  context: "neutral",
  avoid: "warning",
  forbid: "danger",
};

export const forceLabel = (p: MemoryPolarity): string => POLARITY_META[p].label;

export const FORCE_OPTIONS = POLARITY_ORDER.map((p) => ({ value: p, label: forceLabel(p) }));

/** "Sep 23" (en-US, like the design, whatever the browser's locale). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** "just now" / "31m ago" / "5h ago" / "3d ago", then "Sep 23". */
export function whenLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  return Date.now() - then >= WEEK_MS ? shortDate(iso) : formatRelativeTime(iso);
}

/** The editor's Scope: Account (every repo), Repo, or Agent (one agent). */
export function scopeOf(m: Pick<Memory, "tier">): MemoryScope {
  return m.tier === "node" ? "agent" : m.tier;
}

export type ScopeChipKind = "agent" | "repo" | "account";

/**
 * MEM-9 / Q14: an agent memory reads "<Role> · <Team>" ("Removed agent" once the agent is gone), a
 * repo memory its `owner/name`, an account memory "Account · all repos".
 */
export function scopeChip(m: Memory): { kind: ScopeChipKind; label: string } {
  if (m.tier === "node") {
    const a = m.agent;
    if (!a) return { kind: "agent", label: "Agent" };
    const who = agentLabel(a);
    return {
      kind: "agent",
      label: a.role_name && a.team_name ? `${who} · ${a.team_name}` : who,
    };
  }
  if (m.tier === "repo") return { kind: "repo", label: m.repo_label ?? m.repo_key ?? "Repo" };
  return { kind: "account", label: "Account · all repos" };
}

const isCaution = (p: MemoryPolarity) => p === "avoid" || p === "forbid";

/**
 * MEM-10 / MEM-11: "From run “Add an RSI indicator” · round 3 · 31m ago", or for a caution a failed
 * run taught, "From a failed run · Sep 23 · a caution". A memory a person added says so.
 */
export function provenance(m: Memory): string {
  const s = m.source;
  if (s.kind === "manual") return `Added by you · ${whenLabel(m.created_at)}`;
  if (s.run_succeeded === false && isCaution(m.polarity))
    return `From a failed run · ${shortDate(m.created_at)} · a caution`;
  const parts = [s.run_title ? `From run “${s.run_title}”` : "From a run"];
  if (s.round !== null) parts.push(`round ${s.round}`);
  const when = whenLabel(m.created_at);
  if (when) parts.push(when);
  return parts.join(" · ");
}

/** Newest first (the Inbox's order). */
export function sortNewestFirst(list: Memory[]): Memory[] {
  return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * MEM-12's toast. Only an agent memory names the agent ("Kept. Reviewer uses it from the next
 * run."): a repo or account memory reaches every agent. A merge or a supersede says what happened
 * instead (Q11).
 */
export function keptMessage(kept: Memory, res: Pick<PromoteResult, "action">): string {
  if (res.action === "promote_merged") return "Already known. Confirmed the existing memory.";
  if (res.action === "promote_supersede")
    return "Kept. It replaces an older memory that said the opposite.";
  if (kept.tier === "node" && kept.agent?.role_name)
    return `Kept. ${agentLabel(kept.agent)} uses it from the next run.`;
  return "Kept. Agents use it from the next run.";
}

export interface ScopeChoice {
  value: MemoryScope;
  label: string;
  disabled: boolean;
}

/**
 * Q8: Account / Repo / Agent. Agent needs a known agent (its own or the one that learned it); Repo
 * needs a repo (its own, or the repo of the run that taught it — the server resolves that).
 */
export function scopeChoices(m: Memory): ScopeChoice[] {
  const hasRepo = m.repo_key !== null || m.source.kind === "run";
  const hasAgent = m.node_id !== null || m.source_node_id !== null;
  return [
    { value: "account", label: "Account", disabled: false },
    { value: "repo", label: "Repo", disabled: !hasRepo && m.tier !== "repo" },
    { value: "agent", label: "Agent", disabled: !hasAgent && m.tier !== "node" },
  ];
}

export interface MemoryDraft {
  content: string;
  polarity: MemoryPolarity;
  scope: MemoryScope;
}

export const draftOf = (m: Memory): MemoryDraft => ({
  content: m.content,
  polarity: m.polarity,
  scope: scopeOf(m),
});

/** Only what changed (null when nothing did). Blank text is the caller's to refuse. */
export function editPatch(m: Memory, draft: MemoryDraft): MemoryPatch | null {
  const patch: MemoryPatch = {};
  const text = draft.content.trim();
  if (text !== m.content.trim()) patch.content = text;
  if (draft.polarity !== m.polarity) patch.polarity = draft.polarity;
  if (draft.scope !== scopeOf(m)) patch.scope = draft.scope;
  return Object.keys(patch).length > 0 ? patch : null;
}
