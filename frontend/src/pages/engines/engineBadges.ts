/**
 * The Engines nav badges on every page (ENG-2..4): "N to fix" / "New" on Overview, "X of 2" on
 * Subscriptions and the saved-key count on API keys. `pages/badgeLoaders.ts` registers this; the
 * Engines pages publish the same numbers after every load and change.
 */
import {
  NO_RUNNER,
  getEngineUsage,
  getEnginesConfig,
  getSubscriptions,
  listKeys,
} from "../../lib/api/engines";
import { isDesktopApp } from "../../lib/desktopRepos";
import type { NavBadges } from "../../lib/workspaceStatus";
import { readLiveStatuses } from "./engineBridge";
import { engineBadges } from "./engineModel";

export async function loadEngineBadges(): Promise<Partial<NavBadges>> {
  const [config, keys, usage, mirror, live] = await Promise.all([
    getEnginesConfig(),
    listKeys(),
    getEngineUsage(),
    getSubscriptions().catch(() => null),
    readLiveStatuses(),
  ]);
  const subs = live ?? mirror?.subscriptions;
  // Neither the bridge nor the mirror answered: keep the last badges rather than guess.
  if (!subs) throw new Error("No subscription status");
  return engineBadges({
    directory: config.directory,
    catalogue: config.catalogue,
    keys,
    usage,
    subs,
    runner: mirror?.runner ?? NO_RUNNER,
    surface: isDesktopApp() ? "desktop" : "website",
  });
}
