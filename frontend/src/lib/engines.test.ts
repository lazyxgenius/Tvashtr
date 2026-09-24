import { describe, expect, it } from "vitest";

import sharedGate from "./credentialGate.cases.json";
import {
  RUNNER_SUBSCRIPTIONS,
  SUBSCRIPTION_DISCLOSURE,
  subscriptionCoverLabel,
  SUBSCRIPTION_PROVIDERS,
  subscriptionProviderForModel,
  modelProvidersForSubscription,
  credentialTreatment,
  missingProvidersForModels,
  missingCredentialCtaTitle,
  missingProviderBannerDetail,
  enginesNeedsInstallHint,
  enginesShelfSubtitle,
  enginesSubscriptionsCallout,
  enginesApiKeysLede,
  enginesApiKeysEmpty,
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

  it("treats a fresh Desktop subscription as covering the mapped BYOK slug", () => {
    expect(
      missingProvidersForModels({
        models: ["xai/grok-4.7", "anthropic/claude-sonnet-4"],
        byokProviders: new Set(),
        subscriptionConnected: { grok: true, claude: true },
        launchTarget: "local",
      }),
    ).toEqual([]);
  });

  it("a Codex subscription cannot run nodes on Desktop yet — openai still needs a key", () => {
    expect(
      missingProvidersForModels({
        models: ["openai/gpt-4o-mini"],
        byokProviders: new Set(),
        subscriptionConnected: { codex: true },
        launchTarget: "local",
      }),
    ).toEqual(["openai"]);
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

describe("missingCredentialCtaTitle / banner detail", () => {
  it("hosted CTA requires API keys and excludes subscription as a fix", () => {
    const title = missingCredentialCtaTitle("hosted");
    expect(title).toMatch(/API key/i);
    expect(title).toMatch(/Engines/i);
    expect(title).toMatch(/Desktop/i);
    expect(title).not.toMatch(/or connect a subscription/i);
  });

  it("local CTA still offers API keys or a Desktop subscription", () => {
    expect(missingCredentialCtaTitle("local")).toBe(
      "Add API keys or connect a subscription under Engines on the Dashboard",
    );
  });

  it("hosted banner line says API keys are required; subscriptions are Desktop-only", () => {
    expect(missingProviderBannerDetail("openai", "hosted")).toBe(
      "No API key for “openai” (hosted runs need an API key; subscriptions are Desktop-only)",
    );
  });

  it("local banner line mentions covering Desktop subscription", () => {
    expect(missingProviderBannerDetail("openai", "local")).toBe(
      "No API key for “openai” (and no covering Desktop subscription)",
    );
  });
});

describe("engines shelf hosted-vs-subscription copy (#4)", () => {
  it("shelf subtitle: hosted needs API keys; Connect does not satisfy hosted; local Desktop can use subs", () => {
    const copy = enginesShelfSubtitle();
    expect(copy).toMatch(/hosted/i);
    expect(copy).toMatch(/fly\.dev/i);
    expect(copy).toMatch(/API key/i);
    expect(copy).toMatch(/Domains ingest\/Ask/i);
    expect(copy).toMatch(/Connect|subscription/i);
    expect(copy).toMatch(/do(?:es)? not satisfy hosted|not satisfy hosted/i);
    expect(copy).toMatch(/[Dd]esktop/);
  });

  it("subscriptions callout on web: open Desktop; subs do not satisfy hosted", () => {
    const copy = enginesSubscriptionsCallout(false);
    expect(copy).toMatch(/Desktop/i);
    expect(copy).toMatch(/connect/i);
    expect(copy).toMatch(/do(?:es)? not satisfy hosted|not satisfy hosted/i);
    expect(copy).toMatch(/API key/i);
  });

  it("subscriptions callout on Desktop: local-only + quit warning; not for hosted", () => {
    const copy = enginesSubscriptionsCallout(true);
    expect(copy).toMatch(/local/i);
    expect(copy).toMatch(/quit/i);
    expect(copy).toMatch(/do(?:es)? not satisfy hosted|not satisfy hosted/i);
    expect(copy).toMatch(/API key/i);
  });

  it("API keys lede: required for hosted Domains + team runs; also work on Desktop", () => {
    const copy = enginesApiKeysLede();
    expect(copy).toMatch(/encrypted/i);
    expect(copy).toMatch(/hosted/i);
    expect(copy).toMatch(/Domains ingest\/Ask/i);
    expect(copy).toMatch(/Desktop/i);
  });

  it("API keys empty state: hosted needs keys; Connect does not satisfy hosted", () => {
    const copy = enginesApiKeysEmpty();
    expect(copy).toMatch(/API key/i);
    expect(copy).toMatch(/hosted/i);
    expect(copy).toMatch(/Connect|subscription/i);
    expect(copy).toMatch(/do(?:es)? not satisfy hosted|not satisfy hosted/i);
  });
});

describe("enginesNeedsInstallHint (Desktop PATH / Dock)", () => {
  it("explains Dock PATH ≠ Terminal and Refresh after quit/reopen", () => {
    const copy = enginesNeedsInstallHint("Grok");
    expect(copy).toMatch(/Grok CLI/i);
    expect(copy).toMatch(/PATH/i);
    expect(copy).toMatch(/Dock/i);
    expect(copy).toMatch(/Terminal/i);
    expect(copy).toMatch(/Refresh/i);
    expect(copy).toMatch(/quit|reopen/i);
  });
});

// M-subs-desktop: the ONE launch credential rule. These exact cases are ALSO asserted against the
// server pre-flight (backend/tests/test_credential_gate.py) — the Run button and POST /api/runs
// cannot disagree.
describe("shared launch credential rule (FE ⇄ server)", () => {
  for (const c of sharedGate.cases) {
    it(c.name, () => {
      const fresh: Partial<Record<"claude" | "grok" | "codex", boolean>> = {};
      for (const p of c.fresh) fresh[p as "claude" | "grok" | "codex"] = true;
      expect(
        missingProvidersForModels({
          models: c.models,
          byokProviders: new Set(c.byok),
          subscriptionConnected: fresh,
          launchTarget: c.target as "local" | "hosted",
        }),
      ).toEqual(c.missing);
    });
  }

  it("only Claude and Grok can run on Tvashtr Desktop", () => {
    expect(RUNNER_SUBSCRIPTIONS).toEqual(["claude", "grok"]);
  });
});

describe("subscription copy (M-subs-desktop §3.0/§3.4)", () => {
  it("labels a covered node as running on this computer via the subscription", () => {
    expect(subscriptionCoverLabel("claude")).toBe(
      "via your Claude subscription · runs on this computer",
    );
    expect(subscriptionCoverLabel("grok")).toBe(
      "via your Grok subscription · runs on this computer",
    );
  });

  it("carries the exact compliance disclosure", () => {
    expect(SUBSCRIPTION_DISCLOSURE).toBe(
      "Tvashtr runs your own installed Claude Code / Grok on this computer. You sign in inside that tool — Tvashtr never sees or stores your login. Usage counts against your own plan and follows Anthropic's / xAI's terms. Tvashtr isn't affiliated with or endorsed by Anthropic or xAI.",
    );
  });
});
