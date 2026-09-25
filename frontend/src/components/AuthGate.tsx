import { useEffect, useState } from "react";

import { ToastProvider } from "../design-system/components";
import {
  type AuthUser,
  type Config,
  getConfig,
  getMe,
  logout,
  setUnauthorizedHandler,
} from "../lib/api";
import { Workspace } from "../pages/Workspace";
import { LandingPage } from "./LandingPage";
import { type AuthMode, AuthWizard } from "./AuthWizard";

/**
 * The auth gate + top-level router (M-accounts). On mount it asks the server who we are (`getMe`).
 *
 * - Logged OUT: the LANDING page by default (product pitch + CTAs); a CTA switches to the
 *   login/register screen (Slice B — the canvas is never the logged-out default).
 * - Logged IN: the `Workspace` — the dashboard pages and each team's canvas, chosen by the page
 *   address (`lib/nav.ts`), so back/forward and refresh keep the place.
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
  // M-h1a: the public backend posture (hosted vs self-hosted) — drives which door the AuthWizard shows.
  const [config, setConfig] = useState<Config | null>(null);

  // Register the 401 seam first: a 401 on getMe (below) or any later poll flips us back to the
  // logged-out landing page. Cleared on unmount so a stale closure can't fire after this gate is gone.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus("unauthed");
      setUnauthView("landing");
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
  return (
    <ToastProvider>
      <Workspace user={user} config={config} onLogout={() => void handleLogout()} />
    </ToastProvider>
  );
}
