import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../design-system/components";
import { type DesktopSetup, loadDesktopSetup } from "../../../lib/desktopSetup";
import type { SubscriptionStatus } from "../../../lib/engines";
import {
  installDesktopBridge,
  ME,
  plan,
  stubFetch,
  uninstallDesktopBridge,
} from "../desktopTestUtils";
import { EnginesStep } from "./EnginesStep";

// DT-Engines' Mac: Claude Code connected, Grok found but signed out, Codex not installed.
const MAC_PLANS = [
  plan("claude", "connected"),
  plan("grok", "needs_login"),
  plan("codex", "needs_install"),
];

async function renderStep(
  opts: {
    plans?: SubscriptionStatus[];
    setup?: Partial<DesktopSetup>;
    keys?: { provider: string; key_last4: string; created_at: string }[];
    connect?: Partial<Record<SubscriptionStatus["provider"], SubscriptionStatus["state"]>>;
  } = {},
) {
  const bridge = installDesktopBridge({
    plans: opts.plans ?? MAC_PLANS,
    setup: { step: "engines", ...opts.setup },
    connect: opts.connect,
  });
  stubFetch({ "GET /api/providers": { body: { providers: opts.keys ?? [] } } });
  const setup = await loadDesktopSetup(ME.id);
  const props = { onSwitch: vi.fn(), onUseKey: vi.fn(), onSetUp: vi.fn() };
  render(
    <ToastProvider placement="setup">
      <EnginesStep login="lazyxgenius" setup={setup!} {...props} />
    </ToastProvider>,
  );
  // The bridge's statuses are in (Claude's row no longer says "Looking for…").
  await waitFor(() =>
    expect(within(row("claude")).queryByText("Looking for Claude Code on this Mac…")).toBeNull(),
  );
  return { bridge, props };
}

