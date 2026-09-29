import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { DESKTOP_MAC_DMG_URL, GITHUB_RELEASES_PAGE_URL } from "../../lib/desktopDownload";
import type { DownloadOs } from "../../lib/nav";
import { DownloadPage } from "./DownloadPage";
import { stubFetch } from "../desktop/desktopTestUtils";
import { clearUaHints, downloadLinks, setUaHints, SITE } from "./testUtils";

const ME = { id: "u1", email: "l@x.dev", github_login: "lazyxgenius", display_name: "Lazyx" };

function renderPage(os?: DownloadOs, user: typeof ME | null = null) {
  return render(
    <ToastProvider>
      <DownloadPage os={os} user={user} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.location.hash = "#/download";
  stubFetch({ "GET /api/public/site": { body: SITE } });
});

afterEach(() => {
  clearUaHints();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("Download on a Mac (WEB-33)", () => {
  it("claims Apple silicon only when UA-CH says arm; the button is the stable DMG", async () => {
    setUaHints("macOS", "arm");
    renderPage();
    expect(await screen.findByText("We detected a Mac with Apple silicon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tvashtr for Mac" })).toBeInTheDocument();
    const button = screen.getByRole("link", { name: "Download for Mac · Apple silicon" });
    expect(button).toHaveAttribute("href", DESKTOP_MAC_DMG_URL);
    expect(downloadLinks()).toEqual([DESKTOP_MAC_DMG_URL]);
    // The version from /api/public/site, the macOS floor from the constant (OQ-8); no Intel link.
    expect(
      await screen.findByText(
        "Needs a Mac with Apple silicon (M1 or later) · v0.7.0 · macOS 11 or later",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Intel Mac\?/)).toBeNull();
  });

  it("says only 'We detected a Mac' when the browser can't tell the chip (Safari, Firefox)", async () => {
    setUaHints("macOS");
    renderPage();
    expect(await screen.findByText("We detected a Mac")).toBeInTheDocument();
    expect(screen.queryByText("We detected a Mac with Apple silicon")).toBeNull();
  });

  it("says what runs on the Mac: only steps on your plan (review finding)", () => {
    setUaHints("macOS", "arm");
    renderPage();
    expect(screen.queryByText(/Runs stop when you quit the app/)).toBeNull();
    expect(screen.getByText("Steps on your plan stop when you quit the app.")).toBeInTheDocument();
    expect(
      screen.getByText(/Agents on your Claude or Grok plan run on this computer/),
    ).toBeInTheDocument();
  });

  it("omits the version when it's unknown", async () => {
    stubFetch({ "GET /api/public/site": { status: 500 } });
    setUaHints("macOS", "arm");
    renderPage();
    expect(
      await screen.findByText("Needs a Mac with Apple silicon (M1 or later) · macOS 11 or later"),
    ).toBeInTheDocument();
  });

  it("the download shows the install steps; the page stays", () => {
    setUaHints("macOS", "arm");
    renderPage();
    // jsdom can't follow the DMG link; the browser would download it and stay on the page.
    const stay = (e: Event) => e.preventDefault();
    document.addEventListener("click", stay);
    fireEvent.click(screen.getByRole("link", { name: "Download for Mac · Apple silicon" }));
    document.removeEventListener("click", stay);
    expect(window.location.hash).toBe("#/download/started");
  });

  it("?os=mac makes no detection claim, even on Windows", async () => {
    setUaHints("Windows", "x86");
    renderPage("mac");
    expect(await screen.findByRole("heading", { name: "Tvashtr for Mac" })).toBeInTheDocument();
    expect(screen.queryByText(/We detected/)).toBeNull();
  });
});

describe("no build for this computer (WEB-36, OQ-6, OQ-9, OQ-29)", () => {
  it("Windows: Mac-only for now, use the website, releases on GitHub, or the Mac download", async () => {
    setUaHints("Windows", "x86");
    renderPage();
    expect(await screen.findByText("We detected Windows")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "The desktop app is Mac-only for now." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You can do everything on the website today with API keys. Want to know when Windows is ready?",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Use the website" })).toHaveAttribute(
      "href",
      "#/signin",
    );
    const watch = screen.getByRole("link", { name: "Watch for releases on GitHub" });
    expect(watch).toHaveAttribute("href", GITHUB_RELEASES_PAGE_URL);
    expect(watch).toHaveAttribute("rel", "noopener noreferrer");
    // No email field: there is no email service (OQ-9).
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(downloadLinks()).toEqual([]);
    fireEvent.click(screen.getByRole("link", { name: "I’m on a Mac — show the Mac download" }));
    expect(window.location.hash).toBe("#/download?os=mac");
  });

  it("signed in, Use the website goes to the app", () => {
    setUaHints("Windows", "x86");
    renderPage(undefined, ME);
    expect(screen.getByRole("link", { name: "Use the website" })).toHaveAttribute("href", "#/home");
  });

  it("Linux gets the same page", () => {
    renderPage("linux");
    expect(screen.queryByText(/We detected/)).toBeNull();
    expect(
      screen.getByText(/Want to know when Linux is ready\?$/, { selector: "p" }),
    ).toBeInTheDocument();
  });

  it("an Intel Mac: the build needs Apple silicon", async () => {
    setUaHints("macOS", "x86");
    renderPage();
    expect(await screen.findByText("We detected an Intel Mac")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "The desktop app needs Apple silicon for now." }),
    ).toBeInTheDocument();
    expect(downloadLinks()).toEqual([]);
  });
});

describe("on a phone (OQ-24, OQ-10)", () => {
  it("no DMG: copy the link for a computer", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    setUaHints("Android", undefined, true);
    renderPage();
    expect(screen.queryByText(/We detected/)).toBeNull();
    expect(downloadLinks()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Copy the link" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/#/download`);
    const toast = await screen.findByRole("status");
    expect(within(toast).getByText("Link copied")).toBeInTheDocument();
  });

  it("?os=mac on a phone still never offers the DMG (review finding, WEB-25)", () => {
    setUaHints("Android", undefined, true);
    renderPage("mac");
    expect(downloadLinks()).toEqual([]);
    expect(
      screen.getByRole("button", { name: /Copy the link|Send me the link/ }),
    ).toBeInTheDocument();
  });

  it("shares the link where the phone can", () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    setUaHints("Android", undefined, true);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Send me the link" }));
    expect(share).toHaveBeenCalledWith({
      title: "Tvashtr",
      url: `${window.location.origin}/#/download`,
    });
  });
});
