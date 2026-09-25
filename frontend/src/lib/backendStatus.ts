/**
 * Is the backend reachable? One shared store for the header's "Connected" / "Can't reach backend"
 * label and the stale-data banner (HmF-Backend).
 *
 * The old BackendDot pinged /health every 5s, and each ping touched Postgres — enough to keep a
 * serverless database awake around the clock. Now: one check at start, then every 30s but only
 * while the tab is visible, plus an immediate check when the tab becomes visible. Data fetches
 * report their own outcome through `reportFetchOk` / `reportFetchFailed`, so a failed request
 * shows the banner at once instead of waiting for the next health tick.
 */
import { useSyncExternalStore } from "react";

export type BackendState = "checking" | "connected" | "offline";

export interface BackendStatus {
  state: BackendState;
  /** When the backend last answered (ms since epoch), or null if it never has. */
  lastOkAt: number | null;
}

const POLL_MS = 30_000;

let status: BackendStatus = { state: "checking", lastOkAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function set(next: BackendStatus): void {
  if (next.state === status.state && next.lastOkAt === status.lastOkAt) return;
  status = next;
  listeners.forEach((l) => l());
}

export function reportFetchOk(): void {
  set({ state: "connected", lastOkAt: Date.now() });
}

export function reportFetchFailed(): void {
  set({ state: "offline", lastOkAt: status.lastOkAt });
}

/** Ask /health now. Resolves once the answer is recorded. */
export async function checkBackend(): Promise<BackendState> {
  try {
    const res = await fetch("/health");
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { status?: string; db?: string };
    if (body.db === "down") throw new Error("db down");
    reportFetchOk();
  } catch {
    reportFetchFailed();
  }
  return status.state;
}

function onVisibility(): void {
  if (document.visibilityState === "visible") void checkBackend();
}

function start(): void {
  if (timer !== null) return;
  void checkBackend();
  timer = setInterval(() => {
    if (document.visibilityState === "visible") void checkBackend();
  }, POLL_MS);
  document.addEventListener("visibilitychange", onVisibility);
}

function stop(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisibility);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** Subscribe to the backend status (starts polling while anything is subscribed). */
export function useBackendStatus(): BackendStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  );
}

/** Test seam: reset the module state between tests. */
export function __resetBackendStatusForTests(): void {
  stop();
  listeners.clear();
  status = { state: "checking", lastOkAt: null };
}
