import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../lib/api";
import { EnginesShelf } from "./EnginesShelf";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    listProviders: vi.fn(),
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
    listSubscriptionStatuses: vi.fn(),
    putSubscriptionStatus: vi.fn(),
    deleteSubscriptionStatus: vi.fn(),
    providerSuggestions: vi.fn(() => ["openrouter", "openai", "anthropic"]),
  };
});

const disconnected = (provider: "claude" | "grok" | "codex") => ({
  provider,
  connected: false,
  state: "disconnected" as const,
  account_hint: null,
  source: null,
  checked_at: null,
});

afterEach(() => {
  vi.clearAllMocks();
  delete (window as Window & { tvashtrDesktop?: unknown }).tvashtrDesktop;
});

describe("EnginesShelf", () => {
  it("renders subscription cards disabled on web with local-only copy", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([]);
    vi.mocked(api.listSubscriptionStatuses).mockResolvedValue([
      disconnected("claude"),
      disconnected("grok"),
      disconnected("codex"),
    ]);
    render(<EnginesShelf />);
    expect(await screen.findByRole("region", { name: /Engines/i })).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Grok")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    screen.getAllByRole("button", { name: /Connect/i }).forEach((b) => expect(b).toBeDisabled());
    expect(screen.getByText(/open Tvashtr Desktop to connect/i)).toBeInTheDocument();
  });

  it("enables Connect on Desktop and calls engines.connect", async () => {
    const connect = vi.fn().mockResolvedValue({
      provider: "claude",
      connected: true,
      state: "connected",
      account_hint: "ada@ex.com",
      source: "harness",
      checked_at: "2026-09-15T00:00:00Z",
    });
    window.tvashtrDesktop = {
      engines: {
        getStatus: vi.fn().mockResolvedValue([]),
        connect,
        disconnect: vi.fn(),
        refresh: vi.fn(),
      },
    };
    vi.mocked(api.listProviders).mockResolvedValue([]);
    vi.mocked(api.listSubscriptionStatuses).mockResolvedValue([
      disconnected("claude"),
      disconnected("grok"),
      disconnected("codex"),
    ]);
    render(<EnginesShelf />);
    const btn = await screen.findByRole("button", { name: /Connect Claude/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(connect).toHaveBeenCalledWith("claude"));
  });

  it("keeps BYOK add-key working under Engines", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([]);
    vi.mocked(api.listSubscriptionStatuses).mockResolvedValue([]);
    vi.mocked(api.addProvider).mockResolvedValue({ provider: "openrouter", key_last4: "1234" });
    vi.mocked(api.listProviders)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { provider: "openrouter", key_last4: "1234", created_at: "2026-09-15T00:00:00Z" },
      ]);
    render(<EnginesShelf />);
    fireEvent.change(await screen.findByLabelText(/^Provider$/i), {
      target: { value: "openrouter" },
    });
    fireEvent.change(screen.getByLabelText(/^API key$/i), { target: { value: "sk-test-1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Add key/i }));
    await waitFor(() => expect(api.addProvider).toHaveBeenCalledWith("openrouter", "sk-test-1234"));
  });

  it("separates Subscriptions from API keys and promotes quit-stops-runs on Desktop", async () => {
    window.tvashtrDesktop = {
      engines: {
        getStatus: vi.fn().mockResolvedValue([]),
        connect: vi.fn(),
        disconnect: vi.fn(),
        refresh: vi.fn(),
      },
    };
    vi.mocked(api.listProviders).mockResolvedValue([]);
    vi.mocked(api.listSubscriptionStatuses).mockResolvedValue([]);
    render(<EnginesShelf />);
    expect(await screen.findByRole("heading", { name: "Subscriptions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "API keys" })).toBeInTheDocument();
    expect(screen.getByText(/stop when Desktop quits/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Bring your own keys/i })).not.toBeInTheDocument();
  });

  it("shows explicit Provider and API key labels", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([]);
    vi.mocked(api.listSubscriptionStatuses).mockResolvedValue([]);
    render(<EnginesShelf />);
    await screen.findByRole("region", { name: /Engines/i });
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("API key")).toBeInTheDocument();
  });
});
