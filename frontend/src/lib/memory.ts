// M-memory S5 — pure, unit-tested helpers shared by the memory views (Toolkit › Memory, the agent
// drawer's Memory section, a run's memories): the polarity/tier presentation vocabulary, the repos
// among a list of facts, and the "Used this run" resolution. No JSX here, so components import from
// it without tripping react-refresh.

import type { MemoryPolarity, MemoryTier, NodeMemoryRow } from "./api";

// The 6 directive forces → their RFC-2119 badge label + the CSS modifier suffix (`.tv-mem-badge--X`).
export const POLARITY_META: Record<MemoryPolarity, { label: string; cls: string }> = {
  require: { label: "MUST", cls: "require" },
  prefer: { label: "SHOULD", cls: "prefer" },
  allow: { label: "MAY", cls: "allow" },
  context: { label: "CONTEXT", cls: "context" },
  avoid: { label: "SHOULD NOT", cls: "avoid" },
  forbid: { label: "MUST NOT", cls: "forbid" },
};

// Strongest → weakest, positive before negative — the order the authoring polarity picker offers.
export const POLARITY_ORDER: MemoryPolarity[] = [
  "require",
  "prefer",
  "allow",
  "context",
  "avoid",
  "forbid",
];

export const TIER_LABEL: Record<MemoryTier, string> = {
  account: "Account",
  repo: "This repo",
  node: "Per-node",
};

export interface RepoOption {
  repo_key: string;
  count: number;
}

// The distinct repos among repo/node-tier rows (account-tier rows have no repo_key and are skipped),
// each with its fact count, most facts first (ties keep first-seen order). Drives the repo selector.
export function reposOf(rows: NodeMemoryRow[]): RepoOption[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.repo_key === null) continue;
    counts.set(r.repo_key, (counts.get(r.repo_key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([repo_key, count]) => ({ repo_key, count }))
    .sort((a, b) => b.count - a.count);
}

// ===== M-memory S5b — the run-inspector "Used this run" resolution ==============================
// A node's per-round injected memory is stored as {id, polarity} stubs on each round's
// context_manifest.memory. These pure helpers dedupe those stubs, resolve them against the store,
// and order them by directive force so the tab reads strongest-first.

// The sort rank of a polarity force = its POLARITY_ORDER index; an unknown/legacy force sorts last.
export function polarityRank(polarity: string): number {
  const i = POLARITY_ORDER.indexOf(polarity as MemoryPolarity);
  return i === -1 ? POLARITY_ORDER.length : i;
}

// One fact a node saw injected this run: the polarity + id, resolved to the stored row — or `null`
// when the fact has since been deleted (the view then shows "(no longer stored)" with just polarity).
export interface UsedFact {
  id: string;
  polarity: MemoryPolarity;
  row: NodeMemoryRow | null;
}

// Resolve a node's injected-memory refs (gathered across every round, in round order) into
// displayable facts: dedupe by id (a fact injected in several rounds is ONE fact — first occurrence
// wins), resolve each against a store id→row map, and return them ordered by directive force (a
// resolved row sorts by its CURRENT polarity; an unresolved ref by its injected polarity).
export function usedFacts(
  refs: { id: string; polarity: string }[],
  byId: Map<string, NodeMemoryRow>,
): UsedFact[] {
  const seen = new Set<string>();
  const out: UsedFact[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push({
      id: ref.id,
      polarity: ref.polarity as MemoryPolarity,
      row: byId.get(ref.id) ?? null,
    });
  }
  return out.sort(
    (a, b) =>
      polarityRank(a.row?.polarity ?? a.polarity) - polarityRank(b.row?.polarity ?? b.polarity),
  );
}
