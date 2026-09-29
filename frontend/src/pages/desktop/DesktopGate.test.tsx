import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMe } from "../../lib/api";
import { setDesktopTitle, TITLE_LAUNCH } from "../../lib/desktopApp";
import { DesktopGate } from "./DesktopGate";
import {
  HOSTED_CONFIG,
  installDesktopBridge,
  ME,
  SIGN_IN_URL,
  stubFetch,
  uninstallDesktopBridge,
} from "./desktopTestUtils";

// The signed-in app is out of scope here: the gate only decides WHICH screen shows.
vi.mock("../Workspace", () => ({
  Workspace: ({ onLogout }: { onLogout: () => void }) => (
    <button type="button" onClick={onLogout}>
      WORKSPACE STUB
    </button>
  ),
}));

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  window.location.hash = "#/home";
});

afterEach(() => {
  uninstallDesktopBridge();
  vi.unstubAllGlobals();
  writeText.mockClear();
  setDesktopTitle(TITLE_LAUNCH);
});

function signedOut(extra: Record<string, { status?: number; body?: unknown }> = {}) {
  return stubFetch({
    "GET /api/auth/me": { status: 401, body: { detail: "Not authenticated" } },
    "GET /api/config": { body: HOSTED_CONFIG },
    ...extra,
  });
}

describe("DesktopGate — signed out (DT-1, DT-5)", () => {
  it("shows Welcome with the honest copy, never the website's landing page", async () => {
    installDesktopBridge();
    signedOut();
    render(<DesktopGate />);
    expect(await screen.findByRole("heading", { name: "Welcome to Tvashtr" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "This app runs your agents on this Mac with your own Claude or Grok plan. Sign in to pick up your teams, or to start your first one.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Steps on your plan run on this Mac. Quit the app and they stop."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start building" })).toBeNull();
    expect(document.title).toBe("Tvashtr");
    // The foot: the running version, Help and Privacy open in the browser.
    expect(await screen.findByText("Tvashtr Desktop · 0.5.0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute(
      "href",
      "https://github.com/lazyxgenius/Tvashtr/blob/main/docs/desktop-v1.md",
    );
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("target", "_blank");
  });

  it("says 'this computer' off macOS (DT-50)", async () => {
    installDesktopBridge({ platform: "linux" });
    signedOut();
    render(<DesktopGate />);
    expect(
      await screen.findByText("Teams can work in a folder on this computer or on a GitHub repo."),
    ).toBeInTheDocument();
  });

  it("shows Expired when someone signed in on this Mac before (DT-11)", async () => {
    const bridge = installDesktopBridge({
      lastUser: { login: "lazyxgenius", displayName: "lazyxgenius" },
    });
    signedOut();
    render(<DesktopGate />);
    expect(
      await screen.findByRole("heading", { name: "Sign in again to continue" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Last signed in as lazyxgenius")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    await waitFor(() =>
      expect(bridge.auth.startSignIn).toHaveBeenCalledWith({ account: "github" }),
    );
  });

  it("shows the email form for a self-hosted backend (OQ-37) and signs in with it", async () => {
    installDesktopBridge();
    signedOut({
      "GET /api/config": { body: { ...HOSTED_CONFIG, hosted_mode: false } },
      "POST /api/auth/login": { body: ME },
    });
    render(<DesktopGate />);
    const form = await screen.findByRole("form", { name: "Sign in with email" });
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull();
    fireEvent.change(within(form).getByLabelText("Email"), { target: { value: "a@b.dev" } });
    fireEvent.change(within(form).getByLabelText("Password"), { target: { value: "secret-pass" } });
    fireEvent.click(within(form).getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: "WORKSPACE STUB" })).toBeInTheDocument();
  });

  it("Expired on a self-hosted backend offers the email form, not GitHub (OQ-37)", async () => {
    installDesktopBridge({ lastUser: { login: "ada@b.dev", displayName: "ada@b.dev" } });
    signedOut({
      "GET /api/config": { body: { ...HOSTED_CONFIG, hosted_mode: false } },
      "POST /api/auth/login": { body: ME },
    });
    render(<DesktopGate />);
    await screen.findByRole("heading", { name: "Sign in again to continue" });
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull();
    const form = screen.getByRole("form", { name: "Sign in with email" });
    fireEvent.change(within(form).getByLabelText("Email"), { target: { value: "ada@b.dev" } });
    fireEvent.change(within(form).getByLabelText("Password"), { target: { value: "secret-pass" } });
    fireEvent.click(within(form).getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: "WORKSPACE STUB" })).toBeInTheDocument();
  });

  it("a failed /api/config doesn't pass a hosted backend off as self-hosted", async () => {
    installDesktopBridge();
    signedOut({ "GET /api/config": { status: 502 } });
    render(<DesktopGate />);
    expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Sign in with email" })).toBeNull();
  });

  it("shows Offline when the server can't be reached, and Try again relaunches", async () => {
    installDesktopBridge();
    let down = true;
    stubFetch({
      "GET /api/auth/me": () => (down ? { status: 502 } : { body: ME }),
      "GET /api/config": { body: HOSTED_CONFIG },
    });
    render(<DesktopGate />);
    expect(await screen.findByRole("heading", { name: "Can’t reach Tvashtr" })).toBeInTheDocument();
    down = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "WORKSPACE STUB" })).toBeInTheDocument();
  });
});

