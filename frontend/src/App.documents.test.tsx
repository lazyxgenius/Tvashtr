import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { TeamGraphData, TeamGraphNode } from "./lib/api";

// The toolbar's Documents toggle, the canvas doc chips and the Documents drawer (Docs-Drawer,
// DOCS-10..17), on the real <App/> with the control plane stubbed.

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const agent = (node_id: string, label: string) => ({
  node_id,
  clone_node_id: `c-${node_id}`,
  role_name: node_id,
  label,
});
const PM = agent("tn-pm", "Product manager");
const ENG = agent("tn-eng", "Engineer");
const REV = agent("tn-rev", "Reviewer");
const version = (n: number, min: number) => ({
  version_no: n,
  created_at: ago(min),
  author: PM,
  note: null,
});
const DOCS: Record<string, unknown> = {
  "r-rsi": {
    run: { run_id: "r-rsi", idea: "Add an RSI indicator", status: "completed", live: false },
    documents: [
      {
        id: "d-spec",
        name: "spec",
        doc_type: "prd",
        is_shared_spec: true,
        version_count: 3,
        latest_version: version(3, 31),
        written_by: [PM],
        read_by: [PM, ENG, REV],
      },
      {
        id: "d-notes",
        name: "build-notes",
        doc_type: "build-notes",
        version_count: 2,
        latest_version: version(2, 36),
        written_by: [ENG],
        read_by: [REV],
      },
    ],
  },
  "r-macd": {
    run: { run_id: "r-macd", idea: "Fix the MACD label", status: "completed", live: false },
    documents: [],
  },
};
const RUNS = [
  { run_id: "r-rsi", idea: "Add an RSI indicator", status: "completed", updated_at: ago(31) },
  {
    run_id: "r-macd",
    idea: "Fix the MACD label",
    status: "failed",
    updated_at: "2026-09-10T10:00:00Z",
  },
];

const tnode = (
  id: string,
  role_name: string,
  kind: TeamGraphNode["kind"],
  x: number,
): TeamGraphNode => ({
  id,
  role_name,
  kind,
  model: "openai/gpt-4o-mini",
  engine: kind === "agent" ? "openhands" : null,
  prompt: `${role_name} behavior`,
  position: { x, y: 0 },
  config: null,
});
const TEAM: TeamGraphData = {
  team_graph_id: "team-1",
  name: "Indicator sprint team",
  nodes: [
    tnode("tn-pm", "pm", "completion", 0),
    tnode("tn-eng", "engineer", "agent", 240),
    {
      ...tnode("tn-rev", "reviewer", "agent", 480),
      last_run: {
        run_id: "r-rsi",
        iteration: 1,
        outcome: "approved",
        outcome_detail: null,
        started_at: ago(33),
      },
    },
  ],
  edges: [],
};

let teamRuns: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));

