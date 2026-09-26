import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadEngineBadges } from "./engineBadges";
import { SUBS, installDesktop, mockEnginesApi, resetEnginesState, sub } from "./enginesTestUtils";

beforeEach(() => resetEnginesState());
afterEach(() => {
  vi.unstubAllGlobals();
  resetEnginesState();
});

describe("loadEngineBadges (the nav on every page)", () => {
  it("website: counts from the mirror", async () => {
    mockEnginesApi();
    await expect(loadEngineBadges()).resolves.toEqual({
      enginesFirstTime: false,
      enginesToFix: 2,
      subscriptions: { connected: 1, total: 2 },
      apiKeys: 3,
    });
  });

  it("Desktop: the live bridge status wins", async () => {
    mockEnginesApi();
    installDesktop([SUBS[0], sub("grok", "connected"), SUBS[2]]);
    await expect(loadEngineBadges()).resolves.toMatchObject({
      enginesToFix: 1,
      subscriptions: { connected: 2, total: 2 },
    });
  });

  it("no subscription status at all keeps the last badges (throws)", async () => {
    mockEnginesApi({
      "GET /api/engines/subscriptions": () => new Response("{}", { status: 500 }),
    });
    await expect(loadEngineBadges()).rejects.toThrow();
  });
});
