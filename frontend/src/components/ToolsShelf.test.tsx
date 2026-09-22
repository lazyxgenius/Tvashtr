import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createToolLibraryItem,
  deleteToolLibraryItem,
  listToolCatalog,
  listToolLibrary,
  updateToolLibraryItem,
} from "../lib/api";
import { ToolsShelf, buildServerConfig } from "./ToolsShelf";

// M-tools C7.C — the account Tool library shelf. Mock the CRUD client (no network).
vi.mock("../lib/api", () => ({
  listToolLibrary: vi.fn(),
  listToolCatalog: vi.fn(),
  createToolLibraryItem: vi.fn(),
  updateToolLibraryItem: vi.fn(),
  deleteToolLibraryItem: vi.fn(),
}));
const mList = listToolLibrary as unknown as ReturnType<typeof vi.fn>;
const mCatalog = listToolCatalog as unknown as ReturnType<typeof vi.fn>;
const mCreate = createToolLibraryItem as unknown as ReturnType<typeof vi.fn>;
const mUpdate = updateToolLibraryItem as unknown as ReturnType<typeof vi.fn>;
const mDelete = deleteToolLibraryItem as unknown as ReturnType<typeof vi.fn>;

const CATALOG = [
  {
    key: "fetch",
    name: "fetch",
    title: "Web fetch",
    description: "Fetch HTTP URLs",
    access: "free" as const,
    secret_names: [] as string[],
    badge: "Free",
    attachable: true,
    server_config: { command: "uvx", args: ["mcp-server-fetch"] },
  },
  {
    key: "github",
    name: "github",
    title: "GitHub (PAT)",
    description: "GitHub via PAT",
    access: "needs_secret" as const,
    secret_names: ["GITHUB_TOKEN"],
    badge: "Needs ${GITHUB_TOKEN}",
    attachable: true,
    server_config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
    },
  },
  {
    key: "github-app",
    name: "github-app",
    title: "GitHub App repos",
    description: "Hosted GitHub App",
    access: "needs_github_app" as const,
    secret_names: [] as string[],
    badge: "Needs GitHub App",
    attachable: false,
    server_config: {},
  },
];

const ROW = { id: "t1", name: "fetch", server_config: { command: "uvx" }, created_at: "x" };

