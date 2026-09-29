import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import type { AuthUser } from "../../lib/api";
import { stubFetch } from "../desktop/desktopTestUtils";
import { SiteRoot } from "./SiteRoot";
import { downloadLinks } from "./testUtils";

const ME: AuthUser = { id: "u1", email: "l@x.dev", github_login: "lazyxgenius", display_name: "L" };

function phone(width = 390) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 719px)" && width < 720,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function renderPhone(user: AuthUser | null = null) {
  return render(
    <ToastProvider>
      <SiteRoot route={{ page: "welcome" }} user={user} config={null} onAuthed={vi.fn()} />
    </ToastProvider>,
  );
}

const sheet = () => screen.getByRole("dialog", { name: "Best on a computer" });

beforeEach(() => {
  window.location.hash = "#/welcome";
  stubFetch({});
  phone();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("The landing on a phone (WEB-20..22)", () => {
  it("is its own page below 720px, with the phone copy", () => {
    renderPhone();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    expect(screen.getByText("Source on GitHub · your keys or your plan")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Draw the team on a canvas. It works on your GitHub repo and hands back a reviewed pull request.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Tvashtr is built for a computer screen.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Website or Mac app" })).toBeInTheDocument();
    // No 1440 header on a phone.
    expect(screen.queryByRole("link", { name: "Start building" })).toBeNull();
  });

  it("is the 1440 page from 720px up", () => {
    phone(720);
    renderPhone();
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Before you start." })).toBeInTheDocument();
  });

  it("asks four questions, all closed, and opens one when tapped", () => {
    renderPhone();
    const faq = document.getElementById("faq") as HTMLElement;
    const rows = within(faq).getAllByRole("button");
    expect(rows.map((b) => b.textContent)).toEqual([
      "Do I need an API key?",
      "Does Tvashtr see my code or my Claude login?",
      "Which models can I use?",
      "What is Tvashtr Desktop for?",
    ]);
    for (const row of rows) expect(row).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(rows[1]);
    expect(rows[1]).toHaveAttribute("aria-expanded", "true");
    expect(within(faq).getByText(/Tvashtr never sees or stores that login/)).toBeVisible();
  });

  it("never hands a phone the DMG (WEB-25)", () => {
    renderPhone();
    expect(downloadLinks()).toEqual([]);
  });
});

describe("The menu (WEB-23)", () => {
  it("opens full screen, holds focus and the page still, and closes on Escape", () => {
    renderPhone();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("dialog", { name: "Menu" });
    expect(within(menu).getByRole("button", { name: "Close menu" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(within(menu).getByRole("link", { name: "Desktop for Mac" })).toHaveAttribute(
      "href",
      "#/download",
    );
    expect(within(menu).getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(within(menu).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "#/signin");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("a section link closes the menu, then scrolls, with no Back step", () => {
    renderPhone();
    const before = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(screen.getByRole("link", { name: "Domains" }));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    // The address (replaced) says where to go; the page following it scrolls (sections.test).
    expect(window.location.hash).toBe("#/welcome?s=domains");
    expect(window.history.length).toBe(before);
  });

  it("offers Open app instead of Sign in when signed in", () => {
    renderPhone(ME);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("dialog", { name: "Menu" });
    expect(within(menu).getByRole("link", { name: "Open app" })).toHaveAttribute("href", "#/home");
    expect(within(menu).queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("Start building swaps the menu for the computer sheet", () => {
    renderPhone();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Menu" })).getByRole("button", {
        name: "Start building",
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(sheet()).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
  });
});

describe("Best on a computer (WEB-24, OQ-10, OQ-24)", () => {
  it("opens from Start building, Download for Mac and the closing button", () => {
    renderPhone();
    for (const name of ["Start building", "Download for Mac", "Send me a link for my computer"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(within(sheet()).getByText("Tvashtr works best on a computer")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("sends the site with the share sheet, and never offers an email it can't send", () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    renderPhone();
    fireEvent.click(screen.getByRole("button", { name: "Start building" }));
    const dialog = sheet();
    expect(
      within(dialog).getByText(
        "The canvas needs a big screen. Send yourself this page and open it on your computer.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send me the link" }));
    expect(share).toHaveBeenCalledWith({ title: "Tvashtr", url: `${window.location.origin}/` });
    expect(
      within(dialog).getByRole("link", { name: "Continue on this phone anyway" }),
    ).toHaveAttribute("href", "#/signin");
  });

  it("copies the link where there's no share sheet", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPhone();
    fireEvent.click(screen.getByRole("button", { name: "Start building" }));
    fireEvent.click(within(sheet()).getByRole("button", { name: "Copy the link" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/`);
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  it("closes on the scrim", async () => {
    renderPhone();
    fireEvent.click(screen.getByRole("button", { name: "Start building" }));
    fireEvent.click(document.querySelector(".web-m__scrim") as Element);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.style.overflow).toBe("");
  });
});
