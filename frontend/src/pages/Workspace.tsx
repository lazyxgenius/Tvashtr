import { useEffect, useState } from "react";

import App from "../App";
import type { AuthUser, Config } from "../lib/api";
import {
  rememberAfterSetup,
  resumeStep,
  setupUnfinished,
  useDesktopSetup,
} from "../lib/desktopSetup";
import { useDesktopDeepLinks } from "../lib/desktopDeepLinks";
import { requestHomeAction } from "../lib/homeActions";
import { type DashView, HOME, type Route, isPublicRoute, navigate, useNav } from "../lib/nav";
import { useGlobalShortcuts } from "../lib/useGlobalShortcuts";
import { refreshBadges, useNavBadges } from "../lib/workspaceStatus";
import { SetupPage } from "./desktop/setup/SetupPage";
import { DomainDetailPage } from "./domains/DomainDetailPage";
import { DomainsListPage } from "./domains/DomainsListPage";
import { EnginesPage } from "./engines/EnginesPage";
import { CommandPalette } from "./home/CommandPalette";
import { HomePage } from "./home/HomePage";
import { MemoryPage } from "./memory/MemoryPage";
import { Shell } from "./shell/Shell";
import { SkillEditorPage } from "./skills/SkillEditorPage";
import { SkillsPage } from "./skills/SkillsPage";
import { SecretsPage } from "./secrets/SecretsPage";
import { ShortcutsDialog } from "./shell/ShortcutsDialog";
import { ToolDetailPage } from "./tools/ToolDetailPage";
import { ToolsPage } from "./tools/ToolsPage";
import { useGithubReturn } from "./tools/githubReturn";
import "./badgeLoaders";

/** Where the canvas's "back" and "Open Engines / Toolkit" controls land. */
function dashViewRoute(view: DashView | undefined): Route {
  switch (view) {
    case "domains":
      return { page: "domains" };
    case "engines":
      // "Open Engines" on a blocked run: Overview with the rows to fix highlighted.
      return { page: "engines", tab: "overview", fix: true };
    case "tools":
      return { page: "tools", view: "installed" };
    default:
      return { page: "home" };
  }
}

// The mark on a history step the canvas pushed to open the document viewer (Back closes it).
const DOC_STEP = "tvashtrDocStep";
const historyState = () => (window.history.state ?? {}) as Record<string, unknown>;
const onDocStep = () => historyState()[DOC_STEP] === true;

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

  // On arrival and on every return from the canvas: the drawer changes other areas' counts.
  useEffect(() => {
    if (!onCanvas) void refreshBadges();
  }, [onCanvas]);
  useGithubReturn(); // Desktop: back from the GitHub App install → Toolkit › Tools › Browse
  // Tvashtr Desktop: follow `tvashtr://` links (a no-op on the website).
  useDesktopDeepLinks();

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

  // The website's public pages never show in the app: Tvashtr Desktop signed in goes Home (WEB-3).
  const onPublic = isPublicRoute(route);
  useEffect(() => {
    if (onPublic) navigate(HOME, { replace: true });
  }, [onPublic]);

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
  if (onPublic || setup.status === "loading" || (needsSetup && !onSetup)) return null;

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
        node={route.node}
        tab={route.tab}
        focus={route.focus}
        onNodeRoute={(next) =>
          navigate(
            { page: "team", teamId: route.teamId, runId: route.runId, ...next },
            { replace: true },
          )
        }
        doc={
          route.docId
            ? { id: route.docId, version: route.version, compare: route.compare }
            : undefined
        }
        // The viewer sits over the canvas or the focus view under it: closing keeps that place.
        // Closing one the canvas opened goes Back over its history step, so the canvas's address
        // isn't left in history twice (a dead Back step); one opened from the address replaces.
        onDocRoute={(next, { push }) => {
          if (!next && onDocStep()) {
            window.history.back();
            return;
          }
          const from = window.location.hash;
          navigate(
            { ...route, docId: next?.id, version: next?.version, compare: next?.compare },
            { replace: !push },
          );
          if (push && window.location.hash !== from)
            window.history.replaceState({ ...historyState(), [DOC_STEP]: true }, "");
        }}
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
      return route.domainId ? (
        <DomainDetailPage
          key={route.domainId}
          domainId={route.domainId}
          tab={route.tab}
          file={route.file}
          piece={route.piece}
        />
      ) : (
        <DomainsListPage />
      );
    case "engines":
      return (
        <EnginesPage
          tab={route.tab}
          fix={route.fix}
          connect={route.connect}
          embeddings={route.embeddings}
        />
      );
    case "tools":
      return <ToolsPage view={route.view} />;
    case "tool":
      return <ToolDetailPage key={route.toolId} toolId={route.toolId} />;
    case "skills":
      return <SkillsPage view={route.view} />;
    case "skill":
      return <SkillEditorPage skillId={route.skillId} />;
    case "memory":
      return <MemoryPage tab={route.tab} pick={route.pick === true} />;
    case "secrets":
      return <SecretsPage />;
    default:
      return null;
  }
}
