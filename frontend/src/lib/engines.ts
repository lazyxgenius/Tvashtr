export type SubscriptionProviderId = "claude" | "grok" | "codex";

export type SubscriptionCardState =
  | "disconnected"
  | "checking"
  | "needs_install"
  | "needs_login"
  | "connected"
  | "error";

export type SubscriptionSource = "harness" | "oauth";

export interface SubscriptionStatus {
  provider: SubscriptionProviderId;
  connected: boolean;
  state: SubscriptionCardState;
  account_hint: string | null;
  source: SubscriptionSource | null;
  checked_at: string | null;
}

export const SUBSCRIPTION_PROVIDERS: readonly SubscriptionProviderId[] = [
  "claude",
  "grok",
  "codex",
] as const;

const MODEL_TO_SUB: Record<string, SubscriptionProviderId> = {
  anthropic: "claude",
  xai: "grok",
  grok: "grok",
  openai: "codex",
};

const SUB_TO_MODELS: Record<SubscriptionProviderId, string[]> = {
  claude: ["anthropic"],
  grok: ["xai", "grok"],
  codex: ["openai"],
};

export function subscriptionProviderForModel(model: string): SubscriptionProviderId | null {
  const slug = model.split("/", 1)[0]?.trim().toLowerCase() ?? "";
  return MODEL_TO_SUB[slug] ?? null;
}

export function modelProvidersForSubscription(provider: SubscriptionProviderId): string[] {
  return [...SUB_TO_MODELS[provider]];
}

export function displayNameForSubscription(provider: SubscriptionProviderId): string {
  switch (provider) {
    case "claude":
      return "Claude";
    case "grok":
      return "Grok";
    case "codex":
      return "Codex";
  }
}

/** Prefer-subscription wins when Desktop local context + connected. */
export function credentialTreatment(opts: {
  model: string;
  subscriptionConnected: boolean;
  byokConfigured: boolean;
  launchTarget: "local" | "hosted";
}): "subscription" | "byok" | "none" {
  const sub = subscriptionProviderForModel(opts.model);
  if (!sub) {
    return opts.byokConfigured ? "byok" : "none";
  }
  if (opts.launchTarget === "local" && opts.subscriptionConnected) return "subscription";
  if (opts.byokConfigured) return "byok";
  if (opts.subscriptionConnected) return "subscription";
  return "none";
}

/** BYOK provider slug from a model id (leading ``provider/`` segment). Matches api.providerOf. */
export function byokProviderOf(model: string): string {
  return model.split("/")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Provider slugs required by node models that have neither a BYOK key nor a covering
 * Desktop subscription. Hosted launches still need BYOK even if a subscription is mirrored
 * connected (subscriptions only run locally). Sorted unique — empty means the team can launch.
 */
export function missingProvidersForModels(opts: {
  models: readonly (string | null | undefined)[];
  byokProviders: ReadonlySet<string>;
  subscriptionConnected: Readonly<Partial<Record<SubscriptionProviderId, boolean>>>;
  launchTarget: "local" | "hosted";
}): string[] {
  const missing = new Set<string>();
  for (const raw of opts.models) {
    const model = (raw ?? "").trim();
    if (!model) continue;
    const provider = byokProviderOf(model);
    if (!provider) continue;
    if (opts.byokProviders.has(provider)) continue;
    const subId = subscriptionProviderForModel(model);
    const subConnected = subId ? opts.subscriptionConnected[subId] === true : false;
    // Match TeamNodePanel soft-warning: subscription covers missing BYOK only on Desktop local.
    if (opts.launchTarget === "local" && subConnected) continue;
    missing.add(provider);
  }
  return [...missing].sort();
}
