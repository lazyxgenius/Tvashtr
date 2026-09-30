/**
 * Opening a provider's sign-in page: a popup on the web (opened blank in the click, then pointed
 * at the address), the system browser on Tvashtr Desktop. Only http(s) addresses are ever opened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openSignIn, prepareSignInWindow } from "./connectSignIn";

const AUTHORIZE = "https://api.supabase.com/v1/oauth/authorize?response_type=code&state=s1";

function fakePopup() {
  return { location: { href: "about:blank" }, opener: window as unknown, close: vi.fn() };
}
type Popup = ReturnType<typeof fakePopup>;

let popup: Popup | null;
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  popup = fakePopup();
  open = vi.fn(() => popup);
  vi.stubGlobal("open", open);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.tvashtrDesktop;
});

describe("on the web", () => {
  it("opens a blank popup in the click, then points it at the sign-in", () => {
    const prepared = prepareSignInWindow();
    expect(open).toHaveBeenCalledExactlyOnceWith("", "tv-connect", "popup,width=520,height=720");
    expect(popup?.location.href).toBe("about:blank");

    expect(openSignIn(AUTHORIZE, prepared)).toBe("opened");
    expect(popup?.location.href).toBe(AUTHORIZE);
    // The provider's page gets no handle on Tvashtr's window.
    expect(popup?.opener).toBeNull();
    expect(open).toHaveBeenCalledOnce();
  });

  it("opens the window again when there is none to reuse", () => {
    expect(openSignIn(AUTHORIZE, null)).toBe("opened");
    expect(open).toHaveBeenCalledExactlyOnceWith("", "tv-connect", "popup,width=520,height=720");
    expect(popup?.location.href).toBe(AUTHORIZE);
  });

  it("says so when the browser blocked the popup", () => {
    popup = null;
    expect(prepareSignInWindow()).toBeNull();
    expect(openSignIn(AUTHORIZE, null)).toBe("blocked");
  });

  it.each([
    "javascript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "JAVASCRIPT:alert(1)",
    "file:///etc/passwd",
    "not an address",
    "",
  ])("never gives the popup %s", (address) => {
    const prepared = prepareSignInWindow();
    expect(openSignIn(address, prepared)).toBe("refused");
    // The blank popup is same-origin: a script address assigned to it would run as Tvashtr.
    expect(popup?.location.href).toBe("about:blank");
    expect(popup?.close).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();

    expect(openSignIn(address, null)).toBe("refused");
    expect(open).toHaveBeenCalledOnce();
  });

  it("opens a plain http address (local development)", () => {
    expect(openSignIn("http://localhost:9000/authorize", prepareSignInWindow())).toBe("opened");
    expect(popup?.location.href).toBe("http://localhost:9000/authorize");
  });
});

describe("on Tvashtr Desktop", () => {
  beforeEach(() => {
    document.documentElement.dataset.tvashtrDesktop = "true";
  });

  it("opens the system browser, with no blank popup first", () => {
    expect(prepareSignInWindow()).toBeNull();
    expect(open).not.toHaveBeenCalled();

    expect(openSignIn(AUTHORIZE, null)).toBe("opened");
    // Electron sends a `tv-external` window to the system browser.
    expect(open).toHaveBeenCalledExactlyOnceWith(AUTHORIZE, "tv-external", "noopener");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ms-msdt:/id"])(
    "never opens %s",
    (address) => {
      expect(openSignIn(address, null)).toBe("refused");
      expect(open).not.toHaveBeenCalled();
    },
  );
});
