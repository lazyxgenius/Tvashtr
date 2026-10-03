import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Compare, CompareStart } from "../../lib/api/compare";
import { useNav } from "../../lib/nav";
import { ComparePage } from "./ComparePage";

// M-desk-routes (D1, D3; Quality › Cmp-ResultsDesktop): a compare started in Tvashtr Desktop
// runs both versions on the owner's subscriptions; its results count work time and say so.

const WORK_LINE =
  "On your Desktop, both versions share your subscription and take turns, so this counts working time only.";
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const START: CompareStart = {
  team: { id: "team-1", name: "Indicator sprint team" },
  versions: [
    { number: 7, when: ago(0), runs: 1, summary: "Reviewer: stricter", current: true },
    { number: 6, when: ago(1440), runs: 3, summary: "Spec gate", current: false },
  ],
  defaults: { a: 6, b: 7 },
  changes: 0,
  target: null,
  estimate: null,
  latest: null,
};
const side = (label: "A" | "B", version: number) => ({
  label,
  version,
  run_id: `run-${label.toLowerCase()}`,
  number: label === "A" ? 12 : 13,
  status: "finished" as const,
  elapsed_s: 1200,
  cost_usd: 0,
  strip: [],
  current: { label: "Approved", text: "in round 2" },
  lines: [],
  gate_task_id: null,
});
const RESULTS: Compare = {
  id: "cmp-1",
  team_id: "team-1",
  task: "Add an RSI indicator",
  auto_approve: true,
  status: "finished",
  elapsed_s: 1200,
  cost_usd: 0,
  created_at: ago(20),
  ended_at: ago(2),
  waiting: null,
  sides: [side("A", 6), side("B", 7)],
  results: {
    headline: "v7 did better on this task",
    rows: [
      {
        key: "time",
        label: "Work time",
        a: "9m 40s",
        b: "6m 05s",
        better: "b",
        difference: "−4m",
      },
    ],
    current_version: 7,
    restore: null,
    note: WORK_LINE,
  },
};

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
let compare: Compare;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  compare = RESULTS;
  fetchMock = vi.fn<Fetch>((url, init) => {
    const method = init?.method ?? "GET";
    if (url === "/api/teams/team-1/compare" && method === "POST")
      return reply({ id: "cmp-9", status: "running" }, 201);
    if (url === "/api/teams/team-1/compare") return reply(START);
    if (url.startsWith("/api/recent-tasks")) return reply({ tasks: [] });
    if (/^\/api\/compares\/cmp-\d+$/.test(url)) return reply(compare);
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
  delete document.documentElement.dataset.tvashtrDesktop;
});

function Routed() {
  const { route } = useNav();
  if (route.page !== "compare") return <div>ELSEWHERE</div>;
  return <ComparePage teamId={route.teamId} compareId={route.compareId} tab={route.tab} />;
}
const open = (hash: string) => {
  window.location.hash = hash;
  return render(<Routed />);
};
const posted = () =>
  fetchMock.mock.calls
    .filter(([u, init]) => u === "/api/teams/team-1/compare" && init?.method === "POST")
    .map(([, init]) => JSON.parse(init?.body as string) as Record<string, unknown>);

async function startOne() {
  open("#/teams/team-1/compare");
  const task = await screen.findByRole("textbox", { name: "Task" });
  fireEvent.change(task, { target: { value: "Add an RSI indicator" } });
  fireEvent.click(screen.getByRole("button", { name: "Start compare" }));
  await waitFor(() => expect(posted()).toHaveLength(1));
}

describe("Compare on the Desktop", () => {
  it("Start compare posts desktop_target in Tvashtr Desktop", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    await startOne();
    expect(posted()[0]).toEqual({
      a: 6,
      b: 7,
      task: "Add an RSI indicator",
      auto_approve: true,
      desktop_target: true,
    });
  });

  it("the website posts no desktop_target", async () => {
    await startOne();
    expect(posted()[0]).not.toHaveProperty("desktop_target");
  });

  it("Cmp-ResultsDesktop: the Work time row and the line under the table", async () => {
    open("#/teams/team-1/compare/cmp-1");
    expect(await screen.findByRole("rowheader", { name: "Work time" })).toBeInTheDocument();
    expect(screen.getByText(WORK_LINE)).toBeInTheDocument();
  });

  it("a website compare's results have no such line", async () => {
    compare = { ...RESULTS, results: { ...RESULTS.results!, note: undefined } };
    open("#/teams/team-1/compare/cmp-1");
    await screen.findByRole("heading", { name: "v7 did better on this task" });
    expect(screen.queryByText(/counts working time only/)).toBeNull();
  });
});