describe("DesktopGate — browser sign-in (DT-6..DT-9)", () => {
  it("Sign in with GitHub opens the browser and waits; the waiting screen's actions work", async () => {
    const bridge = installDesktopBridge();
    signedOut();
    render(<DesktopGate />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }));
    expect(
      await screen.findByRole("heading", { name: "Finish signing in in your browser" }),
    ).toBeInTheDocument();
    expect(bridge.auth.startSignIn).toHaveBeenCalledWith({ account: "github" });

    fireEvent.click(screen.getByRole("button", { name: "Open the browser again" }));
    expect(bridge.auth.reopenBrowser).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Copy the sign-in link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SIGN_IN_URL));
    expect(await screen.findByText("Sign-in link copied.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(bridge.auth.cancelSignIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Welcome to Tvashtr" })).toBeInTheDocument();
  });

  it("a signed-in event opens the app with the 'Signed in as' toast and remembers the user", async () => {
    const bridge = installDesktopBridge();
    let authed = false;
    stubFetch({
      "GET /api/auth/me": () => (authed ? { body: ME } : { status: 401 }),
      "GET /api/config": { body: HOSTED_CONFIG },
    });
    render(<DesktopGate />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }));
    await screen.findByRole("heading", { name: "Finish signing in in your browser" });
    authed = true;
    act(() => bridge.fireSignIn({ state: "signed_in", user: ME }));
    expect(await screen.findByRole("button", { name: "WORKSPACE STUB" })).toBeInTheDocument();
    expect(await screen.findByText("Signed in as lazyxgenius")).toBeInTheDocument();
    expect(bridge.auth.rememberUser).toHaveBeenCalledWith({
      login: "lazyxgenius",
      displayName: "lazyxgenius",
      github: true,
    });
    expect(document.title).toBe("Tvashtr — the living canvas");
  });

  it("a timeout shows Sign-in didn't finish; Try again and Copy the sign-in link start fresh", async () => {
    const bridge = installDesktopBridge();
    signedOut();
    render(<DesktopGate />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }));
    await screen.findByRole("heading", { name: "Finish signing in in your browser" });
    act(() =>
      bridge.fireSignIn({ state: "failed", reason: "timeout", message: "The browser didn't…" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Sign-in didn’t finish" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The browser didn’t send you back within 10 minutes, or you cancelled on GitHub. Nothing was changed.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy the sign-in link" }));
    await waitFor(() =>
      expect(bridge.auth.startSignIn).toHaveBeenLastCalledWith({
        account: "github",
        openBrowser: false,
      }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SIGN_IN_URL));
    // Copying keeps this screen: the browser wasn't opened, so "We opened GitHub…" would be false.
    expect(screen.getByRole("heading", { name: "Sign-in didn’t finish" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Finish signing in in your browser" }),
    ).toBeInTheDocument();
    expect(bridge.auth.startSignIn).toHaveBeenLastCalledWith({ account: "github" });
  });

  it("a refused exchange says why in the server's words", async () => {
    const bridge = installDesktopBridge();
    signedOut();
    render(<DesktopGate />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }));
    await screen.findByRole("heading", { name: "Finish signing in in your browser" });
    act(() =>
      bridge.fireSignIn({
        state: "failed",
        reason: "exchange_failed",
        message: "This sign-in has expired. Sign in again.",
      }),
    );
    expect(await screen.findByText("This sign-in has expired. Sign in again.")).toBeInTheDocument();
  });
});

