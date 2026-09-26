import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => resetEnginesState());
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
    expect(screen.getByRole("link", { name: "Download Tvashtr Desktop" })).toHaveAttribute(
      "href",
      DESKTOP_MAC_DMG_URL,
    );
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

  it("row fixes lead to where they're done: Add key → API keys, Open in Desktop → Subscriptions", async () => {
    mockEnginesApi();
    renderEngines();
    await loaded();
    fireEvent.click(within(row("anthropic")).getByRole("button", { name: "Add key" }));
    expect(window.location.hash).toBe("#/engines/keys");
    fireEvent.click(within(row("xai")).getByRole("button", { name: "Open in Desktop" }));
    expect(window.location.hash).toBe("#/engines/subscriptions");
  });

  it("header buttons: Subscriptions and Add API key", async () => {
    mockEnginesApi();
    renderEngines();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Subscriptions" }));
    expect(window.location.hash).toBe("#/engines/subscriptions");
    fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
    expect(window.location.hash).toBe("#/engines/keys");
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

  it("Connect a subscription goes to Subscriptions; Add API key to API keys", async () => {
    mockEnginesApi(nothingSetUp);
    renderEngines();
    fireEvent.click(await screen.findByRole("button", { name: "Connect a subscription" }));
    expect(window.location.hash).toBe("#/engines/subscriptions");
    fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
    expect(window.location.hash).toBe("#/engines/keys");
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
