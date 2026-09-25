/**
 * Home's live data — the Needs-you inbox, the active runs (Running now) and the spend — in one
 * store the sections read with `useHomeData()`. Polling starts when the first section mounts and
 * stops when Home unmounts: every 5s while a run is running, else every 30s, plus at once when the
 * window regains focus (HOME-106). Actions call `refreshHome()` afterwards.
 *
 * It also carries the two cross-section requests Home needs: "fill the composer" (Retry, Start
 * again) and "add these API keys" (Fix on a setup gap, the composer's Fix / Add keys).
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

import { type Inbox, type InboxItem, type Spend, getInbox, getSpend } from "../../lib/api/home";
import { type RunListRow, getRunDetail, listRunsPage } from "../../lib/api/runs";
import { isDesktopApp } from "../../lib/desktopRepos";
import { publishBadges } from "../../lib/workspaceStatus";

export interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

/** A run that ended while Home was open: shown muted in Running now for a minute (spec Q6). */
export interface EndedRun {
  row: RunListRow;
  endedAt: number;
}

export interface HomeData {
  inbox: Loadable<Inbox>;
  active: Loadable<RunListRow[]>;
  spend: Loadable<Spend>;
  ended: EndedRun[];
  /** Bumped after every action, so lists with their own paging (Recent runs) refetch. */
  version: number;
}

const EMPTY: Loadable<never> = { data: null, loading: true, error: false };
const ENDED_MS = 60_000;

let state: HomeData = { inbox: EMPTY, active: EMPTY, spend: EMPTY, ended: [], version: 0 };
const listeners = new Set<() => void>();

