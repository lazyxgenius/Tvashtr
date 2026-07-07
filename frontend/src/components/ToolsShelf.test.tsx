import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createToolLibraryItem,
  deleteToolLibraryItem,
  listToolLibrary,
  updateToolLibraryItem,
} from "../lib/api";
import { ToolsShelf } from "./ToolsShelf";

// M-tools C7.C — the account Tool library shelf. Mock the CRUD client (no network).
vi.mock("../lib/api", () => ({
  listToolLibrary: vi.fn(),
  createToolLibraryItem: vi.fn(),
  updateToolLibraryItem: vi.fn(),
  deleteToolLibraryItem: vi.fn(),
}));
const mList = listToolLibrary as unknown as ReturnType<typeof vi.fn>;
const mCreate = createToolLibraryItem as unknown as ReturnType<typeof vi.fn>;
const mUpdate = updateToolLibraryItem as unknown as ReturnType<typeof vi.fn>;
const mDelete = deleteToolLibraryItem as unknown as ReturnType<typeof vi.fn>;

const ROW = { id: "t1", name: "fetch", server_config: { command: "uvx" }, created_at: "x" };

beforeEach(() => {
  mList.mockResolvedValue([]);
  mCreate.mockResolvedValue({ id: "t1", name: "fetch" });
  mUpdate.mockResolvedValue({ id: "t1", name: "fetch" });
  mDelete.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("ToolsShelf (M-tools C7.C)", () => {
  it("lists the account's existing library tools with a transport badge", async () => {
    mList.mockResolvedValue([ROW]);
    render(<ToolsShelf />);
    await waitFor(() => expect(screen.getByText("fetch")).toBeInTheDocument());
    expect(screen.getByText("stdio")).toBeInTheDocument(); // command → stdio badge
  });

  it("adds a tool via name + a JSON server config", async () => {
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
});
