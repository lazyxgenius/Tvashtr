/**
 * Home's own endpoints (B-RUNS contract, `docs/superpowers/plans/api/runs.md`): the cross-run
 * "Needs you" inbox with dismiss / snooze / undo, the week + month spend, and the parts of the
 * public `/api/config` Home reads (provider directory, default budget, GitHub links).
 */
import { rewriteGithubInstallUrlForDesktop } from "../api";
import type { RunFailure, RunTarget } from "./runs";
import { apiRequest } from "./runs";

export type InboxSurface = "website" | "desktop";

interface InboxTeam {
  id: string;
  name: string;
}

interface InboxRunRef {
  id: string;
  idea: string;
  status: string;
  spent_usd?: number;
  budget_cap_usd?: number | null;
}

export interface InboxApproval {
  key: string;
  kind: "approval";
  since: string;
  team: InboxTeam | null;
  run: InboxRunRef;
  task: {
    id: number;
    kind: string;
    title: string;
    blocking: boolean;
    gate_node_id: string | null;
    gate_role: string;
    next_role: string | null;
  };
  document_id: string | null;
}

export interface InboxNudge {
  key: string;
  kind: "nudge";
  since: string;
  team: InboxTeam | null;
  run: InboxRunRef;
  task: { id: number; kind: string; title: string };
}

export interface InboxRunFailed {
  key: string;
  kind: "run_failed";
  since: string;
  team: InboxTeam | null;
  run: InboxRunRef & {
    created_at?: string;
    ended_at?: string;
    target?: RunTarget | null;
    github_repo?: string | null;
    base_ref?: string | null;
    subpath?: string | null;
    desktop_target?: boolean;
    library_team_id?: string | null;
  };
  failure: RunFailure | null;
}

export interface InboxSetupGap {
  key: string;
  kind: "setup_gap";
  since: string;
  team: InboxTeam;
  target: InboxSurface;
  missing_providers: string[];
  missing_nodes: string[];
  desktop_covers: string[];
}

export interface InboxSetupGapsFolded {
  key: string;
  kind: "setup_gaps_folded";
  since: string;
  count: number;
  teams: { id: string; name: string; target: InboxSurface; missing_providers: string[] }[];
}

export interface InboxMemories {
  key: string;
  kind: "memories";
  since: string;
  count: number;
  learned_by: string[];
  repos: string[];
}

export type InboxItem =
  | InboxApproval
  | InboxNudge
  | InboxRunFailed
  | InboxSetupGap
  | InboxSetupGapsFolded
  | InboxMemories;

export interface Inbox {
  count: number;
  items: InboxItem[];
}

const KNOWN_KINDS = new Set([
  "approval",
  "nudge",
  "run_failed",
  "setup_gap",
  "setup_gaps_folded",
  "memories",
]);

let inboxInFlight: { surface: InboxSurface; promise: Promise<Inbox> } | null = null;

/**
 * GET /api/inbox — oldest first. Unknown kinds (a newer server) are skipped, never rendered.
 * Callers that ask while a request is already on its way share it: Home, the nav badge and ⌘K
 * all read the inbox, and on Home's first paint they'd otherwise each fetch it.
 */
export function getInbox(surface: InboxSurface = "website"): Promise<Inbox> {
  if (inboxInFlight && inboxInFlight.surface === surface) return inboxInFlight.promise;
  const promise = apiRequest<Partial<Inbox>>(
    "GET",
    `/api/inbox${surface === "desktop" ? "?surface=desktop" : ""}`,
  )
    .then((data) => {
      const items = (data.items ?? []).filter((i) => KNOWN_KINDS.has(i.kind));
      return { count: items.length, items };
    })
    .finally(() => {
      if (inboxInFlight?.promise === promise) inboxInFlight = null;
    });
  inboxInFlight = { surface, promise };
  return promise;
}

/** Dismiss or snooze an item (a snooze needs `until`, an absolute future time). */
export async function dismissInboxItem(
  key: string,
  action: "dismiss" | "snooze",
  opts: { until?: string; surface?: InboxSurface } = {},
): Promise<void> {
  const body: Record<string, string> = { key, action };
  if (opts.until) body.until = opts.until;
  if (opts.surface) body.surface = opts.surface;
  await apiRequest("POST", "/api/inbox/dismissals", body);
}

/** Undo a dismiss / snooze (204, idempotent). */
export async function undoInboxDismissal(key: string): Promise<void> {
  await apiRequest("DELETE", `/api/inbox/dismissals/${encodeURIComponent(key)}`);
}

// ---- Spend ----

export interface Spend {
  tz: string;
  month: { label: string; start: string; total_usd: number };
  week: { start: string; total_usd: number };
  by_team: { team_id: string; name: string; total_usd: number }[];
  other_usd: number;
  default_run_budget_usd: number | null;
}

/** The browser's IANA time zone (weeks start Monday in that zone). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function isSpend(body: unknown): body is Spend {
  const s = body as Partial<Spend> | null;
  return (
    typeof s?.month?.total_usd === "number" &&
    typeof s.week?.total_usd === "number" &&
    Array.isArray(s.by_team)
  );
}

/** Spend for Home. An answer in any other shape counts as a failed load (the header leaves the
 * figure out, the card shows its error) rather than crashing the page. */
export async function getSpend(tz: string = browserTimeZone()): Promise<Spend> {
  const body = await apiRequest<unknown>("GET", `/api/spend?tz=${encodeURIComponent(tz)}`);
  if (!isSpend(body)) throw new Error("Unexpected answer from /api/spend");
  return body;
}

// ---- The parts of /api/config Home reads ----

export interface ProviderDirectoryEntry {
  provider: string;
  monogram: string;
  name: string;
  label: string;
  /** `null` when the provider declares no model (nvidia_nim since 2026-09-26). */
  example_model: string | null;
  subscription: string | null;
  embeddings: boolean;
  hint: string | null;
}

export interface HomeConfig {
  hosted_mode: boolean;
  github_install_url: string;
  github_manage_url: string;
  provider_directory: ProviderDirectoryEntry[];
  default_run_budget_usd: number | null;
}

let configPromise: Promise<HomeConfig> | null = null;

/** The public config (cached for the session; a failed fetch is retried next time). */
export function getHomeConfig(): Promise<HomeConfig> {
  if (!configPromise) {
    configPromise = apiRequest<Partial<HomeConfig>>("GET", "/api/config")
      .then((c) => ({
        hosted_mode: c.hosted_mode === true,
        github_install_url: rewriteGithubInstallUrlForDesktop(c.github_install_url ?? ""),
        github_manage_url: c.github_manage_url ?? "",
        provider_directory: Array.isArray(c.provider_directory) ? c.provider_directory : [],
        default_run_budget_usd:
          typeof c.default_run_budget_usd === "number" ? c.default_run_budget_usd : null,
      }))
      .catch((e: unknown) => {
        configPromise = null;
        throw e;
      });
  }
  return configPromise;
}

/** Test seam. */
export function __resetHomeConfigForTests(): void {
  configPromise = null;
  inboxInFlight = null;
}
