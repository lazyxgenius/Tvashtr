/**
 * Engines › Subscriptions, as pure data: what each card (Claude, Grok, Codex — ENG-26) shows for
 * its status, the page's own flow state (waiting for a sign-in, a refresh in flight, a refresh that
 * still found nothing) and the surface (ENG-27..41 on Desktop, ENG-49/50 on the website), plus the
 * runner banner (ENG-25) and the toasts (ENG-33/35/41/44).
 *
 * The status is the live bridge status on Desktop and the server mirror on the website (ENG-81).
 * Codex is status-only: it never runs agents, has no Connect, and reads "Ready" once its CLI is
 * installed, whatever its sign-in state (OQ-8).
 */
import type { RunnerStatus } from "../../lib/api/engines";
import {
  type SubscriptionCardState,
  type SubscriptionProviderId,
  type SubscriptionStatus,
  SUBSCRIPTION_INSTALL_URLS,
  displayNameForSubscription,
  modelProvidersForSubscription,
} from "../../lib/engines";
import { formatRelativeTime } from "../../lib/time";
import { type EngineInputs, nodeProvider, roleLabel, usedByCell } from "./engineModel";
import { joinAnd } from "./keysModel";

// ---- the page's flow state per card ----

export interface CardUi {
  /** Connect opened the vendor sign-in in Terminal; waiting for the CLI to report it (ENG-31). */
  waiting: boolean;
  /** The state Connect started from (the Claude api_key wording, ENG-31/35). */
  waitingFrom: SubscriptionCardState | null;
  /** A Refresh is in flight (ENG-33). */
  refreshing: boolean;
  /** An explicit Refresh answered on this page → "… Checked <when>." (ENG-29). A status checked
   *  within the last minute says "Checked just now." without one (EnF-ClaudeRefresh-1). */
  refreshed: boolean;
  /** An explicit Refresh still found no CLI (ENG-40, front-end state). */
  stillNotFound: boolean;
}

export const IDLE_UI: CardUi = {
  waiting: false,
  waitingFrom: null,
  refreshing: false,
  refreshed: false,
  stillNotFound: false,
};

// ---- the card ----

export type CardBadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

export interface CardBadge {
  variant: CardBadgeVariant;
  dot: boolean;
  text: string;
}

export type CardMessage =
  | { kind: "text"; text: string; link?: { label: string; href: string } }
  /** The coral Terminal callout while a sign-in is pending (Eng-Flow-Grok-2). */
  | { kind: "terminal"; text: string }
  /** The amber PATH callout after a Refresh that still found nothing (Eng-Flow-Codex-2). */
  | { kind: "warn"; text: string };

export type CardActionKind = "connect" | "cancel" | "refresh" | "disconnect" | "open-desktop";

export interface CardAction {
  kind: CardActionKind;
  label: string;
  variant: "primary" | "secondary" | "ghost";
  loading?: boolean;
  disabled?: boolean;
}

export interface CardView {
  sub: SubscriptionProviderId;
  name: string;
  letter: string;
  /** The line under the name ("Claude Pro · via Claude Code", "Not signed in"…), or none. */
  account: string | null;
  badges: CardBadge[];
  /** "anthropic/*" + " models · Desktop runs". */
  coversCode: string;
  coversRest: string;
  usedBy: string;
  message: CardMessage;
  actions: CardAction[];
  /** Connected (or Codex Ready): the card's sage border. */
  ok: boolean;
}

const LETTERS: Record<SubscriptionProviderId, string> = { claude: "C", grok: "G", codex: "O" };

/** The CLI Tvashtr runs, as the account line names it ("via Claude Code"). */
const TOOLS: Record<SubscriptionProviderId, string> = {
  claude: "Claude Code",
  grok: "Grok CLI",
  codex: "Codex CLI",
};

/** The CLI in a sentence ("Looking for the Grok CLI on this computer."). */
const TOOL_IN_SENTENCE: Record<SubscriptionProviderId, string> = {
  claude: "Claude Code",
  grok: "the Grok CLI",
  codex: "the Codex CLI",
};

const INSTALL_LABELS: Record<SubscriptionProviderId, string> = {
  claude: "Install Claude Code",
  grok: "Install Grok CLI",
  codex: "Install Codex CLI",
};

/** The API-key provider a subscription stands in for (the first of its model prefixes). */
function keyProviderOf(sub: SubscriptionProviderId): string {
  return modelProvidersForSubscription(sub)[0] ?? sub;
}