beforeEach(() => {
  mList.mockResolvedValue([]);
  mCatalog.mockResolvedValue(CATALOG);
  mCreate.mockResolvedValue({ id: "t1", name: "fetch" });
  mUpdate.mockResolvedValue({ id: "t1", name: "fetch" });
  mDelete.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

// ── buildServerConfig: the pure guided-form → server_config builder ──────────────
// server_config is the INNER object ({command,args,env} / {url,headers}) — never mcpServers-wrapped.
describe("buildServerConfig (pure)", () => {
  it("builds a local stdio config and splits args on whitespace", () => {
    expect(buildServerConfig("local", "uvx", "mcp-server-fetch  --port 3000", [])).toEqual({
      command: "uvx",
      args: ["mcp-server-fetch", "--port", "3000"],
    });
  });

  it("emits args:[] for a local server with no args (never omits the key)", () => {
    expect(buildServerConfig("local", "uvx", "   ", [])).toEqual({ command: "uvx", args: [] });
  });

  it("folds env rows into a local `env` map, dropping blank keys", () => {
    expect(
      buildServerConfig("local", "uvx", "x", [
        { key: "API_KEY", value: "${OPENAI_KEY}" },
        { key: "  ", value: "ignored" },
      ]),
    ).toEqual({ command: "uvx", args: ["x"], env: { API_KEY: "${OPENAI_KEY}" } });
  });

  it("builds a remote http config from the url, ignoring args", () => {
    expect(buildServerConfig("remote", "https://ex/mcp", "these are ignored", [])).toEqual({
      url: "https://ex/mcp",
    });
  });

  it("folds header rows into a remote `headers` map (not env)", () => {
    expect(
      buildServerConfig("remote", "https://ex/mcp", "", [
        { key: "Authorization", value: "Bearer ${TOKEN}" },
      ]),
    ).toEqual({ url: "https://ex/mcp", headers: { Authorization: "Bearer ${TOKEN}" } });
  });

  it("omits env/headers entirely when no non-blank rows exist", () => {
    expect(buildServerConfig("local", "uvx", "", [{ key: "", value: "v" }])).toEqual({
      command: "uvx",
      args: [],
    });
    expect(buildServerConfig("remote", "https://ex/mcp", "", [])).toEqual({
      url: "https://ex/mcp",
    });
  });
});

describe("ToolsShelf (M-tools C7.C)", () => {
  it("points operators to node Tools for Domains MCP", () => {
    render(<ToolsShelf />);
    const note = screen.getByRole("note", { name: /Domains MCP location/i });
    expect(note.textContent).toMatch(/Domains MCP/i);
    expect(note.textContent).toMatch(/node|Tools panel/i);
  });

  // ── existing behaviors (unchanged) ──
  it("lists the account's existing library tools with a transport badge", async () => {
    mList.mockResolvedValue([ROW]);
    render(<ToolsShelf />);
    await waitFor(() => expect(screen.getByText("fetch")).toBeInTheDocument());
    expect(screen.getByText("stdio")).toBeInTheDocument(); // command → stdio badge
  });

  it("adds a tool via name + a raw JSON server config", async () => {
    render(<ToolsShelf />);
    fireEvent.change(screen.getByLabelText("Tool name"), { target: { value: "fetch" } });
    fireEvent.change(screen.getByLabelText("Server config JSON"), {
      target: { value: '{"command":"uvx","args":["mcp-server-fetch"]}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    await waitFor(() =>
      expect(mCreate).toHaveBeenCalledWith("fetch", {
        command: "uvx",
        args: ["mcp-server-fetch"],
      }),
    );
  });

  it("rejects an empty / non-object server config (no API call)", () => {
    render(<ToolsShelf />);
    fireEvent.change(screen.getByLabelText("Tool name"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Server config JSON"), { target: { value: "{}" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    expect(mCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("edits an existing tool (PATCH) then removes it (DELETE)", async () => {
    mList.mockResolvedValue([ROW]);
    render(<ToolsShelf />);
    await waitFor(() => screen.getByText("fetch"));
    fireEvent.click(screen.getByRole("button", { name: "Edit fetch" }));
    fireEvent.change(screen.getByLabelText("Server config JSON"), {
      target: { value: '{"command":"uvx","args":["x"]}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save tool" }));
    await waitFor(() =>
      expect(mUpdate).toHaveBeenCalledWith("t1", "fetch", { command: "uvx", args: ["x"] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove fetch" }));
    await waitFor(() => expect(mDelete).toHaveBeenCalledWith("t1"));
  });

  // ── guided form (new) — configText stays the single source of truth ──
  it("guided Local fields regenerate the raw JSON and drive the exact create payload", async () => {
    render(<ToolsShelf />);
    fireEvent.change(screen.getByLabelText("Tool name"), { target: { value: "fetch" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "uvx" } });
    fireEvent.change(screen.getByLabelText("Arguments"), {
      target: { value: "mcp-server-fetch" },
    });
    // guided edits are mirrored into the Advanced raw-JSON textarea (single source of truth)
    const raw = screen.getByLabelText<HTMLTextAreaElement>("Server config JSON");
    expect(JSON.parse(raw.value)).toEqual({ command: "uvx", args: ["mcp-server-fetch"] });

    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    await waitFor(() =>
      expect(mCreate).toHaveBeenCalledWith("fetch", {
        command: "uvx",
        args: ["mcp-server-fetch"],
      }),
    );
  });

  it("guided env rows land under `env` in the create payload", async () => {
    render(<ToolsShelf />);
    fireEvent.change(screen.getByLabelText("Tool name"), { target: { value: "srv" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "uvx" } });
    fireEvent.click(screen.getByRole("button", { name: "Add variable" }));
    fireEvent.change(screen.getByLabelText("Environment variable name 1"), {
      target: { value: "API_KEY" },
    });
    fireEvent.change(screen.getByLabelText("Environment variable value 1"), {
      target: { value: "${OPENAI_KEY}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    await waitFor(() =>
      expect(mCreate).toHaveBeenCalledWith("srv", {
        command: "uvx",
        args: [],
        env: { API_KEY: "${OPENAI_KEY}" },
      }),
    );
  });

  it("edit-path parses server_config back into the guided transport + field", async () => {
    mList.mockResolvedValue([
      { id: "t2", name: "remotesrv", server_config: { url: "https://ex/mcp" }, created_at: "x" },
    ]);
    render(<ToolsShelf />);
    await waitFor(() => screen.getByText("remotesrv"));
    fireEvent.click(screen.getByRole("button", { name: "Edit remotesrv" }));
    // transport flips to Remote and the field becomes URL, pre-filled from server_config
    expect(screen.getByRole("button", { name: "Remote" }).className).toContain("tv-seg__btn--active");
    expect(screen.getByLabelText<HTMLInputElement>("URL").value).toBe("https://ex/mcp");
  });

  it("switching transport reshapes the config (command → url)", () => {
    render(<ToolsShelf />);
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "uvx" } });
    fireEvent.click(screen.getByRole("button", { name: "Remote" }));
    // the command field is now a URL field...
    expect(screen.getByLabelText("URL")).toBeInTheDocument();
    // ...and the raw JSON is reshaped to a remote {url} object
    const raw = screen.getByLabelText<HTMLTextAreaElement>("Server config JSON");
    expect(JSON.parse(raw.value)).toEqual({ url: "uvx" });
  });

  it("lays the add-tool form out in a library grid, not a skinny head rail", () => {
    render(<ToolsShelf />);
    const form = document.querySelector(".tv-dash__library-form");
    expect(form).not.toBeNull();
    expect(form?.closest(".tv-dash__prov-head")).toBeNull();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Command")).toBeInTheDocument();
  });
});

describe("ToolsShelf built-in catalog", () => {
  it("renders Free / Needs ${SECRET} / Needs GitHub App badges", async () => {
    render(<ToolsShelf />);
    await waitFor(() => expect(screen.getByLabelText("Built-in tool catalog")).toBeInTheDocument());
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Needs ${GITHUB_TOKEN}")).toBeInTheDocument();
    expect(screen.getByText("Needs GitHub App")).toBeInTheDocument();
  });

  it("Add to library upserts fetch via createToolLibraryItem", async () => {
    render(<ToolsShelf />);
    await waitFor(() => screen.getByRole("button", { name: "Add fetch from catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "Add fetch from catalog" }));
    await waitFor(() =>
      expect(mCreate).toHaveBeenCalledWith("fetch", {
        command: "uvx",
        args: ["mcp-server-fetch"],
      }),
    );
  });
});
