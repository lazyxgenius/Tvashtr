// F5 group G10 — the Memory tab: Web-Memory, Panel-MemoryEmpty, Flow-Memory-1..4, each as a website
// and a Desktop render.
import {
  NODES,
  drawerReady,
  isolateDrawer,
  panelRoutes,
} from "./panel-fixtures.mjs";
import { aboveTitleStrip, at, seenDisclosure } from "./panel-skills.mjs";

// The design's Reviewer notes: one waiting, two on lazyxgenius/trade_mcp (the first pinned).
const note = (id, content, round, day, extra = {}) => ({
  id,
  content,
  polarity: "require",
  repo_key: "lazyxgenius/trade_mcp",
  repo_label: "lazyxgenius/trade_mcp",
  node_id: "n-rev",
  tier: "node",
  pinned: false,
  status: "active",
  confirmation_count: 1,
  source_run_id: "r-rsi",
  created_at: `2026-09-${day}T12:00:00Z`,
  updated_at: `2026-09-${day}T12:00:00Z`,
  source: { kind: "run", run_id: "r-rsi", round },
  source_iteration: round,
  ...extra,
});
const NOTES = () => [
  note(
    "m-new",
    "Check web/lib/engine-facts.ts whenever the Python indicator list changes; the two must stay in sync.",
    3,
    "25",
    { status: "pending_review" },
  ),
  note(
    "m-1",
    "Tests live under tests/; run them with python -m pytest -q -p no:cacheprovider.",
    2,
    "22",
    { pinned: true },
  ),
  note(
    "m-2",
    "Approve only when the registry test and the TypeScript mirror list the same indicators.",
    3,
    "24",
  ),
];

/** A fresh set of routes per render: Keep changes the notes the tab reloads. */
const memoryRoutes = (rev, notes) => () => {
  const rows = notes();
  const byStatus = (req) => {
    const status = new URL(req.url()).searchParams.get("status");
    // Oldest first, as the server answers.
    const memories = rows
      .filter((r) => r.status === status)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { json: { memories } };
  };
  return panelRoutes({
    nodes: Object.values({ ...NODES, rev }),
    over: {
      "GET /api/memories": byStatus,
      "POST /api/memories/m-new/promote": () => {
        rows[0].status = "active";
        return { json: { ...rows[0], action: "promote" } };
      },
    },
  });
};
const FULL = memoryRoutes(NODES.rev, NOTES);
const EMPTY = memoryRoutes(
  { ...NODES.rev, skills: null, tool_config: null },
  () => [],
);

const pair = (name, base, makeRoutes, desktopFrame) => [
  { name: `${name}-web`, ...base, routes: makeRoutes() },
  {
    name: `${name}-desktop`,
    ...base,
    routes: makeRoutes(),
    desktop: true,
    init: seenDisclosure,
    steps: async (p) => {
      await desktopFrame?.(p);
      await base.steps(p);
    },
  },
];

const listed = (page) =>
  page
    .getByText("No notes yet")
    .or(page.getByText("Tests live under tests/"))
    .first()
    .waitFor();

/** The drawer alone, on the Memory tab, once the notes have loaded. */
const drawerAlone = (steps) => async (page) => {
  await drawerReady(page);
  await isolateDrawer(page);
  await listed(page);
  await steps?.(page);
  await page.mouse.move(0, 0);
};

const row = (page, text) =>
  page.getByRole("listitem").filter({ hasText: text });
const drawer = { width: 384, height: 800, path: at("memory") };

export default [
  ...pair(
    "Web-Memory",
    {
      path: at("memory"),
      steps: async (p) => {
        await drawerReady(p);
        await listed(p);
      },
    },
    FULL,
    aboveTitleStrip,
  ),
  ...pair(
    "Panel-MemoryEmpty",
    { ...drawer, height: 760, steps: drawerAlone() },
    EMPTY,
  ),
  ...pair("Flow-Memory-1", { ...drawer, steps: drawerAlone() }, FULL),
  ...pair(
    "Flow-Memory-2",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await p.getByRole("button", { name: "Keep" }).click();
        await p.getByText("Kept. It applies to future runs.").waitFor();
        await p.getByText(/trade_mcp · 3/i).waitFor();
      }),
    },
    FULL,
  ),
  ...pair(
    "Flow-Memory-3",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await row(p, "Tests live under tests/")
          .getByRole("button", { name: "Edit" })
          .click();
        await p.evaluate(() => document.activeElement?.blur());
      }),
    },
    FULL,
  ),
  ...pair(
    "Flow-Memory-4",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await row(p, "Tests live under tests/")
          .getByRole("button", { name: "Delete" })
          .click();
        await p
          .getByRole("alertdialog", { name: "Delete this note?" })
          .waitFor();
      }),
    },
    FULL,
  ),
];