/** Codex is installed (any answer but "not found" / a failed or pending check) → Ready (OQ-8). */
export function codexReady(s: SubscriptionStatus): boolean {
  return s.state === "connected" || s.state === "needs_login" || s.state === "api_key";
}

/** The roles (per team) whose primary model a subscription covers. */
function users(
  i: EngineInputs,
  sub: SubscriptionProviderId,
): { segments: string[]; roles: string[] } {
  const covered = new Set(modelProvidersForSubscription(sub));
  const segments: string[] = [];
  const roles: string[] = [];
  for (const team of i.usage.teams) {
    const teamRoles: string[] = [];
    for (const n of team.nodes) {
      const p = nodeProvider(n);
      if (!p || !covered.has(p)) continue;
      const label = roleLabel(n.role_name, n.title);
      if (!teamRoles.includes(label)) teamRoles.push(label);
      if (!roles.includes(label)) roles.push(label);
    }
    if (teamRoles.length) segments.push(`${teamRoles.join(", ")} · ${team.name}`);
  }
  return { segments, roles };
}

/** "Used by Engineer · Indicator sprint team", or "—" when no agent uses a covered model (ENG-28). */
export function subUsedBy(i: EngineInputs, sub: SubscriptionProviderId): string {
  const { segments } = users(i, sub);
  return segments.length ? usedByCell(segments) : "—";
}

/** ENG-36 after a disconnect: "Engineer now runs on your anthropic API key, if you have one.
 *  Connect to use your Claude plan again." — generic when no agent uses it. */
export function disconnectedMessage(i: EngineInputs, sub: SubscriptionProviderId): string {
  const name = displayNameForSubscription(sub);
  const { roles } = users(i, sub);
  if (roles.length === 0) {
    return `Not connected. Connect opens a Terminal window where you sign in to ${name}.`;
  }
  const verb = roles.length === 1 ? "runs" : "run";
  return (
    `${joinAnd(roles)} now ${verb} on your ${keyProviderOf(sub)} API key, if you have one. ` +
    `Connect to use your ${name} plan again.`
  );
}

function checkedAgo(s: SubscriptionStatus): string {
  return s.checked_at ? formatRelativeTime(s.checked_at) || "just now" : "just now";
}

/** Desktop checked this CLI within the last minute (a launch probe, a sign-in or a Refresh). A
 *  future stamp doesn't count. The page re-renders on its runner poll, so the claim ages out. */
export function checkedJustNow(s: SubscriptionStatus, now = Date.now()): boolean {
  if (!s.checked_at) return false;
  const age = now - new Date(s.checked_at).getTime();
  return age >= 0 && age < 60_000;
}

function connectedAccount(s: SubscriptionStatus): string {
  // The Grok CLI reports no plan name (OQ-10); Claude keeps its real plan hint.
  const plan =
    s.provider === "claude" && s.account_hint?.trim()
      ? s.account_hint.trim()
      : `${displayNameForSubscription(s.provider)} subscription`;
  return `${plan} · via ${TOOLS[s.provider]}`;
}

function installMessage(sub: SubscriptionProviderId): CardMessage {
  const text =
    sub === "codex"
      ? "Install the Codex CLI, make sure it’s on your PATH (npm global bin or Homebrew), then quit and reopen Tvashtr."
      : `Install ${TOOL_IN_SENTENCE[sub]}, make sure it’s on your PATH, then quit and reopen Tvashtr.`;
  return {
    kind: "text",
    text,
    link: { label: INSTALL_LABELS[sub], href: SUBSCRIPTION_INSTALL_URLS[sub] },
  };
}

const STILL_NOT_FOUND =
  "Apps opened from the Dock don’t see your Terminal’s PATH. Quit Tvashtr fully, reopen it, then Refresh.";

const refresh = (label = "Refresh"): CardAction => ({
  kind: "refresh",
  label,
  variant: "secondary",
});
const connect: CardAction = { kind: "connect", label: "Connect", variant: "primary" };
const disconnect: CardAction = { kind: "disconnect", label: "Disconnect", variant: "ghost" };

const badge = (variant: CardBadgeVariant, text: string, dot = true): CardBadge => ({
  variant,
  dot,
  text,
});
const CHECKING = badge("neutral", "Checking…");

type Body = Pick<CardView, "account" | "badges" | "message" | "actions" | "ok">;

