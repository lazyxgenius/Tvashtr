/**
 * The Tvashtr Desktop bridge's `engines` namespace (ENG-81): on Desktop the live status from the
 * Electron main process wins over the server mirror. The website — or an older Desktop build — has
 * no bridge, so every call here is optional and never throws.
 */
import { completeStatuses, toSubscriptionStatus } from "../../lib/api/engines";
import type { SubscriptionStatus } from "../../lib/engines";

export type EnginesBridge = TvashtrDesktopBridge["engines"];

/** The bridge's engines API, or null on the website. */
export function enginesBridge(): EnginesBridge | null {
  const d = typeof window === "undefined" ? undefined : window.tvashtrDesktop;
  if (!d || typeof d !== "object") return null;
  const engines = (d as Partial<TvashtrDesktopBridge>).engines;
  return engines && typeof engines === "object" ? engines : null;
}

/** The live statuses (always Claude, Grok, Codex), or null when there is no bridge or it could not
 *  answer — the caller then keeps the mirror. */
export async function readLiveStatuses(): Promise<SubscriptionStatus[] | null> {
  const engines = enginesBridge();
  if (!engines?.getStatus) return null;
  try {
    const raw: unknown = await engines.getStatus();
    if (!Array.isArray(raw)) return null;
    const rows = raw
      .map((r) => toSubscriptionStatus(r))
      .filter((r): r is SubscriptionStatus => r !== null);
    return rows.length > 0 ? completeStatuses(rows) : null;
  } catch {
    return null;
  }
}
