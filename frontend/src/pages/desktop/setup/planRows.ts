/**
 * The Engines step's plan rows (desktop-app.md DT-20..DT-24): what each Claude Code / Grok / Codex
 * row shows for a bridge status. Pure, so every state is testable without a bridge.
 *
 * The bridge's `disconnected` is the sticky "Use my plan" off (OQ-17): the row reads "Not used".
 * "Checking…" with Cancel is this page's own state while a Terminal sign-in is open (DT-23).
 */
import type { BadgeVariant } from "../../../design-system/components";
import type { SubscriptionStatus } from "../../../lib/engines";

export type PlanProvider = "claude" | "grok";

export type PlanAction =
  | { kind: "switch"; checked: boolean }
  | {
      kind: "button";
      variant: "tint" | "ghost";
      label: string;
      /** connect = DT-23 Terminal sign-in; setUp = the install sheet (DT-25); refresh = ask again. */
      does: "connect" | "setUp" | "refresh" | "cancel";
    };

export interface PlanRowView {
  provider: PlanProvider;
  title: string;
  badge: { variant: BadgeVariant; dot: boolean; label: string };
  line: string;
  /** The row's border: sage when in use, amber when it needs a sign-in. */
  tone: "sage" | "amber" | "line";
  action: PlanAction | null;
}

export const CODEX_INSTALL_URL = "https://developers.openai.com/codex";
/** The vendors' install guides (the harness's INSTALL_URL, desktop/electron/harness/*.cjs). */
export const PLAN_INSTALL_URLS: Record<PlanProvider, string> = {
  claude: "https://docs.anthropic.com/en/docs/claude-code/overview",
  grok: "https://docs.x.ai/build/cli/reference",
};

const TITLE: Record<PlanProvider, string> = { claude: "Claude Code", grok: "Grok" };
const PLAN: Record<PlanProvider, string> = { claude: "Claude", grok: "Grok" };
const MODELS: Record<PlanProvider, string> = { claude: "anthropic/*", grok: "xai/*" };
const INSTALL_LINE: Record<PlanProvider, string> = {
  claude: "Install it and sign in once to use your Claude plan",
  grok: "Install the Grok CLI to use your Grok plan",
};

/**
 * One plan row. `signingIn` is true while this provider's Terminal sign-in is open; `setUpTint`
 * is false when an earlier row already offers a tint action (DT-21: Set up is then ghost).
 */
export function planRowView(
  provider: PlanProvider,
  status: SubscriptionStatus | null,
  opts: { mac: string; signingIn: boolean; setUpTint: boolean },
): PlanRowView {
  const title = TITLE[provider];
  const base = { provider, title };
  if (opts.signingIn) {
    return {
      ...base,
      badge: { variant: "info", dot: true, label: "Checking…" },
      line: "Finish signing in in the Terminal window",
      tone: "line",
      action: { kind: "button", variant: "ghost", label: "Cancel", does: "cancel" },
    };
  }
  const found = `Found on ${opts.mac}`;
  switch (status?.state) {
    case "connected":
      return {
        ...base,
        badge: { variant: "success", dot: true, label: "Connected" },
        // OQ-10: the CLIs expose no plan name, so "your Grok plan", never "SuperGrok".
        line: `${found} · signed in with your ${PLAN[provider]} plan · covers ${MODELS[provider]} models`,
        tone: "sage",
        action: { kind: "switch", checked: true },
      };
    case "disconnected":
      return {
        ...base,
        badge: { variant: "neutral", dot: false, label: "Not used" },
        line: `Tvashtr won’t run agents on your ${PLAN[provider]} plan. Turn this on to use it again.`,
        tone: "line",
        action: { kind: "switch", checked: false },
      };
    case "needs_login":
      return {
        ...base,
        badge: { variant: "warning", dot: true, label: "Needs sign-in" },
        line: `${found} · not signed in · covers ${MODELS[provider]} models`,
        tone: "amber",
        action: {
          kind: "button",
          variant: "tint",
          label: `Sign in to ${PLAN[provider]}`,
          does: "connect",
        },
      };
    case "needs_install":
      return {
        ...base,
        badge: { variant: "neutral", dot: false, label: "Not installed" },
        line: INSTALL_LINE[provider],
        tone: "line",
        action: {
          kind: "button",
          variant: opts.setUpTint ? "tint" : "ghost",
          label: "Set up",
          does: "setUp",
        },
      };
    case "api_key":
      return {
        ...base,
        badge: { variant: "info", dot: false, label: "On an API key" },
        line: `${found} · signed in with an API key, not your ${PLAN[provider]} plan`,
        tone: "line",
        action: {
          kind: "button",
          variant: "tint",
          label: "Sign in with your plan",
          does: "connect",
        },
      };
    case "error":
      return {
        ...base,
        badge: { variant: "danger", dot: true, label: "Error" },
        line: `Couldn’t check ${title}. Try again.`,
        tone: "line",
        action: { kind: "button", variant: "ghost", label: "Check again", does: "refresh" },
      };
    default:
      // The bridge hasn't answered yet, or is re-checking on its own.
      return {
        ...base,
        badge: { variant: "info", dot: true, label: "Checking…" },
        line: `Looking for ${title} on ${opts.mac}…`,
        tone: "line",
        action: null,
      };
  }
}

/** The Claude and Grok rows in order; a Set up after a tint action turns ghost (DT-21). */
export function planRowViews(
  statuses: Partial<Record<PlanProvider, SubscriptionStatus | null>>,
  opts: { mac: string; signingIn: PlanProvider | null },
): PlanRowView[] {
  const rows: PlanRowView[] = [];
  let tintBefore = false;
  for (const provider of ["claude", "grok"] as const) {
    const view = planRowView(provider, statuses[provider] ?? null, {
      mac: opts.mac,
      signingIn: opts.signingIn === provider,
      setUpTint: !tintBefore,
    });
    if (view.action?.kind === "button" && view.action.variant === "tint") tintBefore = true;
    rows.push(view);
  }
  return rows;
}

/** DT-22: Codex is status only; "installed" when the CLI answered at all. */
export function codexRow(
  status: SubscriptionStatus | null,
  mac: string,
): { line: string; installUrl: string | null } {
  const found =
    status?.state === "connected" || status?.state === "needs_login" || status?.state === "api_key";
  return found
    ? {
        line: `Found on ${mac}. Tvashtr can show its status, but can’t run agents on it yet.`,
        installUrl: null,
      }
    : {
        line: "Not found. Tvashtr can show its status, but can’t run agents on it yet.",
        installUrl: CODEX_INSTALL_URL,
      };
}

/** A plan is in use: connected with "Use my plan" on (DT-27). */
export function planInUse(statuses: Partial<Record<PlanProvider, SubscriptionStatus | null>>) {
  return (["claude", "grok"] as const).some((p) => statuses[p]?.state === "connected");
}

/**
 * DT-27 / OQ-16: Continue is on when there is at least one way to run — a plan in use with the
 * consent ticked, or no plan in use and at least one saved API key.
 */
export function canContinue(opts: { planInUse: boolean; consent: boolean; savedKeys: number }) {
  return opts.planInUse ? opts.consent : opts.savedKeys > 0;
}
