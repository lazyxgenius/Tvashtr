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
import { countDesktopRunsGoing } from "../../lib/api/desktop";
import { listTeams } from "../../lib/api/teams";
import {
  failureForStatus,
  type ProbeFailure,
  PROBE_TRIES,
  probeBackendWithRetries,
} from "../../lib/backendStatus";
import {
  canSignInWithBrowser,
  cancelSignIn,
  forgetUser,
  getAppInfo,
  getLaunchContext,
  getPlanStatuses,
  getUpdateState,
  loginOf,
  onSignIn,
  onUpdateState,
  rememberUser,
  reopenBrowser,
  setDesktopTitle,
  startSignIn,
  TITLE_CANVAS,
  TITLE_LAUNCH,
  type UpdateState,
} from "../../lib/desktopApp";
import { loadDesktopSetup, resetDesktopSetup } from "../../lib/desktopSetup";
import { useNav } from "../../lib/nav";
import { Workspace } from "../Workspace";
import { ExpiredPage } from "./ExpiredPage";
import { type LaunchProgress, reconnectedLines, splashLines, updatingLines } from "./launchLines";
import { LaunchStatusPage } from "./LaunchStatusPage";
import { OfflinePage } from "./OfflinePage";
import { SignInFailedPage } from "./SignInFailedPage";
import { WaitingPage } from "./WaitingPage";
import { type WebHandoff, WelcomePage } from "./WelcomePage";

type Account = "current" | "github";

export type GateState =
  /** The launch check (DT-2): Splash, or Reconnected after Offline's retry worked (DT-15). */
  | { kind: "launching"; progress: LaunchProgress }
  | { kind: "offline"; failure: ProbeFailure; tries: number }
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
 * Launch order (DT-2): the splash checks /health (10 s per try, 3 tries, 1 s then 2 s apart; all
 * failing → Offline), then the session (401 → Expired / Welcome), then the plans on this Mac and
 * the teams; its checklist ticks as each answer arrives.
 *
 * Signed in, and this Mac's setup for the account not finished (DT-2 step 3, DT-17): the
 * Workspace sits on `#/setup/<saved step>`; toasts there sit above the setup footer (OQ-32).
 *
 * Deep links (DB-8): the root subscribes once to `navigation.onNavigate`; a link that arrives
 * while signed out is kept and opened after sign-in (after setup, OQ-34).
 */
export function DesktopGate() {
  const { route } = useNav();
  return (
    <ToastProvider placement={route.page === "setup" ? "setup" : "center"}>
      <DesktopGateInner onSetup={route.page === "setup"} />
    </ToastProvider>
  );
}

function linkHash(target: TvashtrDeepLinkTarget): string {
  const connect = target.params?.connect;
  return `#${target.path}${connect ? `?connect=${encodeURIComponent(connect)}` : ""}`;
}

/** A session check that failed for want of a server (not a 401) → why, for the Offline screen. */
function networkFailure(err: unknown): ProbeFailure | null {
  // fetch rejects with a TypeError when nothing answers; the loopback proxy answers 502/504.
  if (err instanceof TypeError) return { kind: "unreachable" };
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 500 ? failureForStatus(status) : null;
}

