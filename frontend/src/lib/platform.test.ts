import { describe, expect, it } from "vitest";

import { detectArch, detectOs } from "./platform";

const nav = (userAgent: string, extra: Record<string, unknown> = {}) =>
  ({ userAgent, platform: "", maxTouchPoints: 0, ...extra }) as Parameters<typeof detectOs>[0];

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("detectOs (website.md WEB-32)", () => {
  it("reads User-Agent Client Hints first", () => {
    expect(detectOs(nav("x", { userAgentData: { platform: "macOS" } }))).toBe("mac");
    expect(detectOs(nav("x", { userAgentData: { platform: "Windows" } }))).toBe("windows");
    expect(detectOs(nav("x", { userAgentData: { platform: "Linux" } }))).toBe("linux");
    expect(detectOs(nav("x", { userAgentData: { platform: "Android", mobile: true } }))).toBe(
      "phone",
    );
  });

  it("falls back to the platform and user agent", () => {
    expect(detectOs(nav(SAFARI_MAC, { platform: "MacIntel" }))).toBe("mac");
    expect(detectOs(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", { platform: "Win32" }))).toBe(
      "windows",
    );
    expect(detectOs(nav("Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"))).toBe("linux");
    expect(detectOs(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"))).toBe("phone");
    expect(detectOs(nav("Mozilla/5.0 (Linux; Android 15; Pixel 9)"))).toBe("phone");
    expect(detectOs(nav("SomethingElse/1.0"))).toBe("unknown");
  });

  it("an iPad asking for the desktop site says Mac but has a touch screen: a phone", () => {
    expect(detectOs(nav(SAFARI_MAC, { platform: "MacIntel", maxTouchPoints: 5 }))).toBe("phone");
  });
});

describe("detectArch", () => {
  const hints = (architecture: string) =>
    nav("x", { userAgentData: { getHighEntropyValues: () => Promise.resolve({ architecture }) } });

  it("only UA-CH names the architecture", async () => {
    await expect(detectArch(hints("arm"))).resolves.toBe("arm");
    await expect(detectArch(hints("x86"))).resolves.toBe("x86");
    await expect(detectArch(hints(""))).resolves.toBe("unknown");
  });

  it("Safari and Firefox (no UA-CH) are unknown, never Intel", async () => {
    await expect(detectArch(nav(SAFARI_MAC, { platform: "MacIntel" }))).resolves.toBe("unknown");
  });

  it("a refused hint is unknown", async () => {
    const refusing = nav("x", {
      userAgentData: { getHighEntropyValues: () => Promise.reject(new Error("no")) },
    });
    await expect(detectArch(refusing)).resolves.toBe("unknown");
  });
});
