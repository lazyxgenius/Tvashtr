import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopDisclosure } from "./DesktopDisclosure";

// M-subs-desktop §3.0: the subscription disclosure is shown once at Desktop launch (and always on
// the Engines cards). Dismissing it hides it for the rest of this app session.

afterEach(() => {
  delete document.documentElement.dataset.tvashtrDesktop;
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("DesktopDisclosure", () => {
  it("shows the disclosure on Desktop at launch and hides it once dismissed", () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const { unmount } = render(<DesktopDisclosure />);
    expect(screen.getByRole("note", { name: /subscriptions on this computer/i })).toHaveTextContent(
      "Tvashtr never sees or stores your login",
    );
    fireEvent.click(screen.getByRole("button", { name: /Got it/i }));
    expect(screen.queryByRole("note", { name: /subscriptions on this computer/i })).toBeNull();
    unmount();
    render(<DesktopDisclosure />);
    expect(screen.queryByRole("note", { name: /subscriptions on this computer/i })).toBeNull();
  });

  it("never shows on the web app", () => {
    render(<DesktopDisclosure />);
    expect(screen.queryByRole("note", { name: /subscriptions on this computer/i })).toBeNull();
  });
});
