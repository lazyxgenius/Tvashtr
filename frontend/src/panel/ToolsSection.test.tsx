import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listSecrets } from "../lib/api";
import { ToolsSection } from "./ToolsSection";

// ToolsSection fetches the account's secret NAMES to flag an unstored `${NAME}`. Mock just that.
vi.mock("../lib/api", () => ({ listSecrets: vi.fn() }));
const mockList = listSecrets as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mockList.mockResolvedValue([]));
afterEach(() => vi.clearAllMocks());

describe("ToolsSection (M-tools C7.A)", () => {
  it("round-trips a pasted mcp.json through onChange", () => {
    const onChange = vi.fn();
    render(<ToolsSection value={null} onChange={onChange} capability="worker" />);
    fireEvent.change(screen.getByLabelText("Tools JSON"), {
      target: { value: '{"mcpServers":{"fetch":{"command":"uvx"}}}' },
    });
    expect(onChange).toHaveBeenCalledWith({ mcpServers: { fetch: { command: "uvx" } } });
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

  it("shows the worker-only note (no editor) for a thinker", () => {
    render(<ToolsSection value={null} onChange={vi.fn()} capability="thinker" />);
    expect(screen.getByText(/switch this node to Worker to add them/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Tools JSON")).toBeNull();
  });

  it("appends a server via the guided Add-server form", () => {
    const onChange = vi.fn();
    render(<ToolsSection value={null} onChange={onChange} capability="worker" />);
    fireEvent.change(screen.getByLabelText("New server name"), { target: { value: "fetch" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "uvx" } });
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    expect(onChange).toHaveBeenCalledWith({ mcpServers: { fetch: { command: "uvx", args: [] } } });
  });

  it("writes the tvashtr allow-list metadata when a server is toggled off", () => {
    const onChange = vi.fn();
    render(
      <ToolsSection
        value={{ mcpServers: { fetch: { command: "uvx" } } }}
        onChange={onChange}
        capability="worker"
      />,
    );
    fireEvent.click(screen.getByLabelText("Enable fetch")); // was on → toggle off
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ tvashtr: { servers: { fetch: { enabled: false } } } }),
    );
  });

  it("flags a ${NAME} reference that isn't in the account's stored secrets", () => {
    render(
      <ToolsSection
        value={{ mcpServers: { gh: { command: "x", env: { GH: "${GITHUB_TOKEN}" } } } }}
        onChange={vi.fn()}
        capability="worker"
      />,
    );
    expect(screen.getByText(/Needs .*GITHUB_TOKEN/)).toBeInTheDocument();
  });

  it("does NOT flag a ${NAME} once its secret is stored", async () => {
    mockList.mockResolvedValue([{ name: "GITHUB_TOKEN" }]);
    render(
      <ToolsSection
        value={{ mcpServers: { gh: { command: "x", env: { GH: "${GITHUB_TOKEN}" } } } }}
        onChange={vi.fn()}
        capability="worker"
      />,
    );
    await waitFor(() => expect(screen.queryByText(/Needs .*GITHUB_TOKEN/)).toBeNull());
  });
});
