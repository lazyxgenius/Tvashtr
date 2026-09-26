import { useCallback, useEffect, useRef, useState } from "react";

import { ToastProvider, useToast } from "../../design-system/components";
import {
  type AuthUser,
  type Config,
  getConfig,
  getMe,
  logout,
  setUnauthorizedHandler,
} from "../../lib/api";
import {
  canSignInWithBrowser,
  cancelSignIn,
  forgetUser,
  getAppInfo,
  getLaunchContext,
  onSignIn,
  rememberUser,
  reopenBrowser,
  setDesktopTitle,
  startSignIn,
  TITLE_CANVAS,
} from "../../lib/desktopApp";
import { DesktopDisclosure } from "../../components/DesktopDisclosure";
import { Workspace } from "../Workspace";
import { ExpiredPage } from "./ExpiredPage";
import { LaunchFrame } from "./LaunchFrame";
import { OfflinePage } from "./OfflinePage";
import { SignInFailedPage } from "./SignInFailedPage";
import { WaitingPage } from "./WaitingPage";
import { type WebHandoff, WelcomePage } from "./WelcomePage";

type Account = "current" | "github";

export type GateState =
  | { kind: "checking" }
  | { kind: "offline" }
  | { kind: "signed_out" }
  | { kind: "expired"; lastLogin: string }
  | { kind: "waiting"; signInUrl: string }
  | { kind: "failed"; reason: string | null }
  | { kind: "authed"; user: AuthUser };

/**
 * Tvashtr Desktop's launch state machine (desktop-app.md DT-1, DT-2, DT-11, DT-49), used by
 * `AuthGate` when `isDesktopApp()`. A signed-out user never sees the website's landing page or
 * login wizard: they see Welcome (or its Handoff variant when the app was opened from the
 * website), or Expired when someone signed in on this Mac before. Sign-in happens in the default
 * browser (bridge v6 `auth`); a self-hosted backend keeps email and password (OQ-37).
 *
 * Deep links (DB-8): the root subscribes once to `navigation.onNavigate`; a link that arrives
 * while signed out is kept and opened after sign-in.
 */
export function DesktopGate() {
  return (
    <ToastProvider>
      <DesktopGateInner />
    </ToastProvider>
  );
}

function linkHash(target: TvashtrDeepLinkTarget): string {
  const connect = target.params?.connect;
  return `#${target.path}${connect ? `?connect=${encodeURIComponent(connect)}` : ""}`;
}

function isNetworkFailure(err: unknown): boolean {
  // fetch rejects with a TypeError when nothing answers; the loopback proxy answers 502/504.
  if (err instanceof TypeError) return true;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 500;
}

