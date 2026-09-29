import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { openDesktopLink } from "../../lib/desktopDeepLinks";
import { DESKTOP_MAC_DMG_URL, QUARANTINE_FIX } from "../../lib/desktopDownload";
import { DownloadStarted } from "./DownloadStarted";
import { clearUaHints, downloadLinks, setUaHints } from "./testUtils";

vi.mock(import("../../lib/desktopDeepLinks"), async (original) => ({
  ...(await original()),
  openDesktopLink: vi.fn(),
}));

const ME = { id: "u1", email: "l@x.dev", github_login: "lazyxgenius", display_name: "Lazyx" };
const writeText = vi.fn(() => Promise.resolve());

function renderPage(user: typeof ME | null = null) {
  return render(
    <ToastProvider>
      <DownloadStarted user={user} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  vi.mocked(openDesktopLink).mockClear();
  writeText.mockClear();
});

describe("install steps (WEB-34)", () => {
  it("names the real file and gives the unsigned app's Terminal fix with a Copy button", async () => {
    renderPage();
    expect(screen.getByText("Your download has started")).toBeInTheDocument();
    expect(screen.getByText("Tvashtr-mac.dmg")).toBeInTheDocument();
    expect(screen.getByText(QUARANTINE_FIX)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    expect(writeText).toHaveBeenCalledWith(QUARANTINE_FIX);
    const toast = await screen.findByRole("status");
    expect(within(toast).getByText("Command copied")).toBeInTheDocument();
  });

  it("Download again is the stable DMG (WEB-37)", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Download again" })).toHaveAttribute(
      "href",
      DESKTOP_MAC_DMG_URL,
    );
    expect(downloadLinks()).toEqual([DESKTOP_MAC_DMG_URL]);
  });
});

describe("Open Tvashtr? (WEB-35)", () => {
  it("asks first; Cancel opens nothing", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "I’ve installed it — open Tvashtr" }));
    const dialog = screen.getByRole("dialog", { name: "Open Tvashtr?" });
    expect(
      within(dialog).getByText(
        "Your browser asks before opening the app. Tvashtr then shows its own welcome and signs you in with the same GitHub account.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(openDesktopLink).not.toHaveBeenCalled();
  });

  it("signed out: opens the app on its own welcome (bare tvashtr://home)", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "I’ve installed it — open Tvashtr" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Tvashtr" }));
    expect(openDesktopLink).toHaveBeenCalledWith("tvashtr://home");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("signed in: the link carries who is signed in here as a hint, never a token", () => {
    renderPage(ME);
    fireEvent.click(screen.getByRole("button", { name: "I’ve installed it — open Tvashtr" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Tvashtr" }));
    const link = new URL(vi.mocked(openDesktopLink).mock.calls[0][0]);
    expect(Object.fromEntries(link.searchParams)).toEqual({
      from: "web",
      login: "lazyxgenius",
      host: window.location.host,
    });
  });
});

describe("on a phone (review finding, WEB-25)", () => {
  afterEach(() => clearUaHints());
  it("#/download/started offers no DMG, only a link to send to a computer", () => {
    setUaHints("Android", undefined, true);
    renderPage();
    expect(downloadLinks()).toEqual([]);
    expect(
      screen.getByRole("button", { name: /Copy the link|Send me the link/ }),
    ).toBeInTheDocument();
  });
});
