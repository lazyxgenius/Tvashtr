import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMe } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { setDesktopTitle, TITLE_LAUNCH } from "../../lib/desktopApp";
import { DesktopGate } from "./DesktopGate";
import {
  HOSTED_CONFIG,
  installDesktopBridge,
  ME,
  plan,
  stubFetch,
  uninstallDesktopBridge,
} from "./desktopTestUtils";

// The signed-in app is out of scope here: the gate only decides WHICH screen shows.
vi.mock("../Workspace", () => ({
  Workspace: () => <div>WORKSPACE STUB</div>,
}));

beforeEach(() => {
  window.location.hash = "#/home";
});

afterEach(() => {
  vi.useRealTimers();
  uninstallDesktopBridge();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setDesktopTitle(TITLE_LAUNCH);
  __resetBackendStatusForTests();
});

const signedIn = { "GET /api/auth/me": { body: ME }, "GET /api/config": { body: HOSTED_CONFIG } };

function checklist() {
  return within(screen.getByRole("status", { name: /./ }));
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function healthCalls(fetchMock: ReturnType<typeof stubFetch>): number {
  return fetchMock.mock.calls.filter(([input]) => urlOf(input) === "/health").length;
}

describe("Splash (DT-13)", () => {
  it("ticks who is signed in and each plan, and waits for the teams", async () => {
    installDesktopBridge({
      plans: [plan("claude", "connected"), plan("grok", "needs_login"), plan("codex", "connected")],
    });
    stubFetch({ ...signedIn, "GET /api/teams": "pending" });
    render(<DesktopGate />);
    expect(
      await screen.findByRole("heading", { name: "Opening your workspace…" }),
    ).toBeInTheDocument();
    await screen.findByText("Grok needs sign-in · you can fix it later");
    const lines = checklist();
    expect(lines.getByText("Signed in as lazyxgenius")).toBeInTheDocument();
    expect(lines.getByText("Claude Code connected")).toBeInTheDocument();
    expect(lines.getByText("Loading your teams…")).toBeInTheDocument();
    // Codex runs no agents yet: no line.
    expect(lines.queryByText(/Codex/)).toBeNull();
    expect(screen.queryByText("WORKSPACE STUB")).toBeNull();
    expect(document.title).toBe("Tvashtr");
  });

  it("names a missing CLI and leaves out a plan that is off", async () => {
    installDesktopBridge({
      plans: [plan("claude", "needs_install"), plan("grok", "disconnected")],
    });
    stubFetch({ ...signedIn, "GET /api/teams": "pending" });
    render(<DesktopGate />);
    expect(await screen.findByText("Claude Code not found · you can fix it later")).toBeVisible();
    expect(checklist().queryByText(/Grok/)).toBeNull();
  });

  it("opens Home once the teams answer, even with a plan problem", async () => {
    installDesktopBridge({ plans: [plan("grok", "needs_login")] });
    stubFetch(signedIn);
    render(<DesktopGate />);
    expect(await screen.findByText("WORKSPACE STUB")).toBeInTheDocument();
  });

  it("shows Connecting… until the session answers", async () => {
    installDesktopBridge();
    stubFetch({ ...signedIn, "GET /api/auth/me": "pending" });
    render(<DesktopGate />);
    expect(await screen.findByText("Connecting…")).toBeInTheDocument();
  });
});

describe("Offline (DT-14)", () => {
  it("tries /health 3 times, 1 s then 2 s apart, before saying it can't connect", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    installDesktopBridge();
    const fetchMock = stubFetch({ ...signedIn, "GET /health": "network" });
    render(<DesktopGate />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(healthCalls(fetchMock)).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(healthCalls(fetchMock)).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(healthCalls(fetchMock)).toBe(2);
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(healthCalls(fetchMock)).toBe(2);
    expect(screen.queryByRole("heading", { name: "Can’t reach Tvashtr" })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(healthCalls(fetchMock)).toBe(3);
    expect(screen.getByRole("heading", { name: "Can’t reach Tvashtr" })).toBeInTheDocument();
    expect(
      screen.getByText("tvashtr.fly.dev · couldn’t connect · tried 3 times"),
    ).toBeInTheDocument();
  });

  it("gives up on a try after 10 s: no response after 10 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    installDesktopBridge();
    stubFetch({ ...signedIn, "GET /health": "pending" });
    render(<DesktopGate />);
    await act(() => vi.advanceTimersByTimeAsync(10_000 + 1_000 + 10_000 + 2_000 + 9_999));
    expect(screen.queryByRole("heading", { name: "Can’t reach Tvashtr" })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(
      screen.getByText("tvashtr.fly.dev · no response after 10 s · tried 3 times"),
    ).toBeInTheDocument();
  });

  it.each([
    [{ status: 503 }, "answered with an error (503)"],
    [{ body: { status: "degraded", db: "down" } }, "answered with an error (db down)"],
    [{ status: 502 }, "couldn’t connect"],
  ])("names the failure: %o → %s", async (reply, reason) => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    installDesktopBridge();
    stubFetch({ ...signedIn, "GET /health": reply });
    render(<DesktopGate />);
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(screen.getByText(`tvashtr.fly.dev · ${reason} · tried 3 times`)).toBeInTheDocument();
  });

  it("Try again shows Reconnected, then Home (DT-15)", async () => {
    installDesktopBridge();
    let down = true;
    stubFetch({
      ...signedIn,
      "GET /api/auth/me": () => (down ? { status: 502 } : { body: ME }),
      "GET /api/teams": "pending",
    });
    render(<DesktopGate />);
    expect(await screen.findByRole("heading", { name: "Can’t reach Tvashtr" })).toBeVisible();
    // The session check failed once after /health answered.
    expect(screen.getByText("tvashtr.fly.dev · couldn’t connect · tried once")).toBeVisible();
    down = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Reconnected" })).toBeVisible();
    await screen.findByText("Loading your teams…");
    const lines = checklist();
    expect(lines.getByText("Connected")).toBeVisible();
    expect(lines.getByText("Signed in as lazyxgenius")).toBeVisible();
    // Reconnected shows no plan lines.
    expect(lines.queryByText(/Claude|Grok/)).toBeNull();
  });

  it("retries by itself when the Mac is back online", async () => {
    installDesktopBridge();
    let down = true;
    stubFetch({ ...signedIn, "GET /api/auth/me": () => (down ? "network" : { body: ME }) });
    render(<DesktopGate />);
    await screen.findByRole("heading", { name: "Can’t reach Tvashtr" });
    down = false;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByText("WORKSPACE STUB")).toBeInTheDocument();
  });

  it("a retry that still fails stays on Offline", async () => {
    installDesktopBridge();
    const fetchMock = stubFetch({ ...signedIn, "GET /api/auth/me": { status: 504 } });
    render(<DesktopGate />);
    await screen.findByRole("heading", { name: "Can’t reach Tvashtr" });
    const before = healthCalls(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(healthCalls(fetchMock)).toBe(before + 1));
    expect(await screen.findByRole("heading", { name: "Can’t reach Tvashtr" })).toBeVisible();
  });

  it("Check service status opens the API's /health in the browser (OQ-8)", async () => {
    installDesktopBridge();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    stubFetch({ ...signedIn, "GET /api/auth/me": { status: 502 } });
    render(<DesktopGate />);
    fireEvent.click(await screen.findByRole("button", { name: "Check service status" }));
    expect(open).toHaveBeenCalledWith(
      "https://tvashtr.fly.dev/health",
      "_blank",
      "noopener,noreferrer",
    );
  });
});

