import { useEffect, useState } from "react";

import App from "../App";
import { DomainsPage } from "../components/DomainsPage";
import { EnginesShelf } from "../components/EnginesShelf";
import { MemoryShelf } from "../components/MemoryShelf";
import { SkillsShelf } from "../components/SkillsShelf";
import type { AuthUser, Config } from "../lib/api";
import { requestHomeAction } from "../lib/homeActions";
import { type DashView, type Route, navigate, useNav } from "../lib/nav";
import { useGlobalShortcuts } from "../lib/useGlobalShortcuts";
import { refreshBadges, useNavBadges } from "../lib/workspaceStatus";
import { CommandPalette } from "./home/CommandPalette";
import { HomePage } from "./home/HomePage";
import { Shell } from "./shell/Shell";
import { SecretsPage } from "./secrets/SecretsPage";
import { ShortcutsDialog } from "./shell/ShortcutsDialog";
import { ToolDetailPage } from "./tools/ToolDetailPage";
import { ToolsPage } from "./tools/ToolsPage";
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

  useEffect(() => {
    void refreshBadges();
  }, []);

  useGlobalShortcuts(
    {
      onSearch: () => setSearchOpen(true),
      onNewRun: () => requestHomeAction({ kind: "new-run" }),
      onNewTeam: () => requestHomeAction({ kind: "new-team" }),
      onShowShortcuts: () => setShortcutsOpen(true),
    },
    !onCanvas,
  );

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
      return <ToolsPage view={route.view} />;
    case "tool":
      return <ToolDetailPage key={route.toolId} toolId={route.toolId} />;
    case "skills":
    case "skill":
      return <SkillsShelf />;
    case "memory":
      return <MemoryShelf />;
    case "secrets":
      return <SecretsPage />;
    default:
      return null;
  }
}
