import { useEffect, useState } from "react";

import App from "../App";
import {
  type AuthUser,
  type Config,
  getConfig,
  getMe,
  logout,
  setUnauthorizedHandler,
} from "../lib/api";
import { Dashboard, type DashView } from "./Dashboard";
import { LandingPage } from "./LandingPage";
import { type AuthMode, AuthWizard } from "./AuthWizard";

/**
 * The auth gate + top-level router (M-accounts). On mount it asks the server who we are (`getMe`).
 *
 * - Logged OUT: the LANDING page by default (product pitch + CTAs); a CTA switches to the
 *   login/register screen (Slice B — the canvas is never the logged-out default).
 * - Logged IN: the DASHBOARD by default (teams / runs / providers); opening a team routes to the
 *   canvas (`<App/>`) for that team, with a back-to-dashboard control. (Slice A landed login here on
 *   the canvas; Slice B inserts the landing page in front and the dashboard behind.)
 *
 * It also registers the api 401 seam so an expired session mid-use drops the whole app back to the
 * landing page, and threads the identity + a logout handler into the authed surfaces.
 */
export function AuthGate() {
  const [status, setStatus] = useState<"loading" | "authed" | "unauthed">("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  // Logged-out sub-view: the landing page by default; a CTA switches to the login screen.
  const [unauthView, setUnauthView] = useState<"landing" | "login">("landing");
  const [loginMode, setLoginMode] = useState<AuthMode>("login");
  // Logged-in sub-view: the dashboard by default; opening a team routes to the canvas for that team.
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  // Which dashboard page to show when returning from the canvas (Open Engines → "engines").
  const [dashView, setDashView] = useState<DashView>("home");
  // The dashboard's per-team run-history drill-down can open ONE run directly. It carries the team
  // too, so the canvas lands on the right team with that run's view already seeded — going "back"
  // from there is the ordinary authoring view of the same team.
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  // M-h1a: the public backend posture (hosted vs self-hosted) — drives which door the AuthWizard shows.
  const [config, setConfig] = useState<Config | null>(null);

  // Register the 401 seam first: a 401 on getMe (below) or any later poll flips us back to the
  // logged-out landing page. Cleared on unmount so a stale closure can't fire after this gate is gone.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus("unauthed");
      setUnauthView("landing");
      setOpenTeamId(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Resolve the current session once on mount.
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        if (me) {
          setUser(me);
          setStatus("authed");
        } else {
          setStatus("unauthed");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("unauthed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch the public posture once on mount (resilient: defaults to self-hosted if it fails).
  useEffect(() => {
    let cancelled = false;
    void getConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthed = (me: AuthUser) => {
    setUser(me);
    setStatus("authed");
    setOpenTeamId(null); // land on the dashboard
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      /* even if the network call fails, drop the local session view */
    } finally {
      setUser(null);
      setStatus("unauthed");
      setUnauthView("landing");
      setOpenTeamId(null);
    }
  };

  const startAuth = (mode: AuthMode) => {
    setLoginMode(mode);
    setUnauthView("login");
  };

  if (status === "loading") {
    return <div className="tv-auth tv-auth__loading">Loading…</div>;
  }
  if (status === "unauthed" || !user) {
    if (unauthView === "login") {
      return (
        <AuthWizard
          onAuthed={handleAuthed}
          initialMode={loginMode}
          onBack={() => setUnauthView("landing")}
          hosted={config?.hosted_mode ?? false}
          githubInstallUrl={config?.github_install_url ?? ""}
        />
      );
    }
    return <LandingPage onGetStarted={startAuth} />;
  }
  // Authed: the dashboard, or the canvas for an opened team.
  if (openTeamId) {
    return (
      <App
        user={user}
        onLogout={() => void handleLogout()}
        teamId={openTeamId}
        initialRunId={openRunId}
        onBackToDashboard={(view) => {
          setOpenTeamId(null);
          setOpenRunId(null);
          setDashView(view ?? "home");
        }}
        config={config}
      />
    );
  }
  return (
    <Dashboard
      user={user}
      initialView={dashView}
      onLogout={() => void handleLogout()}
      onOpenTeam={(teamId) => {
        setOpenRunId(null); // opening a team is the authoring view, never a stale run
        setOpenTeamId(teamId);
      }}
      onOpenRun={(runId, teamId) => {
        setOpenRunId(runId);
        setOpenTeamId(teamId);
      }}
    />
  );
}
