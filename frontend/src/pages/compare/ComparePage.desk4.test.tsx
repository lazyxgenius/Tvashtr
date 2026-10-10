import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Compare, CompareSide, CompareStart, SetCell, TaskSet } from "../../lib/api/compare";
import { useNav } from "../../lib/nav";
import { ComparePage } from "./ComparePage";
import { TaskSetDialog } from "./TaskSetDialog";

// M-desk-4 (Quality › Set-RunningDesktop, Cmp-RunningDesktop, Set-EditDesktop): on the Desktop a
// compare's money names the subscriptions its lanes ran on (H1), a set cell waiting for the other
// lane's job shows the waiting line (H4), and Edit task set gives the turn-taking minutes (D15).
// The website keeps today's words (its reads carry no `ran_on` / `queued`).

const LINE = "Waiting for your Claude subscription — one job at a time.";
const CLAUDE = { subscriptions: ["claude"], all: true };
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const side = (label: "A" | "B", version: number, over: Partial<CompareSide> = {}): CompareSide => ({
  label,
  version,
  run_id: `r-${label}`,
  number: null,
  status: "running",
  elapsed_s: 962,
  cost_usd: 0,
  strip: [],
  current: null,
  lines: [],
  gate_task_id: null,
  ...over,
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
const cell = (over: Partial<SetCell>): SetCell => ({
  run_id: "r-1",
  status: "running",
  now: "Engineer · round 1",
  check: null,
  rounds: 1,
  cost_usd: 0,
  note: null,
  ...over,
});
/** A running set compare as the server reads it: the Desktop's read carries where the work ran
 *  and which cell waits; the website's carries neither. */
const running = (desk: boolean): Compare => {
  const d = <T extends object>(o: T) => (desk ? o : {});
  return {
    id: "cmp-set",
    team_id: "team-1",
    task: "Indicators",
    auto_approve: true,
    status: "running",
    elapsed_s: 725,
    cost_usd: 0,
    ...d({ ran_on: CLAUDE }),
    created_at: ago(12),
    ended_at: null,
    waiting: null,
    sides: [side("A", 6), side("B", 7)],
    set: { id: "set-ind", name: "Indicators", count: 2 },
    started: 4,
    runs_waiting: 0,
    items: [
      {
        task: "Add an RSI indicator",
        a: cell({ now: "Engineer · round 2", ...d({ queued: false, ran_on: CLAUDE }) }),
        b: cell({
          status: "finished",
          now: null,
          check: "passed",
          rounds: 2,
          ...d({ queued: false, ran_on: CLAUDE }),
        }),
        badge: null,
      },
      {
        task: "Add a MACD indicator",
        a: cell({ ...d({ ran_on: CLAUDE }) }),
        // The website runs no Desktop jobs, so it never sees the waiting note.
        b: cell({
          now: desk ? `Engineer · ${LINE}` : "Engineer · round 1",
          ...d({ queued: true, ran_on: CLAUDE }),
        }),
        badge: null,
      },
    ],
    results: null,
  };
};
const oneTask = (desk: boolean): Compare => ({
  id: "cmp-1",
  team_id: "team-1",
  task: "Add an RSI indicator",
  auto_approve: true,
  status: "running",
  elapsed_s: 1150,
  cost_usd: 0,
  ...(desk ? { ran_on: CLAUDE } : {}),
  created_at: ago(20),
  ended_at: null,
  waiting: null,
  sides: [
    side("A", 6, { elapsed_s: 1150, ...(desk ? { ran_on: CLAUDE } : {}) }),
    side("B", 7, { elapsed_s: 962, ...(desk ? { ran_on: CLAUDE } : {}) }),
  ],
  results: null,
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const [path, query] = url.split("?");
      const desk = query === "desktop_target=1";
      const body =
        path === "/api/compares/cmp-set"
          ? running(desk)
          : path === "/api/compares/cmp-1"
            ? oneTask(desk)
            : path === "/api/teams/team-1/compare"
              ? START
              : path === "/api/teams/team-1/task-sets"
                ? { sets: [] }
                : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
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
const open = async (id: string, heading: string) => {
  window.location.hash = `#/teams/team-1/compare/${id}`;
  render(<Routed />);
  await screen.findByRole("heading", { name: heading });
};
const text = (sel: string) => [...document.querySelectorAll(sel)].map((e) => e.textContent ?? "");

describe("Set-RunningDesktop: a set compare running on the Desktop", () => {
  it("names the plan, and a cell waiting for the other lane shows the waiting line", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    await open("cmp-set", "v6 and v7 on Indicators");
    expect(document.querySelector(".cmp-run__meta")?.textContent).toContain(
      "12m 05s · on your Claude subscription",
    );
    expect(document.querySelector(".cmp-run__meta")?.textContent).not.toContain("so far");
    const cells = text(".cmp-set__cell");
    expect(cells).toContain(`Engineer · ${LINE}`);
    expect(cells.some((c) => c.startsWith("Working") && c.includes(LINE))).toBe(false);
    expect(cells.some((c) => c.includes("2 rounds · on your Claude subscription"))).toBe(true);
  });

  it("the website's words are today's", async () => {
    await open("cmp-set", "v6 and v7 on Indicators");
    expect(document.querySelector(".cmp-run__meta")?.textContent).toContain(
      "12m 05s · $0.00 so far",
    );
    const cells = text(".cmp-set__cell");
    expect(cells).toContain("Working · Engineer · round 2");
    expect(cells.some((c) => c.includes("2 rounds · $0.00"))).toBe(true);
    expect(cells.join(" ")).not.toContain("subscription");
  });
});

describe("Cmp-RunningDesktop: a one-task compare running on the Desktop", () => {
  it("each lane names the plan instead of a price", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    await open("cmp-1", "v6 and v7 on “Add an RSI indicator”");
    expect(text(".cmp-lane__meta")).toEqual([
      "19m 10s · on your Claude subscription",
      "16m 02s · on your Claude subscription",
    ]);
  });

  it("the website's lanes are today's", async () => {
    await open("cmp-1", "v6 and v7 on “Add an RSI indicator”");
    expect(text(".cmp-lane__meta")).toEqual(["19m 10s · $0.00", "16m 02s · $0.00"]);
  });
});

describe("Set-EditDesktop: Edit task set's estimate", () => {
  const SET: TaskSet = {
    id: "set-ind",
    name: "Indicators",
    items: [
      {
        id: "i1",
        position: 1,
        task: "Add an RSI indicator",
        starts_from: "main",
        hidden_check: "x",
      },
    ],
    last_used: null,
    estimate: { cost_usd: 5.6, minutes: 80 },
    desktop: { subscriptions: ["claude", "grok"], all: true },
  };
  const note = (set: TaskSet) => {
    render(<TaskSetDialog teamId="team-1" set={set} onClose={vi.fn()} onSaved={vi.fn()} />);
    return screen.getByText(/^Comparing two versions on this set:/).textContent;
  };

  it("on the Desktop: the minutes on the subscriptions, or the key part's dollars", () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    expect(note(SET)).toBe(
      "Comparing two versions on this set: about 80 min on your Claude and Grok subscriptions",
    );
  });

  it("mixed: the key part's dollars and the plan", () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    expect(note({ ...SET, desktop: { subscriptions: ["claude"], all: false } })).toBe(
      "Comparing two versions on this set: about $5.60 + your Claude subscription and 80 min",
    );
  });

  it("the website's words are today's", () => {
    expect(note({ ...SET, desktop: undefined })).toBe(
      "Comparing two versions on this set: about $5.60 and 80 min",
    );
  });
});
