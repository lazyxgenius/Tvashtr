import { createContext, useContext } from "react";

import type { AuthUser, TeamSummary } from "../../lib/api";

/**
 * What the Home sections share (spec §4.5 "HomeActions"): the team list, the composer's chosen
 * team, and the cross-section actions — a team card's Run button, ⌘K, the N/T shortcuts, History
 * and the get-started checklist all go through here.
 */
export interface HomeContextValue {
  teams: TeamSummary[];
  teamsLoading: boolean;
  teamsError: boolean;
  reloadTeams: () => Promise<void>;
  /** The team the composer launches (null until teams load, or when there are none). */
  composerTeamId: string | null;
  /** Choose the composer's team, scroll to the composer and focus the idea field. */
  pickTeamForRun: (teamId: string, opts?: { toast?: boolean }) => void;
  /** Scroll to the composer and focus its idea field. */
  focusComposer: () => void;
  /** The composer registers the function that focuses its idea field. */
  registerComposerFocus: (focus: (() => void) | null) => void;
  /** Open the New team dialog, optionally with a template preselected. */
  openNewTeam: (opts?: { templateKey?: string }) => void;
  /** Open one team's run history (Recent runs filtered to that team). */
  openRunHistory: (teamId: string) => void;
  /** The team Recent runs is filtered to (null = all runs). */
  historyTeamId: string | null;
  setHistoryTeamId: (teamId: string | null) => void;
  /** The signed-in user (the greeting's name); absent in isolated tests. */
  user?: AuthUser | null;
}

export const HomeContext = createContext<HomeContextValue | null>(null);

export function useHome(): HomeContextValue {
  const ctx = useContext(HomeContext);
  if (!ctx) throw new Error("useHome must be used inside the Home page");
  return ctx;
}
