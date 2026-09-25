import { useCallback, useEffect, useState } from "react";

import { listProviders, listSubscriptionStatuses, type TeamSummary } from "../../lib/api";
import { listRunsBrief, type RunBrief } from "../../lib/api/homeSearch";
import { checklistWasShown, loadGetStarted, setFirstTime, useGetStarted } from "./getStarted";

export interface GetStartedSteps {
  engine: boolean;
  team: boolean;
  run: boolean;
  review: boolean;
}

export interface GetStartedProgress {
  /** Everything needed to decide has loaded. */
  ready: boolean;
  /** Home shows the first-time layout. */
  firstTime: boolean;
  steps: GetStartedSteps;
  runs: RunBrief[];
  /** The first pull request (or Desktop ship branch) a run produced, for the 4-of-4 callout. */
  firstResult: { url: string | null; label: string } | null;
}

/** Did a run produce something to review — a PR, or on Desktop a finished ship branch (§6 Q10)? */
function resultOf(run: RunBrief): { url: string | null; label: string } | null {
  if (run.pr_url) {
    const n = run.pr_number ?? Number(/\/pull\/(\d+)/.exec(run.pr_url)?.[1] ?? NaN);
    return { url: run.pr_url, label: Number.isFinite(n) ? `PR #${n}` : "the pull request" };
  }
  if (run.status === "completed" && run.ship_branch && run.desktop_target) {
    return { url: null, label: `branch ${run.ship_branch}` };
  }
  return null;
}

/**
 * The get-started checklist's steps (TEAMS-72) and whether Home is in first-time mode:
 * the checklist isn't hidden and the account has no runs (or the checklist was already showing in
 * this browser, so it stays through steps 3 and 4 until the user hides it).
 */
export function useGetStartedProgress(
  teams: TeamSummary[],
  teamsLoading: boolean,
): GetStartedProgress {
  const { hidden } = useGetStarted();
  const [runs, setRuns] = useState<RunBrief[] | null>(null);
  const [engine, setEngine] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const [runsR, keysR, subsR] = await Promise.allSettled([
      listRunsBrief({ limit: 50 }),
      listProviders(),
      listSubscriptionStatuses(),
    ]);
    if (runsR.status === "fulfilled") setRuns(runsR.value);
    else setRuns((cur) => cur ?? []);
    const keys = keysR.status === "fulfilled" ? keysR.value.length > 0 : false;
    const subs = subsR.status === "fulfilled" ? subsR.value.some((s) => s.connected) : false;
    setEngine(keys || subs);
  }, []);

  useEffect(() => {
    void loadGetStarted();
  }, []);

  // Only an account that hasn't hidden the checklist needs the steps. Reload them when the team
  // list changes (a team was just made) and when the tab comes back.
  const wanted = hidden === false;
  useEffect(() => {
    if (wanted) void load();
  }, [wanted, load, teams.length]);
  useEffect(() => {
    if (!wanted) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [wanted, load]);

  const list = runs ?? [];
  const firstResult =
    list
      .slice()
      .reverse()
      .map(resultOf)
      .find((r) => r !== null) ?? null;
  const steps: GetStartedSteps = {
    engine: Boolean(engine),
    team: teams.some((t) => t.template_key !== "seed"),
    run: list.length > 0,
    review: firstResult !== null,
  };
  const ready =
    hidden === true || (hidden === false && runs !== null && engine !== null && !teamsLoading);
  const firstTime = ready && hidden === false && (list.length === 0 || checklistWasShown());

  useEffect(() => {
    setFirstTime(firstTime);
  }, [firstTime]);
  useEffect(() => () => setFirstTime(false), []);

  return { ready, firstTime, steps, runs: list, firstResult };
}
