/**
 * The credential hint under the Model button (PANEL-40) and whether a model is covered at all
 * (PANEL-15 / Q9: "Needs a model" when blank or when no key or subscription covers it). Kept out of
 * lib/engines.ts (the Engines area owns that file).
 */
import { providerOf } from "../../lib/api";
import {
  credentialTreatment,
  displayNameForSubscription,
  missingProviderBannerDetail,
  subscriptionProviderForModel,
  type SubscriptionProviderId,
} from "../../lib/engines";
import { providerLabel } from "../nodeBadges";

/** What the account holds: API keys by provider, and which subscriptions a Desktop run can use. */
export interface CredentialCover {
  byok: ReadonlySet<string>;
  subs: Partial<Record<SubscriptionProviderId, boolean>>;
}

export interface ModelHint {
  icon: "monitor" | "key" | "warn" | null;
  text: string;
  warn: boolean;
}

export function isDesktopApp(): boolean {
  return document.documentElement.dataset.tvashtrDesktop === "true";
}

/** How this model would run: on a subscription (Desktop), on an API key, or not at all. */
export function modelTreatment(
  model: string,
  cover: CredentialCover,
  desktop = isDesktopApp(),
): "subscription" | "byok" | "none" {
  const sub = subscriptionProviderForModel(model);
  return credentialTreatment({
    model,
    subscriptionConnected: sub ? cover.subs[sub] === true : false,
    byokConfigured: cover.byok.has(providerOf(model)),
    launchTarget: desktop ? "local" : "hosted",
  });
}

/** The hint under the model; null while credentials are still loading. */
export function modelHint(
  model: string,
  cover: CredentialCover | null,
  desktop = isDesktopApp(),
): ModelHint | null {
  if (!model.trim()) {
    return { icon: null, text: "This agent needs a model before the team can run.", warn: true };
  }
  if (!cover) return null;
  const provider = providerOf(model);
  switch (modelTreatment(model, cover, desktop)) {
    case "subscription": {
      const sub = subscriptionProviderForModel(model) as SubscriptionProviderId;
      return {
        icon: "monitor",
        text: `Your ${displayNameForSubscription(sub)} subscription · runs on this computer`,
        warn: false,
      };
    }
    case "byok":
      return { icon: "key", text: `Uses your ${providerLabel(provider)} API key`, warn: false };
    default:
      return {
        icon: "warn",
        text: `${missingProviderBannerDetail(provider, desktop ? "local" : "hosted")}.`,
        warn: true,
      };
  }
}

/** Needs a model: blank, or (once credentials are known) nothing covers it. */
export function needsModel(model: string, cover: CredentialCover | null): boolean {
  if (!model.trim()) return true;
  return cover !== null && modelTreatment(model, cover) === "none";
}