describe("DesktopGate — opened from the website (DT-10)", () => {
  it("offers Continue as <login>, which reuses the browser session, then says so", async () => {
    const bridge = installDesktopBridge({
      openedFromWeb: { login: "lazyxgenius", host: "tvashtr.fly.dev" },
    });
    let authed = false;
    stubFetch({
      "GET /api/auth/me": () => (authed ? { body: ME } : { status: 401 }),
      "GET /api/config": { body: HOSTED_CONFIG },
    });
    render(<DesktopGate />);
    const cont = await screen.findByRole("button", { name: /Continue as lazyxgenius/ });
    expect(
      screen.getByText(/You opened the app from tvashtr\.fly\.dev, where you’re signed in\./),
    ).toBeInTheDocument();
    fireEvent.click(cont);
    await waitFor(() =>
      expect(bridge.auth.startSignIn).toHaveBeenCalledWith({ account: "current" }),
    );
    await screen.findByRole("heading", { name: "Finish signing in in your browser" });
    authed = true;
    act(() => bridge.fireSignIn({ state: "signed_in", user: ME }));
    expect(await screen.findByText("Signed in from your browser")).toBeInTheDocument();
  });

  it("a from=web link that arrives while Welcome is open shows the handoff", async () => {
    const bridge = installDesktopBridge();
    signedOut();
    render(<DesktopGate />);
    await screen.findByRole("button", { name: "Sign in with GitHub" });
    // Main keeps the link's hint, then delivers the link.
    bridge.auth.getLaunchContext.mockResolvedValue({
      openedFromWeb: { login: "lazyxgenius", host: "tvashtr.fly.dev" },
      lastUser: null,
    });
    act(() => bridge.fireNavigate({ path: "/home" }));
    expect(
      await screen.findByRole("button", { name: /Continue as lazyxgenius/ }),
    ).toBeInTheDocument();
  });

  it("Use a different account starts the GitHub path", async () => {
    const bridge = installDesktopBridge({
      openedFromWeb: { login: "lazyxgenius", host: "tvashtr.fly.dev" },
    });
    signedOut();
    render(<DesktopGate />);
    fireEvent.click(await screen.findByRole("button", { name: "Use a different account" }));
    await waitFor(() =>
      expect(bridge.auth.startSignIn).toHaveBeenCalledWith({ account: "github" }),
    );
  });
});

describe("DesktopGate — signed in", () => {
  it("opens a deep link that arrived while signed out once signed in (DT-49)", async () => {
    const bridge = installDesktopBridge();
    let authed = false;
    stubFetch({
      "GET /api/auth/me": () => (authed ? { body: ME } : { status: 401 }),
      "GET /api/config": { body: HOSTED_CONFIG },
    });
    render(<DesktopGate />);
    await screen.findByRole("heading", { name: "Welcome to Tvashtr" });
    act(() =>
      bridge.fireNavigate({ path: "/engines/subscriptions", params: { connect: "claude" } }),
    );
    expect(window.location.hash).toBe("#/home");
    fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    await screen.findByRole("heading", { name: "Finish signing in in your browser" });
    authed = true;
    act(() => bridge.fireSignIn({ state: "signed_in", user: ME }));
    await screen.findByRole("button", { name: "WORKSPACE STUB" });
    // The link opens from the gate's effect, which can land a tick after the Workspace renders.
    await waitFor(() =>
      expect(window.location.hash).toBe("#/engines/subscriptions?connect=claude"),
    );
  });

  it("a 401 mid-session goes to Expired (DT-11)", async () => {
    installDesktopBridge({ lastUser: { login: "lazyxgenius", displayName: "lazyxgenius" } });
    let authed = true;
    stubFetch({
      "GET /api/auth/me": () => (authed ? { body: ME } : { status: 401 }),
      "GET /api/config": { body: HOSTED_CONFIG },
    });
    render(<DesktopGate />);
    await screen.findByRole("button", { name: "WORKSPACE STUB" });
    authed = false;
    await act(async () => {
      await getMe(); // any API call that answers 401 trips the seam
    });
    expect(
      await screen.findByRole("heading", { name: "Sign in again to continue" }),
    ).toBeInTheDocument();
  });

  it("signing out goes to Welcome and forgets the user (DT-12)", async () => {
    const bridge = installDesktopBridge({
      lastUser: { login: "lazyxgenius", displayName: "lazyxgenius" },
    });
    stubFetch({
      "GET /api/auth/me": { body: ME },
      "GET /api/config": { body: HOSTED_CONFIG },
      "POST /api/auth/logout": { status: 204 },
    });
    render(<DesktopGate />);
    fireEvent.click(await screen.findByRole("button", { name: "WORKSPACE STUB" }));
    expect(await screen.findByRole("heading", { name: "Welcome to Tvashtr" })).toBeInTheDocument();
    expect(bridge.auth.forgetUser).toHaveBeenCalledTimes(1);
  });
});
