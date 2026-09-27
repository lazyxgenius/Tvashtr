/**
 * The Query domain node's pure helpers (DM-99…106): each domain's status line in the drawer's Domain
 * list and the agent checklist, the line under the picked domain, the default title and question a
 * pick fills in (DM-101), who reads the answer, the Last run's badge and meta, the card's badges,
 * and the agent's `tvashtr.domains` access value. No I/O.
 */
import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import type { DomainListItem, NoAnswerPolicy, QueryNodeRound } from "../../lib/api/domains";
import { titleCase } from "../../lib/text";
import { formatNumber } from "./domainFormat";
import { defaultQuestion, lowerName } from "./useInTeamsFormat";

export const IDEA = "{idea}";
export const DEFAULT_TITLE = "Query domain";

export const NO_ANSWER_OPTIONS: { value: NoAnswerPolicy; label: string }[] = [
  { value: "continue", label: "Keep going and say so in the spec" },
  { value: "stop", label: "Stop the run and tell me" },
];

const plural = (n: number, one: string, many: string) =>
  `${formatNumber(n)} ${n === 1 ? one : many}`;

/** A domain's status in a list: "Ready · 14 files", "Reading 4 of 6", "1 file needs attention". */
export function domainStatusLine(d: DomainListItem): string {
  const { files } = d;
  if (files.total === 0) return "No files yet";
  const of = `${formatNumber(files.ready)} of ${formatNumber(files.total)}`;
  switch (d.state) {
    case "reading":
      return `Reading ${of}`;
    case "rereading":
      return `Re-reading ${of}`;
    case "waiting_for_key":
      return `Waiting for ${/^[aeiou]/i.test(d.reading_model.provider) ? "an" : "a"} ${
        d.reading_model.provider || "API"
      } key`;
    case "needs_attention":
      return `${plural(files.needs_attention, "file needs", "files need")} attention`;
    default:
      return `Ready · ${plural(files.total, "file", "files")}`;
  }
}

/** A domain with no files can't answer, so the Domain list offers it disabled (DM-100). */
export function usableDomain(d: DomainListItem): boolean {
  return d.files.total > 0;
}

/** The line under the picked domain (DM-100): ready ones add the latest test score. */
export function pickedStatus(d: DomainListItem): { tone: "ok" | "warn"; text: string } {
  const line = domainStatusLine(d);
  if (d.state !== "ready" || d.files.total === 0) {
    return { tone: "warn", text: d.files.total === 0 ? "No files yet — can’t be used" : line };
  }
  const hit = d.quality.cases > 0 ? d.quality.hit_at_k : null;
  return {
    tone: "ok",
    text: hit === null ? line : `${line} · ${Math.round(hit * 100)}% found the right file`,
  };
}

/** "Look up support docs", "Look up Q3 filings" (DM-101, the backend's `step_title`). */
export function lookupTitle(name: string): string {
  return `Look up ${lowerName(name)}`;
}

/**
 * Picking a domain (DM-101): a title still at its default — or the previous pick's — becomes
 * "Look up <name>"; a question still `{idea}` — or the previous pick's — becomes the DM-94 one.
 */
export function afterPick(
  current: { title: string; prompt: string },
  previous: string | null,
  picked: string,
): { title: string; prompt: string } {
  const title = current.title.trim();
  const prompt = current.prompt.trim();
  const titleIsDefault =
    !title || title === DEFAULT_TITLE || (previous !== null && title === lookupTitle(previous));
  const promptIsDefault =
    !prompt || prompt === IDEA || (previous !== null && prompt === defaultQuestion(previous));
  return {
    title: titleIsDefault ? lookupTitle(picked) : current.title,
    prompt: promptIsDefault ? defaultQuestion(picked) : current.prompt,
  };
}

const ROLE_TITLES: Record<string, string> = {
  pm: "Product manager",
  architect: "Architect",
  engineer: "Engineer",
  reviewer: "Reviewer",
};

/** A node's display name: its own title, else its role's. */
export function nodeTitle(node: Pick<TeamGraphNode, "role_name" | "config">): string {
  const title = (node.config as { title?: unknown } | null)?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  return ROLE_TITLES[node.role_name] ?? titleCase(node.role_name.replace(/_/g, " "));
}

/** The agents the walk reaches after `nodeId`, in path order (loop-backs skipped). */
export function readersAfter(nodeId: string, nodes: TeamGraphNode[], edges: GraphEdge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set([nodeId]);
  const out: string[] = [];
  const queue = [nodeId];
  while (queue.length) {
    const at = queue.shift() as string;
    for (const e of edges) {
      if (e.source_node_id !== at || e.conditions?.loop_limit != null) continue;
      if (seen.has(e.target_node_id)) continue;
      seen.add(e.target_node_id);
      queue.push(e.target_node_id);
      const n = byId.get(e.target_node_id);
      if (n && (n.kind === "agent" || n.kind === "completion")) out.push(nodeTitle(n));
    }
  }
  return out;
}

