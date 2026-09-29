/**
 * WEB-3: inside Tvashtr Desktop no public page ever renders. Every public address and the empty
 * hash go to the Desktop welcome when signed out, and to #/home when signed in.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "../../components/AuthGate";
import { parseRoute } from "../../lib/nav";
import { Workspace } from "../Workspace";
import {
  HOSTED_CONFIG,
  installDesktopBridge,
  ME,
  stubFetch,
  uninstallDesktopBridge,
} from "../desktop/desktopTestUtils";

vi.mock("../home/HomePage", () => ({ HomePage: () => <div>HOME BODY</div> }));

const ADDRESSES = [
  "",
  "#/",
  "#/welcome",
  "#/welcome?s=faq",
  "#/download",
  "#/download?os=windows",
  "#/download/started",
  "#/signin",
  "#/signin/done?next=%2Fdomains",
  "#/signin?error=cancelled",
];

beforeEach(() => {
  installDesktopBridge();
});

afterEach(() => {
  uninstallDesktopBridge();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Tvashtr Desktop never shows the website (WEB-3)", () => {
  it.each(ADDRESSES)("signed out, %j shows the Desktop welcome", async (hash) => {
    window.history.replaceState(null, "", `/${hash}`);
    stubFetch({
      "GET /api/auth/me": { status: 401, body: { detail: "Not authenticated" } },
      "GET /api/config": { body: HOSTED_CONFIG },
    });
    render(<AuthGate />);
    expect(await screen.findByRole("heading", { name: "Welcome to Tvashtr" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tvashtr for Mac" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Site" })).toBeNull();
  });

  it.each(ADDRESSES)("signed in, %j goes Home", async (hash) => {
    window.history.replaceState(null, "", `/${hash}`);
    stubFetch({ "GET /api/config": { body: HOSTED_CONFIG } });
    render(<Workspace user={ME} config={null} onLogout={vi.fn()} />);
    expect(await screen.findByText("HOME BODY")).toBeInTheDocument();
    await waitFor(() => expect(parseRoute(window.location.hash)).toEqual({ page: "home" }));
    expect(screen.queryByRole("navigation", { name: "Site" })).toBeNull();
  });
});
