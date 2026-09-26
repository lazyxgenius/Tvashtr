/**
 * This Mac's first-run setup for the signed-in account (desktop-app.md DT-17, bridge v6 `setup`,
 * DB-4). Setup is per Mac and per account: the step to resume at, the plan consent time, the
 * project choice and whether it finished are saved on this Mac through the bridge, so quitting
 * mid-setup resumes at the same step.
 *
 * One small store the launch gate fills (DT-2 step 3) and the Workspace reads to decide whether
 * the signed-in app sits on `#/setup/<step>`. The website, and a Desktop older than v6, have no
 * setup: `status` is "none" there and nothing redirects.
 */
import { useEffect, useSyncExternalStore } from "react";

export type SetupStep = TvashtrSetupStep;
export type DesktopSetup = TvashtrDesktopSetup;
export type SetupPatch = Partial<Omit<DesktopSetup, "version">>;

export const SETUP_STEPS: readonly SetupStep[] = ["engines", "project", "team"] as const;

export type SetupState =
  /** No setup to do: the website, an older Desktop, or this account's store couldn't be read. */
  | { status: "none"; accountId?: string }
  | { status: "loading"; accountId: string }
  | { status: "ready"; accountId: string; setup: DesktopSetup };

type SetupBridge = NonNullable<TvashtrDesktopBridge["setup"]>;

function setupBridge(): SetupBridge | null {
  const b = typeof window === "undefined" ? undefined : window.tvashtrDesktop;
  const setup = b && typeof b === "object" ? b.setup : undefined;
  return setup && typeof setup.get === "function" && typeof setup.update === "function"
    ? setup
    : null;
}

const EMPTY: DesktopSetup = {
  version: 1,
  step: null,
  finishedAt: null,
  planConsentAt: null,
  workspace: null,
};

function validSetup(raw: unknown): DesktopSetup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<DesktopSetup>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const w = r.workspace;
  const workspace: DesktopSetup["workspace"] =
    w && typeof w === "object"
      ? w.kind === "ask"
        ? { kind: "ask" }
        : w.kind === "github" && typeof w.repo === "string"
          ? { kind: "github", repo: w.repo }
          : w.kind === "folder" && typeof w.path === "string" && typeof w.displayPath === "string"
            ? { kind: "folder", path: w.path, displayPath: w.displayPath }
            : null
      : null;
  return {
    version: 1,
    step: SETUP_STEPS.includes(r.step as SetupStep) ? (r.step as SetupStep) : null,
    finishedAt: str(r.finishedAt),
    planConsentAt: str(r.planConsentAt),
    workspace,
  };
}

let state: SetupState = { status: "none" };
const listeners = new Set<() => void>();
// Where the user was headed when setup took over (a deep link, OQ-34); opened when it finishes.
let afterSetup: string | null = null;
// Setup finished in this session (DT-38: the ready card says "You’re set up…", else "Welcome back").
let finishedThisSession = false;

function set(next: SetupState): void {
  state = next;
  listeners.forEach((l) => l());
}

/**
 * Read this Mac's setup for `accountId` (once per sign-in). Resolves the loaded setup, or null when
 * there is none to do: the website, an older Desktop, or a bridge that failed (never blocks the
 * app on a broken store).
 */
export async function loadDesktopSetup(accountId: string): Promise<DesktopSetup | null> {
  const bridge = setupBridge();
  if (!bridge) {
    set({ status: "none" });
    return null;
  }
  if (state.status === "ready" && state.accountId === accountId) return state.setup;
  set({ status: "loading", accountId });
  let setup: DesktopSetup | null;
  try {
    setup = validSetup(await bridge.get(accountId)) ?? EMPTY;
  } catch {
    setup = null;
  }
  // Signed out (or another account signed in) while the bridge answered.
  if (state.status !== "loading" || state.accountId !== accountId) return null;
  set(setup ? { status: "ready", accountId, setup } : { status: "none", accountId });
  return setup;
}

/** Save part of the signed-in account's setup. Rejects with a readable Error when it can't. */
export async function saveDesktopSetup(patch: SetupPatch): Promise<DesktopSetup> {
  const bridge = setupBridge();
  if (!bridge || state.status !== "ready") {
    throw new Error("Couldn't save this Mac's setup. Try again.");
  }
  const { accountId } = state;
  const saved = validSetup(await bridge.update(accountId, patch));
  if (!saved) throw new Error("Couldn't save this Mac's setup. Try again.");
  if (patch.finishedAt) finishedThisSession = true;
  if (state.status === "ready" && state.accountId === accountId) {
    set({ status: "ready", accountId, setup: saved });
  }
  return saved;
}

/** Signed out: forget the loaded setup (the next account loads its own). */
export function resetDesktopSetup(): void {
  afterSetup = null;
  finishedThisSession = false;
  if (state.status !== "none" || state.accountId) set({ status: "none" });
}

/** Did the signed-in account finish setup on this Mac in this session (DT-38)? */
export function setupFinishedThisSession(): boolean {
  return finishedThisSession;
}

/** True while the signed-in account hasn't finished setup on this Mac. */
export function setupUnfinished(s: SetupState): boolean {
  return s.status === "ready" && s.setup.finishedAt === null;
}

/** The step to resume at (DT-17). */
export function resumeStep(setup: DesktopSetup): SetupStep {
  return setup.step ?? "engines";
}

export function rememberAfterSetup(hash: string | null): void {
  afterSetup = hash;
}

/** The address setup took the user away from, once (then forgotten). */
export function takeAfterSetup(): string | null {
  const out = afterSetup;
  afterSetup = null;
  return out;
}

export function getDesktopSetupState(): SetupState {
  return state;
}

export function useDesktopSetupState(): SetupState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/**
 * The setup for `accountId`, loading it when nothing is loaded for that account yet (a browser
 * sign-in lands here without the launch check). "none" means there is no setup to do.
 */
export function useDesktopSetup(accountId: string): SetupState {
  const s = useDesktopSetupState();
  const loaded = s.accountId === accountId;
  const hasBridge = setupBridge() !== null;
  useEffect(() => {
    if (!loaded && hasBridge) void loadDesktopSetup(accountId);
  }, [accountId, hasBridge, loaded]);
  if (!hasBridge) return { status: "none" };
  return loaded ? s : { status: "loading", accountId };
}
