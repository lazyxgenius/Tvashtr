import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { NodeMemoryRow } from "../lib/api";
import { MemoryFact } from "./MemoryFact";

function row(over: Partial<NodeMemoryRow> = {}): NodeMemoryRow {
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

describe("MemoryFact", () => {
  it("renders the content and the RFC-2119 polarity badge", () => {
    render(<MemoryFact memory={row({ content: "use pnpm", polarity: "require" })} />);
    expect(screen.getByText("use pnpm")).toBeInTheDocument();
    expect(screen.getByText("MUST")).toBeInTheDocument();
  });

  it("shows the tier tag only when showTier is set", () => {
    const { rerender } = render(<MemoryFact memory={row({ tier: "account" })} />);
    expect(screen.queryByText("Account")).toBeNull();
    rerender(<MemoryFact memory={row({ tier: "account" })} showTier />);
    expect(screen.getByText("Account")).toBeInTheDocument();
  });

  it("shows 'seen N×' only when confirmed more than once", () => {
    const { rerender } = render(<MemoryFact memory={row({ confirmation_count: 1 })} />);
    expect(screen.queryByText(/seen/)).toBeNull();
    rerender(<MemoryFact memory={row({ confirmation_count: 3 })} />);
    expect(screen.getByText(/seen 3×/)).toBeInTheDocument();
  });

  it("toggles pin via onTogglePin in the manage variant", () => {
    const onTogglePin = vi.fn();
    render(<MemoryFact memory={row({ content: "c", pinned: false })} onTogglePin={onTogglePin} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin c" }));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it("labels the pin button Unpin when the fact is already pinned", () => {
    render(<MemoryFact memory={row({ content: "c", pinned: true })} onTogglePin={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Unpin c" })).toBeInTheDocument();
  });

  it("edits inline and calls onSaveEdit with the new content + polarity", () => {
    const onSaveEdit = vi.fn();
    render(
      <MemoryFact
        memory={row({ id: "m1", content: "old", polarity: "context" })}
        onSaveEdit={onSaveEdit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit old" }));
    fireEvent.change(screen.getByLabelText("Edit content"), { target: { value: "new text" } });
    fireEvent.change(screen.getByLabelText("Edit polarity"), { target: { value: "require" } });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
    expect(onSaveEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }), {
      content: "new text",
      polarity: "require",
    });
  });

  it("requires an inline confirm step before deleting", () => {
    const onDelete = vi.fn();
    render(<MemoryFact memory={row({ content: "c" })} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete c" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("renders Confirm/Discard in the pending variant", () => {
    const onConfirm = vi.fn();
    const onDiscard = vi.fn();
    render(
      <MemoryFact
        memory={row({ content: "c" })}
        variant="pending"
        onConfirm={onConfirm}
        onDiscard={onDiscard}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm c" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard c" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("is read-only in the archived variant and shows the status", () => {
    render(<MemoryFact memory={row({ content: "c", status: "rejected" })} variant="archived" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("rejected")).toBeInTheDocument();
  });
});
