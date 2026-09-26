import { useEffect, useState } from "react";

import type { AuthUser } from "../../../lib/api";
import { countLibraryTeams } from "../../../lib/api/desktop";
import { loginOf } from "../../../lib/desktopApp";
import type { DesktopSetup, SetupStep } from "../../../lib/desktopSetup";
import { EnginesStep } from "./EnginesStep";
import { ProjectStep } from "./ProjectStep";
import { TeamStep } from "./TeamStep";

/**
 * Tvashtr Desktop's first-run setup at `#/setup/<step>` (desktop-app.md DT-16..DT-18), shown
 * full-window by the Workspace while this Mac's setup for the account isn't finished (DT-17).
 */
export function SetupPage({
  step,
  user,
  setup,
  onLogout,
}: {
  step: SetupStep;
  user: AuthUser;
  setup: DesktopSetup;
  onLogout: () => void;
}) {
  const login = loginOf(user);
  const teamsAlready = useTeamsAlready();
  switch (step) {
    case "engines":
      return (
        <EnginesStep
          login={login}
          setup={setup}
          onSwitch={onLogout}
          teamsAlready={teamsAlready === true}
        />
      );
    case "project":
      return (
        <ProjectStep login={login} setup={setup} teamsAlready={teamsAlready} onSwitch={onLogout} />
      );
    case "team":
      return <TeamStep login={login} onSwitch={onLogout} />;
  }
}

/** DT-37: whether the account already has library teams (null until known, or when unreadable). */
function useTeamsAlready(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void countLibraryTeams().then((n) => {
      if (live) setHas(n === null ? null : n > 0);
    });
    return () => {
      live = false;
    };
  }, []);
  return has;
}