beforeEach(() => {
  teamRuns = RUNS;
  fetchMock = vi.fn((input: string) => {
    const url = input;
    if (url === "/api/teams/team-1/graph") return ok(TEAM);
    if (url === "/api/teams/team-1/runs") return ok({ runs: teamRuns });
    if (url.startsWith("/api/teams/team-1/nodes/tn-rev/runs"))
      return ok({
        runs: [{ run_id: "r-rsi", idea: "Add an RSI indicator", rounds_count: 1 }],
        run: null,
      });
    const docs = /^\/api\/runs\/([\w-]+)\/documents$/.exec(url);
    if (docs) return ok(DOCS[docs[1]] ?? { documents: [] });
    if (url === "/api/documents/d-notes")
      return ok({
        id: "d-notes",
        name: "build-notes",
        run_id: "r-rsi",
        versions: [{ id: "v2", version_no: 2, content: "Ran pytest: 12 passed" }],
      });
    if (url.endsWith("/validate")) return ok({ errors: [], warnings: [], runnable: true });
    if (url === "/api/teams") return ok({ teams: [{ team_graph_id: "team-1", name: "x" }] });
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const toggle = () => screen.findByRole("button", { name: /^Documents/ });
const drawer = () => screen.getByRole("complementary", { name: "Documents" });

describe("Documents on the canvas", () => {
  it("no run yet: no toggle and no chips", async () => {
    teamRuns = [];
    render(<App teamId="team-1" />);
    await screen.findByText("Product manager");
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[0] === "/api/teams/team-1/runs")).toBe(true),
    );
    expect(screen.queryByRole("button", { name: /^Documents/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Shared spec v/ })).toBeNull();
  });

  it("the toggle counts the latest run's documents and opens the drawer on it", async () => {
    render(<App teamId="team-1" />);
    const button = await toggle();
    await waitFor(() => expect(button).toHaveAccessibleName("Documents 2"));
    expect(button).toHaveAttribute("aria-pressed", "false");
    // The chips sit on their writers' cards.
    const chip = await screen.findByRole("button", { name: "Shared spec v3" });
    const chipNode = (el: Element) =>
      el.closest(".react-flow__node-toolbar")?.getAttribute("data-id");
    expect(chipNode(chip)).toBe("tn-pm");
    expect(chipNode(screen.getByRole("button", { name: "build-notes v2" }))).toBe("tn-eng");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    const aside = within(drawer());
    expect(aside.getByText("What this team’s agents wrote")).toBeInTheDocument();
    expect(
      await aside.findByRole("button", { name: "Run: Add an RSI indicator · 31m ago" }),
    ).toBeInTheDocument();
    const shared = within(aside.getByText("PRD · written by Product manager").closest("li")!);
    expect(shared.getByText("v3 · 31m ago · read by all 3 agents")).toBeInTheDocument();
    const notes = within(aside.getByText("Written by Engineer").closest("li")!);
    expect(notes.getByText("v2 · 36m ago · read by Reviewer")).toBeInTheDocument();
    expect(
      aside.getByText(
        "Documents belong to a run. While a run is live you can edit the shared spec to steer it.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(aside.getByRole("button", { name: "Close documents" }));
    expect(screen.queryByRole("complementary", { name: "Documents" })).toBeNull();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("the run picker switches the drawer to another run", async () => {
    render(<App teamId="team-1" />);
    fireEvent.click(await toggle());
    fireEvent.click(await within(drawer()).findByRole("button", { name: /^Run: / }));
    const menu = within(screen.getByRole("menu", { name: "Choose a run" }));
    expect(menu.getByText("Sep 10 · failed")).toBeInTheDocument();
    fireEvent.click(menu.getByRole("menuitem", { name: /Fix the MACD label/ }));
    expect(await within(drawer()).findByText("No documents in this run yet.")).toBeInTheDocument();
    expect(within(drawer()).getByRole("button", { name: /^Run: Fix the MACD label/ }));
  });

  it("a chip and the drawer's Open show the document in the viewer", async () => {
    render(<App teamId="team-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "build-notes v2" }));
    const viewer = await screen.findByRole("dialog", { name: "build-notes" });
    expect(await within(viewer).findByText("Ran pytest: 12 passed")).toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "build-notes" })).toBeNull();

    fireEvent.click(await toggle());
    fireEvent.click(
      within(
        await within(drawer())
          .findByText("Written by Engineer")
          .then((el) => el.closest("li")!),
      ).getByRole("button", { name: "Open" }),
    );
    expect(await screen.findByRole("dialog", { name: "build-notes" })).toBeInTheDocument();
    // The drawer stays docked under the viewer.
    expect(drawer()).toBeInTheDocument();
  });

  it("the Documents drawer and the agent drawer never show together (OQ-20)", async () => {
    render(<App teamId="team-1" node="tn-rev" />);
    await screen.findByRole("complementary", { name: "Reviewer settings" });
    fireEvent.click(await toggle());
    expect(drawer()).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Reviewer settings" })).toBeNull();

    // Selecting an agent closes the Documents drawer.
    const card = screen
      .getAllByText("Engineer")
      .map((el) => el.closest(".react-flow__node"))
      .find((el): el is Element => el !== null)!;
    fireEvent.click(card);
    await screen.findByRole("complementary", { name: "Engineer settings" });
    expect(screen.queryByRole("complementary", { name: "Documents" })).toBeNull();
  });

  it("Docs tab › See all documents in this run opens the drawer on that run (DOCS-6)", async () => {
    teamRuns = [...RUNS].reverse(); // the toolbar's latest run is another run
    render(<App teamId="team-1" node="tn-rev" tab="docs" />);
    const panel = await screen.findByRole("complementary", { name: "Reviewer settings" });
    fireEvent.click(
      await within(panel).findByRole("button", { name: "See all documents in this run" }),
    );
    expect(screen.queryByRole("complementary", { name: "Reviewer settings" })).toBeNull();
    expect(
      await within(drawer()).findByRole("button", { name: /^Run: Add an RSI indicator/ }),
    ).toBeInTheDocument();
  });
});

describe("The document viewer's address (spec §3.2)", () => {
  it("opens from the address, over the focus view, and closes back onto it", async () => {
    const onDocRoute = vi.fn();
    render(
      <App
        teamId="team-1"
        node="tn-rev"
        tab="docs"
        focus
        onNodeRoute={vi.fn()}
        doc={{ id: "d-notes" }}
        onDocRoute={onDocRoute}
      />,
    );
    const viewer = await screen.findByRole("dialog", { name: "build-notes" });
    expect(screen.getByRole("dialog", { name: "Reviewer in focus view" })).toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole("button", { name: "Close" }));
    expect(onDocRoute).toHaveBeenCalledWith(null, { push: false });
  });

  it("a reload on the viewer over the focus view: the viewer owns the keyboard", async () => {
    const onDocRoute = vi.fn();
    const onNodeRoute = vi.fn();
    render(
      <App
        teamId="team-1"
        node="tn-rev"
        tab="docs"
        focus
        onNodeRoute={onNodeRoute}
        doc={{ id: "d-notes" }}
        onDocRoute={onDocRoute}
      />,
    );
    await screen.findByRole("dialog", { name: "Reviewer in focus view" });
    await screen.findByRole("dialog", { name: "build-notes" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDocRoute).toHaveBeenCalledWith(null, { push: false });
    expect(onNodeRoute).not.toHaveBeenCalled();
  });

  it("opening a document adds a history step; moving inside it doesn't", async () => {
    const onDocRoute = vi.fn();
    const { rerender } = render(<App teamId="team-1" onDocRoute={onDocRoute} />);
    fireEvent.click(await screen.findByRole("button", { name: "build-notes v2" }));
    expect(onDocRoute).toHaveBeenLastCalledWith({ id: "d-notes" }, { push: true });
    rerender(<App teamId="team-1" onDocRoute={onDocRoute} doc={{ id: "d-notes" }} />);
    const viewer = await screen.findByRole("dialog", { name: "build-notes" });
    fireEvent.click(
      within(
        await within(viewer).findByRole("complementary", { name: "This run’s documents" }),
      ).getByRole("button", { name: /Shared spec/ }),
    );
    expect(onDocRoute).toHaveBeenLastCalledWith({ id: "d-spec" }, { push: false });
  });
});
