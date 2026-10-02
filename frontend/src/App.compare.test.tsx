import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { ToastProvider } from "./design-system/components";

// M8 — the canvas toolbar's Compare on the real <App/> (the control plane stubbed): present while
// authoring (it opens #/teams/<id>/compare), absent in the run view; every control the toolbar had
// stays (brief §2.2).

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const node = (id: string, role_name: string, kind: string) => ({
  id,
  role_name,
  kind,
  model: "openai/gpt-4o-mini",
  engine: null,
  prompt: null,
  position: { x: 0, y: 0 },
  config: null,
});
const GRAPH = {
  team_graph_id: "team-1",
  name: "Indicator sprint team",
  nodes: [node("tn-pm", "pm", "completion"), node("tn-rev", "reviewer", "agent")],
  edges: [],
};
const VERSIONS = {
  current: 2,
  saved_at: ago(2),
  changes: 0,
  next: 3,
  total: 2,
  versions: [2, 1].map((number) => ({
    number,
    created_at: ago(number === 2 ? 2 : 60),
    author: "you",
    summary: number === 2 ? "Reviewer: stricter" : "First version",
    note: null,
    runs: 1,
    source: "save",
    restored_from: null,
  })),
};
const RUN = "run-12";

beforeEach(() => {
  window.location.hash = "";
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
      if (url === "/api/teams") return ok({ teams: [{ team_graph_id: "team-1", name: "x" }] });
      if (url === "/api/teams/team-1/graph") return ok(GRAPH);
      if (url === "/api/teams/team-1/validate")
        return ok({ errors: [], warnings: [], runnable: true });
      if (url === "/api/teams/team-1/versions") return ok(VERSIONS);
      if (url === "/api/teams/team-1/runs")
        return ok({
          runs: [
            { run_id: RUN, idea: "Add an RSI indicator", status: "completed", updated_at: ago(5) },
          ],
        });
      if (url === `/api/runs/${RUN}/documents`)
        return ok({ run: { run_id: RUN, status: "completed", live: false }, documents: [] });
      if (url === `/api/runs/${RUN}`)
        return ok({
          run_id: RUN,
          workflow_status: "SUCCESS",
          costs: [],
          run: {
            id: RUN,
            team_graph_id: "g",
            idea: "Add an RSI indicator",
            status: "completed",
            pm_document_id: null,
            ship_commit_sha: null,
            ship_tag: null,
            cost_total_usd: 0.84,
            created_at: ago(30),
            updated_at: ago(5),
            library_team_id: "team-1",
          },
        });
      if (url === `/api/runs/${RUN}/graph`)
        return ok({ run_id: RUN, team_graph_id: "g", nodes: [], edges: [] });
      if (url === `/api/runs/${RUN}/tasks`) return ok({ run_id: RUN, tasks: [] });
      return ok({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("App — M8 the toolbar's Compare", () => {
  it("keeps every toolbar control and adds Compare before Team file (authoring)", async () => {
    render(
      <ToastProvider>
        <App teamId="team-1" onBackToDashboard={vi.fn()} />
      </ToastProvider>,
    );
    const bar = screen.getByRole("toolbar", { name: "Team" });
    const compare = await within(bar).findByRole("button", { name: "Compare" });
    await within(bar).findByRole("button", { name: "Version history" });
    await within(bar).findByRole("button", { name: /^Documents/ });
    for (const name of ["Back to teams", "Run this team", "Team file"])
      expect(within(bar).getByRole("button", { name })).toBeInTheDocument();
    expect(within(bar).getByText("Indicator sprint team")).toBeInTheDocument();
    expect(within(bar).getByText("$0.00")).toBeInTheDocument();
    expect(within(bar).getByText("Connected")).toBeInTheDocument();
    expect(compare.nextElementSibling).toBe(within(bar).getByRole("button", { name: "Team file" }));

    fireEvent.click(compare);
    await waitFor(() => expect(window.location.hash).toBe("#/teams/team-1/compare"));
  });

  it("the run view has no Compare", async () => {
    render(
      <ToastProvider>
        <App teamId="team-1" initialRunId={RUN} />
      </ToastProvider>,
    );
    const bar = screen.getByRole("toolbar", { name: "Team" });
    await within(bar).findByRole("button", { name: "Edit this team" });
    expect(within(bar).queryByRole("button", { name: "Compare" })).toBeNull();
  });
});
