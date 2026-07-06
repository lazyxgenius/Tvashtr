import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addSecret, listSecrets, removeSecret } from "../lib/api";
import { SecretsShelf } from "./SecretsShelf";

vi.mock("../lib/api", () => ({
  listSecrets: vi.fn(),
  addSecret: vi.fn(),
  removeSecret: vi.fn(),
}));
const m = {
  listSecrets: listSecrets as unknown as ReturnType<typeof vi.fn>,
  addSecret: addSecret as unknown as ReturnType<typeof vi.fn>,
  removeSecret: removeSecret as unknown as ReturnType<typeof vi.fn>,
};

beforeEach(() => {
  m.listSecrets.mockResolvedValue([]);
  m.addSecret.mockResolvedValue({ name: "X" });
  m.removeSecret.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("SecretsShelf (M-tools C7.A)", () => {
  it("lists secret NAMES (never values)", async () => {
    m.listSecrets.mockResolvedValue([{ name: "GITHUB_TOKEN" }]);
    render(<SecretsShelf />);
    expect(await screen.findByText("GITHUB_TOKEN")).toBeInTheDocument();
    // the value is masked, never rendered
    expect(screen.getByText("••••")).toBeInTheDocument();
  });

  it("adds a secret via name + value", async () => {
    render(<SecretsShelf />);
    fireEvent.change(screen.getByLabelText("Secret name"), { target: { value: "GH_TOKEN" } });
    fireEvent.change(screen.getByLabelText("Secret value"), { target: { value: "ghp_x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add secret" }));
    await waitFor(() => expect(m.addSecret).toHaveBeenCalledWith("GH_TOKEN", "ghp_x"));
  });

  it("removes a secret", async () => {
    m.listSecrets.mockResolvedValue([{ name: "GH_TOKEN" }]);
    render(<SecretsShelf />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove GH_TOKEN" }));
    await waitFor(() => expect(m.removeSecret).toHaveBeenCalledWith("GH_TOKEN"));
  });
});
