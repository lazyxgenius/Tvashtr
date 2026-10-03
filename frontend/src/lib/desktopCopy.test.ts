import { afterEach, describe, expect, it } from "vitest";

import { estimateText, replayCostText } from "./agentTestsFormat";
import { desktopQuery, onSubscriptions, subscriptionsText } from "./desktopRepos";

// M-desk-2 (E2): on the Desktop, when every model an action would run is on a fresh subscription
// (the server's `desktop` routes, read with `?desktop_target=1`), the copy names the subscription
// instead of keys. Mixed, not fresh, or the website: today's words, unchanged.

const CLAUDE = { subscriptions: ["claude"], all: true };
const BOTH = { subscriptions: ["claude", "grok"], all: true };
const MIXED = { subscriptions: ["claude"], all: false };
const AI = { available: true, left: 186, limit: 200 };

afterEach(() => {
  delete document.documentElement.dataset.tvashtrDesktop;
});

describe("the subscription words", () => {
  it("name one, two or more subscriptions", () => {
    expect(subscriptionsText(["claude"])).toBe("your Claude subscription");
    expect(subscriptionsText(["grok"])).toBe("your Grok subscription");
    expect(subscriptionsText(["grok", "claude"])).toBe("your Claude and Grok subscriptions");
  });

  it("only when every route is all on a subscription", () => {
    expect(onSubscriptions(CLAUDE)).toBe("your Claude subscription");
    expect(onSubscriptions(CLAUDE, { subscriptions: ["grok"], all: true })).toBe(
      "your Claude and Grok subscriptions",
    );
    expect(onSubscriptions(BOTH)).toBe("your Claude and Grok subscriptions");
    expect(onSubscriptions(MIXED)).toBeNull();
    expect(onSubscriptions(CLAUDE, MIXED)).toBeNull();
    expect(onSubscriptions({ subscriptions: [], all: false })).toBeNull();
    expect(onSubscriptions(undefined)).toBeNull();
    expect(onSubscriptions(CLAUDE, null)).toBeNull();
  });

  it("the Desktop's reads carry ?desktop_target=1; the website's carry nothing", () => {
    expect(desktopQuery()).toBe("");
    expect(desktopQuery("&")).toBe("");
    document.documentElement.dataset.tvashtrDesktop = "true";
    expect(desktopQuery()).toBe("?desktop_target=1");
    expect(desktopQuery("&")).toBe("&desktop_target=1");
  });
});

describe("Test-EstimateDesktop", () => {
  it("the estimate box names the subscription instead of keys", () => {
    expect(
      estimateText("Reviewer", { cost_usd: 0.4, minutes: 4 }, AI, onSubscriptions(CLAUDE)),
    ).toBe(
      "Replays only the Reviewer, on saved inputs, on your Claude subscription · about 4 min. AI checks are included.",
    );
    expect(
      estimateText(
        "Reviewer",
        { cost_usd: 0.4, minutes: 4 },
        { ...AI, available: false },
        onSubscriptions(CLAUDE),
      ),
    ).toBe(
      "Replays only the Reviewer, on saved inputs, on your Claude subscription · about 4 min.",
    );
  });

  it("the website's (and a mixed Desktop's) estimate box is today's, word for word", () => {
    const today =
      "Replays only the Reviewer, on saved inputs. About $0.40 on your keys · 4 min. AI checks are included.";
    expect(estimateText("Reviewer", { cost_usd: 0.4, minutes: 4 }, AI)).toBe(today);
    expect(
      estimateText("Reviewer", { cost_usd: 0.4, minutes: 4 }, AI, onSubscriptions(MIXED)),
    ).toBe(today);
    expect(estimateText("Reviewer", null, AI, onSubscriptions(CLAUDE))).toBe(
      "Replays only the Reviewer, on saved inputs. AI checks are included.",
    );
  });

  it("the New test footer names the subscription instead of keys", () => {
    expect(replayCostText({ cost_usd: 0.07 }, onSubscriptions(CLAUDE))).toBe(
      "Replaying runs on your Claude subscription",
    );
    expect(replayCostText({ cost_usd: 0.07 })).toBe("Replaying costs about $0.07 on your keys");
    expect(replayCostText({ cost_usd: 0.07 }, onSubscriptions(MIXED))).toBe(
      "Replaying costs about $0.07 on your keys",
    );
    expect(replayCostText(null, onSubscriptions(CLAUDE))).toBeNull();
  });
});
