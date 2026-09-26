/**
 * The checklist lines of the Desktop launch screens (desktop-app.md DT-13, DT-15, DT-45). Pure, so
 * the gate and the tests share one source of copy.
 */
import type { AuthUser } from "../../lib/api";
import type { ProbeFailure } from "../../lib/backendStatus";
import type { SubscriptionStatus } from "../../lib/engines";

export type StatusTone = "done" | "warn" | "busy" | "note";

export interface StatusLine {
  tone: StatusTone;
  text: string;
}

/** What the launch has learnt so far. */
export interface LaunchProgress {
  /** `splash` = a normal launch (DT-13); `reconnected` = after Offline's retry worked (DT-15). */
  mode: "splash" | "reconnected";
  /** Set once `GET /api/auth/me` answered with the user. */
  me: AuthUser | null;
  /** The plan CLIs' status on this Mac, once the bridge answered. */
  plans: SubscriptionStatus[] | null;
}

const PLAN_NAMES: Partial<Record<SubscriptionStatus["provider"], string>> = {
  claude: "Claude Code",
  grok: "Grok",
  // Codex runs no agents yet, so it never gets a line.
};

export function signedInAs(user: AuthUser): string {
  return `Signed in as ${user.github_login || user.display_name || user.email}`;
}

/**
 * One line per runnable plan the user turned on: connected (sage), or needs sign-in / not found
 * (amber, "you can fix it later" — the splash never blocks on a plan problem). A plan that is off
 * (disconnected), an API-key login, or a failed check shows no line.
 */
export function planLines(plans: SubscriptionStatus[] | null): StatusLine[] {
  const out: StatusLine[] = [];
  for (const provider of ["claude", "grok"] as const) {
    const name = PLAN_NAMES[provider];
    const status = plans?.find((p) => p.provider === provider);
    if (!name || !status) continue;
    if (status.state === "connected") out.push({ tone: "done", text: `${name} connected` });
    else if (status.state === "needs_login") {
      out.push({ tone: "warn", text: `${name} needs sign-in · you can fix it later` });
    } else if (status.state === "needs_install") {
      out.push({ tone: "warn", text: `${name} not found · you can fix it later` });
    }
  }
  return out;
}

const LOADING_TEAMS: StatusLine = { tone: "busy", text: "Loading your teams…" };

/** Splash (DT-13): connecting until the session answers, then who, the plans, and the teams. */
export function splashLines(progress: LaunchProgress): StatusLine[] {
  if (!progress.me) return [{ tone: "busy", text: "Connecting…" }];
  return [
    { tone: "done", text: signedInAs(progress.me) },
    ...planLines(progress.plans),
    LOADING_TEAMS,
  ];
}

/** Reconnected (DT-15): connected, then who, then the teams. */
export function reconnectedLines(progress: LaunchProgress): StatusLine[] {
  const lines: StatusLine[] = [{ tone: "done", text: "Connected" }];
  if (progress.me) lines.push({ tone: "done", text: signedInAs(progress.me) }, LOADING_TEAMS);
  return lines;
}

/** Updating (DT-45): the resume note shows only while a Desktop run is going (n > 0). */
export function updatingLines(version: string, runsGoing: number | null): StatusLine[] {
  const lines: StatusLine[] = [{ tone: "busy", text: `Installing ${version}` }];
  if (runsGoing && runsGoing > 0) {
    lines.push({
      tone: "note",
      text:
        runsGoing === 1
          ? "Your running team will resume from its last step"
          : "Your running teams will resume from their last step",
    });
  }
  return lines;
}

/** The update card's run count (DT-44, OQ-7). */
export function runsGoingLine(n: number): string {
  if (n === 0) return "No runs are going.";
  return n === 1 ? "1 run is going." : `${n} runs are going.`;
}

function offlineReason(failure: ProbeFailure): string {
  switch (failure.kind) {
    case "timeout":
      return "no response after 10 s";
    case "unreachable":
      return "couldn’t connect";
    case "error":
      return `answered with an error (${failure.status})`;
  }
}

/** The mono line "<api host> · <reason> · tried 3 times" (DT-14). */
export function offlineDetail(
  failure: ProbeFailure,
  tries: number,
  apiHost: string | null,
): string {
  const tried = tries === 1 ? "tried once" : `tried ${tries} times`;
  return [apiHost, offlineReason(failure), tried].filter(Boolean).join(" · ");
}
