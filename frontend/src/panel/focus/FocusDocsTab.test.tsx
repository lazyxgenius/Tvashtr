import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { CATALOGUE, edges, engineer, json, pm, reviewer, ship, stubFetch } from "../editorTestKit";
import { NodeEditor } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// The focus view's Docs tab (Focus-Docs, FOCUS-71..73): the viewer's panes inside the focus view.

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ref = (node_id: string, label: string) => ({
  node_id,
  clone_node_id: `c-${node_id}`,
  role_name: node_id,
  label,
});
const PM = { kind: "agent", node_id: "n-pm", role_name: "pm", label: "Product manager" };
const HISTORY = {
  runs: [
    { run_id: "r1", idea: "Add an RSI indicator", rounds_count: 3, last_round_at: ago(31) },
    { run_id: "r0", idea: "Fix the MACD label", rounds_count: 1, last_round_at: ago(3000) },
  ],
  run: null,
};
const DOCS = {
  r1: [
    {
      id: "d-spec",
      name: "spec",
      is_shared_spec: true,
      latest_version: { version_no: 2, created_at: ago(31), author: PM, note: null },
      written_by: [ref("n-pm", "Product manager")],
      read_by: [ref("n-eng", "Engineer"), ref("n-rev", "Reviewer")],
    },
    {
      id: "d-notes",
      name: "build-notes",
      latest_version: { version_no: 1, created_at: ago(36), author: null, note: null },
      written_by: [ref("n-eng", "Engineer")],
      read_by: [ref("n-rev", "Reviewer")],
    },
  ],
  r0: [],
};
const version = (n: number, content: string, min: number) => ({
  id: `v${n}`,
  version_no: n,
  content,
  created_at: ago(min),
  author: PM,
  note: n === 1 ? "First draft" : "Revised in round 2",
});
const SPEC = {
  id: "d-spec",
  name: "spec",
  run_id: "r1",
  is_shared_spec: true,
  editable: true,
  versions: [version(1, "# RSI\n\n- One", 52), version(2, "# RSI\n\n- One\n- Two", 31)],
};
const ran: TeamGraphNode["last_run"] = {
  run_id: "r1",
  iteration: 3,
  outcome: "changes_requested",
  outcome_detail: null,
  started_at: ago(33),
};

beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  stubFetch(
    () => reviewer(),
    (url) => {
      if (url.startsWith("/api/teams/t1/nodes/")) return json(HISTORY);
      const m = /^\/api\/runs\/(\w+)\/documents$/.exec(url);
      if (m) return json({ documents: DOCS[m[1] as "r1" | "r0"] });
      if (url === "/api/documents/d-spec") return json(SPEC);
      if (url === "/api/documents/d-notes")
        return json({ ...SPEC, id: "d-notes", name: "build-notes", is_shared_spec: false });
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

function renderFocusDocs(onOpenDoc = vi.fn()) {
  const saved = reviewer({ last_run: ran });
  render(
    <NodeEditor
      teamId="t1"
      node={saved}
      nodes={[pm, engineer, saved, ship]}
      edges={edges}
      isEntry={false}
      cover={{ byok: new Set(["xai"]), subs: {} }}
      tab="docs"
      onTabChange={vi.fn()}
      focus
      onFocusChange={vi.fn()}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      onOpenDoc={onOpenDoc}
    />,
  );
  return onOpenDoc;
}

describe("Focus view › Docs", () => {
  it("shows the run's documents, the shared spec and its versions", async () => {
    const onOpenDoc = renderFocusDocs();
    const view = within(screen.getByRole("dialog", { name: "Reviewer in focus view" }));
    await view.findByRole("heading", { name: "RSI" });
    const rail = within(view.getByRole("complementary", { name: "This run’s documents" }));
    expect(
      rail.getByRole("button", { name: /Shared spec\s*Product manager · v2/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      rail.getByRole("button", { name: "Run “Add an RSI indicator” · 31m ago" }),
    ).toBeVisible();
    expect(view.getByText("v2 · written by Product manager · 31m ago")).toBeInTheDocument();
    const versions = within(view.getByRole("complementary", { name: "Versions" }));
    expect(versions.getByText("Product manager · Revised in round 2")).toBeInTheDocument();

    // A version, then Compare; Open takes the same place to the viewer.
    fireEvent.click(versions.getByRole("button", { name: /^v1/ }));
    expect(view.getByText("v1 · written by Product manager · 52m ago")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Open" }));
    expect(onOpenDoc).toHaveBeenLastCalledWith("d-spec", { version: 1 });
    fireEvent.click(versions.getByRole("button", { name: "Compare" }));
    expect(view.getByText(/^Comparing/)).toHaveTextContent("Comparing v2 (Product manager) → v1");
  });

  it("the rail switches documents; its foot picks another run (OQ-16)", async () => {
    renderFocusDocs();
    const view = within(screen.getByRole("dialog", { name: "Reviewer in focus view" }));
    await view.findByRole("heading", { name: "RSI" });
    const rail = within(view.getByRole("complementary", { name: "This run’s documents" }));
    fireEvent.click(rail.getByRole("button", { name: /build-notes/ }));
    expect(await view.findByText("build-notes", { selector: ".ds-badge" })).toBeInTheDocument();

    fireEvent.click(rail.getByRole("button", { name: /^Run “Add an RSI indicator”/ }));
    fireEvent.click(view.getByRole("menuitem", { name: /Fix the MACD label/ }));
    expect(await view.findByText("No documents in this run yet.")).toBeInTheDocument();
  });
});
