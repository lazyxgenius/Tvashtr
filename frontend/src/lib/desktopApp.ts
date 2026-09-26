/**
 * Tvashtr Desktop app plumbing (desktop-app.md §5): typed, optional-chained wrappers around the
 * bridge's v6 `auth` and `app.getInfo` (docs/superpowers/plans/api/desktop-bridge.md), the window
 * title store (DB-9) and the Desktop-only external links. Every call tolerates an older Desktop or
 * the website (no bridge): it resolves to a neutral answer instead of throwing.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import type { SubscriptionStatus } from "./engines";

type AuthBridge = NonNullable<TvashtrDesktopBridge["auth"]>;
export type SignInEvent = TvashtrSignInEvent;
export type AppInfo = TvashtrAppInfo;
export type LaunchContext = Awaited<ReturnType<AuthBridge["getLaunchContext"]>>;

export const HELP_URL = "https://github.com/lazyxgenius/Tvashtr/blob/main/docs/desktop-v1.md";
/** Interim, factual "what Tvashtr stores" page (OQ-9: the privacy statement is the operator's). */
export const PRIVACY_URL =
  "https://github.com/lazyxgenius/Tvashtr/blob/main/docs/what-tvashtr-stores.md";

function bridge(): TvashtrDesktopBridge | null {
  const b = typeof window === "undefined" ? undefined : window.tvashtrDesktop;
  return b && typeof b === "object" ? b : null;
}

function authBridge(): AuthBridge | null {
  return bridge()?.auth ?? null;
}

/** True when this Desktop can sign in through the browser (bridge v6). */
export function canSignInWithBrowser(): boolean {
  return typeof authBridge()?.startSignIn === "function";
}

export async function startSignIn(opts?: {
  account?: "current" | "github";
  openBrowser?: boolean;
}): Promise<{ signInUrl: string } | null> {
  const auth = authBridge();
  if (!auth?.startSignIn) return null;
  const out = await auth.startSignIn(opts);
  return out && typeof out.signInUrl === "string" ? { signInUrl: out.signInUrl } : null;
}

export async function reopenBrowser(): Promise<void> {
  await authBridge()?.reopenBrowser?.();
}

export async function cancelSignIn(): Promise<void> {
  await authBridge()?.cancelSignIn?.();
}

export function onSignIn(cb: (event: SignInEvent) => void): () => void {
  const unsubscribe = authBridge()?.onSignIn?.((event) => {
    if (event && typeof event === "object" && typeof event.state === "string") cb(event);
  });
  return typeof unsubscribe === "function" ? unsubscribe : () => {};
}

const NO_CONTEXT: LaunchContext = { openedFromWeb: null, lastUser: null };

/** Opened from the website (display hint) and the last user on this Mac; never throws. */
export async function getLaunchContext(): Promise<LaunchContext> {
  try {
    const ctx = await authBridge()?.getLaunchContext?.();
    if (!ctx || typeof ctx !== "object") return NO_CONTEXT;
    const web = ctx.openedFromWeb;
    const last = ctx.lastUser;
    return {
      openedFromWeb:
        web && typeof web.login === "string" && typeof web.host === "string"
          ? { login: web.login, host: web.host }
          : null,
      lastUser:
        last && typeof last.login === "string"
          ? {
              login: last.login,
              displayName: typeof last.displayName === "string" ? last.displayName : last.login,
            }
          : null,
    };
  } catch {
    return NO_CONTEXT;
  }
}

export async function rememberUser(user: { login: string; displayName: string }): Promise<void> {
  try {
    await authBridge()?.rememberUser?.(user);
  } catch {
    /* only a label for the Expired screen */
  }
}

export async function forgetUser(): Promise<void> {
  try {
    await authBridge()?.forgetUser?.();
  } catch {
    /* nothing to forget */
  }
}

/** The running app's info (bridge v6), or null on an older Desktop / the website. */
export async function getAppInfo(): Promise<AppInfo | null> {
  try {
    const info = await bridge()?.app?.getInfo?.();
    if (!info || typeof info.version !== "string") return null;
    return info;
  } catch {
    return null;
  }
}

