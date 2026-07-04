import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LandingPage } from "./LandingPage";

/**
 * The premium logged-out landing (F4). A pure presentational component: it owns no data and no
 * auth — the CTAs call back into `onGetStarted(mode)`, which AuthGate routes to the login/register
 * screen (the only way into the product). These tests pin the CONTRACT — the key sections render,
 * each CTA routes to the right auth mode, the secondary CTA is the in-page anchor, and the page is
 * readable under prefers-reduced-motion — NOT pixel fidelity (that is the Playwright self-sign-off
 * vs Landing.dc.html).
 */
describe("LandingPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the key sections (hero, pitch pill, how-it-works, differentiators, closing)", () => {
    render(<LandingPage onGetStarted={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /build the team/i })).toBeInTheDocument();
    expect(screen.getByText(/Compose your own team of AI agents/i)).toBeInTheDocument();
    // "How it works" appears in the nav AND the section eyebrow — at least one must render.
    expect(screen.getAllByText(/how it works/i).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: /the team assembles as you scroll/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /composable\. legible\. steerable\./i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /start weaving/i })).toBeInTheDocument();
  });

  it("has NO canvas / team / auth surface (the CTAs are the only way in)", () => {
    render(<LandingPage onGetStarted={vi.fn()} />);
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByText(/the living canvas/i)).toBeNull();
  });

  it("routes the primary CTA to register and 'Sign in' to login (both auth modes reachable)", () => {
    const onGetStarted = vi.fn();
    render(<LandingPage onGetStarted={onGetStarted} />);
    fireEvent.click(screen.getByRole("button", { name: /start building/i }));
    expect(onGetStarted).toHaveBeenLastCalledWith("register");
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(onGetStarted).toHaveBeenLastCalledWith("login");
  });

  it("points the secondary hero CTA at the in-page #how anchor", () => {
    render(<LandingPage onGetStarted={vi.fn()} />);
    expect(screen.getByRole("link", { name: /see how it works/i })).toHaveAttribute("href", "#how");
  });

  it("renders fully under prefers-reduced-motion (no crash, content visible)", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    render(<LandingPage onGetStarted={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /build the team/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start building/i })).toBeInTheDocument();
  });

  it("exposes a <main> landmark reachable via a skip-to-content link, plus a named nav (a11y hardening)", () => {
    render(<LandingPage onGetStarted={vi.fn()} />);
    // The page content is wrapped in a <main> landmark...
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    // ...and the skip link points at it (keyboard/SR users jump the nav straight to content).
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute(
      "href",
      "#main-content",
    );
    // The primary navigation is a *named* landmark, not an anonymous <nav>.
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
  });

  it("keeps 'Sign in' reachable and flagged to survive the mobile nav fold", () => {
    const onGetStarted = vi.fn();
    render(<LandingPage onGetStarted={onGetStarted} />);
    const signIn = screen.getByRole("button", { name: /^sign in$/i });
    // `tv-lp__nav-signin` is the hook the <=560px media query keeps visible while the
    // in-page anchor links fold away — login must never vanish on phones. Assert the hook
    // so the fix can't silently regress to a plain (foldable) nav link.
    expect(signIn).toHaveClass("tv-lp__nav-signin");
    fireEvent.click(signIn);
    expect(onGetStarted).toHaveBeenLastCalledWith("login");
  });
});
