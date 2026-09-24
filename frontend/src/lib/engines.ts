export type SubscriptionProviderId = "claude" | "grok" | "codex";

export type SubscriptionCardState =
  | "disconnected"
  | "checking"
  | "needs_install"
  | "needs_login"
  // M-subs-desktop (A2): the CLI is signed in with an API key — shown, never counted as a subscription.
  | "api_key"
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
  // M-subs-desktop (A3): from the server mirror — connected AND the user's Tvashtr Desktop runner
  // polled recently. The Run gate counts a subscription only when this is true (same as the server).
  runner_fresh?: boolean;
}

/** The subscription engines Tvashtr Desktop can run a node with (Codex: not yet). */
export const RUNNER_SUBSCRIPTIONS: readonly SubscriptionProviderId[] = ["claude", "grok"] as const;

/**
 * Shown on the Engines subscription cards and once at Desktop launch (M-subs-desktop §3.0).
 * Exact wording — the compliance model rests on it.
 */
export const SUBSCRIPTION_DISCLOSURE =
  "Tvashtr runs your own installed Claude Code / Grok on this computer. You sign in inside that " +
  "tool — Tvashtr never sees or stores your login. Usage counts against your own plan and follows " +
  "Anthropic's / xAI's terms. Tvashtr isn't affiliated with or endorsed by Anthropic or xAI.";

/** Node picker label for a model the user's subscription covers on Desktop (§3.4). */
export function subscriptionCoverLabel(provider: SubscriptionProviderId): string {
  return `via your ${displayNameForSubscription(provider)} subscription · runs on this computer`;
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
  // M-subs-desktop: only an engine Tvashtr Desktop can run, and only on a Desktop launch, ever runs
  // a node on the user's subscription — hosted runs always use the API key.
  if (!sub || !RUNNER_SUBSCRIPTIONS.includes(sub)) {
    return opts.byokConfigured ? "byok" : "none";
  }
  if (opts.launchTarget === "local" && opts.subscriptionConnected) return "subscription";
  return opts.byokConfigured ? "byok" : "none";
}

/** BYOK provider slug from a model id (leading ``provider/`` segment). Matches api.providerOf. */
export function byokProviderOf(model: string): string {
  return model.split("/")[0]?.trim().toLowerCase() ?? "";
}

/**
 * THE launch credential rule (M-subs-desktop) — the same rule the server pre-flight runs, asserted
 * case-for-case against `credentialGate.cases.json` on both sides. Provider slugs required by node
 * models that have neither a BYOK key nor a covering subscription. A subscription covers only on a
 * Desktop (`local`) launch, only for an engine Tvashtr Desktop can run (Claude, Grok), and only when
 * `subscriptionConnected[sub]` is true — callers pass the server mirror's `connected && runner_fresh`
 * so the button agrees with `POST /api/runs`. Hosted launches always need a key. Sorted unique —
 * empty means the team can launch.
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
    const covers =
      opts.launchTarget === "local" &&
      subId !== null &&
      RUNNER_SUBSCRIPTIONS.includes(subId) &&
      opts.subscriptionConnected[subId] === true;
    if (covers) continue;
    missing.add(provider);
  }
  return [...missing].sort();
}

/**
 * Run CTA tooltip when the team is blocked on missing credentials.
 * Hosted/Fly cannot use Desktop subscriptions — only BYOK API keys satisfy runs there.
 */
export function missingCredentialCtaTitle(launchTarget: "local" | "hosted"): string {
  if (launchTarget === "hosted") {
    return "Add an API key under Engines on the Dashboard (subscriptions only work on local Desktop)";
  }
  return "Add API keys or connect a subscription under Engines on the Dashboard";
}

/**
 * One Missing-providers banner line for a BYOK slug the team still needs.
 */
export function missingProviderBannerDetail(
  provider: string,
  launchTarget: "local" | "hosted",
): string {
  if (launchTarget === "local") {
    return `No API key for “${provider}” (and no covering Desktop subscription)`;
  }
  return `No API key for “${provider}” (hosted runs need an API key; subscriptions are Desktop-only)`;
}

/**
 * Engines shelf subtitle — hosted (fly.dev) vs local Desktop credential clarity (#4).
 * Domains ingest/Ask and hosted team runs need API keys; Connect does not satisfy hosted.
 */
export function enginesShelfSubtitle(): string {
  return (
    "Hosted (fly.dev) Domains ingest/Ask and hosted team runs need API keys under Engines. " +
    "Desktop Connect/subscriptions do not satisfy hosted. " +
    "On local Desktop, subscriptions can cover some models; API keys still work."
  );
}

/** Subscriptions section callout — web vs Desktop wording; always clarifies hosted needs keys. */
export function enginesSubscriptionsCallout(isDesktop: boolean): string {
  if (isDesktop) {
    return (
      "Connect covers some models for local Desktop runs only — subscriptions do not satisfy hosted. " +
      "Add API keys below for fly.dev Domains ingest/Ask and hosted team runs. " +
      "Subscription runs stop when Desktop quits."
    );
  }
  return (
    "Subscription engines run on your machine — open Tvashtr Desktop to Connect. " +
    "They do not satisfy hosted (fly.dev) Domains ingest/Ask or hosted team runs; add API keys below."
  );
}

/** API keys section lede — required for hosted; also valid on Desktop. */
export function enginesApiKeysLede(): string {
  return (
    "Stored per account, encrypted. We only ever show the last 4 digits. " +
    "Required for hosted (fly.dev) Domains ingest/Ask and hosted team runs; " +
    "also work on local Desktop alongside subscriptions."
  );
}

/** Empty BYOK list hint. */
export function enginesApiKeysEmpty(): string {
  return (
    "Add API keys for hosted Domains ingest/Ask and Fly team runs " +
    "(Desktop Connect does not satisfy hosted)."
  );
}

/**
 * Desktop Engines card hint when CLI detect returns needs_install.
 * Dock-launched apps often miss Terminal npm-global PATH.
 */
export function enginesNeedsInstallHint(displayName: string): string {
  return (
    `${displayName} CLI was not found on the PATH this Desktop app sees ` +
    `(Dock launch ≠ Terminal). Install the CLI, ensure it is on your PATH ` +
    `(npm global bin / Homebrew), then quit and reopen Tvashtr and Refresh.`
  );
}

