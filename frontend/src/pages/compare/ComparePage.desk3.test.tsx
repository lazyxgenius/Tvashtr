import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Compare, CompareSide, CompareStart } from "../../lib/api/compare";
import { useNav } from "../../lib/nav";
import { ComparePage } from "./ComparePage";

// M-desk-3 (G2; Quality › Set-ResultsDesktop): a Desktop set compare whose lanes shared a
// subscription took turns, so its results subtitle says so instead of "run side by side". Only
// that part changes; the website keeps today's words.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const side = (label: "A" | "B", version: number): CompareSide => ({
  label,
  version,
  run_id: null,
  number: null,
  status: "finished",
  elapsed_s: 2340,
  cost_usd: 0,
  strip: [],
  current: null,
  lines: [],
  gate_task_id: null,
});
const START: CompareStart = {
  team: { id: "team-1", name: "Indicator sprint team" },
  versions: [],
  defaults: { a: 6, b: 7 },
  changes: 0,
  target: null,
  estimate: null,
  latest: null,
};
const SET_RESULTS = (count: number, shared?: boolean): Compare => ({
  id: "cmp-set",
  team_id: "team-1",
  task: "Indicators",
  auto_approve: true,
  status: "finished",
  elapsed_s: 2340,
  cost_usd: 0,
  created_at: ago(45),
  ended_at: ago(6),
  waiting: null,
  sides: [side("A", 6), side("B", 7)],
  set: { id: "set-ind", name: "Indicators", count },
  started: 2 * count,
  runs_waiting: 0,
  items: [],
  results: {
    headline: "v7 did better on this set",
    rows: [],
    current_version: 7,
    restore: 6,
    cards: [],
    ...(shared ? { shared } : {}),
  },
});

let compare: Compare;
beforeEach(() => {
  compare = SET_RESULTS(5);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body =
        url === "/api/compares/cmp-set"
          ? compare
          : url.split("?")[0] === "/api/teams/team-1/compare"
            ? START
            : url === "/api/teams/team-1/task-sets"
              ? { sets: [] }
              : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function Routed() {
  const { route } = useNav();
  if (route.page !== "compare") return <div>ELSEWHERE</div>;
  return <ComparePage teamId={route.teamId} compareId={route.compareId} tab={route.tab} />;
}
const subtitle = async () => {
  window.location.hash = "#/teams/team-1/compare/cmp-set";
  render(<Routed />);
  await screen.findByRole("heading", { name: "v6 and v7 on Indicators" });
  return document.querySelector(".cmp-res__sub")?.textContent ?? "";
};

describe("Set-ResultsDesktop: the subtitle", () => {
  it("lanes that took turns on the Desktop say so", async () => {
    compare = SET_RESULTS(5, true);
    const sub = await subtitle();
    expect(sub.startsWith("5 tasks · taking turns on your Desktop · finished ")).toBe(true);
    expect(sub.endsWith(" · $0.00 in all")).toBe(true);
    expect(sub).not.toContain("side by side");
  });

  it("one task reads as one", async () => {
    compare = SET_RESULTS(1, true);
    expect((await subtitle()).startsWith("1 task · taking turns on your Desktop · ")).toBe(true);
  });

  it("the website's subtitle is today's", async () => {
    const sub = await subtitle();
    expect(sub.startsWith("5 tasks · run side by side · finished ")).toBe(true);
    expect(sub.endsWith(" · $0.00 in all")).toBe(true);
  });
});