function DesktopGateInner({ onSetup }: { onSetup: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<GateState>({
    kind: "launching",
    progress: { mode: "splash", me: null, plans: null },
  });
  const [handoff, setHandoff] = useState<WebHandoff | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [api, setApi] = useState<{ host: string; statusUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({ state: "idle" });
  const [runsGoing, setRunsGoing] = useState<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const account = useRef<Account>("github");
  const pendingLink = useRef<TvashtrDeepLinkTarget | null>(null);
  // Set when this session signed in through the browser: the next "authed" says so in a toast.
  const justSignedIn = useRef<"browser" | "handoff" | null>(null);
  // The address the user was on when the session ended (DT-11): restored after signing in again.
  const returnTo = useRef<string | null>(null);
  // Each launch check bumps this; an older one that is still waiting then drops its answers.
  const launchEpoch = useRef(0);

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

  const setProgress = useCallback((patch: Partial<LaunchProgress>) => {
    setState((s) =>
      s.kind === "launching" ? { kind: "launching", progress: { ...s.progress, ...patch } } : s,
    );
  }, []);

  /**
   * DT-2. `splash` is a normal launch; `reconnected` is Offline's Try again (or the OS coming back
   * online): Offline stays up, busy, while /health is asked again, then Reconnected (DT-15).
   */
  const launch = useCallback(
    async (mode: LaunchProgress["mode"]) => {
      const epoch = ++launchEpoch.current;
      const stale = () => epoch !== launchEpoch.current;
      const progress: LaunchProgress = { mode, me: null, plans: null };
      if (mode === "splash") setState({ kind: "launching", progress });
      else setRetrying(true);
      const health = await probeBackendWithRetries(stale);
      if (stale()) return;
      setRetrying(false);
      if (!health.ok) {
        setState({ kind: "offline", failure: health, tries: PROBE_TRIES });
        return;
      }
      if (mode === "reconnected") setState({ kind: "launching", progress });

      let me: AuthUser | null;
      try {
        // getConfig never throws (it falls back to self-hosted), so it can't mask a failed getMe.
        const [who, cfg] = await Promise.all([getMe(), getConfig()]);
        me = who;
        setConfig(cfg);
      } catch (err) {
        if (stale()) return;
        const failure = networkFailure(err);
        if (failure) setState({ kind: "offline", failure, tries: 1 });
        else await toSignedOut();
        return;
      }
      if (stale()) return;
      if (!me) {
        await toSignedOut();
        return;
      }
      const user = me;
      setProgress({ me: user });
      // The plan lines are the splash's alone; they never hold the launch up (DT-13).
      if (mode === "splash") {
        void getPlanStatuses().then((plans) => {
          if (!stale()) setProgress({ plans });
        });
      }
      // Setup on this Mac not finished for this account → setup at its saved step (DT-2 step 3).
      const setup = await loadDesktopSetup(user.id);
      if (stale()) return;
      if (setup && setup.finishedAt === null) {
        setState({ kind: "authed", user });
        return;
      }
      await listTeams().catch(() => undefined);
      if (stale()) return;
      setState({ kind: "authed", user });
    },
    [setProgress, toSignedOut],
  );

  const retry = useCallback(() => {
    if (!retrying) void launch("reconnected");
  }, [launch, retrying]);

  // Boot, and the 401 seam: a session that ends mid-use goes to Expired (or Welcome).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (stateRef.current.kind !== "authed") return;
      returnTo.current = window.location.hash;
      resetDesktopSetup();
      void toSignedOut();
    });
    void launch("splash");
    void getAppInfo().then((info) => {
      if (info?.apiOrigin) {
        setApi({
          host: info.apiHost || new URL(info.apiOrigin).host,
          statusUrl: `${info.apiOrigin.replace(/\/$/, "")}/health`,
        });
      }
    });
    return () => {
      setUnauthorizedHandler(null);
      launchEpoch.current += 1;
    };
  }, [launch, toSignedOut]);

  // The updater (DB-6): while it installs, the window shows Updating (DtF-Upd-2).
  useEffect(() => {
    let alive = true;
    void getUpdateState().then((s) => {
      if (alive) setUpdate((prev) => (prev.state === "idle" ? s : prev));
    });
    const unsubscribe = onUpdateState(setUpdate);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  const installing = update.state === "installing";
  const signedIn = state.kind === "authed";
  useEffect(() => {
    if (!installing || !signedIn) return;
    let alive = true;
    void countDesktopRunsGoing().then((n) => {
      if (alive) setRunsGoing(n);
    });
    return () => {
      alive = false;
    };
  }, [installing, signedIn]);

  // The browser sign-in's outcome (bridge v6).
  useEffect(
    () =>
      onSignIn((event) => {
        if (event.state === "signed_in") {
          justSignedIn.current = account.current === "current" ? "handoff" : "browser";
          void getMe()
            .then((me) => (me ? setState({ kind: "authed", user: me }) : toSignedOut()))
            .catch((err: unknown) =>
              setState({
                kind: "offline",
                failure: networkFailure(err) ?? { kind: "unreachable" },
                tries: 1,
              }),
            );
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
  // The shell's title (DT-3); setup and the Updating screen keep the launch title "Tvashtr".
  useEffect(() => {
    if (authedUser && !installing) setDesktopTitle(onSetup ? TITLE_LAUNCH : TITLE_CANVAS);
  }, [authedUser, installing, onSetup]);
  useEffect(() => {
    if (!authedUser) return;
    void rememberUser({
      login: authedUser.github_login || authedUser.display_name || authedUser.email,
      displayName: authedUser.display_name || authedUser.github_login || authedUser.email,
    });
    // Back to where the session ended (DT-11), unless a deep link asked for somewhere else.
    if (returnTo.current && window.location.hash !== returnTo.current) {
      window.location.hash = returnTo.current;
    }
    returnTo.current = null;
    if (pendingLink.current) {
      window.location.hash = linkHash(pendingLink.current);
      pendingLink.current = null;
    }
    const how = justSignedIn.current;
    justSignedIn.current = null;
    if (how === "handoff") toast({ message: "Signed in from your browser", duration: 6000 });
    else if (how === "browser") {
      toast({ message: `Signed in as ${loginOf(authedUser)}`, duration: 6000 });
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
    resetDesktopSetup();
    returnTo.current = null;
    setHandoff(null);
    setState({ kind: "signed_out" });
  }, []);

  if (update.state === "installing") {
    return (
      <LaunchStatusPage
        title="Updating Tvashtr…"
        lines={updatingLines(update.version, runsGoing)}
      />
    );
  }

  switch (state.kind) {
    case "launching":
      return state.progress.mode === "splash" ? (
        <LaunchStatusPage title="Opening your workspace…" lines={splashLines(state.progress)} />
      ) : (
        <LaunchStatusPage title="Reconnected" lines={reconnectedLines(state.progress)} />
      );
    case "offline":
      return (
        <OfflinePage
          failure={state.failure}
          tries={state.tries}
          apiHost={api?.host ?? null}
          statusUrl={api?.statusUrl ?? null}
          retrying={retrying}
          onRetry={retry}
        />
      );
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
      // The per-session plan disclosure retired with the setup consent (DT-52): the consent lives
      // on the Engines step, the disclosure on Engines › Subscriptions.
      return <Workspace user={state.user} config={config} onLogout={() => void signOut()} />;
  }
}
