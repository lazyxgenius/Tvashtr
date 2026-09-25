import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "../../design-system/components";
import { type AuthUser, getTeams, type TeamSummary } from "../../lib/api";
import { reportFetchFailed, reportFetchOk } from "../../lib/backendStatus";
import { type HomeAction, useHomeActionHandler } from "../../lib/homeActions";
import { Composer } from "./Composer";
import { defaultTeamId } from "./composerModel";
import { FirstTimeHome } from "./FirstTimeHome";
import { HomeHeader } from "./HomeHeader";
import { HomeContext, type HomeContextValue } from "./homeContext";
import { NeedsYou } from "./NeedsYou";
import { NewTeamDialog } from "./NewTeamDialog";
import { RecentRuns } from "./RecentRuns";
import { RunningNow } from "./RunningNow";
import { SpendCard } from "./SpendCard";
import { TeamsSection } from "./TeamsSection";
import { useGetStartedProgress } from "./useGetStartedProgress";
import "./home.css";

/**
 * Home (Home-Main): greeting, Start a run, then two columns — Needs you / Running now / Teams on
 * the left, Recent runs / Spend on the right (330px). Sections live in their own files; this page
 * owns the shared state they coordinate through (`HomeContext`).
 */
export function HomePage({ user = null }: { user?: AuthUser | null } = {}) {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState(false);
  const [composerTeamId, setComposerTeamId] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState<{ templateKey?: string } | null>(null);
  const [historyTeamId, setHistoryTeamId] = useState<string | null>(null);
  const composerFocus = useRef<(() => void) | null>(null);
  const toast = useToast();
  const getStarted = useGetStartedProgress(teams, teamsLoading);

  const reloadTeams = useCallback(async () => {
    try {
      const list = await getTeams();
      reportFetchOk();
      setTeams(list);
      setTeamsError(false);
      setComposerTeamId((cur) =>
        cur && list.some((t) => t.team_graph_id === cur) ? cur : defaultTeamId(list),
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

  // Pick the composer's team; with `toast`, say so ("{team} picked. Say what to build.").
  const pickTeamForRun = useCallback(
    (teamId: string, opts?: { toast?: boolean }) => {
      setComposerTeamId(teamId);
      composerFocus.current?.();
      const name = teams.find((t) => t.team_graph_id === teamId)?.name;
      if (opts?.toast && name) toast({ message: `${name} picked. Say what to build.` });
    },
    [teams, toast],
  );

  const value = useMemo<HomeContextValue>(
    () => ({
      teams,
      teamsLoading,
      teamsError,
      reloadTeams,
      composerTeamId,
      pickTeamForRun,
      focusComposer,
      registerComposerFocus: (focus) => {
        composerFocus.current = focus;
      },
      openNewTeam: (opts) => setNewTeam(opts ?? {}),
      openRunHistory: (teamId) => setHistoryTeamId(teamId),
      historyTeamId,
      setHistoryTeamId,
      user,
    }),
    [
      teams,
      teamsLoading,
      teamsError,
      reloadTeams,
      composerTeamId,
      pickTeamForRun,
      focusComposer,
      historyTeamId,
      user,
    ],
  );

  useHomeActionHandler((action: HomeAction) => {
    if (action.kind === "new-team") {
      setNewTeam({ templateKey: action.templateKey });
    } else if (teams.length === 0 && !teamsLoading) {
      setNewTeam({});
    } else if (action.teamId) {
      pickTeamForRun(action.teamId, { toast: true });
    } else {
      focusComposer();
    }
  });

  return (
    <HomeContext.Provider value={value}>
      {getStarted.firstTime ? <FirstTimeHome progress={getStarted} /> : <HomeMain />}
      <NewTeamDialog
        open={newTeam !== null}
        initialTemplate={newTeam?.templateKey}
        onClose={() => setNewTeam(null)}
      />
    </HomeContext.Provider>
  );
}

/** The normal Home layout (Home-Main). */
function HomeMain() {
  return (
    <>
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
    </>
  );
}