/** "Adds the answer and its sources to the spec, so the Writer and Reviewer read them." */
export function passHelper(readers: string[]): string {
  const who =
    readers.length === 0
      ? "the next agents"
      : readers.length === 1
        ? `the ${readers[0]}`
        : `the ${readers.slice(0, -1).join(", ")} and ${readers[readers.length - 1]}`;
  return `Adds the answer and its sources to the spec, so ${who} ${
    readers.length === 1 ? "reads" : "read"
  } them.`;
}

/** The drawer's subtitle: the node's title, " · run 14" once it has run (DM-103). */
export function drawerSubtitle(title: string, runNumber: number | null | undefined): string {
  return runNumber ? `${title} · run ${runNumber}` : title;
}

export type RoundBadge = { tone: "ok" | "warn" | "danger"; label: string };

/** A round's badge (DM-103): Answered / No answer / Failed (`null` while it runs). */
export function roundBadge(
  r: Pick<QueryNodeRound, "status" | "outcome" | "covered">,
): RoundBadge | null {
  if (r.outcome === "no_answer" || r.covered === false) return { tone: "warn", label: "No answer" };
  if (r.status === "failed") return { tone: "danger", label: "Failed" };
  if (r.outcome === "answered") return { tone: "ok", label: "Answered" };
  return null;
}

/** "1.9 s · $0.0012" (either part left out when unknown). */
export function roundMeta(r: Pick<QueryNodeRound, "latency_ms" | "cost_usd">): string {
  const parts: string[] = [];
  if (r.latency_ms !== null) parts.push(`${(r.latency_ms / 1000).toFixed(1)} s`);
  if (r.cost_usd !== null) parts.push(`$${r.cost_usd.toFixed(4)}`);
  return parts.join(" · ");
}

/** The round's last line (DM-103): where the answer went, or why the round failed. */
export function specLine(r: Pick<QueryNodeRound, "status" | "spec_section" | "detail">): {
  tone: "ok" | "muted" | "danger";
  text: string;
} {
  if (r.status === "failed") return { tone: "danger", text: r.detail || "The lookup failed." };
  if (r.spec_section) {
    return { tone: "ok", text: `Added to the spec · section “${r.spec_section}”` };
  }
  return { tone: "muted", text: "Not added to the spec" };
}

/** The card's badges (DM-99): what blocks a run first, then how the last run went. */
export function cardBadges({
  hasDomain,
  errorCode,
  lastOutcome,
  failed,
}: {
  hasDomain: boolean;
  errorCode?: string | null;
  lastOutcome?: string | null;
  failed?: boolean;
}): RoundBadge[] {
  const out: RoundBadge[] = [];
  if (!hasDomain) out.push({ tone: "warn", label: "Needs a domain" });
  if (errorCode === "no_exit") out.push({ tone: "warn", label: "No way out" });
  if (out.length) return out;
  if (lastOutcome === "no_answer") out.push({ tone: "warn", label: "No answer" });
  else if (failed) out.push({ tone: "danger", label: "Failed" });
  else if (lastOutcome === "answered") out.push({ tone: "ok", label: "Answered" });
  return out;
}

// ---- An agent's domains (`tool_config.tvashtr.domains`, DM-105) ----

/** `true` = every domain (the round-1 switch); a list = exactly those. */
export type DomainAccess = true | string[];

export function accessIncludes(access: DomainAccess | null, id: string): boolean {
  return access === true || (Array.isArray(access) && access.includes(id));
}

/** Tick or untick one domain. From "every domain", unticking keeps all the others (as a list). */
export function toggleAccess(
  access: DomainAccess | null,
  id: string,
  on: boolean,
  allIds: string[],
): string[] {
  const current = access === true ? allIds : (access ?? []);
  const next = current.filter((x) => x !== id);
  return on ? [...next, id] : next;
}

/** The agent's `tool_config.tvashtr.domains` (`null` when it has none). */
export function accessOf(toolConfig: unknown): DomainAccess | null {
  const meta = (toolConfig as { tvashtr?: { domains?: unknown } } | null)?.tvashtr;
  const v = meta?.domains;
  if (v === true) return true;
  if (Array.isArray(v)) {
    const ids = v.filter((x): x is string => typeof x === "string");
    return ids.length ? ids : null;
  }
  return null;
}

/** The agent card's line (DM-99): "Can search Support docs", "+2" for more. */
export function accessLine(
  access: DomainAccess | null,
  domains: { id: string; name: string }[] | undefined,
): string | null {
  if (!access || !domains) return null;
  const names = domains.filter((d) => accessIncludes(access, d.id)).map((d) => d.name);
  if (names.length === 0) return null;
  return `Can search ${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ""}`;
}