function set(patch: Partial<HomeData>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function surface(): "website" | "desktop" {
  return isDesktopApp() ? "desktop" : "website";
}

async function loadInbox(): Promise<void> {
  try {
    const inbox = await getInbox(surface());
    set({ inbox: { data: inbox, loading: false, error: false } });
    publishBadges({ home: inbox.count });
  } catch {
    set({ inbox: { ...state.inbox, loading: false, error: true } });
  }
}

async function loadActive(): Promise<void> {
  try {
    const page = await listRunsPage({ status: "active", progress: true, limit: 50 });
    const before = state.active.data ?? [];
    const now = page.runs;
    const nowIds = new Set(now.map((r) => r.run_id));
    const endedIds = new Set(state.ended.map((e) => e.row.run_id));
    const vanished = before.filter((r) => !nowIds.has(r.run_id) && !endedIds.has(r.run_id));
    set({ active: { data: now, loading: false, error: false } });
    for (const row of vanished) void noteEnded(row);
  } catch {
    set({ active: { ...state.active, loading: false, error: true } });
  }
}

/** A run left the active list: find out how it ended and keep it as a muted card for a minute. */
async function noteEnded(row: RunListRow): Promise<void> {
  let status = "completed";
  try {
    const detail = await getRunDetail(row.run_id);
    if (detail?.status) status = detail.status;
  } catch {
    // keep "completed" — the card only lingers for a minute anyway
  }
  markRunEnded(row, status);
}

async function loadSpend(): Promise<void> {
  try {
    const spend = await getSpend();
    set({ spend: { data: spend, loading: false, error: false } });
  } catch {
    set({ spend: { ...state.spend, loading: false, error: true } });
  }
}

/** Refetch everything Home shows (after an action, on a timer, on focus). */
export async function refreshHome(opts: { bump?: boolean } = {}): Promise<void> {
  if (opts.bump !== false) set({ version: state.version + 1 });
  pruneEnded();
  await Promise.all([loadInbox(), loadActive(), loadSpend()]);
}

/** Keep a finished run's card in Running now, muted, for a minute. */
export function markRunEnded(row: RunListRow, status: string): void {
  const ended: EndedRun = {
    row: { ...row, status, awaiting: null },
    endedAt: Date.now(),
  };
  set({
    ended: [...state.ended.filter((e) => e.row.run_id !== row.run_id), ended],
    active: state.active.data
      ? { ...state.active, data: state.active.data.filter((r) => r.run_id !== row.run_id) }
      : state.active,
  });
}

function pruneEnded(): void {
  const cutoff = Date.now() - ENDED_MS;
  if (state.ended.some((e) => e.endedAt < cutoff)) {
    set({ ended: state.ended.filter((e) => e.endedAt >= cutoff) });
  }
}

/** Take an item out of Needs you right away (the server agrees on the next refresh). */
export function removeInboxItem(key: string): InboxItem | null {
  const inbox = state.inbox.data;
  const item = inbox?.items.find((i) => i.key === key) ?? null;
  if (!inbox || !item) return null;
  const items = inbox.items.filter((i) => i.key !== key);
  set({ inbox: { ...state.inbox, data: { count: items.length, items } } });
  publishBadges({ home: items.length });
  return item;
}

/** Put an item back (Undo), in its oldest-first place. */
export function restoreInboxItem(item: InboxItem): void {
  const inbox = state.inbox.data ?? { count: 0, items: [] };
  if (inbox.items.some((i) => i.key === item.key)) return;
  const items = [...inbox.items, item].sort((a, b) => a.since.localeCompare(b.since));
  set({ inbox: { ...state.inbox, data: { count: items.length, items } } });
  publishBadges({ home: items.length });
}

export function getHomeData(): HomeData {
  return state;
}

// ---- Polling, ref-counted by the sections that read the store ----

let subscribers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function anyRunning(): boolean {
  return (state.active.data ?? []).some((r) => r.status === "pending" || r.status === "running");
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(
    () => {
      if (document.visibilityState !== "hidden") void refreshHome().finally(schedule);
      else schedule();
    },
    anyRunning() ? 5_000 : 30_000,
  );
}

function onFocus(): void {
  void refreshHome();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function startPolling(): void {
  subscribers += 1;
  if (subscribers > 1) return;
  void refreshHome({ bump: false }).finally(schedule);
  window.addEventListener("focus", onFocus);
}

function stopPolling(): void {
  subscribers -= 1;
  if (subscribers > 0) return;
  if (timer) clearTimeout(timer);
  timer = null;
  window.removeEventListener("focus", onFocus);
}

/** Read Home's live data (and keep it fresh while mounted). */
export function useHomeData(): HomeData {
  useEffect(() => {
    startPolling();
    return stopPolling;
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

// ---- Cross-section requests ----

export type ComposerTarget =
  | { kind: "github"; repo: string }
  | { kind: "folder"; path: string; label: string }
  | { kind: "local"; path: string }
  | { kind: "none" };

export interface ComposerPrefill {
  teamId: string | null;
  idea: string;
  target?: ComposerTarget | null;
  baseRef?: string | null;
  subpath?: string | null;
  budget?: number | null;
  /** Retry: the run this launch retries (shows the retry note, links the new run). */
  retryOfRunId?: string;
}

export interface AddKeysRequest {
  teamName: string;
  providers: string[];
  onDone?: () => void;
}

type Handler<T> = ((req: T) => void) | null;
let prefillHandler: Handler<ComposerPrefill> = null;
let addKeysHandler: Handler<AddKeysRequest> = null;

/** Fill the composer (Retry / Start again); the composer scrolls into view and focuses. */
export function requestComposerPrefill(p: ComposerPrefill): void {
  prefillHandler?.(p);
}

/** Start the Add-API-key sheet sequence for these providers. */
export function requestAddKeys(req: AddKeysRequest): void {
  addKeysHandler?.(req);
}

function useRegistered<T>(fn: (req: T) => void, register: (h: Handler<T>) => void): void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    const h = (req: T) => ref.current(req);
    register(h);
    return () => register(null);
  }, [register]);
}

const registerPrefill = (h: Handler<ComposerPrefill>) => {
  prefillHandler = h;
};
const registerAddKeys = (h: Handler<AddKeysRequest>) => {
  addKeysHandler = h;
};

export function useComposerPrefillHandler(fn: (p: ComposerPrefill) => void): void {
  useRegistered(fn, registerPrefill);
}

export function useAddKeysHandler(fn: (req: AddKeysRequest) => void): void {
  useRegistered(fn, registerAddKeys);
}

/** Test seam: reset the store between tests. */
export function __resetHomeDataForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  subscribers = 0;
  state = { inbox: EMPTY, active: EMPTY, spend: EMPTY, ended: [], version: 0 };
  listeners.clear();
  prefillHandler = null;
  addKeysHandler = null;
}
