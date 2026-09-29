import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentsDrawer, type DocumentsDrawerProps } from "./DocumentsDrawer";

// The toolbar's Documents drawer while its run is live: a finished round looks again.

const PM = { node_id: "n-pm", clone_node_id: "c-pm", role_name: "pm", label: "Product manager" };
const ENG = { node_id: "n-eng", clone_node_id: "c-eng", role_name: "engineer", label: "Engineer" };
const latest = { version_no: 1, created_at: new Date().toISOString(), author: PM, note: null };
const SPEC = {
  id: "d-spec",
  name: "spec",
  is_shared_spec: true,
  latest_version: latest,
  written_by: [PM],
  read_by: [PM, ENG],
};
const NOTES = { ...SPEC, id: "d-notes", name: "build-notes", is_shared_spec: false };
const run = { run_id: "r1", idea: "Add an RSI indicator", status: "running", created_at: "" };

let documents: unknown[];
beforeEach(() => {
  documents = [SPEC];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ run, documents })))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("DocumentsDrawer", () => {
  it("a finished round lists the run's new documents, without blinking to Loading", async () => {
    const props: DocumentsDrawerProps = {
      runs: { state: "ready", value: [], retry: () => undefined },
      runId: "r1",
      tick: "pm:1",
      onPickRun: vi.fn(),
      agentCount: 2,
      onOpenDoc: vi.fn(),
      onClose: vi.fn(),
    };
    const view = render(<DocumentsDrawer {...props} />);
    const aside = within(screen.getByRole("complementary", { name: "Documents" }));
    expect(await aside.findByText("Shared spec")).toBeInTheDocument();
    expect(aside.getByText("No agent wrote a document of its own in this run.")).toBeVisible();

    documents = [SPEC, NOTES];
    view.rerender(<DocumentsDrawer {...props} tick="pm:1,eng:1" />);
    expect(aside.getByText("Shared spec")).toBeInTheDocument();
    expect(await aside.findByText("build-notes")).toBeInTheDocument();
  });
});
