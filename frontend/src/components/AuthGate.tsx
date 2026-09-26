import { useEffect, useRef, useState } from "react";

import { ToastProvider } from "../design-system/components";
import {
  type AuthUser,
  type Config,
  getConfig,
  getMe,
  logout,
  setUnauthorizedHandler,
} from "../lib/api";
import { isDesktopApp } from "../lib/desktopRepos";
import { appAddress, isPublicRoute, navigate, parseRoute, useNav } from "../lib/nav";
import { DesktopGate } from "../pages/desktop/DesktopGate";
import { SiteRoot } from "../pages/website/SiteRoot";
import { Workspace } from "../pages/Workspace";

/**
 * The app's root gate. Tvashtr Desktop has its own launch and sign-in screens
 * (`pages/desktop/DesktopGate`, desktop-app.md DT-1): it never shows the website's landing page
 * or login wizard. The website keeps the gate below.
 */
export function AuthGate() {
  return isDesktopApp() ? <DesktopGate /> : <WebAuthGate />;
}

/**
 * The website's gate + top-level router (website.md WEB-1, WEB-2, WEB-5, WEB-42, WEB-43). It asks
 * the server who we are once (`getMe`); `user` is undefined until it answers.
 *
 * - A public address (`#/welcome`, `#/download…`, `#/signin…`) renders the website at once, signed
 *   in or out; only its header waits for the answer.
 * - The empty hash (and `#/home`) is the landing signed out and Home signed in; it waits on a
 *   blank page, never a wrong-variant flash.
 * - Any other app address signed out goes to `#/signin?next=<that address>`, and so does a 401
 *   mid-session (the api seam), so the user lands back where they were after signing in.
 * - Toasts ("Command copied") work on public pages too: the provider sits above both branches.
 */
function WebAuthGate() {
  const { route } = useNav();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const signedIn = useRef(false);
  signedIn.current = Boolean(user);
  // M-h1a: the public backend posture (hosted vs self-hosted) — which sign-in door shows.
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Mid-session (not the first check): back through sign-in to this very address.
      if (signedIn.current && !isPublicRoute(parseRoute(window.location.hash))) {
        navigate({ page: "signin", next: here() }, { replace: true });
      }
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Signed out on an app address (not Home): sign in first, then come back.
  const toSignIn = user === null && !isPublicRoute(route) && route.page !== "home";
  useEffect(() => {
    if (toSignIn) navigate({ page: "signin", next: here() }, { replace: true });
  }, [toSignIn]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      /* even if the network call fails, drop the local session view */
    } finally {
      setUser(null);
      navigate({ page: "welcome" });
    }
  };

  let page;
  if (isPublicRoute(route)) {
    page = <SiteRoot route={route} user={user} config={config} onAuthed={setUser} />;
  } else if (user) {
    page = <Workspace user={user} config={config} onLogout={() => void handleLogout()} />;
  } else if (user === null && route.page === "home") {
    page = <SiteRoot route={{ page: "welcome" }} user={null} config={config} onAuthed={setUser} />;
  } else {
    page = <div className="web-blank" />;
  }
  return <ToastProvider>{page}</ToastProvider>;
}

/** The current app address (`/teams/<id>?node=x`), if it can be returned to after sign-in. */
function here(): string | undefined {
  return appAddress(window.location.hash.replace(/^#/, ""));
}
