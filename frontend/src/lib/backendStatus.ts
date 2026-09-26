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

// ---- The launch probe (Tvashtr Desktop, desktop-app.md DT-2 step 1 / DT-14) ---------------------

/** Why /health didn't answer well: the Offline screen's detail line says which. */
export type ProbeFailure =
  /** Nothing answered within the per-try timeout. */
  | { kind: "timeout" }
  /** Nothing to connect to: fetch failed, or the Desktop proxy / Fly edge answered 502 or 504. */
  | { kind: "unreachable" }
  /** The server answered, but with an error status (or its database is down). */
  | { kind: "error"; status: number | "db down" };

export type ProbeResult = { ok: true } | ({ ok: false } & ProbeFailure);

export const PROBE_TIMEOUT_MS = 10_000;
export const PROBE_TRIES = 3;
/** The waits between tries: 1 s after the first, 2 s after the second. */
export const PROBE_GAPS_MS: readonly number[] = [1_000, 2_000];

/** Classify a failed answer (the same split the Offline detail line makes). */
export function failureForStatus(status: number): ProbeFailure {
  return status === 502 || status === 504 ? { kind: "unreachable" } : { kind: "error", status };
}

/**
 * Ask /health once, giving up after `timeoutMs` (the request is aborted). Unlike `checkBackend`
 * it says WHY it failed. The outcome is recorded in the shared status store too.
 */
export async function probeBackend(timeoutMs: number = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  let result: ProbeResult;
  try {
    const res = await fetch("/health", { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) {
      result = { ok: false, ...failureForStatus(res.status) };
    } else {
      const body = (await res.json().catch(() => null)) as { db?: unknown } | null;
      result = body?.db === "down" ? { ok: false, kind: "error", status: "db down" } : { ok: true };
    }
  } catch {
    result = timedOut ? { ok: false, kind: "timeout" } : { ok: false, kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
  if (result.ok) reportFetchOk();
  else reportFetchFailed();
  return result;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The launch check: up to `PROBE_TRIES` tries of `probeBackend`, waiting `PROBE_GAPS_MS` between
 * them. Resolves with the first success or the last failure. `isCancelled` stops between tries.
 */
export async function probeBackendWithRetries(
  isCancelled: () => boolean = () => false,
): Promise<ProbeResult> {
  let last: ProbeResult = { ok: false, kind: "unreachable" };
  for (let attempt = 0; attempt < PROBE_TRIES; attempt += 1) {
    if (attempt > 0) await wait(PROBE_GAPS_MS[attempt - 1] ?? 0);
    if (isCancelled()) return last;
    last = await probeBackend();
    if (last.ok) return last;
  }
  return last;
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
