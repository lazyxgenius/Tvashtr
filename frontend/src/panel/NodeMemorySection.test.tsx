import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NodeMemoryRow } from "../lib/api";
import {
  deleteMemory,
  listMemories,
  pinMemory,
  promoteMemory,
  rejectMemory,
  unpinMemory,
  updateMemory,
} from "../lib/api";
import { NodeMemorySection } from "./NodeMemorySection";

// S5b Surface 2 — the authoring-drawer Memory section: an INDEPENDENT-fetch + direct-mutate mini-shelf
// scoped to node_id. Mock the api client (MemoryShelf pattern); the factory must list every api
// export the component (and MemoryFact) imports at runtime.

vi.mock("../lib/api", () => ({
  listMemories: vi.fn(),
  pinMemory: vi.fn(),
  unpinMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  promoteMemory: vi.fn(),
  rejectMemory: vi.fn(),
}));

const mList = listMemories as unknown as ReturnType<typeof vi.fn>;
const mPin = pinMemory as unknown as ReturnType<typeof vi.fn>;
const mUnpin = unpinMemory as unknown as ReturnType<typeof vi.fn>;
const mUpdate = updateMemory as unknown as ReturnType<typeof vi.fn>;
const mDelete = deleteMemory as unknown as ReturnType<typeof vi.fn>;
const mPromote = promoteMemory as unknown as ReturnType<typeof vi.fn>;
const mReject = rejectMemory as unknown as ReturnType<typeof vi.fn>;

function mem(over: Partial<NodeMemoryRow> = {}): NodeMemoryRow {
  return {
    id: "m1",
    content: "a note",
    polarity: "context",
    repo_key: "/repo",
    node_id: "node-x",
    tier: "node",
    pinned: false,
    status: "active",
    confirmation_count: 1,
    source_run_id: "r1",
    source_invocation_id: 5,
    embedding_dim: 1536,
    valid_from: null,
    invalid_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: null,
    ...over,
  };
}

// The section fires listMemories twice on mount: active (no status) + pending (status pending_review).
function stubList(active: NodeMemoryRow[], pending: NodeMemoryRow[] = []) {
  mList.mockImplementation((p: { status?: string } = {}) =>
    Promise.resolve(p.status === "pending_review" ? pending : active),
  );
}

beforeEach(() => {
  stubList([]);
  mPin.mockResolvedValue(mem());
  mUnpin.mockResolvedValue(mem());
  mUpdate.mockResolvedValue(mem());
  mDelete.mockResolvedValue(undefined);
  mPromote.mockResolvedValue(mem());
  mReject.mockResolvedValue(mem());
});
afterEach(() => vi.clearAllMocks());

describe("NodeMemorySection", () => {
  it("fetches the node's node-tier notes and renders them with manage controls", async () => {
    stubList([mem({ id: "n1", content: "avoid global state" })]);
    render(<NodeMemorySection nodeId="node-x" />);
    expect(await screen.findByText("avoid global state")).toBeInTheDocument();
    // scoped to this node's id
    expect(mList).toHaveBeenCalledWith({ node_id: "node-x" });
    // manage variant → pin / edit / delete controls
    expect(screen.getByRole("button", { name: "Pin avoid global state" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit avoid global state" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete avoid global state" })).toBeInTheDocument();
  });

  it("teaches node memory in an empty state and links to the shelf via onManageAll", async () => {
    stubList([]);
    const onManageAll = vi.fn();
    render(<NodeMemorySection nodeId="node-x" onManageAll={onManageAll} />);
    expect(await screen.findByText(/no private notes yet/i)).toHaveTextContent(
      "shared repo-wide lessons live in Toolkit › Memory.",
    );
    fireEvent.click(screen.getByRole("button", { name: /manage all memory/i }));
    expect(onManageAll).toHaveBeenCalledTimes(1);
  });

  it("pins a note through the pin control", async () => {
    stubList([mem({ id: "n1", content: "note one", pinned: false })]);
    render(<NodeMemorySection nodeId="node-x" />);
    fireEvent.click(await screen.findByRole("button", { name: "Pin note one" }));
    await waitFor(() => expect(mPin).toHaveBeenCalledWith("n1"));
  });

  it("offers inline Confirm on a pending note and promotes it", async () => {
    stubList([], [mem({ id: "p1", content: "cache the config", status: "pending_review" })]);
    render(<NodeMemorySection nodeId="node-x" />);
    const confirm = await screen.findByRole("button", { name: "Confirm cache the config" });
    fireEvent.click(confirm);
    await waitFor(() => expect(mPromote).toHaveBeenCalledWith("p1"));
  });

  it("groups the notes by repo when the node has learned on more than one repo", async () => {
    stubList([
      mem({ id: "a", content: "note A", repo_key: "/alpha" }),
      mem({ id: "b", content: "note B", repo_key: "/beta" }),
    ]);
    render(<NodeMemorySection nodeId="node-x" />);
    expect(await screen.findByText("note A")).toBeInTheDocument();
    expect(screen.getByText("/alpha")).toBeInTheDocument();
    expect(screen.getByText("/beta")).toBeInTheDocument();
  });

  it("does not repo-group a single-repo node (flat list)", async () => {
    stubList([
      mem({ id: "a", content: "note A", repo_key: "/only" }),
      mem({ id: "b", content: "note B", repo_key: "/only" }),
    ]);
    render(<NodeMemorySection nodeId="node-x" />);
    expect(await screen.findByText("note A")).toBeInTheDocument();
    // the single repo key is NOT rendered as a sub-head
    expect(screen.queryByText("/only")).toBeNull();
  });
});
