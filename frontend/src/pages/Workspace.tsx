import { useEffect, useState } from "react";

import App from "../App";
import { DomainsPage } from "../components/DomainsPage";
import { EnginesShelf } from "../components/EnginesShelf";
import { MemoryShelf } from "../components/MemoryShelf";
import { SecretsShelf } from "../components/SecretsShelf";
import { SkillsShelf } from "../components/SkillsShelf";
import { ToolsShelf } from "../components/ToolsShelf";
import type { AuthUser, Config } from "../lib/api";
import {
  rememberAfterSetup,
  resumeStep,
  setupUnfinished,
  useDesktopSetup,
} from "../lib/desktopSetup";
import { requestHomeAction } from "../lib/homeActions";
import { type DashView, type Route, navigate, useNav } from "../lib/nav";
import { useGlobalShortcuts } from "../lib/useGlobalShortcuts";
import { refreshBadges, useNavBadges } from "../lib/workspaceStatus";
import { SetupPage } from "./desktop/setup/SetupPage";
import { CommandPalette } from "./home/CommandPalette";
import { HomePage } from "./home/HomePage";
import { Shell } from "./shell/Shell";
import { ShortcutsDialog } from "./shell/ShortcutsDialog";
import "./badgeLoaders";

/** Where the canvas's "back" and "Open Engines / Toolkit" controls land. */
function dashViewRoute(view: DashView | undefined): Route {
  switch (view) {
    case "domains":
      return { page: "domains" };
    case "engines":
      return { page: "engines", tab: "overview" };
    case "tools":
      return { page: "tools", view: "installed" };
    default:
      return { page: "home" };
  }
}

/**
 * The signed-in app: every dashboard page inside the Shell, chosen by the page address
 * (`lib/nav.ts`), and a team's canvas full-window. Back/forward and refresh keep the place.
 */
export function Workspace({
  user,
  config,
  onLogout,
}: {
  user: AuthUser;
  config: Config | null;
  onLogout: () => void;
}) {
  const { route } = useNav();
  const badges = useNavBadges();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const onCanvas = route.page === "team";
  const onSetup = route.page === "setup";
  // Tvashtr Desktop: this Mac's first-run setup for the account (DT-17). "none" on the website.
  const setup = useDesktopSetup(user.id);
  const needsSetup = setupUnfinished(setup);

  useEffect(() => {
    void refreshBadges();
  }, []);

  // While setup isn't finished the app sits on #/setup/<saved step>; a deep link that asked for
  // somewhere else opens when setup finishes (OQ-34). No setup to do → setup addresses go Home.
  useEffect(() => {
    if (setup.status === "loading") return;
    if (needsSetup && setup.status === "ready" && !onSetup) {
      rememberAfterSetup(route.page === "home" ? null : window.location.hash);
      navigate({ page: "setup", step: resumeStep(setup.setup) }, { replace: true });
    } else if (onSetup && setup.status === "none") {
      navigate({ page: "home" }, { replace: true });
    }
  }, [needsSetup, onSetup, route.page, setup]);

  useGlobalShortcuts(
    {
      onSearch: () => setSearchOpen(true),
      onNewRun: () => requestHomeAction({ kind: "new-run" }),
      onNewTeam: () => requestHomeAction({ kind: "new-team" }),
      onShowShortcuts: () => setShortcutsOpen(true),
    },
    !onCanvas && !onSetup,
  );

  // Desktop: the few ms the setup store takes to answer, and the redirect into setup.
  if (setup.status === "loading" || (needsSetup && !onSetup)) return null;

  if (route.page === "setup") {
    if (setup.status !== "ready") return null;
    return <SetupPage step={route.step} user={user} setup={setup.setup} onLogout={onLogout} />;
  }

  if (route.page === "team") {
    return (
      <App
        key={`${route.teamId}:${route.runId ?? ""}`}
        user={user}
        onLogout={onLogout}
        teamId={route.teamId}
        initialRunId={route.runId ?? null}
        onBackToDashboard={(view) => navigate(dashViewRoute(view))}
        config={config}
      />
    );
  }

  return (
    <>
      <Shell
        route={route}
        user={user}
        badges={badges}
        onNavigate={(r) => navigate(r)}
        onOpenSearch={() => setSearchOpen(true)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onLogout={onLogout}
      >
        <WorkspacePage route={route} user={user} />
      </Shell>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}

function WorkspacePage({ route, user }: { route: Route; user: AuthUser }) {
  switch (route.page) {
    case "home":
      return <HomePage user={user} />;
    case "domains":
      return (
        <DomainsPage
          onOpenEngines={() => navigate({ page: "engines", tab: "overview" })}
          onCreateTeam={() => requestHomeAction({ kind: "new-team" })}
        />
      );
    case "engines":
      return <EnginesShelf />;
    case "tools":
    case "tool":
      return <ToolsShelf />;
    case "skills":
    case "skill":
      return <SkillsShelf />;
    case "memory":
      return <MemoryShelf />;
    case "secrets":
      return <SecretsShelf />;
    default:
      return null;
  }
}
