import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canSignInWithBrowser,
  forgetUser,
  getAppInfo,
  getLaunchContext,
  onSignIn,
  startSignIn,
  thisComputer,
} from "./desktopApp";

afterEach(() => {
  delete window.tvashtrDesktop;
  delete window.tvashtrDesktopInfo;
});

describe("desktopApp — the bridge wrappers", () => {
  it("answer neutrally on the website (no bridge)", async () => {
    expect(canSignInWithBrowser()).toBe(false);
    expect(await startSignIn()).toBeNull();
    expect(await getLaunchContext()).toEqual({ openedFromWeb: null, lastUser: null });
    expect(await getAppInfo()).toBeNull();
    await expect(forgetUser()).resolves.toBeUndefined();
    expect(typeof onSignIn(() => {})).toBe("function");
  });

  it("answer neutrally on an older Desktop (bridge v5, no auth)", async () => {
    window.tvashtrDesktop = { engines: {} } as unknown as TvashtrDesktopBridge;
    expect(canSignInWithBrowser()).toBe(false);
    expect(await getLaunchContext()).toEqual({ openedFromWeb: null, lastUser: null });
  });

  it("validate what the bridge answers", async () => {
    window.tvashtrDesktop = {
      auth: {
        getLaunchContext: vi.fn(() =>
          Promise.resolve({
            openedFromWeb: { login: 42, host: "x" },
            lastUser: { login: "lazyxgenius" },
          }),
        ),
        startSignIn: vi.fn(() => Promise.resolve({ nope: true })),
      },
      app: { getInfo: vi.fn(() => Promise.resolve({ version: 5 })) },
    } as unknown as TvashtrDesktopBridge;
    expect(await getLaunchContext()).toEqual({
      openedFromWeb: null,
      lastUser: { login: "lazyxgenius", displayName: "lazyxgenius" },
    });
    expect(await startSignIn()).toBeNull();
    expect(await getAppInfo()).toBeNull();
  });

  it("a failing bridge call never throws out of the context read", async () => {
    window.tvashtrDesktop = {
      auth: { getLaunchContext: vi.fn(() => Promise.reject(new Error("boom"))) },
    } as unknown as TvashtrDesktopBridge;
    expect(await getLaunchContext()).toEqual({ openedFromWeb: null, lastUser: null });
  });

  it("names the computer by platform (DT-50)", () => {
    window.tvashtrDesktopInfo = { shell: "electron", version: 6, platform: "darwin" };
    expect(thisComputer()).toBe("this Mac");
    window.tvashtrDesktopInfo = { shell: "electron", version: 6, platform: "win32" };
    expect(thisComputer()).toBe("this computer");
  });
});
