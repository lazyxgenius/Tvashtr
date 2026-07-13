import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMemory,
  deleteMemory,
  getReviewMode,
  listMemories,
  pinMemory,
  promoteMemory,
  rejectMemory,
  setReviewMode,
  updateMemory,
} from "../lib/api";
import type { NodeMemoryRow } from "../lib/api";
import { MemoryShelf } from "./MemoryShelf";

vi.mock("../lib/api", () => ({
  listMemories: vi.fn(),
  createMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  pinMemory: vi.fn(),
  unpinMemory: vi.fn(),
  promoteMemory: vi.fn(),
  rejectMemory: vi.fn(),
  getReviewMode: vi.fn(),
  setReviewMode: vi.fn(),
}));

const mList = listMemories as unknown as ReturnType<typeof vi.fn>;
const mCreate = createMemory as unknown as ReturnType<typeof vi.fn>;
const mUpdate = updateMemory as unknown as ReturnType<typeof vi.fn>;
const mDelete = deleteMemory as unknown as ReturnType<typeof vi.fn>;
const mPin = pinMemory as unknown as ReturnType<typeof vi.fn>;
const mPromote = promoteMemory as unknown as ReturnType<typeof vi.fn>;
const mReject = rejectMemory as unknown as ReturnType<typeof vi.fn>;
const mGetReview = getReviewMode as unknown as ReturnType<typeof vi.fn>;
const mSetReview = setReviewMode as unknown as ReturnType<typeof vi.fn>;

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
    source_run_id: null,
    source_invocation_id: null,
    embedding_dim: 1536,
    valid_from: null,
    invalid_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: null,
    ...over,
  };
}

// The default: everything empty, review mode off. Individual tests override `mList` by branching on
// the `status` arg (active = no status; pending_review / superseded / rejected for the other lists).
beforeEach(() => {
  mList.mockResolvedValue([]);
  mCreate.mockResolvedValue(mem());
  mUpdate.mockResolvedValue(mem());
  mDelete.mockResolvedValue(undefined);
  mPin.mockResolvedValue(mem({ pinned: true }));
  mPromote.mockResolvedValue(mem({ status: "active" }));
  mReject.mockResolvedValue(mem({ status: "rejected" }));
  mGetReview.mockResolvedValue(false);
  mSetReview.mockResolvedValue(true);
});
afterEach(() => vi.clearAllMocks());

