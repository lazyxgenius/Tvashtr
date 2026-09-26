import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_CONFIG, stubFetch } from "../pages/desktop/desktopTestUtils";
import { AuthGate } from "./AuthGate";

// The signed-in app is out of scope: this targets which screen the gate shows. The stub's button
// makes a session call, so a test can expire the session mid-use (the api 401 seam).
vi.mock("../pages/Workspace", async () => {
  const { getMe } = await import("../lib/api");
  return {
    Workspace: () => (
      <button type="button" onClick={() => void getMe()}>
        DASHBOARD STUB
      </button>
    ),
  };
});

const ME = {
  id: "u1",
  email: "lazyxgenius@users.noreply.github.com",
  github_login: "lazyxgenius",
  display_name: "Lazyx",
};
const signedOut = { "GET /api/auth/me": { status: 401 } };
const signedIn = { "GET /api/auth/me": { body: ME } };

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("AuthGate on Tvashtr Desktop", () => {
  afterEach(() => {
    delete document.documentElement.dataset.tvashtrDesktop;
    delete window.tvashtrDesktop;
  });

  it("hands over to the Desktop launch screens: Welcome, never the landing page (DT-1)", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    stubFetch(signedOut);
    render(<AuthGate />);
    expect(await screen.findByRole("heading", { name: "Welcome to Tvashtr" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Start building/ })).toBeNull();
  });
});

describe("the website's gate (WEB-2)", () => {
  it("the empty address is the landing when signed out", async () => {
    stubFetch(signedOut);
    render(<AuthGate />);
    expect(
      await screen.findByRole("heading", { level: 1, name: /^Compose your own team of AI agents/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD STUB")).toBeNull();
  });

  it("the landing's CTA goes to the sign-in page", async () => {
    stubFetch(signedOut);
    render(<AuthGate />);
    const [hero] = await screen.findAllByRole("link", {
      name: "Start building — sign in with GitHub",
    });
    fireEvent.click(hero);
    await waitFor(() => expect(window.location.hash).toBe("#/signin"));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });

  it("the empty address is Home when signed in", async () => {
    stubFetch(signedIn);
    render(<AuthGate />);
    expect(await screen.findByText("DASHBOARD STUB")).toBeInTheDocument();
  });

  it("an app address signed out goes to sign-in, remembering where it was", async () => {
    window.location.hash = "#/teams/t1?node=pm";
    stubFetch(signedOut);
    render(<AuthGate />);
    await waitFor(() =>
      expect(window.location.hash).toBe("#/signin?next=%2Fteams%2Ft1%3Fnode%3Dpm"),
    );
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });

  it("a 401 mid-session goes to sign-in with this address, not the landing (WEB-42)", async () => {
    window.location.hash = "#/engines/keys";
    stubFetch(signedIn);
    render(<AuthGate />);
    const app = await screen.findByText("DASHBOARD STUB");
    stubFetch(signedOut);
    fireEvent.click(app);
    await waitFor(() => expect(window.location.hash).toBe("#/signin?next=%2Fengines%2Fkeys"));
    expect(screen.queryByText("DASHBOARD STUB")).toBeNull();
  });

  it("signed in, the sign-in page goes on to where it was headed (WEB-4)", async () => {
    window.location.hash = "#/signin?next=%2Fdomains";
    stubFetch(signedIn);
    render(<AuthGate />);
    await waitFor(() => expect(window.location.hash).toBe("#/domains"));
    expect(await screen.findByText("DASHBOARD STUB")).toBeInTheDocument();
  });
});

describe("signing in through the gate (WEB-27..29)", () => {
  it("self-hosted: the form → #/signin/done → Home, no extra steps", async () => {
    window.location.hash = "#/signin?next=%2Fdomains";
    stubFetch({ ...signedOut, "POST /api/auth/login": { body: ME } });
    render(<AuthGate />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: ME.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-good-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Signing you in…" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/signin/done?next=%2Fdomains");
    expect(screen.getByText("Signed in as lazyxgenius")).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/domains"), { timeout: 2000 });
    expect(await screen.findByText("DASHBOARD STUB")).toBeInTheDocument();
  });

  it("hosted: back from GitHub, #/signin/done waits for the account, then Home", async () => {
    window.location.hash = "#/signin/done";
    stubFetch({ ...signedIn, "GET /api/config": { body: HOSTED_CONFIG } });
    render(<AuthGate />);
    expect(await screen.findByText("Signed in as lazyxgenius")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/signin/done");
    await waitFor(() => expect(window.location.hash).toBe("#/home"), { timeout: 2000 });
    expect(await screen.findByText("DASHBOARD STUB")).toBeInTheDocument();
  });

  it("#/signin/done with no session is a failed sign-in", async () => {
    window.location.hash = "#/signin/done?next=%2Fdomains";
    stubFetch({ ...signedOut, "GET /api/config": { body: HOSTED_CONFIG } });
    render(<AuthGate />);
    await waitFor(() => expect(window.location.hash).toBe("#/signin?error=failed&next=%2Fdomains"));
    expect(
      await screen.findByRole("heading", { name: "Sign-in didn’t finish" }),
    ).toBeInTheDocument();
  });

  it("hosted: the only door is Continue with GitHub", async () => {
    window.location.hash = "#/signin";
    stubFetch({ ...signedOut, "GET /api/config": { body: HOSTED_CONFIG } });
    render(<AuthGate />);
    expect(await screen.findByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(document.title).toBe("Sign in · Tvashtr");
  });
});

describe("public pages (WEB-1, WEB-4, WEB-5, WEB-43)", () => {
  it("render at once; the header's right side waits for the session answer", async () => {
    window.location.hash = "#/download?os=mac";
    stubFetch({ "GET /api/auth/me": "pending" });
    render(<AuthGate />);
    expect(await screen.findByRole("heading", { name: "Tvashtr for Mac" })).toBeInTheDocument();
    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(within(header).queryByText(/Signed in as/)).toBeNull();
    expect(document.title).toBe("Tvashtr for Mac");
  });

  it("signed out: Sign in and Start building; Desktop is the current page", async () => {
    window.location.hash = "#/download?os=mac";
    stubFetch(signedOut);
    render(<AuthGate />);
    const header = screen.getByRole("banner");
    expect(await within(header).findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "#/signin",
    );
    expect(within(header).getByRole("link", { name: "Start building" })).toHaveAttribute(
      "href",
      "#/signin",
    );
    const nav = within(header).getByRole("navigation", { name: "Site" });
    expect(within(nav).getByRole("link", { name: "Desktop" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("signed in: the website still shows, with 'Signed in as' and Open app", async () => {
    window.location.hash = "#/download?os=mac";
    stubFetch(signedIn);
    render(<AuthGate />);
    const header = screen.getByRole("banner");
    expect(await within(header).findByText("lazyxgenius")).toBeInTheDocument();
    expect(within(header).getByText(/Signed in as/)).toBeInTheDocument();
    expect(within(header).getByRole("link", { name: "Open app" })).toHaveAttribute(
      "href",
      "#/home",
    );
    expect(screen.queryByText("DASHBOARD STUB")).toBeNull();
  });

  it("toasts work on public pages", async () => {
    window.location.hash = "#/download/started";
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    stubFetch(signedOut);
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy command" }));
    expect(await screen.findByText("Command copied")).toBeInTheDocument();
  });
});
