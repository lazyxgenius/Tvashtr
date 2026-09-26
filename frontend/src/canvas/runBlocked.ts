/**
 * Why "Run this team" is disabled, as the canvas's warn callout says it (engines.md ENG-77): the
 * providers the launch rule finds uncovered (the same rule POST /api/runs enforces), or the team's
 * blocking validity findings.
 */
import type { ValidityIssue } from "../lib/api";
import { RUNNER_SUBSCRIPTIONS, subscriptionProviderForModel } from "../lib/engines";

export interface RunBlock {
  title: string;
  detail: string;
  /** Offer "Open Engines" (a missing key is fixed there). */
  openEngines: boolean;
}

/** "anthropic" / "anthropic or xai" / "anthropic, openai or xai". */
export function joinOr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** A provider whose models Tvashtr Desktop can run on the owner's own subscription. */
function subscriptionCapable(provider: string): boolean {
  const sub = subscriptionProviderForModel(`${provider}/`);
  return sub !== null && RUNNER_SUBSCRIPTIONS.includes(sub);
}

export function credentialBlock(missing: string[], desktop: boolean): RunBlock | null {
  if (missing.length === 0) return null;
  const list = joinOr(missing);
  const anySub = missing.some(subscriptionCapable);
  if (desktop) {
    return {
      title: "Can’t run yet.",
      detail: anySub
        ? `No API key or connected subscription for ${list}.`
        : `No API key for ${list}.`,
      openEngines: true,
    };
  }
  return {
    title: "Can’t run on the website yet.",
    detail: `No API key for ${list}.${anySub ? " Subscriptions only work on Tvashtr Desktop." : ""}`,
    openEngines: true,
  };
}

export function validityBlock(errors: ValidityIssue[]): RunBlock | null {
  // A finding flagged on several nodes (two starting points) is said once.
  const messages = [...new Set(errors.map((e) => e.message))];
  if (messages.length === 0) return null;
  const shown = messages.slice(0, 2);
  const more = messages.length - shown.length;
  return {
    title: "Can’t run yet.",
    detail: `${shown.join(" ")}${more > 0 ? ` …and ${more} more.` : ""}`,
    openEngines: false,
  };
}