/** Desktop (live status): every Eng-CardStates state plus the flow states. */
function desktopBody(i: EngineInputs, s: SubscriptionStatus, ui: CardUi): Body {
  const sub = s.provider;
  const name = displayNameForSubscription(sub);
  const tool = TOOL_IN_SENTENCE[sub];

  if (ui.waiting && sub !== "codex") {
    const text =
      sub === "claude" && ui.waitingFrom === "api_key"
        ? "Finish signing in to Claude in the Terminal window that just opened. Choose your Claude plan, not an API key."
        : `Finish signing in to ${name} in the Terminal window that just opened, then come back. Tvashtr checks again automatically.`;
    return {
      account: "Waiting for sign-in",
      badges: [CHECKING],
      message: { kind: "terminal", text },
      actions: [
        { kind: "connect", label: "Checking", variant: "primary", loading: true },
        { kind: "cancel", label: "Cancel", variant: "ghost" },
      ],
      ok: false,
    };
  }

  const body = desktopState(i, s, ui);
  if (!ui.refreshing) return body;
  // A Refresh in flight (ENG-33): the refresh button spins, everything else waits for it.
  const checkText =
    sub === "codex"
      ? "Checking that the Codex CLI is installed."
      : `Checking that ${tool} is installed and signed in.`;
  return {
    ...body,
    badges: sub === "codex" ? [STATUS_ONLY, CHECKING] : [CHECKING],
    message: { kind: "text", text: checkText },
    actions: body.actions.map((a) =>
      a.kind === "refresh" ? { ...a, label: "Checking", loading: true } : { ...a, disabled: true },
    ),
  };
}

const STATUS_ONLY = badge("info", "Status only", false);

function desktopState(i: EngineInputs, s: SubscriptionStatus, ui: CardUi): Body {
  const sub = s.provider;
  const name = displayNameForSubscription(sub);
  const tool = TOOL_IN_SENTENCE[sub];
  const lead = sub === "codex" ? [STATUS_ONLY] : [];

  if (s.state === "checking") {
    // The launch probe (Eng-CardStates "Checking…").
    return {
      account: null,
      badges: [...lead, CHECKING],
      message: { kind: "text", text: `Looking for ${tool} on this computer.` },
      actions: [{ ...refresh("Checking"), loading: true }],
      ok: false,
    };
  }
  if (s.state === "error") {
    return {
      account: null,
      badges: [...lead, badge("danger", "Error")],
      message: {
        kind: "text",
        text: `Couldn’t check ${name}. Try Refresh. If it keeps failing, reopen Tvashtr Desktop.`,
      },
      actions: [refresh()],
      ok: false,
    };
  }
  if (s.state === "needs_install") {
    if (ui.stillNotFound) {
      return {
        account: `Checked ${checkedAgo(s)}`,
        badges: [...lead, badge("warning", "Still not found", false)],
        message: { kind: "warn", text: STILL_NOT_FOUND },
        actions: [refresh("Refresh again")],
        ok: false,
      };
    }
    return {
      account: "Not found on this computer",
      badges: [...lead, badge("neutral", "Needs install", false)],
      message: installMessage(sub),
      actions: [refresh("I’ve installed it — Refresh")],
      ok: false,
    };
  }

  if (sub === "codex") {
    if (codexReady(s)) {
      return {
        account: "Codex CLI found",
        badges: [STATUS_ONLY, badge("success", "Ready")],
        message: { kind: "text", text: "Codex can’t run agents yet. You’ll be ready when it can." },
        actions: [refresh()],
        ok: true,
      };
    }
    // No answer from this computer yet ("disconnected": nothing cached).
    return {
      account: null,
      badges: [STATUS_ONLY, badge("neutral", "Not checked yet", false)],
      message: { kind: "text", text: "Refresh to look for the Codex CLI on this computer." },
      actions: [refresh()],
      ok: false,
    };
  }

  if (s.state === "connected") {
    const checked = ui.refreshed || checkedJustNow(s) ? ` Checked ${checkedAgo(s)}.` : "";
    return {
      account: connectedAccount(s),
      badges: [badge("success", "Connected")],
      message: { kind: "text", text: `Runs while Tvashtr Desktop is open.${checked}` },
      actions: [refresh(), disconnect],
      ok: true,
    };
  }
  if (s.state === "api_key") {
    return {
      account: `${TOOLS[sub]} signed in with an API key`,
      badges: [badge("info", "On an API key", false)],
      message: {
        kind: "text",
        text: `${TOOLS[sub]} is using an API key, not your ${name} plan. Connect to sign in with your plan instead.`,
      },
      actions: [connect],
      ok: false,
    };
  }
  if (s.state === "needs_login") {
    return {
      account: "Not signed in",
      badges: [badge("warning", "Needs login")],
      message: {
        kind: "text",
        text: `Connect opens a Terminal window. Sign in to ${name} there, then come back.`,
      },
      actions: [connect],
      ok: false,
    };
  }
  // disconnected: on Desktop only the user's own Disconnect leaves it here (it sticks, B1).
  return {
    account: "Not connected",
    badges: [badge("neutral", "Disconnected", false)],
    message: { kind: "text", text: disconnectedMessage(i, sub) },
    actions: [connect],
    ok: false,
  };
}

