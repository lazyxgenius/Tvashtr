import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Compare, CompareStart, CompareVersion, TaskSet } from "../../lib/api/compare";
import { useNav } from "../../lib/nav";
import { ComparePage } from "./ComparePage";

// M-desk-2 (E2; Quality › Cmp-StartDesktop, Cmp-ResultsDesktop): in Tvashtr Desktop the start
// estimates name the subscriptions when every model of both versions runs on one, the start line
// says the versions take turns when they share one, and the results subtitle says the lanes took
// turns. The website keeps today's words.

const TODAY_LEDE =
  "Both run at the same time on separate copies of the repo. Nothing ships and no pull request is opened.";
const DESK_LEDE =
  "Both run on separate copies of the repo, taking turns on your Claude subscription. Nothing ships and no pull request is opened.";
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const v = (number: number, desktop?: CompareVersion["desktop"]): CompareVersion => ({
  number,
  when: ago(number === 7 ? 0 : 1440),
  runs: 1,
  summary: `v${number}`,
  current: number === 7,
  ...(desktop ? { desktop } : {}),
});
const start = (a?: CompareVersion["desktop"], b?: CompareVersion["desktop"]): CompareStart => ({
  team: { id: "team-1", name: "Indicator sprint team" },
  versions: [v(7, b), v(6, a)],
  defaults: { a: 6, b: 7 },
  changes: 0,
  target: null,
  estimate: { cost_usd: 2.3, minutes: 25 },
  latest: null,
});
const SET: TaskSet = {
  id: "set-1",
  name: "Indicators",
  items: [
    { task: "Add RSI", starts_from: null, hidden_check: "" },
    { task: "Add MACD", starts_from: null, hidden_check: "" },
  ],
  last_used: null,
  estimate: { cost_usd: 4.6, minutes: 25 },
};
const BOTH = { subscriptions: ["claude", "grok"], all: true };
const CLAUDE = { subscriptions: ["claude"], all: true };
const RESULTS = (shared?: boolean): Compare => ({
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
  sides: [],
  results: {
    headline: "v7 did better on this task",
    rows: [],
    current_version: 7,
    restore: null,
    ...(shared ? { shared } : {}),
  },
});

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
let page: CompareStart;
let sets: TaskSet[];
let compare: Compare;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  page = start();
  sets = [];
  compare = RESULTS();
  fetchMock = vi.fn<Fetch>((url) => {
    if (url.split("?")[0] === "/api/teams/team-1/compare") return reply(page);
    if (url === "/api/teams/team-1/task-sets") return reply({ sets });
    if (url === "/api/teams/team-1/task-sets?desktop_target=1") return reply({ sets }); // M-desk-4
    if (url.startsWith("/api/recent-tasks")) return reply({ tasks: [] });
    if (url === "/api/compares/cmp-1") return reply(compare);
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
const read = async () => {
  await screen.findByRole("button", { name: "Start compare" });
  return {
    lede: document.querySelector(".cmp-lede")?.textContent,
    foot: document.querySelector(".cmp-start__foot span")?.textContent,
  };
};
const startUrls = () =>
  fetchMock.mock.calls
    .map(([u]) => u)
    .filter((u) => u.split("?")[0] === "/api/teams/team-1/compare");

describe("Cmp-StartDesktop", () => {
  it("the Desktop reads where each version runs (?desktop_target=1)", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    open("#/teams/team-1/compare");
    await read();
    expect(startUrls()).toEqual(["/api/teams/team-1/compare?desktop_target=1"]);
  });

  it("the website reads as before", async () => {
    open("#/teams/team-1/compare");
    await read();
    expect(startUrls()).toEqual(["/api/teams/team-1/compare"]);
  });

  it("every model on a subscription: the estimate names them; sharing one: they take turns", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    page = start(BOTH, CLAUDE);
    open("#/teams/team-1/compare");
    expect(await read()).toEqual({
      lede: DESK_LEDE,
      foot: "On your Claude and Grok subscriptions · about 25 min",
    });
  });

  it("two versions sharing Claude and Grok take turns on both", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    page = start(BOTH, BOTH);
    open("#/teams/team-1/compare");
    expect((await read()).lede).toBe(
      "Both run on separate copies of the repo, taking turns on your Claude and Grok subscriptions. Nothing ships and no pull request is opened.",
    );
  });

  it("a task set's estimate names the subscriptions too", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    page = start(BOTH, BOTH);
    sets = [SET];
    open("#/teams/team-1/compare");
    await read();
    fireEvent.click(screen.getByRole("radio", { name: "A task set" }));
    expect(await screen.findByText(/× 2 versions/)).toHaveTextContent(
      "On your Claude and Grok subscriptions · about 25 min · 2 tasks × 2 versions",
    );
  });

  it("the website's words are today's, word for word", async () => {
    open("#/teams/team-1/compare");
    expect(await read()).toEqual({
      lede: TODAY_LEDE,
      foot: "About $2.30 on your keys · about 25 min",
    });
  });

  it("the website's task-set estimate is today's", async () => {
    sets = [SET];
    open("#/teams/team-1/compare");
    await read();
    fireEvent.click(screen.getByRole("radio", { name: "A task set" }));
    expect(await screen.findByText(/× 2 versions/)).toHaveTextContent(
      "About $4.60 on your keys · about 25 min · 2 tasks × 2 versions",
    );
  });

  it("a version needing a key keeps today's estimate; sharing Claude, the line says they take turns", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    page = start(BOTH, { subscriptions: ["claude"], all: false });
    open("#/teams/team-1/compare");
    expect(await read()).toEqual({
      lede: DESK_LEDE,
      foot: "About $2.30 on your keys · about 25 min",
    });
  });

  it("versions sharing no subscription keep today's line", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    page = start(CLAUDE, { subscriptions: [], all: false });
    open("#/teams/team-1/compare");
    expect((await read()).lede).toBe(TODAY_LEDE);
  });
});

describe("Cmp-ResultsDesktop: the subtitle", () => {
  it("lanes that took turns on the Desktop say so", async () => {
    compare = RESULTS(true);
    open("#/teams/team-1/compare/cmp-1");
    await screen.findByRole("heading", { name: "v7 did better on this task" });
    const sub = document.querySelector(".cmp-res__sub")?.textContent ?? "";
    expect(sub.startsWith("Same task, same repo, taking turns on your Desktop · finished ")).toBe(
      true,
    );
    expect(sub.endsWith(" · $0.00 in all")).toBe(true);
  });

  it("the website's subtitle is today's", async () => {
    open("#/teams/team-1/compare/cmp-1");
    await screen.findByRole("heading", { name: "v7 did better on this task" });
    const sub = document.querySelector(".cmp-res__sub")?.textContent ?? "";
    expect(sub.startsWith("Same task, same repo, at the same time · finished ")).toBe(true);
  });
});
