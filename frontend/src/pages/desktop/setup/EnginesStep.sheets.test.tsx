import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../design-system/components";
import { resetProviderDirectoryCache } from "../../../lib/api/desktop";
import { loadDesktopSetup } from "../../../lib/desktopSetup";
import type { SubscriptionStatus } from "../../../lib/engines";
import {
  installDesktopBridge,
  ME,
  plan,
  stubFetch,
  uninstallDesktopBridge,
} from "../desktopTestUtils";
import { EnginesStep } from "./EnginesStep";

type State = SubscriptionStatus["state"];

/** The directory as `/api/config` serves it (NVIDIA NIM serves no model Tvashtr can run). */
const DIRECTORY = [
  {
    provider: "anthropic",
    monogram: "A",
    name: "Anthropic",
    label: "Claude models",
    example_model: "anthropic/claude-sonnet-5",
    subscription: "claude",
    embeddings: false,
    hint: null,
    serves_models: true,
  },
  {
    provider: "xai",
    monogram: "X",
    name: "xAI",
    label: "Grok models",
    example_model: "xai/grok-4",
    subscription: "grok",
    embeddings: false,
    hint: null,
    serves_models: true,
  },
  {
    provider: "nvidia_nim",
    monogram: "N",
    name: "NVIDIA NIM",
    label: "NIM models",
    example_model: null,
    subscription: null,
    embeddings: false,
    hint: "NVIDIA NIM serves no model Tvashtr can run right now.",
    serves_models: false,
  },
];

const PASTED = "sk-ant-api03-abcdefghijklmnop9c1e";

async function renderStep(
  opts: {
    claude?: State;
    grok?: State;
    refresh?: Partial<Record<SubscriptionStatus["provider"], State>>;
    keys?: { provider: string; key_last4: string; created_at: string }[];
    save?: { status?: number; body?: unknown } | "network";
  } = {},
) {
  const bridge = installDesktopBridge({
    plans: [
      plan("claude", opts.claude ?? "needs_install"),
      plan("grok", opts.grok ?? "needs_login"),
      plan("codex", "needs_install"),
    ],
    setup: { step: "engines" },
    refresh: opts.refresh,
  });
  let saved = opts.keys ?? [];
  const fetchMock = stubFetch({
    "GET /api/config": { body: { hosted_mode: true, provider_directory: DIRECTORY } },
    "GET /api/providers": () => ({ body: { providers: saved } }),
    "POST /api/providers": () => {
      const reply = opts.save ?? { body: { provider: "anthropic", key_last4: "9c1e" } };
      if (reply !== "network" && (reply.status ?? 200) < 300) {
        saved = [{ provider: "anthropic", key_last4: "9c1e", created_at: "2026-09-26T10:00:00Z" }];
      }
      return reply;
    },
  });
  const setup = await loadDesktopSetup(ME.id);
  render(
    <ToastProvider placement="setup">
      <EnginesStep login="lazyxgenius" setup={setup!} onSwitch={vi.fn()} />
    </ToastProvider>,
  );
  await waitFor(() =>
    expect(within(row("claude")).queryByText("Looking for Claude Code on this Mac…")).toBeNull(),
  );
  return { bridge, fetchMock };
}