describe("MemoryShelf", () => {
  it("teaches the concept with an empty state when nothing is learned yet", async () => {
    render(<MemoryShelf />);
    expect(await screen.findByText(/haven.t learned anything yet/i)).toBeInTheDocument();
  });

  it("lists the account's active facts with a polarity badge", async () => {
    mList.mockImplementation((p: { status?: string } = {}) =>
      Promise.resolve(
        p.status
          ? []
          : [mem({ id: "a1", content: "use pnpm", polarity: "require", tier: "account" })],
      ),
    );
    render(<MemoryShelf />);
    expect(await screen.findByText("use pnpm")).toBeInTheDocument();
    expect(screen.getByText("MUST")).toBeInTheDocument();
  });

  it("reflects and toggles the review-mode switch", async () => {
    render(<MemoryShelf />);
    const sw = await screen.findByRole("switch", { name: /Review new memories/i });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    await waitFor(() => expect(mSetReview).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
  });

  it("adds an account-tier fact via the form", async () => {
    render(<MemoryShelf />);
    await waitFor(() => expect(mList).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("New memory content"), {
      target: { value: "use pnpm" },
    });
    fireEvent.change(screen.getByLabelText("Polarity"), { target: { value: "require" } });
    fireEvent.click(screen.getByRole("button", { name: "Add memory" }));
    await waitFor(() =>
      expect(mCreate).toHaveBeenCalledWith({
        content: "use pnpm",
        polarity: "require",
        repo_key: null,
      }),
    );
  });

  it("adds a repo-tier fact with its repo path", async () => {
    render(<MemoryShelf />);
    await waitFor(() => expect(mList).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("New memory content"), {
      target: { value: "prefer vitest" },
    });
    fireEvent.change(screen.getByLabelText("Tier"), { target: { value: "repo" } });
    fireEvent.change(screen.getByLabelText("Repo path"), { target: { value: "/srv/app" } });
    fireEvent.change(screen.getByLabelText("Polarity"), { target: { value: "prefer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add memory" }));
    await waitFor(() =>
      expect(mCreate).toHaveBeenCalledWith({
        content: "prefer vitest",
        polarity: "prefer",
        repo_key: "/srv/app",
      }),
    );
  });

  it("shows the pending inbox and promotes on Confirm", async () => {
    mList.mockImplementation((p: { status?: string } = {}) =>
      Promise.resolve(
        p.status === "pending_review" ? [mem({ id: "p1", content: "maybe flaky" })] : [],
      ),
    );
    render(<MemoryShelf />);
    const confirm = await screen.findByRole("button", { name: "Confirm maybe flaky" });
    fireEvent.click(confirm);
    await waitFor(() => expect(mPromote).toHaveBeenCalledWith("p1"));
  });

  it("discards a pending fact via Reject", async () => {
    mList.mockImplementation((p: { status?: string } = {}) =>
      Promise.resolve(p.status === "pending_review" ? [mem({ id: "p2", content: "noise" })] : []),
    );
    render(<MemoryShelf />);
    fireEvent.click(await screen.findByRole("button", { name: "Discard noise" }));
    await waitFor(() => expect(mReject).toHaveBeenCalledWith("p2"));
  });

  it("pins an active fact", async () => {
    mList.mockImplementation((p: { status?: string } = {}) =>
      Promise.resolve(p.status ? [] : [mem({ id: "a1", content: "use pnpm", pinned: false })]),
    );
    render(<MemoryShelf />);
    await screen.findByText("use pnpm");
    fireEvent.click(screen.getByRole("button", { name: "Pin use pnpm" }));
    await waitFor(() => expect(mPin).toHaveBeenCalledWith("a1"));
  });

  it("edits an active fact", async () => {
    mList.mockImplementation((p: { status?: string } = {}) =>
      Promise.resolve(
        p.status ? [] : [mem({ id: "a1", content: "use pnpm", polarity: "context" })],
      ),
    );
    render(<MemoryShelf />);
    await screen.findByText("use pnpm");
    fireEvent.click(screen.getByRole("button", { name: "Edit use pnpm" }));
    fireEvent.change(screen.getByLabelText("Edit content"), { target: { value: "use bun" } });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
    await waitFor(() =>
      expect(mUpdate).toHaveBeenCalledWith("a1", { content: "use bun", polarity: "context" }),
    );
  });

  it("deletes an active fact after the inline confirm", async () => {
    mList.mockImplementation((p: { status?: string } = {}) =>
      Promise.resolve(p.status ? [] : [mem({ id: "a1", content: "use pnpm" })]),
    );
    render(<MemoryShelf />);
    await screen.findByText("use pnpm");
    fireEvent.click(screen.getByRole("button", { name: "Delete use pnpm" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(mDelete).toHaveBeenCalledWith("a1"));
  });

  it("reveals superseded + rejected facts on Show archived", async () => {
    mList.mockImplementation((p: { status?: string } = {}) => {
      if (p.status === "superseded")
        return Promise.resolve([mem({ id: "s1", content: "old rule", status: "superseded" })]);
      if (p.status === "rejected")
        return Promise.resolve([mem({ id: "r1", content: "bad rule", status: "rejected" })]);
      return Promise.resolve([]);
    });
    render(<MemoryShelf />);
    await waitFor(() => expect(mList).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Show archived/i }));
    expect(await screen.findByText("old rule")).toBeInTheDocument();
    expect(await screen.findByText("bad rule")).toBeInTheDocument();
  });

  it("buckets account / repo / per-node facts under a repo selector", async () => {
    mList.mockImplementation((p: { status?: string } = {}) =>
      Promise.resolve(
        p.status
          ? []
          : [
              mem({ id: "acc", content: "account fact", repo_key: null, tier: "account" }),
              mem({
                id: "r1",
                content: "repo fact",
                repo_key: "/srv/app",
                node_id: null,
                tier: "repo",
              }),
              mem({
                id: "n1",
                content: "node fact",
                repo_key: "/srv/app",
                node_id: "11111111-2222-3333-4444-555555555555",
                tier: "node",
              }),
            ],
      ),
    );
    render(<MemoryShelf />);
    // The account-tier fact renders in the Account section.
    expect(await screen.findByText("account fact")).toBeInTheDocument();
    // The repo selector appears once there are repo-scoped facts (distinct from the add-form "Repo path").
    expect(screen.getByLabelText("Repo")).toBeInTheDocument();
    // The selected repo's This-repo fact + its per-node subsection (headed by the truncated node id).
    expect(screen.getByText("repo fact")).toBeInTheDocument();
    expect(screen.getByText("node fact")).toBeInTheDocument();
    expect(screen.getByText(/Node 11111111/)).toBeInTheDocument();
  });
});
