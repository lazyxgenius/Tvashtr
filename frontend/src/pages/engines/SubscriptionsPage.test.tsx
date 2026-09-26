import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunnerStatus } from "../../lib/api/engines";
import { DESKTOP_MAC_DMG_URL } from "../../lib/desktopDownload";
import { SUBSCRIPTION_DISCLOSURE } from "../../lib/engines";
import {
  RUNNER_STALE,
  SUBS,
  installDesktop,
  mockEnginesApi,
  renderEngines,
  resetEnginesState,
  sub,
} from "./enginesTestUtils";

beforeEach(() => resetEnginesState());
afterEach(() => {
  vi.unstubAllGlobals();
  resetEnginesState();
});

const RUNNER_FRESH: RunnerStatus = {
  fresh: true,
  last_seen_at: new Date().toISOString(),
  providers: ["claude", "grok"],
};

function api(runner = RUNNER_FRESH, subs = SUBS) {
  return mockEnginesApi({ "GET /api/engines/subscriptions": { subscriptions: subs, runner } });
}

const card = (name: string) => screen.getByRole("article", { name });

async function loaded() {
  await screen.findByRole("article", { name: "Codex" });
}

describe("Subscriptions on Desktop (Eng-Subs)", () => {
  it("shows the runner check-in, the three cards in order and the disclosure", async () => {
    api();
    installDesktop();
    renderEngines("subscriptions");
    await loaded();

    expect(screen.getByRole("heading", { level: 1, name: "Subscriptions" })).toBeInTheDocument();
    const banner = screen.getByRole("note", { name: "Tvashtr Desktop check-in" });
    expect(banner).toHaveTextContent(
      "Tvashtr Desktop is open and checking in. Subscription runs stop when you quit it.",
    );
    expect(banner).toHaveTextContent("Checked just now");
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("data-sub"))).toEqual([
      "claude",
      "grok",
      "codex",
    ]);

    const claude = within(card("Claude"));
    expect(claude.getByText("Claude Pro · via Claude Code")).toBeInTheDocument();
    expect(claude.getByText("Connected")).toBeInTheDocument();
    expect(claude.getByText("Engineer · Indicator sprint team")).toBeInTheDocument();
    expect(claude.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(claude.getByRole("button", { name: "Disconnect" })).toBeEnabled();

    const grok = within(card("Grok"));
    expect(grok.getByText("Needs login")).toBeInTheDocument();
    expect(grok.getByRole("button", { name: "Connect" })).toBeEnabled();

    const codex = within(card("Codex"));
    expect(codex.getByText("Status only")).toBeInTheDocument();
    expect(codex.getByText("Needs install")).toBeInTheDocument();
    expect(codex.getByRole("link", { name: "Install Codex CLI" })).toHaveAttribute(
      "href",
      "https://developers.openai.com/codex",
    );
    expect(codex.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(screen.getByText(SUBSCRIPTION_DISCLOSURE)).toBeInTheDocument();
  });

  it("warns when Desktop isn't checking in (ENG-25)", async () => {
    api(RUNNER_STALE);
    installDesktop();
    renderEngines("subscriptions");
    await loaded();
    expect(
      screen.getByText(
        "Tvashtr Desktop can’t reach Tvashtr right now. Subscription runs won’t start.",
      ),
    ).toBeInTheDocument();
  });

  it("Connect waits for the sign-in, then the pushed status connects Grok (Eng-Flow-Grok-1..3)", async () => {
    api();
    const desktop = installDesktop();
    renderEngines("subscriptions");
    await loaded();

    fireEvent.click(within(card("Grok")).getByRole("button", { name: "Connect" }));
    expect(desktop.engines.connect).toHaveBeenCalledWith("grok");
    const grok = within(card("Grok"));
    expect(await grok.findByText("Waiting for sign-in")).toBeInTheDocument();
    expect(grok.getByText("Checking…")).toBeInTheDocument();
    expect(
      grok.getByText(
        "Finish signing in to Grok in the Terminal window that just opened, then come back. Tvashtr checks again automatically.",
      ),
    ).toBeInTheDocument();
    expect(grok.getByRole("button", { name: "Checking" })).toBeDisabled();

    act(() => desktop.push(sub("grok", "connected", "SuperGrok")));
    expect(
      await screen.findByText("Grok connected. xai models now run on this computer."),
    ).toBeInTheDocument();
    expect(grok.getByText("Grok subscription · via Grok CLI")).toBeInTheDocument();
    expect(grok.getByText("Connected")).toBeInTheDocument();
    expect(grok.queryByText("Waiting for sign-in")).toBeNull();
  });

  it("Cancel stops waiting and asks the bridge to stop re-checking (ENG-32)", async () => {
    api();
    const desktop = installDesktop();
    renderEngines("subscriptions");
    await loaded();

    fireEvent.click(within(card("Grok")).getByRole("button", { name: "Connect" }));
    const grok = within(card("Grok"));
    fireEvent.click(await grok.findByRole("button", { name: "Cancel" }));
    expect(desktop.engines.cancelConnect).toHaveBeenCalledWith("grok");
    expect(await grok.findByText("Not signed in")).toBeInTheDocument();
    expect(grok.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("a Connect that can't open Terminal says so and stops waiting", async () => {
    api();
    const desktop = installDesktop();
    desktop.engines.connect.mockRejectedValueOnce(new Error("no terminal"));
    renderEngines("subscriptions");
    await loaded();

    fireEvent.click(within(card("Grok")).getByRole("button", { name: "Connect" }));
    expect(
      await screen.findByText("Couldn’t open a Terminal window to sign in. Try again."),
    ).toBeInTheDocument();
    expect(within(card("Grok")).getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("an older Desktop without cancelConnect still cancels (optional bridge calls)", async () => {
    api();
    const desktop = installDesktop();
    delete (desktop.engines as { cancelConnect?: unknown }).cancelConnect;
    renderEngines("subscriptions");
    await loaded();

    fireEvent.click(within(card("Grok")).getByRole("button", { name: "Connect" }));
    fireEvent.click(await within(card("Grok")).findByRole("button", { name: "Cancel" }));
    expect(await within(card("Grok")).findByText("Not signed in")).toBeInTheDocument();
  });

  it("Refresh checks Claude again and says when (ENG-33)", async () => {
    api();
    const desktop = installDesktop();
    const now = {
      ...sub("claude", "connected", "Claude Pro"),
      checked_at: new Date().toISOString(),
    };
    desktop.engines.refresh.mockResolvedValueOnce(now);
    renderEngines("subscriptions");
    await loaded();

    fireEvent.click(within(card("Claude")).getByRole("button", { name: "Refresh" }));
    expect(desktop.engines.refresh).toHaveBeenCalledWith("claude");
    expect(await screen.findByText("Claude is connected. Checked just now.")).toBeInTheDocument();
    expect(
      within(card("Claude")).getByText("Runs while Tvashtr Desktop is open. Checked just now."),
    ).toBeInTheDocument();
  });

  it("Codex: still not found, then found and Ready (Eng-Flow-Codex-1..3)", async () => {
    api();
    const desktop = installDesktop();
    renderEngines("subscriptions");
    await loaded();

    fireEvent.click(
      within(card("Codex")).getByRole("button", { name: "I’ve installed it — Refresh" }),
    );
    const codex = within(card("Codex"));
    expect(await codex.findByText("Still not found")).toBeInTheDocument();
    expect(
      codex.getByText(
        "Apps opened from the Dock don’t see your Terminal’s PATH. Quit Tvashtr fully, reopen it, then Refresh.",
      ),
    ).toBeInTheDocument();

    desktop.engines.refresh.mockResolvedValueOnce(sub("codex", "needs_login"));
    fireEvent.click(codex.getByRole("button", { name: "Refresh again" }));
    expect(
      await screen.findByText("Codex CLI found. It can’t run agents yet."),
    ).toBeInTheDocument();
    expect(codex.getByText("Ready")).toBeInTheDocument();
    expect(codex.getByText("Codex CLI found")).toBeInTheDocument();
    expect(
      codex.getByText("Codex can’t run agents yet. You’ll be ready when it can."),
    ).toBeInTheDocument();
  });

  it("Disconnect confirms the impact, then offers the key that takes over (ENG-42/43)", async () => {
    api();
    const desktop = installDesktop();
    desktop.engines.disconnect.mockResolvedValueOnce(sub("claude", "disconnected"));
    renderEngines("subscriptions");
    await loaded();

    fireEvent.click(within(card("Claude")).getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Disconnect Claude?" });
    expect(dialog).toHaveTextContent(
      "Engineer in Indicator sprint team uses anthropic models. Without Claude, it runs on your anthropic API key. You don’t have one yet, so it can’t run until you add a key or connect again. You stay signed in to Claude Code itself.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(desktop.engines.disconnect).toHaveBeenCalledWith("claude"));

    const toast = (await screen.findByText("Claude disconnected.")).closest(".ds-toast")!;
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const claude = within(card("Claude"));
    expect(claude.getByText("Disconnected")).toBeInTheDocument();
    expect(
      claude.getByText(
        "Engineer now runs on your anthropic API key, if you have one. Connect to use your Claude plan again.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(toast as HTMLElement).getByRole("button", { name: "Add anthropic key" }),
    );
    expect(await screen.findByRole("button", { name: /^Provider anthropic/ })).toBeInTheDocument();
  });
});

describe("Subscriptions on the website (ENG-46/49)", () => {
  it("shows the mirror with every Desktop action disabled", async () => {
    api(RUNNER_FRESH, [
      { ...sub("claude", "connected", "Claude Pro"), runner_fresh: true },
      sub("grok", "needs_login"),
      sub("codex", "needs_install"),
    ]);
    renderEngines("subscriptions");
    await loaded();

    expect(
      screen.getByText(
        "Subscriptions run on your own computer. Open Tvashtr Desktop to connect them. Website runs always use API keys.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      DESKTOP_MAC_DMG_URL,
    );
    const claude = within(card("Claude"));
    expect(
      claude.getByText("Connected on your computer. It only runs agents from Tvashtr Desktop."),
    ).toBeInTheDocument();
    expect(claude.getByRole("button", { name: "Refresh" })).toBeDisabled();
    expect(claude.getByRole("button", { name: "Disconnect" })).toBeDisabled();
    expect(within(card("Grok")).getByRole("button", { name: "Connect in Desktop" })).toBeDisabled();
    expect(
      within(card("Codex")).getByText("Status appears when Tvashtr Desktop is open."),
    ).toBeInTheDocument();
  });

  it("a connected subscription whose Desktop isn't checking in can open Desktop (ENG-38)", async () => {
    api(RUNNER_STALE);
    renderEngines("subscriptions");
    await loaded();
    const claude = within(card("Claude"));
    expect(claude.getByText("Desktop not checking in")).toBeInTheDocument();
    expect(claude.getByRole("button", { name: "Open Tvashtr Desktop" })).toBeEnabled();
  });
});