describe("Expired (DT-11)", () => {
  it("a 401 mid-session shows Expired, and signing in returns to the same address", async () => {
    const bridge = installDesktopBridge({
      lastUser: { login: "lazyxgenius", displayName: "lazyxgenius" },
    });
    let authed = true;
    stubFetch({ ...signedIn, "GET /api/auth/me": () => (authed ? { body: ME } : { status: 401 }) });
    render(<DesktopGate />);
    await screen.findByText("WORKSPACE STUB");
    window.location.hash = "#/teams/t-1";
    authed = false;
    await act(async () => {
      await getMe(); // any API call that answers 401 trips the seam
    });
    expect(await screen.findByRole("heading", { name: "Sign in again to continue" })).toBeVisible();
    expect(screen.getByText("Last signed in as lazyxgenius")).toBeVisible();
    // Something moved the address while signed out; signing in again goes back.
    window.location.hash = "#/home";
    fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    await screen.findByRole("heading", { name: "Finish signing in in your browser" });
    authed = true;
    act(() => bridge.fireSignIn({ state: "signed_in", user: ME }));
    await screen.findByText("WORKSPACE STUB");
    expect(window.location.hash).toBe("#/teams/t-1");
  });

  it("a 401 at launch shows Expired when someone signed in on this Mac before", async () => {
    installDesktopBridge({ lastUser: { login: "lazyxgenius", displayName: "Lazy X" } });
    stubFetch({ ...signedIn, "GET /api/auth/me": { status: 401 } });
    render(<DesktopGate />);
    expect(await screen.findByRole("heading", { name: "Sign in again to continue" })).toBeVisible();
    expect(screen.getByText("Last signed in as Lazy X")).toBeVisible();
  });
});

describe("Updating (DT-45)", () => {
  const running = {
    runs: [
      { run_id: "r1", desktop_target: true, status_group: "running" },
      { run_id: "r2", desktop_target: false, status_group: "running" },
    ],
    next_cursor: null,
  };

  it("shows Installing <version> and the resume note while a Desktop run is going", async () => {
    const bridge = installDesktopBridge();
    stubFetch({ ...signedIn, "GET /api/runs": { body: running } });
    render(<DesktopGate />);
    await screen.findByText("WORKSPACE STUB");
    act(() => bridge.fireUpdate({ state: "installing", version: "0.7.0" }));
    expect(await screen.findByRole("heading", { name: "Updating Tvashtr…" })).toBeVisible();
    expect(checklist().getByText("Installing 0.7.0")).toBeVisible();
    expect(
      await screen.findByText("Your running team will resume from its last step"),
    ).toBeVisible();
    expect(screen.queryByText("WORKSPACE STUB")).toBeNull();
    expect(document.title).toBe("Tvashtr");
  });

  it("leaves the resume note out when no Desktop run is going", async () => {
    installDesktopBridge({ update: { state: "installing", version: "0.7.0" } });
    const fetchMock = stubFetch({
      ...signedIn,
      "GET /api/runs": { body: { runs: [], next_cursor: null } },
    });
    render(<DesktopGate />);
    expect(await screen.findByText("Installing 0.7.0")).toBeVisible();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => urlOf(input).startsWith("/api/runs"))).toBe(
        true,
      ),
    );
    expect(screen.queryByText(/will resume/)).toBeNull();
    // Signed in by now (the count is read signed in), yet still a launch screen's title.
    expect(document.title).toBe("Tvashtr");
  });
});
