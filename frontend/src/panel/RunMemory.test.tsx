import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRunMemories, listMemories, promoteMemory, rejectMemory } from "../lib/api";
import type { NodeInvocation, NodeMemoryRow } from "../lib/api";
import { RunMemory } from "./RunMemory";

// S5b Surface 1 — the run-inspector Memory tab. Mock the api client (MemoryShelf pattern) so the two
// zones ("Used this run" = injected refs resolved client-side; "Learned this run" = getRunMemories)
// and the inline Confirm/Discard are exercised without a backend.

vi.mock("../lib/api", () => ({
  listMemories: vi.fn(),
  getRunMemories: vi.fn(),
  promoteMemory: vi.fn(),
  rejectMemory: vi.fn(),
}));

const mList = listMemories as unknown as ReturnType<typeof vi.fn>;
const mRun = getRunMemories as unknown as ReturnType<typeof vi.fn>;
const mPromote = promoteMemory as unknown as ReturnType<typeof vi.fn>;
const mReject = rejectMemory as unknown as ReturnType<typeof vi.fn>;

function mem(over: Partial<NodeMemoryRow> = {}): NodeMemoryRow {
  return {
    id: "m1",
    content: "a fact",
    polarity: "context",
    repo_key: null,
    node_id: null,
    tier: "account",
    pinned: false,
    status: "active",
    confirmation_count: 1,
    source_run_id: "r1",
    source_invocation_id: null,
    embedding_dim: 1536,
    valid_from: null,
    invalid_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: null,
    ...over,
  };
}

function inv(memory: { id: string; polarity: string }[] | null): NodeInvocation {
  return {
    iteration: 1,
    status: "done",
    outcome: "built",
    outcome_detail: null,
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T00:01:00Z",
    context_manifest: memory
      ? { parts: [], total_tokens: 0, budget: 0, handle_used: false, memory }
      : null,
    cost: null,
  };
}

beforeEach(() => {
  mList.mockResolvedValue([]);
  mRun.mockResolvedValue([]);
  mPromote.mockResolvedValue(mem());
  mReject.mockResolvedValue(mem());
});
afterEach(() => vi.clearAllMocks());

describe("RunMemory — Used this run", () => {
  it("resolves the node's injected ids to content + a polarity badge (include_superseded)", async () => {
    mList.mockResolvedValue([
      mem({ id: "a", content: "run the linter", polarity: "require", tier: "account" }),
    ]);
    render(<RunMemory invocations={[inv([{ id: "a", polarity: "require" }])]} runId="r1" />);
    expect(await screen.findByText("run the linter")).toBeInTheDocument();
    expect(screen.getByText("MUST")).toBeInTheDocument();
    // superseded facts must still resolve, so the client asks for them
    expect(mList).toHaveBeenCalledWith({ include_superseded: true });
  });

  it("shows '(no longer stored)' with the polarity when a used id is gone from the store", async () => {
    mList.mockResolvedValue([]); // the store no longer has the used id
    render(<RunMemory invocations={[inv([{ id: "gone", polarity: "avoid" }])]} runId="r1" />);
    expect(await screen.findByText("(no longer stored)")).toBeInTheDocument();
    expect(screen.getByText("SHOULD NOT")).toBeInTheDocument(); // the avoid badge survives
  });

  it("empties the Used zone when no memory was injected", async () => {
    render(<RunMemory invocations={[inv(null)]} runId="r1" />);
    expect(await screen.findByText(/No memory was injected/i)).toBeInTheDocument();
  });
});

describe("RunMemory — Learned this run", () => {
  it("lists the run's taught facts with the run-level note", async () => {
    mRun.mockResolvedValue([
      mem({ id: "L", content: "prefers small PRs", polarity: "prefer", status: "active" }),
    ]);
    render(<RunMemory invocations={[]} runId="r1" />);
    expect(await screen.findByText("prefers small PRs")).toBeInTheDocument();
    expect(screen.getByText(/shown on every node/i)).toBeInTheDocument();
    expect(mRun).toHaveBeenCalledWith("r1");
  });

  it("offers Confirm on a pending taught fact and promotes it, dropping it from pending", async () => {
    mRun.mockResolvedValueOnce([
      mem({ id: "P", content: "always lint", status: "pending_review" }),
    ]);
    render(<RunMemory invocations={[]} runId="r1" />);
    const confirm = await screen.findByRole("button", { name: "Confirm always lint" });
    fireEvent.click(confirm);
    await waitFor(() => expect(mPromote).toHaveBeenCalledWith("P"));
    // the post-promote reload (default []) drops it out of the pending list
    await waitFor(() => expect(screen.queryByText("always lint")).toBeNull());
  });

  it("offers Discard on a pending taught fact and rejects it", async () => {
    mRun.mockResolvedValueOnce([mem({ id: "Q", content: "skip this", status: "pending_review" })]);
    render(<RunMemory invocations={[]} runId="r1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Discard skip this" }));
    await waitFor(() => expect(mReject).toHaveBeenCalledWith("Q"));
  });

  it("empties the Learned zone when the run taught nothing", async () => {
    render(<RunMemory invocations={[]} runId="r1" />);
    expect(await screen.findByText(/hasn.t taught any durable memory/i)).toBeInTheDocument();
  });
});
