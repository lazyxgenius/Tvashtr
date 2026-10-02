import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import App from "./App";
import { ToastProvider } from "./design-system/components";
import type { CheckSet, TeamVersions, VersionCheck, VersionTests } from "./lib/api/versions";

// M7 on the real <App/>: Save as vN offers the changed agents' tests (R6, Test-SaveNudge /
// -SaveNudgeTwo) only when they have some; History's version rows gain "Tests 5 of 6"
// (Set-Checked); the graph is read again every 2 s while an agent tests (its card's chip).
// M9 (R6, Set-SaveCheck / Set-Checked / Set-CheckedWorse): Save as vN also offers "Compare vN with
// vN-1 on <set>" when the team has task sets; History shows each version's set check.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const node = (id: string, role_name: string, kind: string, tests: unknown = null) => ({
  id,
  role_name,
  kind,
  model: "openai/gpt-4o-mini",
  engine: null,
  prompt: null,
  position: { x: 0, y: 0 },
  config: null,
  tests,
});
const graph = (testing: boolean) => ({
  team_graph_id: "team-1",
  name: "Indicator sprint team",
  nodes: [
    node("tn-pm", "pm", "completion"),
    node("tn-rev", "reviewer", "agent", {
      total: 6,
      passed: 5,
      ran: 6,
      running: testing ? { done: 2, total: 6 } : null,
    }),
  ],
  edges: [],
});
const TESTS: VersionTests = {
  count: 6,
  agents: [{ node_id: "tn-rev", name: "Reviewer", count: 6 }],
  sub: "You changed the Reviewer’s instructions. The Reviewer has 6 tests.",
  option: "Save and run the Reviewer’s 6 tests",
  estimate: { cost_usd: 0.4, minutes: 4 },
};
const versions = (tests: VersionTests | null, changes = 1): TeamVersions => ({
  current: 7,
  saved_at: ago(2),
  changes,
  next: 8,
  total: 3,
  versions: [
    [7, { passed: 6, total: 6, running: false }],
    [6, { passed: 5, total: 6, running: false }],
    [5, { passed: 2, total: 6, running: true }],
  ].map(([number, t]) => ({
    number: number as number,
    created_at: ago(60),
    author: "you",
    summary: `v${number as number}`,
    note: null,
    runs: 0,
    source: "save" as const,
    restored_from: null,
    tests: t as { passed: number; total: number; running: boolean },
  })),
  tests,
});

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
let summary: TeamVersions;
let testing: boolean;
// The graph reads that fail (a 502) before the next one answers.
let graphFails: number;
// What the next GET /versions answers instead of `summary` (a fresher summary).
let nextSummary: TeamVersions | null;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const posts = () =>
  fetchMock.mock.calls
    .filter(([u, init]) => u === "/api/teams/team-1/versions" && init?.method === "POST")
    .map(([, init]) => JSON.parse(init?.body as string) as unknown);
const graphReads = () =>
  fetchMock.mock.calls.filter(([u]) => u === "/api/teams/team-1/graph").length;