/** The website (server mirror): the same states, every Desktop-only action disabled (ENG-49). */
function websiteBody(s: SubscriptionStatus): Body {
  const sub = s.provider;
  const name = displayNameForSubscription(sub);
  const off = (a: CardAction): CardAction => ({ ...a, disabled: true });
  const connectInDesktop = off({
    kind: "connect",
    label: "Connect in Desktop",
    variant: "primary",
  });
  const never = s.checked_at === null;

  if (sub === "codex") {
    const status =
      never || s.state === "disconnected"
        ? badge("neutral", "Not checked yet", false)
        : s.state === "error"
          ? badge("danger", "Error")
          : s.state === "needs_install"
            ? badge("neutral", "Needs install", false)
            : codexReady(s)
              ? badge("success", "Ready")
              : CHECKING;
    const ready = !never && codexReady(s);
    return {
      account: ready
        ? "Codex CLI found"
        : !never && s.state === "needs_install"
          ? "Not found on this computer"
          : null,
      badges: [STATUS_ONLY, status],
      message: {
        kind: "text",
        text: ready
          ? "Codex can’t run agents yet. You’ll be ready when it can."
          : "Status appears when Tvashtr Desktop is open.",
      },
      actions: [
        off(
          refresh(
            !never && s.state === "needs_install" ? "I’ve installed it — Refresh" : "Refresh",
          ),
        ),
      ],
      ok: ready,
    };
  }

  if (never) {
    // Tvashtr Desktop never reported this subscription (OQ-11).
    return {
      account: null,
      badges: [badge("neutral", "Not checked yet", false)],
      message: { kind: "text", text: "Open Tvashtr Desktop to connect." },
      actions: [connectInDesktop],
      ok: false,
    };
  }
  if (s.state === "connected") {
    if (s.runner_fresh === false) {
      return {
        account: connectedAccount(s),
        badges: [badge("warning", "Desktop not checking in")],
        message: {
          kind: "text",
          text: "Connected, but Tvashtr Desktop hasn’t checked in lately. Open it to run agents on your subscription.",
        },
        actions: [{ kind: "open-desktop", label: "Open Tvashtr Desktop", variant: "secondary" }],
        ok: false,
      };
    }
    return {
      account: connectedAccount(s),
      badges: [badge("success", "Connected")],
      message: {
        kind: "text",
        text: "Connected on your computer. It only runs agents from Tvashtr Desktop.",
      },
      actions: [off(refresh()), off(disconnect)],
      ok: true,
    };
  }
  const account: Record<Exclude<SubscriptionCardState, "connected">, string | null> = {
    needs_login: "Not signed in",
    needs_install: "Not found on this computer",
    api_key: `${TOOLS[sub]} signed in with an API key`,
    disconnected: "Not connected",
    error: null,
    checking: null,
  };
  const status: Record<Exclude<SubscriptionCardState, "connected">, CardBadge> = {
    needs_login: badge("warning", "Needs login"),
    needs_install: badge("neutral", "Needs install", false),
    api_key: badge("info", "On an API key", false),
    disconnected: badge("neutral", "Disconnected", false),
    error: badge("danger", "Error"),
    checking: CHECKING,
  };
  return {
    account: account[s.state],
    badges: [status[s.state]],
    message: { kind: "text", text: `Open Tvashtr Desktop to connect ${name}.` },
    actions: [connectInDesktop],
    ok: false,
  };
}

export function subscriptionCard(
  i: EngineInputs,
  s: SubscriptionStatus,
  ui: CardUi = IDLE_UI,
): CardView {
  const sub = s.provider;
  const code = `${keyProviderOf(sub)}/*`;
  const body = i.surface === "desktop" ? desktopBody(i, s, ui) : websiteBody(s);
  return {
    sub,
    name: displayNameForSubscription(sub),
    letter: LETTERS[sub],
    coversCode: code,
    // Codex never runs a node, so it covers no Desktop runs (ENG-28).
    coversRest: sub === "codex" ? " models" : " models · Desktop runs",
    usedBy: subUsedBy(i, sub),
    ...body,
  };
}

// ---- the runner banner (ENG-25) ----

export interface RunnerBanner {
  tone: "ok" | "warn";
  text: string;
  /** "Checked just now" / "Last checked in 3h ago", or null. */
  checked: string | null;
}