function DesktopGateInner() {
  const toast = useToast();
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const [handoff, setHandoff] = useState<WebHandoff | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const account = useRef<Account>("github");
  const pendingLink = useRef<TvashtrDeepLinkTarget | null>(null);
  // Set when this session signed in through the browser: the next "authed" says so in a toast.
  const justSignedIn = useRef<"browser" | "handoff" | null>(null);

  /** Signed out: Expired when someone signed in on this Mac before, else Welcome / Handoff. */
  const toSignedOut = useCallback(async (opts: { afterSignOut?: boolean } = {}) => {
    const ctx = await getLaunchContext();
    setHandoff(opts.afterSignOut ? null : ctx.openedFromWeb);
    if (!opts.afterSignOut && ctx.lastUser) {
      setState({ kind: "expired", lastLogin: ctx.lastUser.displayName || ctx.lastUser.login });
    } else {
      setState({ kind: "signed_out" });
    }
  }, []);

  const launch = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      // getConfig never throws (it falls back to self-hosted), so it can't mask a failed getMe.
      const [me, cfg] = await Promise.all([getMe(), getConfig()]);
      setConfig(cfg);
      if (me) {
        setState({ kind: "authed", user: me });
        return;
      }
      await toSignedOut();
    } catch (err) {
      if (isNetworkFailure(err)) setState({ kind: "offline" });
      else await toSignedOut();
    }
  }, [toSignedOut]);

  // Boot, and the 401 seam: a session that ends mid-use goes to Expired (or Welcome).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (stateRef.current.kind === "authed") void toSignedOut();
    });
    void launch();
    void getAppInfo().then((info) => {
      if (info?.apiOrigin) setStatusUrl(`${info.apiOrigin.replace(/\/$/, "")}/health`);
    });
    return () => setUnauthorizedHandler(null);
  }, [launch, toSignedOut]);

  // The browser sign-in's outcome (bridge v6).
  useEffect(
    () =>
      onSignIn((event) => {
        if (event.state === "signed_in") {
          justSignedIn.current = account.current === "current" ? "handoff" : "browser";
          void getMe()
            .then((me) => (me ? setState({ kind: "authed", user: me }) : toSignedOut()))
            .catch(() => setState({ kind: "offline" }));
        } else if (event.state === "failed") {
          const own = event.reason === "timeout" || event.reason === "cancelled";
          setState({ kind: "failed", reason: own ? null : event.message });
        }
      }),
    [toSignedOut],
  );

  // Deep links: open now when signed in, else after sign-in (DT-49).
  useEffect(() => {
    const nav = typeof window.tvashtrDesktop === "object" ? window.tvashtrDesktop.navigation : null;
    if (!nav?.onNavigate) return;
    return nav.onNavigate((target) => {
      if (stateRef.current.kind === "authed") window.location.hash = linkHash(target);
      else pendingLink.current = target;
    });
  }, []);

  const authedUser = state.kind === "authed" ? state.user : null;
  useEffect(() => {
    if (!authedUser) return;
    setDesktopTitle(TITLE_CANVAS);
    void rememberUser({
      login: authedUser.github_login || authedUser.display_name || authedUser.email,
      displayName: authedUser.display_name || authedUser.github_login || authedUser.email,
    });
    if (pendingLink.current) {
      window.location.hash = linkHash(pendingLink.current);
      pendingLink.current = null;
    }
    const how = justSignedIn.current;
    justSignedIn.current = null;
    if (how === "handoff") toast({ message: "Signed in from your browser", duration: 6000 });
    else if (how === "browser") {
      toast({ message: `Signed in as ${authedUser.display_name}`, duration: 6000 });
    }
  }, [authedUser, toast]);

  const copy = useCallback(
    async (url: string) => {
      try {
        await navigator.clipboard.writeText(url);
        toast({ message: "Sign-in link copied." });
      } catch {
        toast({ message: "Couldn't copy the link. Try again.", tone: "error" });
      }
    },
    [toast],
  );

  const signIn = useCallback(
    async (which: Account) => {
      account.current = which;
      if (!canSignInWithBrowser()) {
        // An older Tvashtr Desktop (bridge < 6): its in-window GitHub sign-in.
        if (config?.github_install_url) window.location.href = config.github_install_url;
        return;
      }
      setBusy(true);
      try {
        const res = await startSignIn({ account: which });
        if (res) setState({ kind: "waiting", signInUrl: res.signInUrl });
      } catch {
        toast({ message: "Couldn't open your browser. Try again.", tone: "error" });
      } finally {
        setBusy(false);
      }
    },
    [config, toast],
  );

  const copyFreshLink = useCallback(async () => {
    try {
      const res = await startSignIn({ account: account.current, openBrowser: false });
      if (res) await copy(res.signInUrl);
    } catch {
      toast({ message: "Couldn't make a sign-in link. Try again.", tone: "error" });
    }
  }, [copy, toast]);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      /* drop the local session view anyway */
    }
    await forgetUser();
    setHandoff(null);
    setState({ kind: "signed_out" });
  }, []);

  switch (state.kind) {
    case "checking":
      return <LaunchFrame width={440} label="Opening Tvashtr" />;
    case "offline":
      return <OfflinePage statusUrl={statusUrl} onRetry={() => void launch()} />;
    case "signed_out":
      return (
        <WelcomePage
          handoff={handoff}
          hosted={config?.hosted_mode ?? true}
          busy={busy}
          onSignIn={(which) => void signIn(which)}
          onAuthed={(user) => setState({ kind: "authed", user })}
        />
      );
    case "expired":
      return (
        <ExpiredPage
          lastLogin={state.lastLogin}
          busy={busy}
          onSignIn={() => void signIn("github")}
        />
      );
    case "waiting":
      return (
        <WaitingPage
          onReopen={() => void reopenBrowser()}
          onCopyLink={() => void copy(state.signInUrl)}
          onCancel={() => {
            void cancelSignIn();
            void toSignedOut();
          }}
        />
      );
    case "failed":
      return (
        <SignInFailedPage
          reason={state.reason}
          onTryAgain={() => void signIn(account.current)}
          onCopyLink={() => void copyFreshLink()}
        />
      );
    case "authed":
      // The per-session plan disclosure shows only once signed in, never over the launch screens
      // (it retires when the setup consent ships, DT-52).
      return (
        <>
          <Workspace user={state.user} config={config} onLogout={() => void signOut()} />
          <DesktopDisclosure />
        </>
      );
  }
}
