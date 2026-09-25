import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getTeams, type TeamSummary } from "../../lib/api";
import { reportFetchFailed, reportFetchOk } from "../../lib/backendStatus";
import { type HomeAction, useHomeActionHandler } from "../../lib/homeActions";
import { Composer } from "./Composer";
import { HomeHeader } from "./HomeHeader";
import { HomeContext, type HomeContextValue } from "./homeContext";
import { NeedsYou } from "./NeedsYou";
import { NewTeamDialog } from "./NewTeamDialog";
import { RecentRuns } from "./RecentRuns";
import { RunningNow } from "./RunningNow";
import { SpendCard } from "./SpendCard";
import { TeamsSection } from "./TeamsSection";
import "./home.css";

/**
 * Home (Home-Main): greeting, Start a run, then two columns — Needs you / Running now / Teams on
 * the left, Recent runs / Spend on the right (330px). Sections live in their own files; this page
 * owns the shared state they coordinate through (`HomeContext`).
 */
export function HomePage() {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState(false);
  const [composerTeamId, setComposerTeamId] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState<{ templateKey?: string } | null>(null);
  const [historyTeamId, setHistoryTeamId] = useState<string | null>(null);
  const composerFocus = useRef<(() => void) | null>(null);

  const reloadTeams = useCallback(async () => {
    try {
      const list = await getTeams();
      reportFetchOk();
      setTeams(list);
      setTeamsError(false);
      setComposerTeamId((cur) =>
        cur && list.some((t) => t.team_graph_id === cur) ? cur : (list[0]?.team_graph_id ?? null),
      );
    } catch {
      reportFetchFailed();
      setTeamsError(true);
    } finally {
      setTeamsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadTeams();
  }, [reloadTeams]);

  const focusComposer = useCallback(() => composerFocus.current?.(), []);

  const value = useMemo<HomeContextValue>(
    () => ({
      teams,
      teamsLoading,
      teamsError,
      reloadTeams,
      composerTeamId,
      pickTeamForRun: (teamId) => {
        setComposerTeamId(teamId);
        composerFocus.current?.();
      },
      focusComposer,
      registerComposerFocus: (focus) => {
        composerFocus.current = focus;
      },
      openNewTeam: (opts) => setNewTeam(opts ?? {}),
      openRunHistory: (teamId) => setHistoryTeamId(teamId),
      historyTeamId,
      setHistoryTeamId,
    }),
    [teams, teamsLoading, teamsError, reloadTeams, composerTeamId, focusComposer, historyTeamId],
  );

  useHomeActionHandler((action: HomeAction) => {
    if (action.kind === "new-team") {
      setNewTeam({ templateKey: action.templateKey });
    } else if (teams.length === 0 && !teamsLoading) {
      setNewTeam({});
    } else {
      if (action.teamId) setComposerTeamId(action.teamId);
      focusComposer();
    }
  });

  return (
    <HomeContext.Provider value={value}>
      <HomeHeader />
      <Composer />
      <div className="hm-cols">
        <div className="hm-cols__main">
          <NeedsYou />
          <RunningNow />
          <TeamsSection />
        </div>
        <div className="hm-cols__side">
          <RecentRuns />
          <SpendCard />
        </div>
      </div>
      <NewTeamDialog
        open={newTeam !== null}
        initialTemplate={newTeam?.templateKey}
        onClose={() => setNewTeam(null)}
      />
    </HomeContext.Provider>
  );
}
