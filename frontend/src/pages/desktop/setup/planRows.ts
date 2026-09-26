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

// ---- The "Use your <plan> plan" sheet (DT-25, OQ-18) ----

export interface UsePlanCopy {
  title: string;
  subtitle: string;
  install: { title: string; body: string };
  signIn: { body: string; command: string };
  check: string;
  lock: string;
}

/** The sheet's copy for Claude Code (DtF-Claude-2) and its Grok variant (OQ-18). */
export function usePlanCopy(provider: PlanProvider, mac: string): UsePlanCopy {
  const onMac = mac === "this Mac";
  const tool = provider === "claude" ? "Claude Code" : "Grok";
  const vendor = provider === "claude" ? "Anthropic’s" : "xAI’s";
  return {
    title: `Use your ${PLAN[provider]} plan`,
    subtitle: `Tvashtr runs ${tool} on ${mac} for you`,
    install: {
      title: provider === "claude" ? "Install Claude Code" : "Install the Grok CLI",
      body: `Follow ${vendor} install guide${onMac ? " for Mac" : ""}.`,
    },
    signIn: {
      body: `Open ${onMac ? "Terminal" : "a terminal"}, run the command below, and sign in with your ${PLAN[provider]} account.`,
      command: provider === "claude" ? "claude" : "grok login",
    },
    check: `Tvashtr looks for it again and uses your plan for ${MODELS[provider]} models.`,
    lock: `You sign in inside ${tool}, not in Tvashtr. Tvashtr never sees your login.`,
  };
}

/** The sheet's footer note: "Not found yet" until Check again finds something else (DT-25). */
export const NOT_FOUND_YET = "Not found yet";

/**
 * What Check again says when the plan still isn't in use; null when the sheet should close
 * (found and signed in with the plan, or found with "Use my plan" turned off).
 */
export function checkAgainNote(
  provider: PlanProvider,
  state: SubscriptionStatus["state"] | "failed",
): string | null {
  switch (state) {
    case "connected":
    case "disconnected":
      return null;
    case "needs_login":
      return "Found. Sign in once (step 2), then check again.";
    case "api_key":
      return `Found, but signed in with an API key. Sign in with your ${PLAN[provider]} plan, then check again.`;
    case "error":
    case "failed":
      return `Couldn’t check ${TITLE[provider]}. Try again.`;
    default:
      return NOT_FOUND_YET;
  }
}

/** The toast when Check again (or a re-probe) finds the plan signed in (DtF-Claude-3). */
export function planFoundToast(provider: PlanProvider): string {
  return `${TITLE[provider]} found · using your ${PLAN[provider]} plan`;
}

// ---- API keys (DT-26) ----

/** The API-key provider that covers each plan's models. */
export const PLAN_KEY_PROVIDER: Record<PlanProvider, string> = { claude: "anthropic", grok: "xai" };

/**
 * The Add-key sheet's pre-pick: the provider of the first plan that can't run here (Claude not in
 * use → anthropic; else Grok → xai; else nothing).
 */
export function prePickProvider(
  statuses: Partial<Record<PlanProvider, SubscriptionStatus | null>>,
): string | null {
  for (const p of ["claude", "grok"] as const) {
    if (statuses[p]?.state !== "connected") return PLAN_KEY_PROVIDER[p];
  }
  return null;
}

/**
 * The API-keys row once a key is saved (DtF-Key-3): "<p> key saved · •••• <last4>", or
 * "<p1>, <p2> keys saved" for several; null when none is saved.
 */
export function savedKeysLine(keys: { provider: string; key_last4: string }[]): string | null {
  if (keys.length === 0) return null;
  if (keys.length === 1) {
    const [k] = keys;
    return k.key_last4
      ? `${k.provider} key saved · •••• ${k.key_last4}`
      : `${k.provider} key saved`;
  }
  return `${keys.map((k) => k.provider).join(", ")} keys saved`;
}
