/**
 * Run notifications (M2, ruling R10; Prob-Notify): once the run bar's bell asked and the OS allows
 * it, poll the inbox and the active runs every 10 s — hidden or not, that's the point — and fire
 * one notification per NEW transition the account chose: a run needs you (an approval), a run
 * stalls or fails, a run finishes (with its pull request). Whatever the first poll finds is
 * already known, never announced. Clicking a notification opens its run.
 *
 * The bell (`panel/run/live/NotifyBell.tsx`) reads and saves the choices through this module, so
 * a choice made in the run view applies here at once.
 */
import { useEffect } from "react";

import { approvalTitle } from "../pages/home/homeFormat";
import { type InboxItem, getInbox } from "./api/home";
import { getRunDetail, listRunsPage } from "./api/runs";
import {
  type AccountPreferences,
  getAccountPreferences,
  patchAccountPreferences,
} from "./api/teams";
import { isDesktopApp } from "./desktopRepos";
import { navigate } from "./nav";

export const NOTIFY_POLL_MS = 10_000;

export interface NotifyPrefs {
  notify_asked: boolean;
  notify_needs_you: boolean;
  notify_stalls_fails: boolean;
  notify_finishes: boolean;
}

// ---- The account's choices (one copy for the bell and the notifier) ----

let prefs: NotifyPrefs | null = null;
let loading: Promise<NotifyPrefs | null> | null = null;

const pick = (p: AccountPreferences): NotifyPrefs => ({
  notify_asked: p.notify_asked ?? false,
  notify_needs_you: p.notify_needs_you ?? true,
  notify_stalls_fails: p.notify_stalls_fails ?? true,
  notify_finishes: p.notify_finishes ?? true,
});

/** The choices, loaded once (null while they can't be read; a later call tries again). */
export function loadNotifyPrefs(): Promise<NotifyPrefs | null> {
  if (prefs) return Promise.resolve(prefs);
  loading ??= getAccountPreferences()
    .then((p) => (prefs = pick(p)))
    .catch(() => null)
    .finally(() => (loading = null));
  return loading;
}

/** Save the bell's answer. Applies to this session at once; if the save fails the server still
 *  says "not asked", so the bell asks again next time. */
export async function saveNotifyPrefs(next: NotifyPrefs): Promise<void> {
  prefs = next;
  try {
    prefs = pick(await patchAccountPreferences({ ...next }));
  } catch {
    // keep the local answer for this session
  }
}

let autoAsked = false;

/** True the first time a run view's bell may ask on its own this session (then never again). */
export function claimAutoAsk(): boolean {
  if (autoAsked) return false;
  autoAsked = true;
  return true;
}

const notificationsAllowed = () =>
  typeof Notification !== "undefined" && Notification.permission === "granted";

/** Ask the OS (the browser's prompt; Desktop answers "granted") and say what it answered. Call
 *  it inside the click. */
export function askNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return Promise.resolve("denied");
  if (Notification.permission !== "default") return Promise.resolve(Notification.permission);
  return Notification.requestPermission().catch(() => "default" as const);
}

// ---- What a notification says (Prob-Notify) ----

interface Note {
  key: string;
  title: string;
  body: string;
  teamId: string | null | undefined;
  runId: string;
}

function inboxNote(item: InboxItem, p: NotifyPrefs, stalled: Set<string>): Note | null {
  const team = ("team" in item && item.team?.name) || "A run";
  if (item.kind === "approval" && p.notify_needs_you)
    return {
      key: item.key,
      title: `${team} needs you`,
      body: `${approvalTitle(item.task.kind)} for “${item.run.idea}”.`,
      teamId: item.team?.id ?? item.run.library_team_id,
      runId: item.run.id,
    };
  if (item.kind === "run_stalled" && p.notify_stalls_fails) {
    const at = new Date(item.live.last_event_at ?? item.since).getTime();
    const min = Math.max(1, Math.floor((Date.now() - at) / 60_000));
    return {
      key: item.key,
      title: `${team} stalled`,
      body: `No update for ${min} ${min === 1 ? "minute" : "minutes"}. Nothing shipped; finished steps are saved.`,
      teamId: item.team?.id ?? item.run.library_team_id,
      runId: item.run.id,
    };
  }
  // A stall the person already heard about fails at the 20-minute ceiling (R1): once is enough.
  if (item.kind === "run_failed" && p.notify_stalls_fails && !stalled.has(item.run.id))
    return {
      key: item.key,
      title: `${team} failed`,
      body: item.failure?.message ?? "The run stopped with an error.",
      teamId: item.team?.id ?? item.run.library_team_id,
      runId: item.run.id,
    };
  return null;
}

function fire(note: Note): void {
  let n: Notification;
  try {
    n = new Notification(note.title, { body: note.body, tag: note.key });
  } catch {
    return; // the OS refused (e.g. a mobile browser): the key still counts as seen
  }
  n.onclick = () => {
    window.focus();
    if (note.teamId) navigate({ page: "team", teamId: note.teamId, runId: note.runId });
    n.close();
  };
}

async function notifyIfFinished(runId: string): Promise<void> {
  const run = await getRunDetail(runId).catch(() => null);
  if (run?.status !== "completed") return;
  fire({
    key: `finished:${runId}`,
    title: `${run.team?.name ?? "A run"} finished`,
    body: run.pr_number
      ? `Pull request #${run.pr_number} is open: “${run.idea}”.`
      : `“${run.idea}” is done.`,
    teamId: run.team?.id ?? run.library_team_id,
    runId,
  });
}

// ---- The poll ----

/** Poll and notify while mounted — called once, by pages/Workspace.tsx (the signed-in app). */
export function useRunNotifier(): void {
  useEffect(() => {
    // What the last poll saw; null = the next poll only learns what's there.
    let seen: { keys: Set<string>; runs: Set<string> } | null = null;
    // Runs whose stall was announced (their failure isn't, R1).
    const stalled = new Set<string>();
    let busy = false;
    let stopped = false;

    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const p = await loadNotifyPrefs();
        const wanted =
          p?.notify_asked &&
          notificationsAllowed() &&
          (p.notify_needs_you || p.notify_stalls_fails || p.notify_finishes);
        if (!p || !wanted) {
          seen = null;
          return;
        }
        const [inbox, page] = await Promise.all([
          getInbox(isDesktopApp() ? "desktop" : "website"),
          listRunsPage({ status: "active", limit: 50 }),
        ]);
        if (stopped) return;
        const runs = new Set(page.runs.map((r) => r.run_id));
        if (seen) {
          const before = seen;
          for (const item of inbox.items) {
            const note = before.keys.has(item.key) ? null : inboxNote(item, p, stalled);
            if (!note) continue;
            fire(note);
            if (item.kind === "run_stalled") stalled.add(item.run.id);
          }
          if (p.notify_finishes)
            for (const id of before.runs) if (!runs.has(id)) void notifyIfFinished(id);
        }
        seen = { keys: new Set(inbox.items.map((i) => i.key)), runs };
      } catch {
        // offline or a bad answer: try again next time
      } finally {
        busy = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), NOTIFY_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
}

/** Test seam. */
export function __resetNotifyPrefsForTests(): void {
  prefs = null;
  loading = null;
  autoAsked = false;
}
