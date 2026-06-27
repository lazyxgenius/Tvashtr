import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { RunRow } from "../lib/api";
import { RunBanner } from "./RunBanner";

function run(over: Partial<RunRow>): RunRow {
  return {
    id: "run-1",
    team_graph_id: "g1",
    idea: "idea",
    status: "completed",
    pm_document_id: null,
    ship_commit_sha: null,
    ship_tag: null,
    repo_path: null,
    base_ref: null,
    ship_branch: null,
    cost_total_usd: 0.0123,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("RunBanner — greenfield ship vs brownfield branch", () => {
  it("greenfield: shows the ship commit Item, no branch", () => {
    render(
      <RunBanner
        runId="run-abc12345"
        run={run({ ship_tag: "ship-run-1", ship_commit_sha: "abcdef1234567" })}
        workflowStatus="SUCCESS"
        costs={[]}
      />,
    );
    expect(screen.getByText("ship")).toBeInTheDocument();
    expect(screen.getByText("abcdef123")).toBeInTheDocument(); // the 9-char sha slice
    expect(screen.queryByText("branch")).toBeNull();
  });

  it("brownfield: shows the branch Item (and NOT ship) when ship_branch is set", () => {
    render(
      <RunBanner
        runId="run-abc12345"
        run={run({
          ship_tag: "ship-run-1",
          ship_commit_sha: "abcdef1234567",
          ship_branch: "tvashtr/run-1",
          repo_path: "/Users/me/repo",
          base_ref: "main",
        })}
        workflowStatus="SUCCESS"
        costs={[]}
      />,
    );
    expect(screen.getByText("branch")).toBeInTheDocument();
    expect(screen.getByText("tvashtr/run-1")).toBeInTheDocument();
    expect(screen.queryByText("ship")).toBeNull();
  });

  it("in flight (no ship): neither a branch nor a ship Item", () => {
    render(
      <RunBanner
        runId="run-abc12345"
        run={run({ status: "running" })}
        workflowStatus="PENDING"
        costs={[]}
      />,
    );
    expect(screen.queryByText("branch")).toBeNull();
    expect(screen.queryByText("ship")).toBeNull();
  });
});