export function runnerBanner(runner: RunnerStatus): RunnerBanner {
  const ago = runner.last_seen_at ? formatRelativeTime(runner.last_seen_at) : "";
  if (runner.fresh) {
    return {
      tone: "ok",
      text: "Tvashtr Desktop is open and checking in. Subscription runs stop when you quit it.",
      checked: `Checked ${ago || "just now"}`,
    };
  }
  return {
    tone: "warn",
    text: "Tvashtr Desktop can’t reach Tvashtr right now. Subscription runs won’t start.",
    checked: ago ? `Last checked in ${ago}` : null,
  };
}

export const WEB_BANNER =
  "Subscriptions run on your own computer. Open Tvashtr Desktop to connect them. Website runs always use API keys.";

// ---- toasts ----

/** A sign-in finished (ENG-35/44): "Grok connected. xai models now run on this computer." */
export function connectedToast(s: SubscriptionStatus, from: SubscriptionCardState | null): string {
  const name = displayNameForSubscription(s.provider);
  if (s.provider === "claude" && from === "api_key" && s.account_hint?.trim()) {
    return `Claude connected with ${s.account_hint.trim()}.`;
  }
  return `${name} connected. ${keyProviderOf(s.provider)} models now run on this computer.`;
}

/** What an explicit Refresh found, as a toast — or null when the card says it alone. */
export function refreshToast(prev: SubscriptionStatus, next: SubscriptionStatus): string | null {
  if (next.provider === "codex") {
    if (!codexReady(next)) return null;
    return codexReady(prev)
      ? "Codex CLI found. Checked just now."
      : "Codex CLI found. It can’t run agents yet.";
  }
  if (next.state === "connected") {
    return `${displayNameForSubscription(next.provider)} is connected. Checked just now.`;
  }
  return null;
}

/** Connect could not open the Terminal sign-in (the bridge rejected). */
export const CONNECT_FAILED = "Couldn’t open a Terminal window to sign in. Try again.";

// ---- Disconnect (ENG-42/43) ----

export interface DisconnectCopy {
  title: string;
  body: string;
  toast: string;
  /** "Add anthropic key" on the toast — only when no key would take over (ENG-43). */
  addKeyProvider: string | null;
}

/** "Disconnect Claude?" and who it affects: "Engineer in Indicator sprint team uses anthropic
 *  models. Without Claude, it runs on your anthropic API key. You don’t have one yet, so it can’t
 *  run until you add a key or connect again. You stay signed in to Claude Code itself." */
export function disconnectCopy(i: EngineInputs, sub: SubscriptionProviderId): DisconnectCopy {
  const name = displayNameForSubscription(sub);
  const provider = keyProviderOf(sub);
  const stay = `You stay signed in to ${TOOL_IN_SENTENCE[sub]} itself.`;
  const covered = new Set(modelProvidersForSubscription(sub));
  const groups: string[] = [];
  let roleCount = 0;
  for (const team of i.usage.teams) {
    const roles: string[] = [];
    for (const n of team.nodes) {
      const p = nodeProvider(n);
      if (!p || !covered.has(p)) continue;
      const label = roleLabel(n.role_name, n.title);
      if (!roles.includes(label)) roles.push(label);
    }
    if (roles.length) groups.push(`${joinAnd(roles)} in ${team.name}`);
    roleCount += roles.length;
  }
  const key = i.keys.find((k) => k.provider === provider);
  let body: string;
  if (groups.length === 0) {
    body = `No team uses ${provider} models. ${stay}`;
  } else {
    const one = roleCount === 1;
    const who = `${joinAnd(groups)} ${one ? "uses" : "use"} ${provider} models.`;
    const it = one ? "it" : "they";
    body = key
      ? `${who} Without ${name}, ${it} ${one ? "runs" : "run"} on your ${provider} API key •••• ${key.key_last4}. ${stay}`
      : `${who} Without ${name}, ${it} ${one ? "runs" : "run"} on your ${provider} API key. You don’t have one yet, so ${it} can’t run until you add a key or connect again. ${stay}`;
  }
  return {
    title: `Disconnect ${name}?`,
    body,
    toast: `${name} disconnected.`,
    addKeyProvider: key ? null : provider,
  };
}

export function disconnectFailed(sub: SubscriptionProviderId): string {
  return `Couldn’t disconnect ${displayNameForSubscription(sub)}. Try again.`;
}

export function refreshFailed(sub: SubscriptionProviderId): string {
  return `Couldn’t check ${displayNameForSubscription(sub)}. Try again.`;
}