beforeEach(() => {
  window.location.hash = "";
  summary = versions(TESTS);
  testing = false;
  graphFails = 0;
  nextSummary = null;
  fetchMock = vi.fn<Fetch>((url, init) => {
    const method = init?.method ?? "GET";
    if (url === "/api/teams") return reply({ teams: [{ team_graph_id: "team-1", name: "x" }] });
    if (url === "/api/teams/team-1/graph") {
      if (graphFails > 0) {
        graphFails -= 1;
        return reply({ detail: "Bad gateway" }, 502);
      }
      return reply(graph(testing));
    }
    if (url === "/api/teams/team-1/validate")
      return reply({ errors: [], warnings: [], runnable: true });
    if (url === "/api/teams/team-1/versions" && method === "POST") {
      summary = { ...versions(null, 0), current: 8, next: 9, saved_at: ago(0) };
      return reply({ number: 8, tests_started: [] }, 201);
    }
    if (url === "/api/teams/team-1/versions" && nextSummary) {
      summary = nextSummary;
      nextSummary = null;
    }
    if (url === "/api/teams/team-1/versions") return reply(summary);
    if (url === "/api/teams/team-1/runs") return reply({ runs: [] });
    if (url === "/api/teams/team-1/versions/7/restore")
      return reply({ number: 7, makes: 9, current: 8, draft_saved_as: null, changes: [] });
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const renderApp = () =>
  render(
    <ToastProvider>
      <App teamId="team-1" onBackToDashboard={vi.fn()} />
    </ToastProvider>,
  );
const saveAs = async () =>
  fireEvent.click(await screen.findByRole("button", { name: "Save as v8" }));

describe("App — M7 Save as vN offers the tests (R6)", () => {
  it("Test-SaveNudge: the note, the two choices, the restore line; Save and run tests posts both", async () => {
    renderApp();
    await saveAs();
    const dialog = await screen.findByRole("dialog", { name: "Save as v8" });
    expect(dialog).toHaveTextContent(TESTS.sub);
    expect(dialog).toHaveTextContent(
      "About 4 min · about $0.40 on your keys. Results show next to v8 in History.",
    );
    expect(dialog).toHaveTextContent("If v8 does worse, restore v7 from History in one click.");
    expect(
      within(dialog).getByRole("radio", { name: /Save and run the Reviewer’s 6 tests/ }),
    ).toBeChecked();
    expect(posts()).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText("What changed (optional)"), {
      target: { value: "Reviewer names the file and line" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and run tests" }));
    await waitFor(() =>
      expect(posts()).toEqual([{ note: "Reviewer names the file and line", run_tests: true }]),
    );
    expect(screen.queryByRole("dialog", { name: "Save as v8" })).toBeNull();
    expect(await screen.findByText("· saved just now")).toBeInTheDocument();
  });

  it("Just save: the button reads Save as v8 and posts run_tests false (no note when empty)", async () => {
    renderApp();
    await saveAs();
    const dialog = await screen.findByRole("dialog", { name: "Save as v8" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Just save" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save as v8" }));
    await waitFor(() => expect(posts()).toEqual([{ run_tests: false }]));
  });

  it("Cancel saves nothing", async () => {
    renderApp();
    await saveAs();
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Save as v8" })).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("decides from the versions read after the click (#4: a draft the guard saved first can add tests)", async () => {
    // On screen: no changed agent with tests. The drawer's draft, saved through the guard, changes the
    // Reviewer, so the summary read after the click offers its tests.
    summary = versions(null);
    renderApp();
    await screen.findByRole("button", { name: "Save as v8" });
    nextSummary = versions(TESTS);
    fireEvent.click(screen.getByRole("button", { name: "Save as v8" }));
    expect(await screen.findByRole("dialog", { name: "Save as v8" })).toHaveTextContent(TESTS.sub);
    expect(posts()).toHaveLength(0);
  });

  it("no changed agent with tests: Save as v8 saves at once with {} as in M5", async () => {
    summary = versions(null);
    renderApp();
    await saveAs();
    await waitFor(() => expect(posts()).toEqual([{}]));
    expect(screen.queryByRole("dialog", { name: "Save as v8" })).toBeNull();
  });
});

describe("App — M7 History's Tests pill (Set-Checked)", () => {
  it("each version's tests next to its runs: sage when all passed, none while running", async () => {
    summary = versions(null, 0);
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Version history" }));
    const panel = await screen.findByRole("complementary", { name: "History" });
    const all = within(panel).getByText("Tests 6 of 6");
    expect(all).toHaveClass("cv-tpill--good");
    expect(within(panel).getByText("Tests 5 of 6")).not.toHaveClass("cv-tpill--good");
    expect(within(panel).queryByText("Tests 2 of 6")).toBeNull();
    // Kept: each row's runs pill and What changed.
    expect(within(panel).getAllByRole("button", { name: /^What changed in v/ })).toHaveLength(3);
  });
});

describe("App — M7 the graph while an agent tests", () => {
  it("is read again every 2 s while testing, and stops once it isn't", async () => {
    testing = true;
    summary = versions(null, 0);
    renderApp();
    await screen.findByText("● Testing 3 of 6");
    const first = graphReads();
    testing = false;
    await waitFor(() => expect(graphReads()).toBe(first + 1), { timeout: 3000 });
    expect(await screen.findByText("5 of 6 tests")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 2200));
    expect(graphReads()).toBe(first + 1);
  }, 10_000);

  it("keeps reading after a failed read (#9: R15's 2 s poll doesn't stop on a 502)", async () => {
    testing = true;
    summary = versions(null, 0);
    renderApp();
    await screen.findByText("● Testing 3 of 6");
    const first = graphReads();
    graphFails = 1;
    await waitFor(() => expect(graphReads()).toBe(first + 1), { timeout: 3000 });
    testing = false;
    await waitFor(() => expect(graphReads()).toBe(first + 2), { timeout: 3000 });
    expect(await screen.findByText("5 of 6 tests")).toBeInTheDocument();
  }, 10_000);
});

const INDICATORS: CheckSet = {
  id: "set-ind",
  name: "Indicators",
  count: 5,
  estimate: { cost_usd: 5.6, minutes: 40 },
};
const check = (over: Partial<VersionCheck> = {}): VersionCheck => ({
  compare_id: "cmp-1",
  set: "Indicators",
  passed: 5,
  total: 5,
  against: 7,
  cost_delta_usd: -0.7,
  status: "finished",
  worse: false,
  ...over,
});
/** v8 (now) · v7 · v6, with the checks given; v8's tests 6 of 6. */
const checked = (v8: VersionCheck | null, v7: VersionCheck | null = null): TeamVersions => {
  const base = versions(null, 0);
  return {
    ...base,
    current: 8,
    next: 9,
    versions: [8, 7, 6].map((number, i) => ({
      ...base.versions[0],
      number,
      summary: `v${number}`,
      tests: i === 0 ? { passed: 6, total: 6, running: false } : null,
      check: i === 0 ? v8 : i === 1 ? v7 : null,
    })),
  };
};
const openHistory = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Version history" }));
  return screen.findByRole("complementary", { name: "History" });
};

describe("App — M9 Save as vN offers a compare on a task set (Set-SaveCheck)", () => {
  it("keeps M7's choices and adds Compare v8 with v7 on the set; Save and check posts both", async () => {
    summary = { ...versions(TESTS), check_sets: [INDICATORS] };
    renderApp();
    await saveAs();
    const dialog = await screen.findByRole("dialog", { name: "Save as v8" });
    // Kept (M7): the note, the two choices, Cancel and the restore line.
    expect(within(dialog).getByLabelText("What changed (optional)")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: /Save and run the Reviewer’s 6 tests/ }),
    ).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Just save" })).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("If v8 does worse, restore v7 from History in one click.");
    // New (M9).
    expect(dialog).toHaveTextContent("Check it right after saving");
    const compare = within(dialog).getByRole("checkbox", { name: /Compare v\d+ with v\d+ on/ });
    expect(compare).toHaveAccessibleName(
      "Compare v8 with v7 on Indicators 5 tasks · about 40 min · about $5.60 · nothing ships",
    );
    expect(compare).toBeChecked();
    expect(dialog).toHaveTextContent("About $6.00 for both checks");
    fireEvent.change(within(dialog).getByLabelText("What changed (optional)"), {
      target: { value: "Engineer on GPT-4.1" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and check" }));
    await waitFor(() =>
      expect(posts()).toEqual([
        { note: "Engineer on GPT-4.1", run_tests: true, check_set: "set-ind" },
      ]),
    );
    expect(screen.queryByRole("dialog", { name: "Save as v8" })).toBeNull();
  });

  it("unticking the compare: the button is M7's again and posts no check_set", async () => {
    summary = { ...versions(TESTS), check_sets: [INDICATORS] };
    renderApp();
    await saveAs();
    const dialog = await screen.findByRole("dialog", { name: "Save as v8" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Compare v8 with v7 on/ }));
    expect(dialog).not.toHaveTextContent("for both checks");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and run tests" }));
    await waitFor(() => expect(posts()).toEqual([{ run_tests: true }]));
  });

  it("Just save clears both checks (Save as v8 posts as M7); ticking the compare again checks only it", async () => {
    summary = { ...versions(TESTS), check_sets: [INDICATORS] };
    renderApp();
    await saveAs();
    const dialog = await screen.findByRole("dialog", { name: "Save as v8" });
    const compare = within(dialog).getByRole("checkbox", { name: /Compare v8 with v7 on/ });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Just save" }));
    expect(compare).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Save as v8" })).toBeInTheDocument();
    fireEvent.click(compare);
    expect(within(dialog).getByRole("radio", { name: "Just save" })).not.toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Save and run the/ })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and check" }));
    await waitFor(() => expect(posts()).toEqual([{ run_tests: false, check_set: "set-ind" }]));
  });

  it("a team with a set and no changed tests: the dialog opens with only the compare", async () => {
    summary = { ...versions(null), check_sets: [{ ...INDICATORS, estimate: null }] };
    renderApp();
    await saveAs();
    const dialog = await screen.findByRole("dialog", { name: "Save as v8" });
    expect(posts()).toHaveLength(0);
    expect(within(dialog).queryByRole("radio")).toBeNull();
    const compare = within(dialog).getByRole("checkbox", { name: /Compare v8 with v7 on/ });
    expect(compare).toHaveAccessibleName(
      "Compare v8 with v7 on Indicators 5 tasks · nothing ships",
    );
    fireEvent.click(compare);
    expect(within(dialog).getByRole("button", { name: "Save as v8" })).toBeInTheDocument();
    fireEvent.click(compare);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and check" }));
    await waitFor(() => expect(posts()).toEqual([{ check_set: "set-ind" }]));
  });

  it("no set and no tests: Save as v8 still saves at once with {} (M5)", async () => {
    summary = { ...versions(null), check_sets: [] };
    renderApp();
    await saveAs();
    await waitFor(() => expect(posts()).toEqual([{}]));
  });
});

describe("App — M9 History's set check (Set-Checked, Set-CheckedWorse)", () => {
  it("did as well: the pill in the good tone and the newest check's callout", async () => {
    summary = checked(check(), check({ cost_delta_usd: null, against: 6 }));
    renderApp();
    const panel = await openHistory();
    const pill = within(panel).getByText("Indicators: 5 of 5, $0.70 less than v7");
    expect(pill).toHaveClass("cv-tpill", "cv-tpill--good");
    expect(within(panel).getByText("Indicators: 5 of 5")).toBeInTheDocument();
    expect(within(panel).getByText("v8 passed both checks")).toBeInTheDocument();
    expect(
      within(panel).getByText(
        "All 6 tests pass, and it did as well as v7 on Indicators for $0.70 less.",
      ),
    ).toBeInTheDocument();
    // Kept: the tests pill, the runs pills and What changed on every row.
    expect(within(panel).getByText("Tests 6 of 6")).toBeInTheDocument();
    expect(within(panel).getAllByRole("button", { name: /^What changed in v/ })).toHaveLength(3);
  });

  it("did worse: the warning pill, the callout and its Restore v7 (M5's Restore)", async () => {
    summary = checked(
      check({ passed: 3, cost_delta_usd: 0.4, worse: true }),
      check({ against: 6 }),
    );
    renderApp();
    const panel = await openHistory();
    expect(within(panel).getByText("Indicators: 3 of 5, $0.40 more than v7")).toHaveClass(
      "cv-tpill--warn",
    );
    const callout = within(panel).getByText("v8 did worse on Indicators").closest("div.cv-check")!;
    expect(callout).toHaveTextContent(
      "3 of 5 hidden checks passed (v7: 5 of 5). Restore v7 to go back.",
    );
    fireEvent.click(within(callout as HTMLElement).getByRole("button", { name: "Restore v7" }));
    expect(await screen.findByRole("dialog", { name: "Restore v7?" })).toBeInTheDocument();
  });

  it("while it runs: checking…, no callout, and History reads the versions again", async () => {
    summary = checked(check({ status: "running", passed: 0 }));
    renderApp();
    const panel = await openHistory();
    expect(within(panel).getByText("Indicators: checking…")).toBeInTheDocument();
    expect(within(panel).queryByText(/passed both checks|did worse/)).toBeNull();
    nextSummary = checked(check());
    expect(
      await within(panel).findByText(
        "Indicators: 5 of 5, $0.70 less than v7",
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  }, 10_000);
});
