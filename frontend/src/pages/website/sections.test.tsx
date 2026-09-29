import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { isPublicRoute, useNav } from "../../lib/nav";
import { stubFetch } from "../desktop/desktopTestUtils";
import { SiteRoot } from "./SiteRoot";

/** The website as AuthGate renders it: following the address. */
function Live() {
  const { route } = useNav();
  return isPublicRoute(route) ? (
    <SiteRoot route={route} user={null} config={null} onAuthed={vi.fn()} />
  ) : null;
}

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(
    <ToastProvider>
      <Live />
    </ToastProvider>,
  );
}

const scrolled = vi.fn();

function reducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  stubFetch({ "GET /api/public/site": "pending" });
  scrolled.mockReset();
  Element.prototype.scrollIntoView = function (this: Element, opts?: ScrollIntoViewOptions) {
    scrolled(this.id, opts);
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("?s= section scroll (WEB-7)", () => {
  it("brings the section under the header, smoothly, then drops the ?s= in place", async () => {
    const before = window.history.length;
    renderAt("#/welcome?s=faq");
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith("faq", expect.anything()));
    expect(scrolled).toHaveBeenCalledWith("faq", { behavior: "smooth", block: "start" });
    expect(window.location.hash).toBe("#/welcome");
    expect(window.history.length).toBe(before + 1); // only the visit itself
  });

  it("jumps instead under reduced motion", async () => {
    reducedMotion(true);
    renderAt("#/welcome?s=two-ways");
    await waitFor(() =>
      expect(scrolled).toHaveBeenCalledWith("two-ways", { behavior: "auto", block: "start" }),
    );
  });

  it("on the landing, the header and footer links scroll without adding Back steps", async () => {
    renderAt("#/welcome");
    const before = window.history.length;
    const nav = screen.getByRole("navigation", { name: "Site" });
    fireEvent.click(within(nav).getByRole("link", { name: "How it works" }));
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith("how", expect.anything()));
    fireEvent.click(within(nav).getByRole("link", { name: "How it works" }));
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(2));
    fireEvent.click(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Domains" }));
    await waitFor(() => expect(scrolled).toHaveBeenLastCalledWith("domains", expect.anything()));
    expect(window.history.length).toBe(before);
    expect(window.location.hash).toBe("#/welcome");
  });

  it("a new public page opens at its top; a ?s= visit keeps its section", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    renderAt("#/welcome");
    expect(scrollTo).not.toHaveBeenCalled(); // first paint: the browser's own restore stands
    window.location.hash = "#/download?os=mac";
    await screen.findByRole("heading", { name: "Tvashtr for Mac" });
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockReset();
    window.location.hash = "#/welcome?s=faq";
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith("faq", expect.anything()));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("from another page, a section link is an ordinary visit", async () => {
    renderAt("#/download?os=mac");
    const link = within(screen.getByRole("navigation", { name: "Site" })).getByRole("link", {
      name: "Product",
    });
    expect(link).toHaveAttribute("href", "#/welcome?s=product");
    expect(fireEvent.click(link)).toBe(true); // not prevented: the browser follows the href
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith("product", expect.anything()));
    expect(window.location.hash).toBe("#/welcome");
  });
});
