/**
 * Toolkit › Memory — the pure labels behind the page (no JSX): force badges, the scope chip,
 * provenance lines, Keep's toast, the inline editor's scope choices and its patch, and the Active
 * tab's meta line, filters and order, the Archive's rows and Restore toast, and Add memory's forces,
 * default repo and toast.
 */
import type { BadgeVariant } from "../../design-system/components";
import type {
  Memory,
  MemoryPatch,
  MemoryPolarity,
  MemoryRepo,
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

/** An inline edit whose new text couldn't be embedded (a 502): nothing changed on the server. */
export const EDIT_EMBED_FAILED =
  "The embedding service didn’t answer, so the edit wasn’t saved. Try again.";

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

// ---- The Active tab (Toolkit-MemoryActive, TkF-Filters) ----

const DAY_MS = 24 * 60 * 60 * 1000;

/** "just now" / "31m ago" / "5h ago" within a day, then "Sep 24". */
export function activeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  return Date.now() - then >= DAY_MS ? shortDate(iso) : formatRelativeTime(iso);
}

/**
 * MEM-18: where it came from, then "pinned" or when — "Confirmed 3× · pinned", "Added by you ·
 * Sep 20", "Edited by you · just now". A person's edit wins over how it arrived.
 */
export function activeMeta(m: Memory): string {
  const origin =
    m.edited_at !== null
      ? "Edited by you"
      : m.source.kind === "manual"
        ? "Added by you"
        : `Confirmed ${Math.max(1, m.confirmation_count)}×`;
  const when = m.pinned ? "pinned" : activeWhen(m.edited_at ?? m.created_at);
  return when ? `${origin} · ${when}` : origin;
}

/** MEM-19: pinned first, then newest first. */
export function sortActive(list: Memory[]): Memory[] {
  return [...list].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at),
  );
}

export interface MemoryFilters {
  /** Words to look for (text, repo or agent). */
  q: string;
  /** A repo key, or "" for every repo. */
  repo: string;
  scope: MemoryScope | "";
  force: MemoryPolarity | "";
}

export const NO_FILTERS: MemoryFilters = { q: "", repo: "", scope: "", force: "" };

export const isFiltered = (f: MemoryFilters): boolean =>
  f.q.trim() !== "" || f.repo !== "" || f.scope !== "" || f.force !== "";

/**
 * MEM-16: the filters combine with AND. A repo keeps that repo's memories and the account-wide
 * ones, which apply to it too (Q9).
 */
export function matchesFilters(m: Memory, f: MemoryFilters): boolean {
  if (f.force && m.polarity !== f.force) return false;
  if (f.scope && scopeOf(m) !== f.scope) return false;
  if (f.repo && m.repo_key !== f.repo && m.tier !== "account") return false;
  const q = f.q.trim().toLowerCase();
  if (q && !`${m.content}\n${scopeChip(m).label}`.toLowerCase().includes(q)) return false;
  return true;
}

export interface FilterOption {
  value: string;
  label: string;
}

export const SCOPE_FILTER_OPTIONS: FilterOption[] = [
  { value: "", label: "All scopes" },
  { value: "account", label: "Account" },
  { value: "repo", label: "Repo" },
  { value: "agent", label: "Agent" },
];

export const FORCE_FILTER_OPTIONS: FilterOption[] = [
  { value: "", label: "Any force" },
  ...FORCE_OPTIONS,
];

/**
 * The Repo filter: "All repos", then the repos you have memories on (most first), then the other
 * repos you ran on. `repos` is `/api/memory/repos` (null if it failed — the loaded memories still
 * name their repos).
 */
export function repoFilterOptions(repos: MemoryRepo[] | null, memories: Memory[]): FilterOption[] {
  const labels = new Map<string, string>();
  for (const r of repos ?? []) labels.set(r.repo_key, r.label);
  const count = new Map<string, number>();
  for (const m of memories) {
    if (m.repo_key === null) continue;
    count.set(m.repo_key, (count.get(m.repo_key) ?? 0) + 1);
    if (!labels.has(m.repo_key)) labels.set(m.repo_key, m.repo_label ?? m.repo_key);
  }
  const keys = [...labels.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0));
  return [
    { value: "", label: "All repos" },
    ...keys.map((k) => ({ value: k, label: labels.get(k) ?? k })),
  ];
}

// ---- The Archive tab (TkF-Archive) ----

/** When it left Active or the Inbox: `invalid_at` (set when it was replaced or discarded). */
const archivedAt = (m: Memory): string => m.invalid_at ?? m.updated_at;

/**
 * MEM-26: "Replaced by a newer memory · Sep 22" / "Discarded by you · Sep 21". A memory a Keep or
 * Restore folded into one you already had says so instead of claiming a newer one replaced it; with
 * no reason (the replacing memory is gone, or a force was edited since) it claims neither.
 */
export function archiveMeta(m: Memory): string {
  const how =
    m.status === "rejected"
      ? "Discarded by you"
      : m.superseded_reason === "merged"
        ? "Merged into a memory you already had"
        : m.superseded_reason === "replaced"
          ? "Replaced by a newer memory"
          : "Another memory took its place";
  const when = activeWhen(archivedAt(m));
  return when ? `${how} · ${when}` : how;
}

/** The Archive's order: most recently replaced or discarded first. */
export function sortArchive(list: Memory[]): Memory[] {
  return [...list].sort((a, b) => archivedAt(b).localeCompare(archivedAt(a)));
}

/** MEM-27: Restore's toast; a restore that only confirms a memory you had says that. */
export function restoredMessage(res: Pick<PromoteResult, "action">): string {
  if (res.action === "promote_merged") return "Already known. Confirmed the existing memory.";
  if (res.action === "promote_supersede")
    return "Restored to Active. It replaces an older memory that said the opposite.";
  return "Restored to Active.";
}

/** MEM-31: Add memory's "How strongly" cards, strongest first; MUST is the default. */
export const FORCE_CHOICES: { polarity: MemoryPolarity; label: string; hint: string }[] = [
  { polarity: "require", label: "MUST", hint: "Always do this." },
  { polarity: "prefer", label: "SHOULD", hint: "Do this unless there’s a good reason." },
  { polarity: "allow", label: "MAY", hint: "Allowed, not required." },
  { polarity: "context", label: "CONTEXT", hint: "A background fact, no instruction." },
  { polarity: "avoid", label: "SHOULD NOT", hint: "Avoid unless there’s a good reason." },
  { polarity: "forbid", label: "MUST NOT", hint: "Never do this." },
];

/**
 * MEM-30: the repo "One repo" starts on — the one you ran on last, else the one with the most
 * memories, else the first. `null` when there is none (Add memory then applies to every repo).
 */
export function defaultRepo(repos: MemoryRepo[]): MemoryRepo | null {
  let best: MemoryRepo | null = null;
  for (const r of repos) {
    if (!best) best = r;
    else if ((r.last_run_at ?? "") !== (best.last_run_at ?? "")) {
      if ((r.last_run_at ?? "") > (best.last_run_at ?? "")) best = r;
    } else if (r.memory_count > best.memory_count) best = r;
  }
  return best;
}

/** MEM-34: the toast after Add memory; `repo` is the label of the one repo, `null` = every repo. */
export const addedMessage = (repo: string | null): string =>
  `Added. It applies to ${repo ?? "every repo"} right away.`;