/** The running app's version (bridge v6 `app.getInfo`), or null until/unless it answers. */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getAppInfo().then((info) => {
      if (alive && info) setVersion(info.version);
    });
    return () => {
      alive = false;
    };
  }, []);
  return version;
}

// ---- Plans and the updater ----------------------------------------------------------------------

const PLAN_PROVIDERS = new Set(["claude", "grok", "codex"]);
const PLAN_STATES = new Set([
  "disconnected",
  "checking",
  "needs_install",
  "needs_login",
  "api_key",
  "connected",
  "error",
]);

/** The plan CLIs' status on this Mac (bridge `engines.getStatus`), or null without a bridge. */
export async function getPlanStatuses(): Promise<SubscriptionStatus[] | null> {
  try {
    const list: unknown = await bridge()?.engines?.getStatus?.();
    if (!Array.isArray(list)) return null;
    return list.filter((s): s is SubscriptionStatus => validPlan(s) !== null);
  } catch {
    return null;
  }
}

function validPlan(s: unknown): SubscriptionStatus | null {
  return !!s &&
    typeof s === "object" &&
    PLAN_PROVIDERS.has((s as SubscriptionStatus).provider) &&
    PLAN_STATES.has((s as SubscriptionStatus).state)
    ? (s as SubscriptionStatus)
    : null;
}

type PlanId = SubscriptionStatus["provider"];

/**
 * DT-23 / DT-24: Sign in (opens the vendor's own login in Terminal and answers at once) or turn
 * "Use my plan" back on. Null on an older Desktop or an answer of the wrong shape.
 */
export async function connectPlan(provider: PlanId): Promise<SubscriptionStatus | null> {
  return validPlan(await bridge()?.engines?.connect?.(provider));
}

/** DT-24: "Use my plan" off — sticky across relaunch (the row reads "Not used"). */
export async function disconnectPlan(provider: PlanId): Promise<SubscriptionStatus | null> {
  return validPlan(await bridge()?.engines?.disconnect?.(provider));
}

/** Ask the CLI again (never rejects on the bridge side: a failed check is an `error` status). */
export async function refreshPlan(provider: PlanId): Promise<SubscriptionStatus | null> {
  return validPlan(await bridge()?.engines?.refresh?.(provider));
}

/** Stop waiting for a Terminal sign-in (bridge v5); it can't close Terminal. */
export async function cancelPlanConnect(provider: PlanId): Promise<SubscriptionStatus | null> {
  try {
    return validPlan(await bridge()?.engines?.cancelConnect?.(provider));
  } catch {
    return null;
  }
}

/** Every status the bridge pushes (e.g. after a Terminal sign-in, on window focus). */
export function onPlanStatus(cb: (status: SubscriptionStatus) => void): () => void {
  const unsubscribe = bridge()?.engines?.onStatus?.((raw) => {
    const s = validPlan(raw);
    if (s) cb(s);
  });
  return typeof unsubscribe === "function" ? unsubscribe : () => {};
}

export type UpdateState = TvashtrUpdateState;

function validUpdateState(s: unknown): UpdateState | null {
  if (!s || typeof s !== "object") return null;
  const state = (s as { state?: unknown }).state;
  if (state === "idle") return { state: "idle" };
  const version = (s as { version?: unknown }).version;
  if (typeof version !== "string") return null;
  if (
    state === "ready" ||
    state === "installing" ||
    state === "downloading" ||
    state === "manual"
  ) {
    return s as UpdateState;
  }
  return null;
}

/** The updater's state (bridge v6 `update`, DB-6); `idle` on an older Desktop or the website. */
export async function getUpdateState(): Promise<UpdateState> {
  try {
    return validUpdateState(await bridge()?.update?.getState?.()) ?? { state: "idle" };
  } catch {
    return { state: "idle" };
  }
}

export function onUpdateState(cb: (state: UpdateState) => void): () => void {
  const unsubscribe = bridge()?.update?.onState?.((raw) => {
    const s = validUpdateState(raw);
    if (s) cb(s);
  });
  return typeof unsubscribe === "function" ? unsubscribe : () => {};
}