function row(provider: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-provider="${provider}"]`)!;
}

const continueButton = () => screen.getByRole("button", { name: "Continue" });

beforeEach(() => {
  window.location.hash = "#/setup/engines";
});

afterEach(() => {
  uninstallDesktopBridge();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EnginesStep — DT-Engines", () => {
  it("shows the heading, the three plan rows, API keys, the consent and the footer", async () => {
    await renderStep();
    expect(
      screen.getByRole("heading", { name: "How should your agents run?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "We looked for AI tools on this Mac. Your plan is used first; API keys are the backup.",
      ),
    ).toBeInTheDocument();

    const claude = within(row("claude"));
    expect(claude.getByText("Connected")).toBeInTheDocument();
    expect(claude.getByRole("switch", { name: "Use my Claude plan" })).toBeChecked();
    const grok = within(row("grok"));
    expect(grok.getByText("Needs sign-in")).toBeInTheDocument();
    expect(grok.getByRole("button", { name: "Sign in to Grok" })).toBeInTheDocument();
    const codex = within(row("codex"));
    expect(codex.getByText("Status only")).toBeInTheDocument();
    expect(
      codex.getByText("Not found. Tvashtr can show its status, but can’t run agents on it yet."),
    ).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Use an API key instead" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByText("Tvashtr isn’t affiliated with or endorsed by Anthropic or xAI."),
    ).toBeInTheDocument();
    // OQ-15: Back is shown but disabled on the first step after sign-in.
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeEnabled();
    // DT-27: a plan in use, box unticked → Continue off.
    expect(continueButton()).toBeDisabled();
  });

  it("the rail marks Sign in done and Engines current (aria-current=step)", async () => {
    await renderStep();
    const steps = within(screen.getByRole("list", { name: "Setup steps" })).getAllByRole(
      "listitem",
    );
    expect(steps.map((s) => s.getAttribute("aria-current"))).toEqual([null, "step", null, null]);
    expect(steps[0]).toHaveTextContent("Sign inlazyxgenius");
    expect(steps[1]).toHaveTextContent("2EnginesHow agents run here");
    expect(steps[3]).toHaveTextContent("4First teamStart from a template");
  });

  it("Switch in the rail signs out (DT-12)", async () => {
    const { props } = await renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(props.onSwitch).toHaveBeenCalledTimes(1);
  });

  it("How to install opens OpenAI's Codex page in the default browser", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await renderStep();
    fireEvent.click(within(row("codex")).getByRole("button", { name: "How to install" }));
    expect(open).toHaveBeenCalledWith(
      "https://developers.openai.com/codex",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("Use an API key instead and Set up hand over to the sheets", async () => {
    const { props } = await renderStep({
      plans: [plan("claude", "needs_install"), plan("grok", "needs_login")],
    });
    fireEvent.click(screen.getByRole("button", { name: "Use an API key instead" }));
    expect(props.onUseKey).toHaveBeenCalledTimes(1);
    fireEvent.click(within(row("claude")).getByRole("button", { name: "Set up" }));
    expect(props.onSetUp).toHaveBeenCalledWith("claude");
  });
});

describe("EnginesStep — Terminal sign-in (DT-23, DtF-Run-4)", () => {
  it("Sign in to Grok opens Terminal: the row checks and the overlay strip shows", async () => {
    const { bridge } = await renderStep({ connect: { grok: "needs_login" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Grok" }));
    const dialog = await screen.findByRole("dialog", { name: "Signing in to Grok" });
    expect(bridge.engines.connect).toHaveBeenCalledWith("grok");
    expect(dialog).toHaveTextContent(
      "We opened Terminal for you. Finish signing in to Grok there; this updates on its own.",
    );
    const grok = within(row("grok"));
    expect(grok.getByText("Checking…")).toBeInTheDocument();
    expect(grok.getByText("Finish signing in in the Terminal window")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("closes on its own when the bridge says Grok is connected", async () => {
    const { bridge } = await renderStep({ connect: { grok: "needs_login" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Grok" }));
    await screen.findByRole("dialog", { name: "Signing in to Grok" });
    // Focus came back from Terminal and the CLI answers "still not signed in": keep waiting.
    act(() => bridge.fireStatus(plan("grok", "needs_login")));
    expect(screen.getByRole("dialog", { name: "Signing in to Grok" })).toBeInTheDocument();
    act(() => bridge.fireStatus(plan("grok", "connected")));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(row("grok")).getByText("Connected")).toBeInTheDocument();
    expect(within(row("grok")).getByRole("switch", { name: "Use my Grok plan" })).toBeChecked();
  });

  it("Cancel stops waiting and restores the row (it can't close Terminal)", async () => {
    const { bridge } = await renderStep({ connect: { grok: "needs_login" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Grok" }));
    const dialog = await screen.findByRole("dialog", { name: "Signing in to Grok" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bridge.engines.cancelConnect).toHaveBeenCalledWith("grok");
    expect(within(row("grok")).getByText("Needs sign-in")).toBeInTheDocument();
    expect(
      within(row("grok")).getByRole("button", { name: "Sign in to Grok" }),
    ).toBeInTheDocument();
  });

  it("focus stays on Cancel; Escape is Cancel", async () => {
    const { bridge } = await renderStep({ connect: { grok: "needs_login" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Grok" }));
    const dialog = await screen.findByRole("dialog", { name: "Signing in to Grok" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    // Tab stays on the dialog's only control.
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bridge.engines.cancelConnect).toHaveBeenCalledWith("grok");
  });

  it("a CLI that is still signed in connects at once, with no overlay left behind", async () => {
    await renderStep({ connect: { grok: "connected" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Grok" }));
    await waitFor(() => expect(within(row("grok")).getByText("Connected")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Claude uses the same flow with its own words", async () => {
    await renderStep({
      plans: [plan("claude", "needs_login"), plan("grok", "connected")],
      connect: { claude: "needs_login" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Claude" }));
    const dialog = await screen.findByRole("dialog", { name: "Signing in to Claude" });
    expect(dialog).toHaveTextContent("Finish signing in to Claude there; this updates on its own.");
  });
});

describe("EnginesStep — Use my plan (DT-24)", () => {
  it("off disconnects (sticky; the row reads Not used), on connects again", async () => {
    const { bridge } = await renderStep();
    fireEvent.click(within(row("claude")).getByRole("switch", { name: "Use my Claude plan" }));
    await waitFor(() => expect(within(row("claude")).getByText("Not used")).toBeInTheDocument());
    expect(bridge.engines.disconnect).toHaveBeenCalledWith("claude");
    expect(
      within(row("claude")).getByText(
        "Tvashtr won’t run agents on your Claude plan. Turn this on to use it again.",
      ),
    ).toBeInTheDocument();
    const off = within(row("claude")).getByRole("switch", { name: "Use my Claude plan" });
    expect(off).not.toBeChecked();

    fireEvent.click(off);
    await waitFor(() => expect(within(row("claude")).getByText("Connected")).toBeInTheDocument());
    expect(bridge.engines.connect).toHaveBeenCalledWith("claude");
  });

  it("Check again re-asks a CLI whose check failed", async () => {
    const { bridge } = await renderStep({
      plans: [plan("claude", "connected"), plan("grok", "error")],
    });
    fireEvent.click(within(row("grok")).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(within(row("grok")).getByText("Connected")).toBeInTheDocument());
    expect(bridge.engines.refresh).toHaveBeenCalledWith("grok");
  });
});

describe("EnginesStep — consent and Continue (DT-27, DtF-Run-5)", () => {
  it("ticking the note saves it on this Mac with a time and turns Continue on", async () => {
    const { bridge } = await renderStep({
      plans: [plan("claude", "connected"), plan("grok", "connected")],
    });
    expect(continueButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(continueButton()).toBeEnabled();
    await waitFor(() => expect(bridge.setup.update).toHaveBeenCalledTimes(1));
    const [account, patch] = bridge.setup.update.mock.calls[0];
    expect(account).toBe(ME.id);
    expect(Object.keys(patch)).toEqual(["planConsentAt"]);
    expect(patch.planConsentAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(continueButton()).toBeDisabled();
    await waitFor(() =>
      expect(bridge.setup.update).toHaveBeenLastCalledWith(ME.id, { planConsentAt: null }),
    );
  });

  it("a consent ticked earlier on this Mac is still ticked", async () => {
    await renderStep({ setup: { planConsentAt: "2026-09-26T10:00:00.000Z" } });
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(continueButton()).toBeEnabled();
  });

  it("no plan in use and a saved key: Continue is on without the box (DtF-Key-3)", async () => {
    await renderStep({
      plans: [plan("claude", "needs_install"), plan("grok", "needs_login")],
      keys: [{ provider: "anthropic", key_last4: "9c1e", created_at: "2026-09-26T10:00:00Z" }],
    });
    await waitFor(() => expect(continueButton()).toBeEnabled());
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("Continue saves the next step and goes to Project", async () => {
    const { bridge } = await renderStep({ setup: { planConsentAt: "2026-09-26T10:00:00.000Z" } });
    fireEvent.click(continueButton());
    expect(window.location.hash).toBe("#/setup/project");
    await waitFor(() =>
      expect(bridge.setup.update).toHaveBeenCalledWith(ME.id, { step: "project" }),
    );
  });

  it("Skip for now goes on to Project with nothing set up", async () => {
    const { bridge } = await renderStep({ plans: [plan("claude", "needs_install")] });
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(window.location.hash).toBe("#/setup/project");
    await waitFor(() =>
      expect(bridge.setup.update).toHaveBeenCalledWith(ME.id, { step: "project" }),
    );
  });
});