function row(provider: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-provider="${provider}"]`)!;
}
function keysRow(): HTMLElement {
  return document.querySelector<HTMLElement>(".st-row--keys")!;
}
const sheet = (name: string) => screen.getByRole("dialog", { name });
const continueButton = () => screen.getByRole("button", { name: "Continue" });
const postCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => {
  window.location.hash = "#/setup/engines";
  resetProviderDirectoryCache();
});

afterEach(() => {
  uninstallDesktopBridge();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Claude Code not found (DtF-Claude-1)", () => {
  it("shows Not installed with a tint Set up; Continue stays off", async () => {
    await renderStep();
    const claude = within(row("claude"));
    expect(claude.getByText("Not installed")).toBeInTheDocument();
    expect(
      claude.getByText("Install it and sign in once to use your Claude plan"),
    ).toBeInTheDocument();
    expect(claude.getByRole("button", { name: "Set up" })).toHaveClass("ds-btn--tint");
    expect(continueButton()).toBeDisabled();
  });
});

describe("Use your Claude plan (DT-25, DtF-Claude-2)", () => {
  it("Set up opens the sheet: three steps, the command, the lock note, Not found yet", async () => {
    await renderStep();
    fireEvent.click(within(row("claude")).getByRole("button", { name: "Set up" }));
    const s = within(sheet("Use your Claude plan"));
    expect(s.getByText("Tvashtr runs Claude Code on this Mac for you")).toBeInTheDocument();
    expect(s.getByText("Install Claude Code")).toBeInTheDocument();
    expect(s.getByText("Follow Anthropic’s install guide for Mac.")).toBeInTheDocument();
    expect(s.getByText("Sign in once")).toBeInTheDocument();
    expect(
      s.getByText("Open Terminal, run the command below, and sign in with your Claude account."),
    ).toBeInTheDocument();
    expect(s.getByText("claude")).toBeInTheDocument();
    expect(s.getByText("Come back and check")).toBeInTheDocument();
    expect(
      s.getByText("Tvashtr looks for it again and uses your plan for anthropic/* models."),
    ).toBeInTheDocument();
    expect(
      s.getByText("You sign in inside Claude Code, not in Tvashtr. Tvashtr never sees your login."),
    ).toBeInTheDocument();
    expect(s.getByText("Not found yet")).toBeInTheDocument();
  });

  it("Open install guide opens Anthropic's guide in the default browser", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await renderStep();
    fireEvent.click(within(row("claude")).getByRole("button", { name: "Set up" }));
    fireEvent.click(
      within(sheet("Use your Claude plan")).getByRole("button", { name: "Open install guide" }),
    );
    expect(open).toHaveBeenCalledWith(
      "https://docs.anthropic.com/en/docs/claude-code/overview",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it.each([
    ["needs_install", "Not found yet"],
    ["needs_login", "Found. Sign in once (step 2), then check again."],
    [
      "api_key",
      "Found, but signed in with an API key. Sign in with your Claude plan, then check again.",
    ],
    ["error", "Couldn’t check Claude Code. Try again."],
  ] as const)("Check again finding %s keeps the sheet open: %s", async (state, note) => {
    const { bridge } = await renderStep({ refresh: { claude: state } });
    fireEvent.click(within(row("claude")).getByRole("button", { name: "Set up" }));
    fireEvent.click(
      within(sheet("Use your Claude plan")).getByRole("button", { name: "Check again" }),
    );
    await waitFor(() => expect(bridge.engines.refresh).toHaveBeenCalledWith("claude"));
    expect(await within(sheet("Use your Claude plan")).findByText(note)).toBeInTheDocument();
  });

  it("Close and × close the sheet without checking", async () => {
    const { bridge } = await renderStep();
    fireEvent.click(within(row("claude")).getByRole("button", { name: "Set up" }));
    const footer = sheet("Use your Claude plan").querySelector("footer")!;
    fireEvent.click(within(footer).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Use your Claude plan" })).toBeNull();
    fireEvent.click(within(row("claude")).getByRole("button", { name: "Set up" }));
    const head = sheet("Use your Claude plan").querySelector("header")!;
    fireEvent.click(within(head).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Use your Claude plan" })).toBeNull();
    expect(bridge.engines.refresh).not.toHaveBeenCalled();
    expect(within(row("claude")).getByText("Not installed")).toBeInTheDocument();
  });

  it("Grok's Set up opens the Grok variant (OQ-18)", async () => {
    await renderStep({ grok: "needs_install" });
    fireEvent.click(within(row("grok")).getByRole("button", { name: "Set up" }));
    const s = within(sheet("Use your Grok plan"));
    expect(s.getByText("Tvashtr runs Grok on this Mac for you")).toBeInTheDocument();
    expect(s.getByText("Install the Grok CLI")).toBeInTheDocument();
    expect(s.getByText("Follow xAI’s install guide for Mac.")).toBeInTheDocument();
    expect(s.getByText("grok login")).toBeInTheDocument();
    expect(
      s.getByText("Tvashtr looks for it again and uses your plan for xai/* models."),
    ).toBeInTheDocument();
    expect(
      s.getByText("You sign in inside Grok, not in Tvashtr. Tvashtr never sees your login."),
    ).toBeInTheDocument();
  });
});

describe("Found and connected (DtF-Claude-3)", () => {
  it("Check again finding the plan closes the sheet, connects the row and toasts", async () => {
    await renderStep();
    fireEvent.click(within(row("claude")).getByRole("button", { name: "Set up" }));
    fireEvent.click(
      within(sheet("Use your Claude plan")).getByRole("button", { name: "Check again" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Use your Claude plan" })).toBeNull(),
    );
    const claude = within(row("claude"));
    expect(claude.getByText("Connected")).toBeInTheDocument();
    expect(claude.getByRole("switch", { name: "Use my Claude plan" })).toBeChecked();
    expect(screen.getByText("Claude Code found · using your Claude plan")).toBeInTheDocument();
    // A plan is in use: Continue waits for the consent (DT-27).
    expect(continueButton()).toBeDisabled();
  });

  it("a re-probe that finds the plan while the sheet is open closes it the same way", async () => {
    const { bridge } = await renderStep();
    fireEvent.click(within(row("claude")).getByRole("button", { name: "Set up" }));
    act(() => bridge.fireStatus(plan("claude", "connected")));
    expect(screen.queryByRole("dialog", { name: "Use your Claude plan" })).toBeNull();
    expect(screen.getByText("Claude Code found · using your Claude plan")).toBeInTheDocument();
  });
});

describe("Nothing found, use an API key (DtF-Key-1)", () => {
  it("Grok's Set up is ghost after Claude's tint Set up; Continue is off", async () => {
    await renderStep({ grok: "needs_install" });
    expect(within(row("claude")).getByRole("button", { name: "Set up" })).toHaveClass(
      "ds-btn--tint",
    );
    expect(
      within(row("grok")).getByText("Install the Grok CLI to use your Grok plan"),
    ).toBeVisible();
    expect(within(row("grok")).getByRole("button", { name: "Set up" })).toHaveClass(
      "ds-btn--ghost",
    );
    expect(within(keysRow()).getByRole("button", { name: "Use an API key instead" })).toBeVisible();
    expect(continueButton()).toBeDisabled();
  });
});

describe("Add an API key (DT-26, DtF-Key-2)", () => {
  async function openSheet(opts: Parameters<typeof renderStep>[0] = {}) {
    const r = await renderStep({ grok: "needs_install", ...opts });
    fireEvent.click(within(keysRow()).getByRole("button", { name: "Use an API key instead" }));
    const s = within(sheet("Add an API key"));
    await waitFor(() => expect(r.fetchMock).toHaveBeenCalledWith("/api/config"));
    return { ...r, s };
  }
  const providerButton = () =>
    within(sheet("Add an API key")).getByRole("button", { name: /^Provider/ });

  it("opens with the setup copy and anthropic pre-picked (Claude can't run here)", async () => {
    const { s } = await openSheet();
    expect(s.getByText("Works on Desktop and on the website")).toBeInTheDocument();
    expect(providerButton()).toHaveTextContent("anthropic");
    // A screen reader hears the chosen provider, not just "Provider".
    expect(providerButton()).toHaveAccessibleName("Provider anthropic");
    expect(
      await s.findByText(
        "Covers models that start with anthropic/, like anthropic/claude-sonnet-5.",
      ),
    ).toBeInTheDocument();
    expect(s.getByLabelText<HTMLInputElement>("API key").type).toBe("password");
    expect(
      s.getByText(
        "Saved encrypted on your account. After you save, you’ll only see •••• and the last 4 characters.",
      ),
    ).toBeInTheDocument();
    expect(s.getByText("Pay the provider per use")).toBeInTheDocument();
    // No "Used by" line on the setup variant.
    expect(s.queryByText(/Used by/)).toBeNull();
  });

  it("pre-picks xai when only Claude runs here", async () => {
    await openSheet({ claude: "connected", grok: "needs_login" });
    expect(providerButton()).toHaveTextContent("xai");
  });

  it("pre-picks nothing when both plans run here", async () => {
    await openSheet({ claude: "connected", grok: "connected" });
    expect(providerButton()).toHaveTextContent("Choose a provider");
  });

  it("lists NVIDIA NIM disabled with its hint; it can't be picked", async () => {
    const { s } = await openSheet();
    await s.findByText("Covers models that start with anthropic/, like anthropic/claude-sonnet-5.");
    fireEvent.click(providerButton());
    const list = within(s.getByRole("listbox"));
    const nim = list.getByRole("option", { name: /nvidia_nim/ });
    expect(nim).toHaveAttribute("aria-disabled", "true");
    expect(
      within(nim).getByText("NVIDIA NIM serves no model Tvashtr can run right now."),
    ).toBeInTheDocument();
    fireEvent.click(nim);
    expect(s.getByRole("listbox")).toBeInTheDocument();
    expect(providerButton()).toHaveTextContent("anthropic");
    fireEvent.click(list.getByRole("option", { name: /xai/ }));
    expect(s.queryByRole("listbox")).toBeNull();
    expect(providerButton()).toHaveTextContent("xai");
    expect(s.getByText("Covers models that start with xai/, like xai/grok-4.")).toBeInTheDocument();
  });

  it("the list works from the keyboard and skips the disabled NIM", async () => {
    const { s } = await openSheet();
    await s.findByText("Covers models that start with anthropic/, like anthropic/claude-sonnet-5.");
    fireEvent.keyDown(providerButton(), { key: "ArrowDown" });
    const listbox = s.getByRole("listbox");
    expect(listbox).toHaveFocus();
    fireEvent.keyDown(listbox, { key: "ArrowUp" }); // wraps past NIM to the last pickable
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(listbox.getAttribute("aria-activedescendant")).toMatch(/anthropic$/);
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(providerButton()).toHaveTextContent("xai");
    fireEvent.keyDown(providerButton(), { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(s.queryByRole("listbox")).toBeNull();
    // Escape closed only the list, not the sheet.
    expect(sheet("Add an API key")).toBeInTheDocument();
  });

  it("Save with no key shows the form error (ENG-71) and posts nothing", async () => {
    const { s, fetchMock } = await openSheet();
    fireEvent.click(s.getByRole("button", { name: "Save key" }));
    expect(s.getByRole("alert")).toHaveTextContent("Enter a provider and an API key.");
    expect(postCalls(fetchMock)).toHaveLength(0);
  });

  it("a 422 shows the server's words under the key (ENG-73)", async () => {
    const { s } = await openSheet({
      save: { status: 422, body: { detail: "An API key is required." } },
    });
    fireEvent.change(s.getByLabelText("API key"), { target: { value: "x" } });
    fireEvent.click(s.getByRole("button", { name: "Save key" }));
    expect(await s.findByRole("alert")).toHaveTextContent("An API key is required.");
    expect(s.getByLabelText("API key")).toHaveAttribute("aria-invalid", "true");
    expect(sheet("Add an API key")).toBeInTheDocument();
  });

  it.each([
    ["no answer", "network" as const],
    ["a 5xx", { status: 503, body: { detail: "upstream down" } }],
  ])("%s shows ENG-72 and keeps the values", async (_label, save) => {
    const { s } = await openSheet({ save });
    fireEvent.change(s.getByLabelText("API key"), { target: { value: PASTED } });
    fireEvent.click(s.getByRole("button", { name: "Save key" }));
    expect(await s.findByRole("alert")).toHaveTextContent(
      "Couldn’t save that key — is the backend running? Your key wasn’t saved. Try again.",
    );
    expect(s.getByLabelText<HTMLInputElement>("API key").value).toBe(PASTED);
    expect(providerButton()).toHaveTextContent("anthropic");
  });
});

describe("Key saved, Continue is on (DtF-Key-3)", () => {
  it("Save key posts the key, closes the sheet and shows the saved row; Continue is on", async () => {
    const { fetchMock } = await renderStep({ grok: "needs_install" });
    fireEvent.click(within(keysRow()).getByRole("button", { name: "Use an API key instead" }));
    const s = within(sheet("Add an API key"));
    fireEvent.change(s.getByLabelText("API key"), { target: { value: PASTED } });
    fireEvent.click(s.getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add an API key" })).toBeNull(),
    );
    const [call] = postCalls(fetchMock);
    expect(call[0]).toBe("/api/providers");
    expect(JSON.parse(call[1]!.body as string)).toEqual({ provider: "anthropic", api_key: PASTED });
    const keys = within(keysRow());
    expect(keys.getByText("anthropic key saved · •••• 9c1e")).toBeInTheDocument();
    expect(keys.getByRole("button", { name: "Manage keys" })).toBeVisible();
    // No plan in use and a saved key: Continue is on without the consent (DT-27).
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(continueButton()).toBeEnabled();
  });

  it("Manage keys reopens the Add-key sheet (OQ-21)", async () => {
    await renderStep({
      keys: [{ provider: "anthropic", key_last4: "9c1e", created_at: "2026-09-26T10:00:00Z" }],
    });
    fireEvent.click(await within(keysRow()).findByRole("button", { name: "Manage keys" }));
    expect(sheet("Add an API key")).toBeInTheDocument();
  });

  it("several keys read as one line", async () => {
    await renderStep({
      keys: [
        { provider: "anthropic", key_last4: "9c1e", created_at: "2026-09-26T10:00:00Z" },
        { provider: "xai", key_last4: "77aa", created_at: "2026-09-26T11:00:00Z" },
      ],
    });
    expect(await within(keysRow()).findByText("anthropic, xai keys saved")).toBeInTheDocument();
  });
});