/** "Signed in as <login>" (DT-16, the sign-in toast): the GitHub login, else the display name. */
export function loginOf(user: {
  email: string;
  github_login?: string | null;
  display_name?: string | null;
}): string {
  return user.github_login || user.display_name || user.email;
}

/** DT-50: "this Mac" on macOS, else "this computer". */
export function thisComputer(): string {
  const platform = typeof window === "undefined" ? undefined : window.tvashtrDesktopInfo?.platform;
  return platform === "darwin" ? "this Mac" : "this computer";
}

// ---- The window title (DB-9) --------------------------------------------------------------------

export const TITLE_LAUNCH = "Tvashtr";
export const TITLE_CANVAS = "Tvashtr — the living canvas";

let title = TITLE_LAUNCH;
const titleListeners = new Set<() => void>();

/** Launch, sign-in and setup screens say "Tvashtr"; the shell and canvas the longer title. */
export function setDesktopTitle(next: string): void {
  if (typeof document !== "undefined") document.title = next;
  if (next === title) return;
  title = next;
  titleListeners.forEach((l) => l());
}

export function useDesktopTitle(): string {
  return useSyncExternalStore(
    (l) => {
      titleListeners.add(l);
      return () => titleListeners.delete(l);
    },
    () => title,
    () => title,
  );
}

// ---- Folders on this Mac (setup's Project step, DT-30..DT-32) -----------------------------------

export type RepoInspection = TvashtrRepoInspection;
export interface PickedFolder {
  path: string;
  displayPath: string;
}

function reposBridge(): NonNullable<TvashtrDesktopBridge["repos"]> | null {
  return bridge()?.repos ?? null;
}

/** The native folder picker; null when cancelled or without the bridge. */
export async function pickFolder(): Promise<PickedFolder | null> {
  const picked = await reposBridge()?.pickFolder?.();
  if (!picked || typeof picked.path !== "string" || !picked.path) return null;
  return {
    path: picked.path,
    displayPath: typeof picked.displayPath === "string" ? picked.displayPath : picked.path,
  };
}

/**
 * What a folder is (branch, remote), or `{is_git:false, error, reason?}`. Rejects with ready-to-show
 * copy (e.g. git missing); a bad answer reads as "not a git repository".
 */
export async function inspectFolder(path: string): Promise<RepoInspection> {
  const repos = reposBridge();
  if (!repos?.inspect) throw new Error("This version of Tvashtr Desktop can't read folders.");
  const out = await repos.inspect(path);
  if (out && typeof out === "object" && out.is_git === true) {
    return {
      ...out,
      current_branch: typeof out.current_branch === "string" ? out.current_branch : null,
      remote_url: typeof out.remote_url === "string" ? out.remote_url : null,
    };
  }
  const bad = (out ?? {}) as { error?: unknown; reason?: unknown };
  const reason =
    bad.reason === "not_git" || bad.reason === "inside_repo" || bad.reason === "missing"
      ? bad.reason
      : undefined;
  return {
    is_git: false,
    error:
      typeof bad.error === "string" && bad.error
        ? bad.error
        : "This folder isn't a git repository.",
    ...(reason ? { reason } : {}),
  };
}

/** True when this Desktop can run "Set up git here" (bridge v6, DB-5). */
export function canInitGit(): boolean {
  return typeof reposBridge()?.initGit === "function";
}

/** "Set up git here" (DB-5). Rejects with the bridge's ready-to-show refusal copy. */
export async function initGit(path: string): Promise<{ branch: string }> {
  const repos = reposBridge();
  if (!repos?.initGit) throw new Error("This version of Tvashtr Desktop can't set up git.");
  const out = await repos.initGit({ path });
  return { branch: out && typeof out.branch === "string" ? out.branch : "main" };
}

/** Put a folder first in the composer's Recent folders (best effort; never throws). */
export async function addRecentFolder(path: string): Promise<void> {
  try {
    await reposBridge()?.recent?.add?.(path);
  } catch {
    // Only the composer's ordering depends on it.
  }
}
