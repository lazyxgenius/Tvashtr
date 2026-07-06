import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolsSection } from "./ToolsSection";

// M-tools C7.0 (scaffold): the Tools stub. A worker gets a JSON editor wired to onChange; a thinker
// gets only the worker-only note (tools run in a worker's sandbox). fireEvent (not user-event) drives
// the textarea — a single change with complete JSON is the round-trip the Save wire relies on.

describe("ToolsSection (M-tools C7.0 stub)", () => {
  it("renders the Tools editor for a worker and round-trips valid JSON through onChange", () => {
    const onChange = vi.fn();
    render(<ToolsSection value={null} onChange={onChange} capability="worker" />);

    expect(screen.getByText("Tools")).toBeInTheDocument();
    const ta = screen.getByLabelText("Tools JSON");
    fireEvent.change(ta, { target: { value: '{"mcpServers":{"fetch":{"command":"uvx"}}}' } });
    expect(onChange).toHaveBeenCalledWith({ mcpServers: { fetch: { command: "uvx" } } });
  });

  it("shows the worker-only note (no editor) for a thinker", () => {
    const onChange = vi.fn();
    render(<ToolsSection value={null} onChange={onChange} capability="thinker" />);

    expect(screen.getByText(/switch this node to Worker to add them/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Tools JSON")).toBeNull();
  });

  it("seeds the textarea from an existing tool_config value", () => {
    render(<ToolsSection value={{ mcpServers: {} }} onChange={vi.fn()} capability="worker" />);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Tools JSON").value).toContain("mcpServers");
  });

  it("clears to null when the editor is emptied", () => {
    const onChange = vi.fn();
    render(<ToolsSection value={{ mcpServers: {} }} onChange={onChange} capability="worker" />);
    fireEvent.change(screen.getByLabelText("Tools JSON"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
