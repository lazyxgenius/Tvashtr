import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { CATALOGUE, edges, engineer, json, pm, reviewer, ship, stubFetch } from "../editorTestKit";
import { NodeEditor, type NodeEditorProps } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// The Docs tab (Flow-Docs-1/2).

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const who = (node_id: string, label: string) => ({ node_id, label });
const HISTORY = {
  runs: [
    { run_id: "r1", idea: "Add an RSI indicator", rounds_count: 3, last_round_at: ago(31) },
    {
      run_id: "r0",
      idea: "Fix the MACD label",
      rounds_count: 1,
      last_outcome: "approved",
      last_round_at: "2026-09-10T10:00:00Z",
    },
  ],
  run: null,
};
const docsOf = (runId: string) => ({
  documents:
    runId === "r1"
      ? [
          {
            id: "d-spec",
            name: "spec",
            doc_type: "prd",
            is_shared_spec: true,
            latest_version: { version_no: 3, created_at: ago(31) },
            written_by: [who("n-pm", "Product manager")],
            read_by: [who("n-pm", "PM"), who("n-eng", "Engineer"), who("n-rev", "Reviewer")],
          },
          {
            id: "d-notes",
            name: "build-notes",
            doc_type: "build-notes",
            latest_version: { version_no: 2, created_at: ago(36) },
            written_by: [who("n-eng", "Engineer")],
            read_by: [who("n-rev", "Reviewer")],
          },
        ]
      : [],
});
const ran: TeamGraphNode["last_run"] = {
  run_id: "r1",
  iteration: 3,
  outcome: "changes_requested",
  outcome_detail: null,
  started_at: ago(33),
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  fetchMock = stubFetch(
    () => reviewer(),
    (url) => {
      if (url.startsWith("/api/teams/t1/nodes/")) return json(HISTORY);
      const m = /^\/api\/runs\/(\w+)\/documents$/.exec(url);
      return m ? json(docsOf(m[1])) : undefined;
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderDocs(saved: TeamGraphNode, over: Partial<NodeEditorProps> = {}) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node: saved,
    nodes: [pm, engineer, saved, ship],
    edges,
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "docs",
    onTabChange: vi.fn(),
    focus: false,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onOpenToolkit: vi.fn(),
    ...over,
  };
  render(<NodeEditor {...props} />);
  return props;
}

const card = (title: string, nth = 0) =>
  within(screen.getAllByText(title)[nth].closest("li") as HTMLElement);

describe("Docs tab", () => {
  it("shows the run's shared spec, what the agent writes and what it reads", async () => {
    const props = renderDocs(reviewer({ last_run: ran }));
    expect(
      await screen.findByText("From run “Add an RSI indicator” · 31m ago"),
    ).toBeInTheDocument();
    await screen.findAllByText("Shared spec");
    const shared = card("Shared spec", 0);
    expect(shared.getByText("PRD · written by Product manager")).toBeInTheDocument();
    expect(shared.getByText("v3 · 31m ago · read by all 3 agents")).toBeInTheDocument();
    expect(card("Shared spec", 1).getByText("v3 · same as above")).toBeInTheDocument();
    expect(card("build-notes").getByText("Written by Engineer")).toBeInTheDocument();
    expect(screen.getByText("No document. Its verdict goes to Runs.")).toBeInTheDocument();

    fireEvent.click(card("build-notes").getByRole("button", { name: "Open" }));
    expect(props.onOpenToolkit).toHaveBeenCalledWith({
      page: "team",
      teamId: "t1",
      docId: "d-notes",
    });
    fireEvent.click(screen.getByRole("link", { name: "See all documents in this run" }));
    expect(props.onOpenToolkit).toHaveBeenCalledWith({ page: "team", teamId: "t1", runId: "r1" });
    fireEvent.click(screen.getByRole("button", { name: "Set in Setup" }));
    expect(props.onTabChange).toHaveBeenCalledWith("setup");
  });

  it("Change picks another of the agent's runs", async () => {
    renderDocs(reviewer({ last_run: ran }));
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    const menu = within(screen.getByRole("menu", { name: "Choose a run" }));
    expect(menu.getByText("31m ago · 3 rounds")).toBeInTheDocument();
    fireEvent.click(menu.getByRole("menuitem", { name: /Fix the MACD label/ }));
    expect(await screen.findByText(/From run “Fix the MACD label”/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/runs/r0/documents")).toBe(true);
    expect(await screen.findByText("No document. Its verdict goes to Runs.")).toBeInTheDocument();
  });

  it("the entry agent writes the spec and reads the idea; a new agent has no documents yet", async () => {
    renderDocs(reviewer({ last_run: ran }), { isEntry: true });
    expect(
      await screen.findByText("Reviewer is the entry agent, so it writes the Shared spec above."),
    ).toBeInTheDocument();
    expect(screen.getByText("The idea you type when you press Run.")).toBeInTheDocument();
  });

  it("with no run: No documents yet", () => {
    renderDocs(reviewer({ last_run: null }));
    expect(screen.getByText("No documents yet")).toBeInTheDocument();
  });
});
