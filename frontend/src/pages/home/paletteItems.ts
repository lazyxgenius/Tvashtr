/**
 * What the ⌘K palette lists (TEAMS-50–54): pure functions from the loaded data and the query to
 * grouped options, so the grouping and matching are testable without the dialog.
 */
import type { DomainSummary, TeamSummary } from "../../lib/api";
import type { InboxBrief, RunBrief } from "../../lib/api/homeSearch";
import { formatRelativeTime } from "../../lib/time";
import { runCount, teamBadge } from "./teamFormat";

export type PaletteIcon =
  | "approval"
  | "failed"
  | "run"
  | "plus"
  | "key"
  | "toolkit"
  | "team"
  | "history"
  | "domain"
  | "engines";

export type PaletteTarget =
  | { kind: "team"; teamId: string }
  | { kind: "run"; teamId: string; runId: string }
  | { kind: "new-run"; teamId?: string }
  | { kind: "new-team" }
  | { kind: "api-keys" }
  | { kind: "toolkit" }
  | { kind: "engines" }
  | { kind: "domains"; domainId?: string };

export interface PaletteOption {
  id: string;
  icon: PaletteIcon;
  label: string;
  hint?: string;
  kbd?: string;
  target: PaletteTarget;
}

export interface PaletteGroup {
  label: string;
  options: PaletteOption[];
}

interface StaticAction extends PaletteOption {
  /** Shown with an empty query (the design's four); the rest appear only when searched. */
  always: boolean;
}

const STATIC_ACTIONS: StaticAction[] = [
  {
    id: "act-new-run",
    icon: "run",
    label: "Start a run",
    kbd: "N",
    target: { kind: "new-run" },
    always: true,
  },
  {
    id: "act-new-team",
    icon: "plus",
    label: "New team",
    kbd: "T",
    target: { kind: "new-team" },
    always: true,
  },
  {
    id: "act-api-key",
    icon: "key",
    label: "Add an API key",
    hint: "Engines",
    target: { kind: "api-keys" },
    always: true,
  },
  {
    id: "act-toolkit",
    icon: "toolkit",
    label: "Open Toolkit",
    target: { kind: "toolkit" },
    always: true,
  },
  {
    id: "act-engines",
    icon: "engines",
    label: "Open Engines",
    target: { kind: "engines" },
    always: false,
  },
  {
    id: "act-domains",
    icon: "domain",
    label: "Open Domains",
    target: { kind: "domains" },
    always: false,
  },
];

function asOption(a: StaticAction): PaletteOption {
  return { id: a.id, icon: a.icon, label: a.label, hint: a.hint, kbd: a.kbd, target: a.target };
}

const APPROVAL_TITLES: Record<string, string> = {
  prd_approval: "Approve the spec",
  ship_approval: "Approve the ship",
  review_escalation: "Answer the escalation",
  budget_approval: "Approve more budget",
};

/** A Needs-you item as a palette row; only items that open a run are offered here. */
function needsYouOption(item: InboxBrief): PaletteOption | null {
  const teamId = item.team?.id;
  const runId = item.run?.id;
  if (!teamId || !runId) return null;
  const target: PaletteTarget = { kind: "run", teamId, runId };
  const hint = item.team?.name;
  if (item.kind === "approval") {
    const title = (item.task && APPROVAL_TITLES[item.task.kind]) ?? item.task?.title ?? "Approve";
    return { id: `ny-${item.key}`, icon: "approval", label: title, hint, target };
  }
  if (item.kind === "run_failed") {
    return { id: `ny-${item.key}`, icon: "failed", label: "Run failed", hint, target };
  }
  if (item.kind === "nudge") {
    return {
      id: `ny-${item.key}`,
      icon: "approval",
      label: item.task?.title ?? "A run needs a look",
      hint,
      target,
    };
  }
  return null;
}

const RANK: Record<string, number> = { approval: 0, run_failed: 1, nudge: 2 };

export function buildPaletteGroups(input: {
  query: string;
  teams: TeamSummary[];
  runs: RunBrief[];
  domains: DomainSummary[];
  inbox: InboxBrief[];
}): PaletteGroup[] {
  const q = input.query.trim().toLowerCase();
  const groups: PaletteGroup[] = [];

  if (!q) {
    const needs = [...input.inbox]
      .sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9))
      .map(needsYouOption)
      .filter((o): o is PaletteOption => o !== null)
      .slice(0, 4);
    if (needs.length) groups.push({ label: "Needs you", options: needs });
    groups.push({
      label: "Actions",
      options: STATIC_ACTIONS.filter((a) => a.always).map(asOption),
    });
    return groups;
  }

  const teams = input.teams.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 5);
  if (teams.length) {
    groups.push({
      label: "Teams",
      options: teams.map((t) => {
        const n = runCount(t);
        return {
          id: `team-${t.team_graph_id}`,
          icon: "team",
          label: t.name,
          hint: `${n} run${n === 1 ? "" : "s"} · ${teamBadge(t).label}`,
          target: { kind: "team", teamId: t.team_graph_id },
        };
      }),
    });
  }

  const runs = input.runs
    .filter((r) => r.team && `${r.idea} ${r.team.name}`.toLowerCase().includes(q))
    .slice(0, 5);
  if (runs.length) {
    groups.push({
      label: "Runs",
      options: runs.map((r) => ({
        id: `run-${r.run_id}`,
        icon: "history",
        label: r.idea || "Untitled run",
        hint: `${r.team?.name ?? ""} · ${formatRelativeTime(r.updated_at ?? r.created_at)}`,
        target: { kind: "run", teamId: r.team?.id ?? "", runId: r.run_id },
      })),
    });
  }

  const actions: PaletteOption[] = [
    ...teams.slice(0, 2).map(
      (t): PaletteOption => ({
        id: `act-run-${t.team_graph_id}`,
        icon: "run",
        label: `Start a run on ${t.name}`,
        target: { kind: "new-run", teamId: t.team_graph_id },
      }),
    ),
    ...input.domains
      .filter((d) => d.name.toLowerCase().includes(q))
      .slice(0, 3)
      .map(
        (d): PaletteOption => ({
          id: `domain-${d.domain_id}`,
          icon: "domain",
          label: `Open the ${d.name} domain`,
          hint: "Domains",
          target: { kind: "domains", domainId: d.domain_id },
        }),
      ),
    ...STATIC_ACTIONS.filter((a) => a.label.toLowerCase().includes(q)).map(asOption),
  ];
  if (actions.length) groups.push({ label: "Actions", options: actions });
  return groups;
}
