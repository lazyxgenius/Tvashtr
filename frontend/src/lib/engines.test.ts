import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_PROVIDERS,
  subscriptionProviderForModel,
  modelProvidersForSubscription,
  credentialTreatment,
  missingProvidersForModels,
} from "./engines";

describe("engines mapping", () => {
  it("orders Claude → Grok → Codex", () => {
    expect(SUBSCRIPTION_PROVIDERS).toEqual(["claude", "grok", "codex"]);
  });

  it("maps model leading slugs to subscription providers", () => {
    expect(subscriptionProviderForModel("anthropic/claude-sonnet-4")).toBe("claude");
    expect(subscriptionProviderForModel("xai/grok-2")).toBe("grok");
    expect(subscriptionProviderForModel("grok/grok-2")).toBe("grok");
    expect(subscriptionProviderForModel("openai/gpt-4.1")).toBe("codex");
    expect(subscriptionProviderForModel("openrouter/openai/gpt-4o")).toBe(null);
  });

  it("lists BYOK slugs covered by a subscription provider", () => {
    expect(modelProvidersForSubscription("claude")).toEqual(["anthropic"]);
    expect(modelProvidersForSubscription("grok")).toEqual(["xai", "grok"]);
    expect(modelProvidersForSubscription("codex")).toEqual(["openai"]);
  });

  it("prefers subscription for local when connected", () => {
    expect(
      credentialTreatment({
        model: "anthropic/claude-sonnet-4",
        subscriptionConnected: true,
        byokConfigured: true,
        launchTarget: "local",
      }),
    ).toBe("subscription");
  });

  it("prefers BYOK for hosted even when subscription connected", () => {
    expect(
      credentialTreatment({
        model: "anthropic/claude-sonnet-4",
        subscriptionConnected: true,
        byokConfigured: true,
        launchTarget: "hosted",
      }),
    ).toBe("byok");
  });
});

describe("missingProvidersForModels", () => {
  it("lists BYOK providers that are not configured", () => {
    expect(
      missingProvidersForModels({
        models: ["openrouter/openai/gpt-4o", "openai/gpt-4o-mini"],
        byokProviders: new Set(["openai"]),
        subscriptionConnected: {},
        launchTarget: "hosted",
      }),
    ).toEqual(["openrouter"]);
  });

  it("treats a Desktop subscription as covering the mapped BYOK slug", () => {
    expect(
      missingProvidersForModels({
        models: ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4"],
        byokProviders: new Set(),
        subscriptionConnected: { codex: true, claude: true },
        launchTarget: "local",
      }),
    ).toEqual([]);
  });

  it("still requires BYOK on hosted even when a subscription is connected", () => {
    expect(
      missingProvidersForModels({
        models: ["openai/gpt-4o-mini"],
        byokProviders: new Set(),
        subscriptionConnected: { codex: true },
        launchTarget: "hosted",
      }),
    ).toEqual(["openai"]);
  });

  it("ignores blank models and gate-only empties", () => {
    expect(
      missingProvidersForModels({
        models: ["", null, undefined],
        byokProviders: new Set(),
        subscriptionConnected: {},
        launchTarget: "hosted",
      }),
    ).toEqual([]);
  });
});
