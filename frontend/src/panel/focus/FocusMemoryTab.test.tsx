import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { CATALOGUE, edges, engineer, json, pm, reviewer, ship, stubFetch } from "../editorTestKit";
import { NodeEditor } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// Focus-Memory (FOCUS-55..61): the filter rail — search, scope with counts, force — beside the
// agent's notes, each with its force and where it came from.

const REPO = "lazyxgenius/trade_mcp";
const note = (
  id: string,
  content: string,
  polarity: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  content,
  polarity,
  repo_key: REPO,
  node_id: "n-rev",
  tier: "node",
  pinned: false,
  status: "active",
  confirmation_count: 1,
  created_at: "2026-09-20T12:00:00Z",
  source_run_id: "r1",
  source: { kind: "run", run_id: "r1", run_title: "Add an RSI indicator", round: 3 },
  ...over,
});
const PENDING = [note("m-new", "Check engine-facts.ts.", "prefer", { status: "pending_review" })];
const OWN = [
  note("m-1", "Run pytest quietly.", "require", {
    pinned: true,
    confirmation_count: 3,
    source: { kind: "run", run_id: "r1", run_title: "Add an RSI indicator", round: 2 },
  }),
  note("m-2", "Ships to a Fly.io preview.", "context", {
    repo_key: null,
    source: { kind: "manual" },
  }),
];
const REPO_NOTES = [
  note("r-1", "The registry test lists 28 names.", "require", { node_id: null, tier: "repo" }),
  note("r-2", "Other repo lesson.", "require", { node_id: null, tier: "repo", repo_key: "o/x" }),
];
const ACCOUNT = [
  note("a-1", "Prefer small commits.", "prefer", {
    node_id: null,
    repo_key: null,
    tier: "account",
  }),
];
const ran: TeamGraphNode["last_run"] = {
  run_id: "r1",
  iteration: 3,
  outcome: "changes_requested",
  outcome_detail: null,
  started_at: "2026-09-27T08:00:00Z",
};
const HISTORY = {
  runs: [{ run_id: "r1", idea: "Add an RSI indicator", repo_key: REPO, rounds_count: 3 }],
  run: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
let account: typeof ACCOUNT;
beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  account = [...ACCOUNT];
  fetchMock = stubFetch(
    () => reviewer(),
    (url, init) => {
      if (url.startsWith("/api/teams/t1/nodes/n-rev/runs")) return json(HISTORY);
      if (init?.method === "DELETE" && url === "/api/memories/a-1") {
        account = [];
        return json(null);
      }
      if (init?.method === "POST" && url.endsWith("/promote"))
        return json({ ...PENDING[0], status: "active", action: "promote" });
      if (!url.startsWith("/api/memories?")) return undefined;
      const q = new URLSearchParams(url.split("?")[1]);
      if (q.get("node_id")) {
        return json({ memories: q.get("status") === "pending_review" ? PENDING : OWN });
      }
      return json({ memories: [...OWN, ...REPO_NOTES, ...account] });
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderMemory(onOpenToolkit = vi.fn()) {
  const saved = reviewer({ last_run: ran });
  render(
    <NodeEditor
      teamId="t1"
      node={saved}
      nodes={[pm, engineer, saved, ship]}
      edges={edges}
      isEntry={false}
      cover={{ byok: new Set(["xai"]), subs: {} }}
      tab="memory"
      onTabChange={vi.fn()}
      focus
      onFocusChange={vi.fn()}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      onOpenToolkit={onOpenToolkit}
    />,
  );
  const view = within(screen.getByRole("dialog", { name: "Reviewer in focus view" }));
  return { view, rail: within(view.getByRole("complementary", { name: "Filter notes" })) };
}

describe("Focus view › Memory", () => {
  it("counts each scope from one account list; this agent's notes show with force and origin", async () => {
    const { view, rail } = renderMemory();
    expect(await rail.findByRole("checkbox", { name: "This agent (2)" })).toBeChecked();
    expect(await rail.findByRole("checkbox", { name: "This repo (1)" })).not.toBeChecked();
    expect(rail.getByRole("checkbox", { name: "Account (1)" })).not.toBeChecked();
    expect(rail.getAllByRole("checkbox", { checked: true })).toHaveLength(7);

    expect(view.getByText("Learned in round 2 · confirmed 3× · pinned")).toBeInTheDocument();
    expect(view.getByText("Added by you · Sep 20")).toBeInTheDocument();
    expect(view.getByText("Suggested after round 3 of “Add an RSI indicator”")).toBeInTheDocument();
    expect(view.getByText("Not repo-specific · 1")).toBeInTheDocument();
    expect(view.queryByText("The registry test lists 28 names.")).toBeNull();
    expect(view.getByRole("switch", { name: "Remember what it learns" })).toBeDisabled();
  });

  it("adds the repo's and the account's notes, and filters by force and text", async () => {
    const { view, rail } = renderMemory();
    fireEvent.click(await rail.findByRole("checkbox", { name: "This repo (1)" }));
    expect(view.getByText("The registry test lists 28 names.")).toBeInTheDocument();
    expect(view.queryByText("Other repo lesson.")).toBeNull();
    fireEvent.click(rail.getByRole("checkbox", { name: "Account (1)" }));
    expect(view.getByText("Prefer small commits.")).toBeInTheDocument();

    // MUST off: the MUST notes go (this agent's and the repo's).
    fireEvent.click(rail.getByRole("checkbox", { name: "MUST" }));
    expect(view.queryByText("Run pytest quietly.")).toBeNull();
    expect(view.queryByText("The registry test lists 28 names.")).toBeNull();
    fireEvent.change(rail.getByRole("textbox", { name: "Search notes" }), {
      target: { value: "nothing like this" },
    });
    expect(view.getByText("No notes match these filters.")).toBeInTheDocument();
  });

  it("Keep saves right away and refreshes the counts; the rail opens Toolkit › Memory", async () => {
    const onOpenToolkit = vi.fn();
    const { view, rail } = renderMemory(onOpenToolkit);
    await rail.findByRole("checkbox", { name: "This repo (1)" });
    const listsBefore = fetchMock.mock.calls.filter((c) => c[0] === "/api/memories?status=active");
    fireEvent.click(view.getByRole("button", { name: "Keep" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => c[0] === "/api/memories?status=active").length,
      ).toBeGreaterThan(listsBefore.length),
    );
    fireEvent.click(rail.getByRole("link", { name: "Open Memory in Toolkit →" }));
    expect(onOpenToolkit).toHaveBeenCalledWith({ page: "memory", tab: "inbox" });
  });

  it("deleting an account note takes it off the list and the count, in words for its reach", async () => {
    const { view, rail } = renderMemory();
    fireEvent.click(await rail.findByRole("checkbox", { name: "Account (1)" }));
    const row = view.getByText("Prefer small commits.").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    const confirm = view.getByRole("alertdialog", { name: "Delete this note?" });
    expect(confirm).toHaveTextContent("Agents stop seeing it on their next run.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete note" }));
    expect(await rail.findByRole("checkbox", { name: "Account (0)" })).toBeChecked();
    expect(view.queryByText("Prefer small commits.")).toBeNull();
  });
});
