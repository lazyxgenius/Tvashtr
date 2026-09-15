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
