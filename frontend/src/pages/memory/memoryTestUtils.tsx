/* eslint-disable react-refresh/only-export-components -- test helpers, never hot-reloaded */
/** Shared fixtures and the mounted page for the Toolkit › Memory tests (the design's sample data). */
import { render } from "@testing-library/react";

import { ToastProvider } from "../../design-system/components";
import type { Memory } from "../../lib/api/memory";
import { useNav } from "../../lib/nav";
import { useNavBadges } from "../../lib/workspaceStatus";
import { MemoryPage } from "./MemoryPage";

export const NOW = Date.parse("2026-09-25T12:00:00Z");

const REVIEWER = {
  node_id: "n-rev",
  role_name: "reviewer",
  title: null,
  team_id: "t1",
  team_name: "Indicator sprint team",
};

const RSI_RUN = {
  kind: "run" as const,
  run_id: "r-rsi",
  run_title: "Add an RSI indicator",
  run_status: "completed",
  run_succeeded: true,
  round: 3,
  agent_role: "reviewer",
  team_name: "Indicator sprint team",
  node_id: "n-rev",
};

export const memory = (over: Partial<Memory> = {}): Memory => ({
  id: "m-x",
  content: "A memory.",
  polarity: "context",
  repo_key: "lazyxgenius/trade_mcp",
  repo_label: "lazyxgenius/trade_mcp",
  node_id: null,
  tier: "repo",
  pinned: false,
  status: "pending_review",
  confirmation_count: 1,
  source_run_id: "r-rsi",
  source_node_id: "n-rev",
  superseded_by: null,
  valid_from: null,
  invalid_at: null,
  edited_at: null,
  created_at: new Date(NOW - 31 * 60_000).toISOString(),
  updated_at: new Date(NOW - 31 * 60_000).toISOString(),
  agent: null,
  source: RSI_RUN,
  ...over,
});

/** Toolkit-MemoryInbox row 1: the Reviewer's SHOULD, learned 31 minutes ago. */
export const MEM_SHOULD = memory({
  id: "m-should",
  content:
    "Check web/lib/engine-facts.ts whenever the Python indicator list changes; the two must stay in sync.",
  polarity: "prefer",
  node_id: "n-rev",
  tier: "node",
  agent: REVIEWER,
});

/** Row 2: a failed run's caution about generated files, on the repo. */
export const MEM_MUST_NOT = memory({
  id: "m-mustnot",
  content: "Don’t edit files under web/generated/; they are rebuilt from the Python source.",
  polarity: "forbid",
  created_at: "2026-09-23T12:00:00Z",
  updated_at: "2026-09-23T12:00:00Z",
  source: {
    ...RSI_RUN,
    run_id: "r-fail",
    run_title: "Wire the indicator page",
    run_status: "failed",
    run_succeeded: false,
    round: 2,
  },
});

function Badges() {
  const b = useNavBadges();
  return <output aria-label="memory badge">{b.memoryInbox ?? ""}</output>;
}

/** The page as Workspace mounts it: the address picks the tab. */
function Harness() {
  const { route } = useNav();
  return (
    <>
      {route.page === "memory" ? <MemoryPage tab={route.tab} /> : <p>elsewhere</p>}
      <Badges />
    </>
  );
}

export function renderAt(hash: string) {
  window.location.hash = hash;
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}
