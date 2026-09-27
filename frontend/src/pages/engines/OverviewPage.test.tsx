import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openTvashtrDesktop } from "../../lib/desktopDeepLinks";
import { DESKTOP_MAC_DMG_URL } from "../../lib/desktopDownload";
import { useNavBadges } from "../../lib/workspaceStatus";
import {
  KEYS,
  RUNNER_STALE,
  SUBS,
  installDesktop,
  key,
  mockEnginesApi,
  renderEngines,
  resetEnginesState,
  sub,
} from "./enginesTestUtils";

// The browser can't follow `tvashtr://` in jsdom; record the hand-off instead.
vi.mock("../../lib/desktopDeepLinks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/desktopDeepLinks")>()),
  openTvashtrDesktop: vi.fn(),
}));

beforeEach(() => {
  resetEnginesState();
  vi.mocked(openTvashtrDesktop).mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetEnginesState();
});

const table = () => screen.getByRole("table");
const row = (provider: string) =>
  within(table())
    .getAllByRole("row")
    .find((r) => r.getAttribute("data-provider") === provider)!;
const teamsList = () =>
  within(screen.getByRole("region", { name: "Can your teams run?" })).getByRole("list");

async function loaded() {
  await screen.findByRole("table");
}

describe("Overview on the website (Eng-OverviewWeb)", () => {
  it("shows both surfaces, every provider's cells, the unused keys and the team verdicts", async () => {
    mockEnginesApi();
    renderEngines();
    await loaded();

    expect(screen.getByRole("heading", { level: 1, name: "Engines" })).toBeInTheDocument();
    expect(screen.getByText("Not open on this computer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Tvashtr Desktop" })).toBeInTheDocument();
    expect(screen.getByText("Always available")).toBeInTheDocument();

    const anthropic = within(row("anthropic"));
    expect(anthropic.getByText("Engineer · Indicator sprint team")).toBeInTheDocument();
    expect(anthropic.getByText("Claude subscription")).toBeInTheDocument();
    expect(anthropic.getByText("(on Desktop)")).toBeInTheDocument();
    expect(anthropic.getByRole("button", { name: "Add key" })).toBeInTheDocument();
    const xai = within(row("xai"));
    expect(xai.getByText("Grok needs login")).toBeInTheDocument();
    // The website can't connect a subscription (OQ-2).
    expect(xai.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(xai.getByRole("button", { name: "Open in Desktop" })).toBeInTheDocument();
    expect(within(row("deepseek")).getAllByText("API key •••• 7d24")).toHaveLength(2);

    expect(screen.getByText(/Also saved, not used by any team yet/)).toBeInTheDocument();
    expect(screen.getByText("nvidia_nim")).toBeInTheDocument();
    expect(screen.getByText(/No agent uses NVIDIA NIM right now\./)).toBeInTheDocument();

    const teams = within(teamsList());
    expect(teams.getByText("Desktop: connect Grok")).toBeInTheDocument();
    expect(teams.getByText("Website: add anthropic, xai keys")).toBeInTheDocument();
    expect(teams.getAllByText("Website: ready")).toHaveLength(1);
  });

  it("publishes the nav badges it computed: 2 to fix, 1 of 2, 3 keys", async () => {
    mockEnginesApi();
    renderEngines();
    await loaded();
    const badges = renderHook(() => useNavBadges()).result.current;
    expect(badges).toMatchObject({
      enginesToFix: 2,
      enginesFirstTime: false,
      subscriptions: { connected: 1, total: 2 },
      apiKeys: 3,
    });
  });

  it("row fixes: Add key opens the sheet with that provider (ENG-15), Open in Desktop opens Desktop on Grok (OQ-2)", async () => {
    mockEnginesApi();
    renderEngines();
    await loaded();
    fireEvent.click(within(row("anthropic")).getByRole("button", { name: "Add key" }));
    const sheet = within(screen.getByRole("dialog", { name: "Add an API key" }));
    expect(sheet.getByRole("button", { name: "Provider anthropic" })).toBeInTheDocument();
    fireEvent.click(sheet.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Add an API key" })).toBeNull();
    fireEvent.click(within(row("xai")).getByRole("button", { name: "Open in Desktop" }));
    expect(openTvashtrDesktop).toHaveBeenCalledWith("grok");
    expect(screen.getByRole("alertdialog", { name: "Opening Tvashtr Desktop…" })).toBeVisible();
  });

  it("Download Tvashtr Desktop opens Get Tvashtr Desktop with the latest DMG on a Mac (ENG-47)", async () => {
    const platform = Object.getOwnPropertyDescriptor(window.navigator, "platform");
    Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
    try {
      mockEnginesApi();
      renderEngines();
      await loaded();
      fireEvent.click(screen.getByRole("button", { name: "Download Tvashtr Desktop" }));
      const dialog = within(screen.getByRole("alertdialog", { name: "Get Tvashtr Desktop" }));
      expect(dialog.getByRole("link", { name: "Download" })).toHaveAttribute(
        "href",
        DESKTOP_MAC_DMG_URL,
      );
    } finally {
      if (platform) Object.defineProperty(window.navigator, "platform", platform);
      else Reflect.deleteProperty(window.navigator, "platform");
    }
  });

  it("header buttons: Subscriptions, and Add API key opens the empty sheet", async () => {
    mockEnginesApi();
    renderEngines();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Subscriptions" }));
    expect(window.location.hash).toBe("#/engines/subscriptions");
    fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
    const sheet = within(screen.getByRole("dialog", { name: "Add an API key" }));
    expect(sheet.getByRole("button", { name: "Provider Choose a provider" })).toBeInTheDocument();
  });

  it("says Desktop is open on your computer when the runner checked in (OQ-15)", async () => {
    mockEnginesApi({
      "GET /api/engines/subscriptions": {
        subscriptions: SUBS,
        runner: { fresh: true, last_seen_at: new Date().toISOString(), providers: ["claude"] },
      },
    });
    renderEngines();
    await loaded();
    expect(
      screen.getByText("Tvashtr Desktop is open on your computer · checked in just now"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download Tvashtr Desktop" })).toBeNull();
  });

  it("arriving from a blocked run highlights the rows to fix (Eng-Flow-Blocked-2)", async () => {
    mockEnginesApi();
    renderEngines("overview", true);
    await loaded();
    expect(row("anthropic")).toHaveClass("eng-row--fix");
    expect(row("xai")).toHaveClass("eng-row--fix");
    expect(row("deepseek")).not.toHaveClass("eng-row--fix");
  });

  it("refreshes when the window regains focus (ENG-82)", async () => {
    let keys = KEYS;
    mockEnginesApi({ "GET /api/providers": () => ({ providers: keys }) });
    renderEngines();
    await loaded();
    keys = [...KEYS, key("anthropic", "wQ3f"), key("xai", "9Kx2")];
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(within(row("anthropic")).getByText("API key •••• wQ3f")).toBeInTheDocument(),
    );
    expect(within(teamsList()).getAllByText("Website: ready")).toHaveLength(2);
  });
});

describe("Overview on Desktop (Eng-Overview)", () => {
  it("the live bridge status wins over the mirror (ENG-81)", async () => {
    // The mirror is stale (says Grok is connected); the bridge knows it needs login.
    mockEnginesApi({
      "GET /api/engines/subscriptions": {
        subscriptions: [SUBS[0], sub("grok", "connected"), SUBS[2]],
        runner: RUNNER_STALE,
      },
    });
    installDesktop();
    renderEngines();
    await loaded();
    expect(screen.getByText("Tvashtr Desktop is open on this computer")).toBeInTheDocument();
    expect(screen.queryByText("Download Tvashtr Desktop")).toBeNull();
    const anthropic = within(row("anthropic"));
    expect(anthropic.getByText("Claude subscription")).toBeInTheDocument();
    expect(anthropic.queryByText("(on Desktop)")).toBeNull();
    expect(within(row("xai")).getByText("Grok needs login")).toBeInTheDocument();
    expect(within(row("xai")).getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("a status pushed by the main process updates the verdicts and the badge", async () => {
    mockEnginesApi();
    const desktop = installDesktop();
    renderEngines();
    await loaded();
    act(() => desktop.push(sub("grok", "connected")));
    await waitFor(() =>
      expect(within(row("xai")).getByText("Grok subscription")).toBeInTheDocument(),
    );
    // Both teams can now run on Desktop.
    expect(within(teamsList()).getAllByText("Desktop: ready")).toHaveLength(2);
    const badges = renderHook(() => useNavBadges()).result.current;
    expect(badges).toMatchObject({ enginesToFix: 1, subscriptions: { connected: 2, total: 2 } });
  });

  it("a Desktop without the bridge's answer falls back to the mirror", async () => {
    mockEnginesApi();
    const desktop = installDesktop();
    desktop.engines.getStatus.mockRejectedValue(new Error("ipc down"));
    renderEngines();
    await loaded();
    expect(within(row("xai")).getByText("Grok needs login")).toBeInTheDocument();
  });
});

/** POST /api/providers as the server answers it: last4 of the posted key, a new key. */
const answerPost = (_u: URL, body: unknown) => {
  const b = body as { provider: string; api_key: string };
  const now = new Date().toISOString();
  return {
    provider: b.provider,
    key_last4: b.api_key.slice(-4),
    created_at: now,
    updated_at: now,
    replaced: false,
  };
};

/** Paste a key into the open sheet and save it; resolves once the sheet has closed. */
async function saveWith(value: string) {
  const sheet = within(screen.getByRole("dialog", { name: "Add an API key" }));
  fireEvent.change(sheet.getByLabelText("API key"), { target: { value } });
  fireEvent.click(sheet.getByRole("button", { name: "Save key" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

const providerOrder = () =>
  within(table())
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.getAttribute("data-provider"));
const flashed = (provider: string) => row(provider).classList.contains("eng-row--ok");
const badges = () => renderHook(() => useNavBadges()).result.current;

describe("A row's Add key (EnF-OvAddKey-1..5)", () => {
  it("adds anthropic then xai from the rows: flash, cells, verdicts, badge and toasts recompute", async () => {
    mockEnginesApi({ "POST /api/providers": answerPost });
    installDesktop();
    renderEngines();
    await loaded();
    expect(badges()).toMatchObject({ enginesToFix: 2 });

    // 1-2: the anthropic row's Add key opens the sheet with anthropic picked.
    fireEvent.click(within(row("anthropic")).getByRole("button", { name: "Add key" }));
    expect(providerOrder()).toEqual(["anthropic", "xai", "deepseek"]);
    const sheet = within(screen.getByRole("dialog", { name: "Add an API key" }));
    expect(sheet.getByRole("button", { name: "Provider anthropic" })).toBeInTheDocument();
    expect(sheet.getByText("Used by Engineer · Indicator sprint team")).toBeInTheDocument();

    // 3-4: saved — the row flashes, its Website cell shows the key, the team still needs xai.
    await saveWith("sk-ant-parity-wQ3f");
    expect(flashed("anthropic")).toBe(true);
    expect(flashed("xai")).toBe(false);
    // Fixed in place: the row doesn't move down the table.
    expect(providerOrder()).toEqual(["anthropic", "xai", "deepseek"]);
    expect(within(row("anthropic")).getByText("API key •••• wQ3f")).toBeInTheDocument();
    expect(within(row("anthropic")).getByText("Claude subscription")).toBeInTheDocument();
    // OQ-16: no false "Website: ready" while xai is still missing.
    expect(within(teamsList()).getByText("Website: add xai key")).toBeInTheDocument();
    expect(within(teamsList()).queryAllByText("Website: ready")).toHaveLength(1);
    expect(badges()).toMatchObject({ enginesToFix: 2, apiKeys: 4 });
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(
      "anthropic key saved. Indicator sprint team still needs xai for the website.",
    );

    // 5: the toast's Add xai keeps the row's wording; the team can now run on the website.
    fireEvent.click(within(toast).getByRole("button", { name: "Add xai" }));
    expect(
      within(screen.getByRole("dialog", { name: "Add an API key" })).getByRole("button", {
        name: "Provider xai",
      }),
    ).toBeInTheDocument();
    await saveWith("xai-parity-9Kx2");
    expect(flashed("xai")).toBe(true);
    expect(flashed("anthropic")).toBe(false);
    expect(within(row("xai")).getAllByText("API key •••• 9Kx2")).toHaveLength(2);
    expect(within(teamsList()).getAllByText("Website: ready")).toHaveLength(2);
    // A key covers Desktop too, so both lines are ready and the badge hides (0 to fix).
    expect(within(teamsList()).getAllByText("Desktop: ready")).toHaveLength(2);
    expect(badges()).toMatchObject({ enginesToFix: 0, apiKeys: 5 });
    expect(
      await screen.findByText("xai key saved. Indicator sprint team can now run on the website."),
    ).toBeInTheDocument();
  });

  it("the flash fades after a moment (ENG-23)", async () => {
    mockEnginesApi({ "POST /api/providers": answerPost });
    renderEngines();
    await loaded();
    // Fake timers after the load (the flash's timer starts at the save); real time still flows
    // so the save's fetch settles.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(within(row("anthropic")).getByRole("button", { name: "Add key" }));
      await saveWith("sk-ant-parity-wQ3f");
      expect(flashed("anthropic")).toBe(true);
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(flashed("anthropic")).toBe(true);
      await act(() => vi.advanceTimersByTimeAsync(500));
      expect(flashed("anthropic")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the header's Add API key keeps the plain toast wording", async () => {
    mockEnginesApi({ "POST /api/providers": answerPost });
    renderEngines();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
    const sheet = within(screen.getByRole("dialog", { name: "Add an API key" }));
    fireEvent.click(sheet.getByRole("button", { name: /^Provider / }));
    fireEvent.click(
      within(sheet.getByRole("listbox", { name: "Providers" })).getByRole("option", {
        name: /^anthropic/,
      }),
    );
    await saveWith("sk-ant-parity-wQ3f");
    expect(flashed("anthropic")).toBe(true);
    expect(
      await screen.findByText(
        "anthropic key saved. Indicator sprint team still needs xai to run on the website.",
      ),
    ).toBeInTheDocument();
  });
});

describe("A row's Refresh on Desktop (ENG-13)", () => {
  const errored = () => [SUBS[0], sub("grok", "error"), SUBS[2]];

  it("re-checks from the row: Checking…, then the answer, without leaving Overview", async () => {
    mockEnginesApi();
    const desktop = installDesktop(errored());
    let answer: (s: ReturnType<typeof sub>) => void = () => undefined;
    desktop.engines.refresh.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderEngines();
    await loaded();
    expect(within(row("xai")).getByText("Couldn’t check Grok")).toBeInTheDocument();
    fireEvent.click(within(row("xai")).getByRole("button", { name: "Refresh" }));
    expect(desktop.engines.refresh).toHaveBeenCalledWith("grok");
    expect(window.location.hash).toBe("");
    expect(within(row("xai")).getByText("Checking…")).toBeInTheDocument();
    expect(within(row("xai")).queryByRole("button", { name: "Refresh" })).toBeNull();

    act(() => answer(sub("grok", "connected")));
    await waitFor(() =>
      expect(within(row("xai")).getByText("Grok subscription")).toBeInTheDocument(),
    );
    expect(flashed("xai")).toBe(true);
    expect(await screen.findByText("Grok is connected. Checked just now.")).toBeInTheDocument();
  });

  it("a failed re-check says so and offers Refresh again", async () => {
    mockEnginesApi();
    const desktop = installDesktop(errored());
    desktop.engines.refresh.mockRejectedValueOnce(new Error("no bridge answer"));
    renderEngines();
    await loaded();
    fireEvent.click(within(row("xai")).getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Couldn’t check Grok. Try again.")).toBeInTheDocument();
    expect(within(row("xai")).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(within(row("xai")).getByText("Couldn’t check Grok")).toBeInTheDocument();
  });
});

describe("A row's Connect on Desktop (EnF-OvConnect-1..3)", () => {
  const later = (s: ReturnType<typeof sub>, at: string) => ({ ...s, checked_at: at });

  it("signs in from the row: Checking…, the Terminal toast, then connected", async () => {
    mockEnginesApi();
    const desktop = installDesktop();
    renderEngines();
    await loaded();
    fireEvent.click(within(row("xai")).getByRole("button", { name: "Connect" }));
    expect(desktop.engines.connect).toHaveBeenCalledWith("grok");
    expect(within(row("xai")).getByText("Checking…")).toBeInTheDocument();
    expect(within(row("xai")).queryByRole("button", { name: "Connect" })).toBeNull();
    expect(
      await screen.findByText("A Terminal window opened. Sign in to Grok there, then come back."),
    ).toBeInTheDocument();
    // The Connect's own status push (same check) keeps the row checking.
    act(() => desktop.push(sub("grok", "needs_login")));
    expect(within(row("xai")).getByText("Checking…")).toBeInTheDocument();

    act(() => desktop.push(later(sub("grok", "connected"), "2026-09-25T09:05:00+00:00")));
    await waitFor(() =>
      expect(within(row("xai")).getByText("Grok subscription")).toBeInTheDocument(),
    );
    expect(flashed("xai")).toBe(true);
    expect(flashed("anthropic")).toBe(false);
    expect(within(teamsList()).getAllByText("Desktop: ready")).toHaveLength(2);
    expect(badges()).toMatchObject({ enginesToFix: 1, subscriptions: { connected: 2, total: 2 } });
    expect(
      await screen.findByText("Grok connected. Indicator sprint team can run on this computer."),
    ).toBeInTheDocument();
  });

  it("coming back without signing in offers Connect again", async () => {
    mockEnginesApi();
    const desktop = installDesktop();
    renderEngines();
    await loaded();
    fireEvent.click(within(row("xai")).getByRole("button", { name: "Connect" }));
    await screen.findByText("A Terminal window opened. Sign in to Grok there, then come back.");
    act(() => desktop.push(later(sub("grok", "needs_login"), "2026-09-25T09:05:00+00:00")));
    await waitFor(() =>
      expect(within(row("xai")).getByRole("button", { name: "Connect" })).toBeInTheDocument(),
    );
    expect(within(row("xai")).getByText("Grok needs login")).toBeInTheDocument();
    expect(flashed("xai")).toBe(false);
  });

  it("already signed in: connected at once, no Terminal toast", async () => {
    mockEnginesApi();
    const desktop = installDesktop();
    desktop.engines.connect.mockResolvedValueOnce(sub("grok", "connected"));
    renderEngines();
    await loaded();
    fireEvent.click(within(row("xai")).getByRole("button", { name: "Connect" }));
    expect(
      await screen.findByText("Grok connected. Indicator sprint team can run on this computer."),
    ).toBeInTheDocument();
    expect(flashed("xai")).toBe(true);
    expect(screen.queryByText(/A Terminal window opened/)).toBeNull();
  });

  it("a Connect that fails says so and puts the button back", async () => {
    mockEnginesApi();
    const desktop = installDesktop();
    desktop.engines.connect.mockRejectedValueOnce(new Error("ipc down"));
    renderEngines();
    await loaded();
    fireEvent.click(within(row("xai")).getByRole("button", { name: "Connect" }));
    expect(
      await screen.findByText("Couldn’t open a Terminal window to sign in. Try again."),
    ).toBeInTheDocument();
    expect(within(row("xai")).getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });
});

describe("First time (EnF-FirstTime-1)", () => {
  const nothingSetUp = {
    "GET /api/providers": { providers: [] },
    "GET /api/engines/subscriptions": {
      subscriptions: [sub("claude", "disconnected"), sub("grok", "needs_login"), SUBS[2]],
      runner: { fresh: false, last_seen_at: null, providers: [] },
    },
  };

  it("offers the two ways to run, and the badges read New / 0 of 2 / no key count", async () => {
    mockEnginesApi(nothingSetUp);
    renderEngines();
    expect(
      await screen.findByRole("heading", { name: "How do you want your agents to run?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The models your agents run on. Pick at least one way to run before you launch a team.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tvashtr never sees or stores your login/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    const badges = renderHook(() => useNavBadges()).result.current;
    expect(badges).toMatchObject({
      enginesFirstTime: true,
      enginesToFix: 0,
      subscriptions: { connected: 0, total: 2 },
      apiKeys: 0,
    });
  });

  it("Connect a subscription goes to Subscriptions; Add API key opens the sheet", async () => {
    mockEnginesApi(nothingSetUp);
    renderEngines();
    fireEvent.click(await screen.findByRole("button", { name: "Connect a subscription" }));
    expect(window.location.hash).toBe("#/engines/subscriptions");
    fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
    expect(screen.getByRole("dialog", { name: "Add an API key" })).toBeInTheDocument();
  });
});

describe("Loading and errors (ENG-78)", () => {
  it("a failed load says so, and Retry loads again", async () => {
    let fail = true;
    mockEnginesApi({
      "GET /api/engines/usage": () =>
        fail
          ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 })
          : { teams: [], domains: [], by_provider: {} },
    });
    renderEngines();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load your engines — is the backend running?");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("Always available")).toBeInTheDocument();
  });

  it("shows a loading state first", () => {
    mockEnginesApi({ "GET /api/engines/usage": () => new Promise(() => undefined) });
    renderEngines();
    expect(screen.getByLabelText("Loading your engines")).toBeInTheDocument();
  });

  it("with no teams, the providers and verdict sections are hidden (ENG-22)", async () => {
    mockEnginesApi({
      "GET /api/providers": { providers: [] },
      "GET /api/engines/usage": { teams: [], domains: [], by_provider: {} },
    });
    renderEngines();
    await screen.findByText("Always available");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("region", { name: "Can your teams run?" })).toBeNull();
  });
});
