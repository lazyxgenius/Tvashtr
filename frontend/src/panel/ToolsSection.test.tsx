import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolLibraryItem, listSecrets, listToolCatalog, listToolLibrary } from "../lib/api";
import { mockApi, sampleDomains } from "../pages/domains/domainsTestUtils";
import { ToolsSection } from "./ToolsSection";

// ToolsSection fetches secret NAMES, library tools, and (catalog MVP) the built-in tool catalog.
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  listSecrets: vi.fn(),
  listToolLibrary: vi.fn(),
  listToolCatalog: vi.fn(),
  createToolLibraryItem: vi.fn(),
}));
const mockList = listSecrets as unknown as ReturnType<typeof vi.fn>;
const mockLibrary = listToolLibrary as unknown as ReturnType<typeof vi.fn>;
const mockCatalog = listToolCatalog as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createToolLibraryItem as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockList.mockResolvedValue([]);
  mockLibrary.mockResolvedValue([]);
  mockCatalog.mockResolvedValue([
    {
      key: "fetch",
      name: "fetch",
      title: "Web fetch",
      description: "Fetch HTTP URLs",
      access: "free",
      secret_names: [],
      badge: "Free",
      attachable: true,
      server_config: { command: "uvx", args: ["mcp-server-fetch"] },
    },
  ]);
  mockCreate.mockResolvedValue({ id: "new-fetch", name: "fetch" });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ToolsSection (M-tools C7.A)", () => {
  it("round-trips a pasted mcp.json through onChange", () => {
    const onChange = vi.fn();
    render(<ToolsSection value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Tools JSON"), {
      target: { value: '{"mcpServers":{"fetch":{"command":"uvx"}}}' },
    });
    expect(onChange).toHaveBeenCalledWith({ mcpServers: { fetch: { command: "uvx" } } });
  });

  it("seeds the textarea from an existing tool_config value", () => {
    render(<ToolsSection value={{ mcpServers: {} }} onChange={vi.fn()} />);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Tools JSON").value).toContain("mcpServers");
  });

  it("clears to null when the editor is emptied", () => {
    const onChange = vi.fn();
    render(<ToolsSection value={{ mcpServers: {} }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Tools JSON"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  // M-unify U3: the editor is available on EVERY node now (the thinker/worker split collapsed to the
  // edits toggle) — no `capability` prop, no worker-only note. An edits-off node still runs read-only +
  // MCP tools, so it authors tools too. (Mutation-real: on the pre-U3 gate a non-worker rendered only
  // the "switch this node to Worker" note with NO editor.)
  it("renders the full Tools editor on every node (no worker-only gate)", () => {
    render(<ToolsSection value={null} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Tools JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add server" })).toBeInTheDocument();
    expect(screen.queryByText(/switch this node to Worker/i)).toBeNull();
  });

  it("appends a server via the guided Add-server form", () => {
    const onChange = vi.fn();
    render(<ToolsSection value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("New server name"), { target: { value: "fetch" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "uvx" } });
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    expect(onChange).toHaveBeenCalledWith({ mcpServers: { fetch: { command: "uvx", args: [] } } });
  });

  it("writes the tvashtr allow-list metadata when a server is toggled off", () => {
    const onChange = vi.fn();
    render(
      <ToolsSection value={{ mcpServers: { fetch: { command: "uvx" } } }} onChange={onChange} />,
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
      />,
    );
    await waitFor(() => expect(screen.queryByText(/Needs .*GITHUB_TOKEN/)).toBeNull());
  });

  // ---- C7.C: "Add from library" picker + library-reference rows + the overridden tag ----

  it("lists library tools in the picker and greys out a name-collision", async () => {
    mockLibrary.mockResolvedValue([
      { id: "t1", name: "fetch", server_config: { command: "uvx" }, created_at: "x" },
      { id: "t2", name: "gh", server_config: { url: "https://x" }, created_at: "x" },
    ]);
    // an inline server named "gh" already exists → the "gh" library item is greyed out (name clash)
    render(<ToolsSection value={{ mcpServers: { gh: { command: "z" } } }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add from library" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add fetch from library" })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: "Add gh from library" })).toBeDisabled();
  });

  it("picking a library tool appends its id to tvashtr.library and renders a Library row", async () => {
    const onChange = vi.fn();
    mockLibrary.mockResolvedValue([
      { id: "t1", name: "fetch", server_config: { command: "uvx" }, created_at: "x" },
    ]);
    render(<ToolsSection value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add from library" }));
    await waitFor(() => screen.getByRole("button", { name: "Add fetch from library" }));
    fireEvent.click(screen.getByRole("button", { name: "Add fetch from library" }));
    expect(onChange).toHaveBeenCalledWith({ tvashtr: { library: ["t1"] } });
    expect(screen.getByText("Library")).toBeInTheDocument(); // the badge on the referenced row
  });

  it("shows an 'overridden' tag when an inline server shares a name with a library reference", async () => {
    mockLibrary.mockResolvedValue([
      { id: "t1", name: "gh", server_config: { command: "lib" }, created_at: "x" },
    ]);
    render(
      <ToolsSection
        value={{ mcpServers: { gh: { command: "inline" } }, tvashtr: { library: ["t1"] } }}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("overridden")).toBeInTheDocument());
  });

  it("remove-reference drops the id from tvashtr.library", async () => {
    const onChange = vi.fn();
    mockLibrary.mockResolvedValue([
      { id: "t1", name: "fetch", server_config: { command: "uvx" }, created_at: "x" },
    ]);
    render(<ToolsSection value={{ tvashtr: { library: ["t1"] } }} onChange={onChange} />);
    await waitFor(() => screen.getByRole("button", { name: "Remove reference fetch" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove reference fetch" }));
    expect(onChange).toHaveBeenCalledWith({ tvashtr: { library: [] } });
  });
});

describe("ToolsSection catalog MVP", () => {
  it("the Domains checklist ticks a domain into tvashtr.domains (DM-105)", async () => {
    mockApi({ "GET /api/domains": { domains: sampleDomains() } });
    const onChange = vi.fn();
    render(<ToolsSection value={null} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Support docs/ }));
    expect(onChange).toHaveBeenCalledWith({ tvashtr: { domains: ["d-support"] } });
  });

  it("unticking the last domain with nothing else clears to null", async () => {
    mockApi({ "GET /api/domains": { domains: sampleDomains() } });
    const onChange = vi.fn();
    render(<ToolsSection value={{ tvashtr: { domains: ["d-support"] } }} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Support docs/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("an agent that could search every domain keeps the others when one is unticked", async () => {
    mockApi({ "GET /api/domains": { domains: sampleDomains() } });
    const onChange = vi.fn();
    render(<ToolsSection value={{ tvashtr: { domains: true } }} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Q3 filings/ }));
    expect(onChange).toHaveBeenCalledWith({
      tvashtr: { domains: ["d-support", "d-vendor", "d-research"] },
    });
  });

  it("an agent on a Desktop plan is told it gets no domain tools there (DM-106)", async () => {
    mockApi({ "GET /api/domains": { domains: sampleDomains() } });
    render(<ToolsSection value={null} onChange={vi.fn()} subscription="claude" />);
    expect(
      await screen.findByText(
        "On Tvashtr Desktop with your Claude plan it can’t search domains yet.",
      ),
    ).toBeInTheDocument();
  });

  it("Attach fetch uses the fallback when the catalog is empty", async () => {
    const onChange = vi.fn();
    mockCatalog.mockResolvedValue([]);
    render(<ToolsSection value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Attach fetch" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith("fetch", {
        command: "uvx",
        args: ["mcp-server-fetch"],
      }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ tvashtr: { library: ["new-fetch"] } }),
    );
  });

  it("Attach fetch reuses an existing library fetch without create", async () => {
    mockLibrary.mockResolvedValue([
      {
        id: "existing-fetch",
        name: "fetch",
        server_config: { command: "uvx", args: ["mcp-server-fetch"] },
        created_at: "x",
      },
    ]);
    const onChange = vi.fn();
    render(<ToolsSection value={null} onChange={onChange} />);
    await waitFor(() => expect(mockLibrary).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Attach fetch" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ tvashtr: { library: ["existing-fetch"] } }),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
