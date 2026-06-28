import { useEffect, useState } from "react";

import App from "../App";
import { type AuthUser, getMe, logout, setUnauthorizedHandler } from "../lib/api";
import { LoginScreen } from "./LoginScreen";

/**
 * The login gate (M-accounts Slice A). On mount it asks the server who we are (`getMe`); until that
 * resolves it shows a minimal placeholder, then renders either the login screen or the real <App/>.
 * It registers the api 401 seam so an expired session mid-use drops the whole app back to login,
 * and threads the logged-in identity + a logout handler into <App/> for the top-bar control.
 */
export function AuthGate() {
  const [status, setStatus] = useState<"loading" | "authed" | "unauthed">("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  // Register the 401 seam first: a 401 on getMe (below) or any later poll flips us to the login
  // screen. Cleared on unmount so a stale closure can't fire after this gate is gone.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus("unauthed");
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
    }
  };

  if (status === "loading") {
    return <div className="tv-auth tv-auth__loading">Loading…</div>;
  }
  if (status === "unauthed" || !user) {
    return <LoginScreen onAuthed={handleAuthed} />;
  }
  return <App user={user} onLogout={() => void handleLogout()} />;
}
