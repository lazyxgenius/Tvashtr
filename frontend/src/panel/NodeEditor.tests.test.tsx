import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../lib/api";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { CATALOGUE, edges, engineer, json, pm, reviewer, ship, stubFetch } from "./editorTestKit";
import { NodeEditor, type NodeEditorProps } from "./NodeEditor";
import { resetNodeTemplates } from "./setup/useNodeTemplates";
import { DONE_RUN, FROM_ROUND, RUNNING_RUN, tests } from "./tests/testsFixtures";

// M7 in the TEAM agent drawer: the Tests tab (sixth, between Runs and Docs), its footer, Run all
// through the unsaved guard, the round ⋯ (Make this a test / Copy the answer), ?test_from=, the
// row ⋯ Delete, Compare with v6, Open this replay. Every existing tab, menu item and card stays.

const BASE = "/api/teams/t1/nodes/n-rev/tests";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ran: TeamGraphNode["last_run"] = {
  run_id: "r1",
  iteration: 2,
  outcome: "changes_requested",
  outcome_detail: null,
  started_at: ago(33),
};
const round = (iteration: number, over: Record<string, unknown> = {}) => ({
  invocation_id: 810 + iteration,
  iteration,
  status: "done",
  outcome: "changes_requested",
  outcome_detail: `Round ${iteration}: register rsi on INDICATORS.`,
  started_at: ago(40),
  ended_at: ago(38),
  cost: null,
  test_blocked: null,
  ...over,
});
const HISTORY = {
  runs: [{ run_id: "r1", idea: "Add RSI", rounds_count: 2, last_round_at: ago(31) }],
  run: {
    run_id: "r1",
    idea: "Add RSI",
    rounds: [
      round(2),
      round(1, { test_blocked: "Can’t make a test from this round (it ran before checkpoints)" }),
    ],
  },
};
const HISTORY_ENTRIES = {
  count: 2,
  entries: [
    {
      number: 7,
      created_at: ago(60),
      author: "you",
      current: true,
      first: false,
      text: "Now.",
      added: ["Now."],
      removed: [],
    },
    {
      number: 5,
      created_at: ago(600),
      author: "you",
      current: false,
      first: true,
      text: "Then.",
      added: [],
      removed: [],
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
let listed: unknown;
let fromRound: () => Promise<Response>;
const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(
    (c) => c[0] === url && ((c[1] as RequestInit | undefined)?.method ?? "GET") === method,
  );

beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  listed = tests(DONE_RUN);
  fromRound = () => json(FROM_ROUND);
  fetchMock = stubFetch(
    () => reviewer(),
    (url, init) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/teams/t1/nodes/n-rev/runs")) return json(HISTORY);
      if (url === BASE && method === "GET") return json(listed);
      if (url.startsWith(`${BASE}/from-round`)) return fromRound();
      if (url === `${BASE}/run`) return json({ run: RUNNING_RUN }, 202);
      if (url === `${BASE}/t4` && method === "DELETE")
        return Promise.resolve(new Response(null, { status: 204 }));
      if (url.endsWith("/instruction-history")) return json(HISTORY_ENTRIES);
      if (url.startsWith(`${BASE}/results/`))
        return json({
          id: "res-t6",
          name: "Names the file to fix",
          status: "failed",
          cost_usd: 0.07,
        });
      return undefined;
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderEditor(over: Partial<NodeEditorProps> = {}) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node: reviewer({ last_run: ran, tests: { total: 6, passed: 5, ran: 6, running: null } }),
    nodes: [pm, engineer, reviewer(), ship],
    edges,
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "tests",
    onTabChange: vi.fn(),
    focus: false,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    teamVersion: 7,
    ...over,
  };
  const view = render(<NodeEditor {...props} />);
  return { props, view, drawer: screen.getByRole("complementary", { name: "Reviewer settings" }) };
}
const toastOf = (drawer: HTMLElement) => drawer.querySelector(".nd-toast-host") as HTMLElement;

describe("NodeEditor — M7 Tests tab", () => {
  it("six tabs, Tests 6 between Runs and Docs (kept: the other five, in order)", () => {
    const { drawer, props } = renderEditor({ tab: "setup" });
    const tablist = within(drawer).getByRole("tablist", { name: "Agent" });
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Setup", "Skills & tools", "Memory", "Runs", "Tests6", "Docs"]);
    expect(tablist.closest(".nd-tabs")).toHaveClass("nd-tabs--scroll");
    fireEvent.click(within(tablist).getByRole("tab", { name: /Tests/ }));
    expect(props.onTabChange).toHaveBeenCalledWith("tests");
    // Kept: the header's More menu, unchanged.
    fireEvent.click(within(drawer).getByRole("button", { name: "More actions" }));
    expect(
      within(within(drawer).getByRole("menu", { name: "More actions" }))
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual([
      "Open in focus view",
      "Rename",
      "Open its documents",
      "Save as my agent",
      "Delete agentIts arrows are removed too",
    ]);
  });

  it("no tests: the tab has no count and the drawer no footer", async () => {
    listed = tests(null, { tests: [] });
    const { drawer } = renderEditor({ node: reviewer({ last_run: ran, tests: null }) });
    expect(await within(drawer).findByText("No tests yet")).toBeInTheDocument();
    expect(within(drawer).getByRole("tab", { name: "Tests" })).toBeInTheDocument();
    expect(drawer.querySelector(".nd-foot")).toBeNull();
  });

  it("the list with its footer: New test goes to Runs; Run all posts the run", async () => {
    const { drawer, props } = renderEditor();
    expect(await within(drawer).findByText("6 tests")).toBeInTheDocument();
    const footer = drawer.querySelector(".nd-foot") as HTMLElement;
    fireEvent.click(within(footer).getByRole("button", { name: "New test" }));
    expect(props.onTabChange).toHaveBeenCalledWith("runs");
    expect(within(footer).getByRole("button", { name: "Add tests from a file" })).toBeVisible();
    fireEvent.click(within(drawer).getByRole("button", { name: "Run all 6" }));
    expect(await within(drawer).findByText("Running 3 of 6")).toBeInTheDocument();
    expect(calls("POST", `${BASE}/run`)).toHaveLength(1);
    // Running: no footer; the graph is read again for the chip.
    expect(drawer.querySelector(".nd-foot")).toBeNull();
    expect(props.onSaved).toHaveBeenCalled();
  });

  it("Run all with a draft asks about it first (the unsaved guard), keeps the Save footer, then runs", async () => {
    const { drawer, props, view } = renderEditor({ tab: "setup" });
    fireEvent.change(within(drawer).getByRole("textbox", { name: /^Instructions/ }), {
      target: { value: "You are a stricter Reviewer." },
    });
    // The same drawer moves to Tests with the draft kept: the Save footer stays.
    view.rerender(<NodeEditor {...props} tab="tests" />);
    expect(await within(drawer).findByText("6 tests")).toBeInTheDocument();
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "New test" })).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: "Run all 6" }));
    const dialog = within(drawer).getByRole("alertdialog", { name: "Unsaved changes" });
    expect(dialog).toHaveTextContent("Save your changes to Reviewer?");
    expect(calls("POST", `${BASE}/run`)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(calls("POST", `${BASE}/run`)).toHaveLength(1));
  });

  it("a row ⋯ › Delete test asks in the footer's place, then deletes and reloads", async () => {
    const { drawer, props } = renderEditor();
    await within(drawer).findByText("6 tests");
    fireEvent.click(
      within(drawer).getByRole("button", { name: "More for Flags a missing test file" }),
    );
    fireEvent.click(within(drawer).getByRole("menuitem", { name: "Delete test" }));
    const bar = within(drawer).getByRole("alertdialog", { name: "Delete test" });
    expect(bar).toHaveTextContent("Delete “Flags a missing test file”? Its past results stay.");
    fireEvent.click(within(bar).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls("DELETE", `${BASE}/t4`)).toHaveLength(1));
    await waitFor(() =>
      expect(within(drawer).queryByRole("alertdialog", { name: "Delete test" })).toBeNull(),
    );
    expect(props.onSaved).toHaveBeenCalled();
  });

  it("Compare with v6 sets the instructions in effect then beside the text now", async () => {
    const { drawer } = renderEditor();
    // Not watched: open the failed row first.
    fireEvent.click(await within(drawer).findByRole("button", { name: /^Names the file to fix/ }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Compare with v6" }));
    expect(
      await screen.findByRole("dialog", { name: "Compare v5 with the text now" }),
    ).toBeInTheDocument();
  });

  it("Open this replay opens the replay sheet in place of the list and footer", async () => {
    const { drawer } = renderEditor();
    fireEvent.click(await within(drawer).findByRole("button", { name: /^Names the file to fix/ }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Open this replay" }));
    const sheet = await within(drawer).findByRole("region", {
      name: "Replay · Names the file to fix",
    });
    expect(drawer.querySelector(".nd-foot")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(within(drawer).getByText("6 tests")).toBeVisible();
  });
});

describe("NodeEditor — M7 round ⋯ on the Runs tab", () => {
  it("kept: Last run and Earlier rounds; each round's ⋯ has the three actions", async () => {
    const { drawer, props } = renderEditor({ tab: "runs" });
    const last = await within(drawer).findByRole("region", { name: "Last run" });
    expect(within(drawer).getByText("Earlier rounds")).toBeInTheDocument();
    fireEvent.click(within(last).getByRole("button", { name: "More for round 2" }));
    const menu = within(drawer).getByRole("menu", { name: "More for round 2" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Open in focus view", "Make this a testnew", "Copy the answer"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open in focus view" }));
    expect(props.onFocusChange).toHaveBeenCalledWith(true);
  });

  it("a round that can't be a test says why and is off (Test-RoundMenuOff)", async () => {
    const { drawer } = renderEditor({ tab: "runs" });
    fireEvent.click(await within(drawer).findByRole("button", { name: "More for round 1" }));
    const item = within(within(drawer).getByRole("menu", { name: "More for round 1" })).getByRole(
      "menuitem",
      { name: /Make this a test/ },
    );
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent("Can’t make a test from this round (it ran before checkpoints)");
  });

  it("Make this a test reads the round, moves to Tests and opens the New test dialog", async () => {
    const { drawer, props } = renderEditor({ tab: "runs" });
    fireEvent.click(await within(drawer).findByRole("button", { name: "More for round 2" }));
    fireEvent.click(within(drawer).getByRole("menuitem", { name: /Make this a test/ }));
    expect(await screen.findByRole("dialog", { name: "New test from round 1" })).toBeVisible();
    expect(props.onTabChange).toHaveBeenCalledWith("tests");
    expect(fetchMock.mock.calls.some((c) => c[0] === `${BASE}/from-round?invocation_id=812`)).toBe(
      true,
    );
  });

  it("a round the server refuses: its words in the drawer toast", async () => {
    fromRound = () => json({ detail: "Can’t make a test from this round (it didn’t finish)" }, 409);
    const { drawer } = renderEditor({ tab: "runs" });
    fireEvent.click(await within(drawer).findByRole("button", { name: "More for round 2" }));
    fireEvent.click(within(drawer).getByRole("menuitem", { name: /Make this a test/ }));
    await waitFor(() =>
      expect(toastOf(drawer)).toHaveTextContent(
        "Can’t make a test from this round (it didn’t finish)",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Copy the answer copies the round's answer and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { drawer } = renderEditor({ tab: "runs" });
    fireEvent.click(await within(drawer).findByRole("button", { name: "More for round 2" }));
    fireEvent.click(within(drawer).getByRole("menuitem", { name: "Copy the answer" }));
    await waitFor(() => expect(toastOf(drawer)).toHaveTextContent("Answer copied"));
    expect(writeText).toHaveBeenCalledWith("Round 2: register rsi on INDICATORS.");
  });

  it("?test_from= opens the New test dialog once and drops it from the address", async () => {
    const onTestFromOpened = vi.fn();
    renderEditor({ testFrom: 812, onTestFromOpened });
    expect(await screen.findByRole("dialog", { name: "New test from round 1" })).toBeVisible();
    expect(onTestFromOpened).toHaveBeenCalledTimes(1);
  });
});
