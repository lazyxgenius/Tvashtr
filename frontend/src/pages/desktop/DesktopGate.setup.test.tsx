import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { setDesktopTitle, TITLE_LAUNCH } from "../../lib/desktopApp";
import { takeAfterSetup } from "../../lib/desktopSetup";
import { DesktopGate } from "./DesktopGate";
import {
  HOSTED_CONFIG,
  installDesktopBridge,
  ME,
  plan,
  stubFetch,
  uninstallDesktopBridge,
} from "./desktopTestUtils";

// The real Workspace decides between setup and the shell; the shell's pages are out of scope.
vi.mock("../shell/Shell", () => ({
  Shell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("../home/HomePage", () => ({ HomePage: () => <div>HOME STUB</div> }));

const PLANS = [plan("claude", "connected"), plan("grok", "needs_login")];

beforeEach(() => {
  window.location.hash = "#/home";
});

afterEach(() => {
  uninstallDesktopBridge();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setDesktopTitle(TITLE_LAUNCH);
  __resetBackendStatusForTests();
});

function signedIn(extra: Record<string, { status?: number; body?: unknown }> = {}) {
  return stubFetch({
    "GET /api/auth/me": { body: ME },
    "GET /api/config": { body: HOSTED_CONFIG },
    "GET /api/providers": { body: { providers: [] } },
    ...extra,
  });
}

const enginesHeading = () => screen.findByRole("heading", { name: "How should your agents run?" });

describe("DesktopGate — this Mac's setup (DT-2 step 3, DT-17)", () => {
  it("setup not finished: the launch goes to setup at the saved step, not Home", async () => {
    const bridge = installDesktopBridge({ plans: PLANS, setup: { step: null } });
    const fetchMock = signedIn();
    render(<DesktopGate />);
    expect(await enginesHeading()).toBeInTheDocument();
    expect(window.location.hash).toBe("#/setup/engines");
    expect(bridge.setup.get).toHaveBeenCalledWith(ME.id);
    // Step 4 of the launch (teams, then Home) waits until setup is done: the one teams request is
    // setup's own "has teams already" check (DT-37), not the launch's.
    const teamsCalls = () =>
      fetchMock.mock.calls.filter(([u]) => (u as string).includes("/api/teams")).length;
    await waitFor(() => expect(teamsCalls()).toBe(1));
    expect(screen.queryByText("HOME STUB")).toBeNull();
    // DT-3: setup screens keep the launch title.
    expect(document.title).toBe("Tvashtr");
  });

  it("resumes where this Mac left off", async () => {
    installDesktopBridge({ plans: PLANS, setup: { step: "project" } });
    signedIn();
    render(<DesktopGate />);
    expect(
      await screen.findByRole("heading", { name: "Where should your teams work?" }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#/setup/project");
  });

  it("setup finished: Home in the shell, with the canvas title", async () => {
    installDesktopBridge({
      plans: PLANS,
      setup: { step: "team", finishedAt: "2026-09-26T10:00:00.000Z" },
    });
    signedIn();
    render(<DesktopGate />);
    expect(await screen.findByText("HOME STUB")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/home");
    await waitFor(() => expect(document.title).toBe("Tvashtr — the living canvas"));
  });

  it("an older Desktop without the setup store has no setup; a setup address goes Home", async () => {
    installDesktopBridge({ plans: PLANS });
    signedIn();
    window.location.hash = "#/setup/engines";
    render(<DesktopGate />);
    expect(await screen.findByText("HOME STUB")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/home");
  });

  it("a page the user was headed to opens after setup (OQ-34)", async () => {
    installDesktopBridge({ plans: PLANS, setup: {} });
    signedIn();
    window.location.hash = "#/engines/keys";
    render(<DesktopGate />);
    expect(await enginesHeading()).toBeInTheDocument();
    expect(takeAfterSetup()).toBe("#/engines/keys");
  });

  it("a browser sign-in lands on setup with the 'Signed in as' toast above the setup footer (OQ-32)", async () => {
    const bridge = installDesktopBridge({ plans: PLANS, setup: {} });
    let authed = false;
    stubFetch({
      "GET /api/auth/me": () => (authed ? { body: ME } : { status: 401 }),
      "GET /api/config": { body: HOSTED_CONFIG },
      "GET /api/providers": { body: { providers: [] } },
    });
    render(<DesktopGate />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }));
    await screen.findByRole("heading", { name: "Finish signing in in your browser" });
    authed = true;
    act(() => bridge.fireSignIn({ state: "signed_in", user: ME }));
    expect(await enginesHeading()).toBeInTheDocument();
    const toast = await screen.findByRole("status", { name: "" });
    expect(toast).toHaveTextContent("Signed in as lazyxgenius");
    expect(toast.parentElement).toHaveClass("ds-toasts", "ds-toasts--setup");
  });

  it("the website handoff says 'Signed in from your browser' (DtF-Hand-2)", async () => {
    const bridge = installDesktopBridge({
      plans: PLANS,
      setup: {},
      openedFromWeb: { login: "lazyxgenius", host: "tvashtr.fly.dev" },
    });
    let authed = false;
    stubFetch({
      "GET /api/auth/me": () => (authed ? { body: ME } : { status: 401 }),
      "GET /api/config": { body: HOSTED_CONFIG },
      "GET /api/providers": { body: { providers: [] } },
    });
    render(<DesktopGate />);
    fireEvent.click(await screen.findByRole("button", { name: /Continue as lazyxgenius/ }));
    authed = true;
    act(() => bridge.fireSignIn({ state: "signed_in", user: ME }));
    expect(await enginesHeading()).toBeInTheDocument();
    expect(await screen.findByText("Signed in from your browser")).toBeInTheDocument();
  });

  it("Switch signs out, forgets this Mac's last user and shows Welcome (DT-12)", async () => {
    const bridge = installDesktopBridge({ plans: PLANS, setup: {} });
    const fetchMock = signedIn({ "POST /api/auth/logout": { body: {} } });
    render(<DesktopGate />);
    await enginesHeading();
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(await screen.findByRole("heading", { name: "Welcome to Tvashtr" })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([u, init]) => (u as string).includes("/api/auth/logout") && init?.method === "POST",
      ),
    ).toBe(true);
    expect(bridge.auth.forgetUser).toHaveBeenCalledTimes(1);
  });
});
