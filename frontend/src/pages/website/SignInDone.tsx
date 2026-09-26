/**
 * `#/signin/done` (website.md WEB-29; design WbF-Start-3): back from GitHub (or the self-hosted
 * form), tick what really happened, then go on to `next` or Home.
 *
 * - "Signed in as <login>" once `/api/auth/me` answers (the gate's own check); a 401 there goes to
 *   `#/signin?error=failed`.
 * - "Account ready" once Home's first reads (`/api/teams`, `/api/inbox`) come back.
 * - Shown for at least 400 ms so it never flashes; no wait beyond that.
 */
import { CircleCheck, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { type AuthUser, getTeams } from "../../lib/api";
import { getInbox } from "../../lib/api/home";
import { loginOf } from "../../lib/desktopApp";
import { navigate, parseRoute } from "../../lib/nav";
import { SignInLayout } from "./SignInPage";

const MIN_SHOWN_MS = 400;

export function SignInDone({
  user,
  next,
  hosted,
}: {
  /** undefined while the session check runs, null when it said 401. */
  user: AuthUser | null | undefined;
  next?: string;
  hosted: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);
  const signedIn = Boolean(user);

  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), MIN_SHOWN_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    // Home handles its own errors; answered at all means the account can be read.
    void Promise.allSettled([getTeams(), getInbox()]).then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [signedIn]);

  useEffect(() => {
    if (user === null) navigate({ page: "signin", error: "failed", next }, { replace: true });
    else if (user && ready && shown) navigate(parseRoute(`#${next ?? "/home"}`), { replace: true });
  }, [user, ready, shown, next]);

  return (
    <SignInLayout>
      <span className="web-signin__tile">
        <LoaderCircle size={22} strokeWidth={1.6} className="web-spin" aria-hidden />
      </span>
      <h1 className="web-signin__title">Signing you in…</h1>
      <p className="web-signin__lede">
        {hosted && "GitHub sent you back. "}Setting up your workspace; this takes a few seconds.
      </p>
      <div className="web-signin__steps" aria-live="polite">
        <Step done={signedIn}>
          {user ? `Signed in as ${loginOf(user)}` : "Checking your sign-in…"}
        </Step>
        <Step done={signedIn && ready}>
          {signedIn && ready ? "Account ready" : "Getting your account ready…"}
        </Step>
        <Step done={false}>{next ? "Taking you back…" : "Opening Home…"}</Step>
      </div>
    </SignInLayout>
  );
}

function Step({ done, children }: { done: boolean; children: string }) {
  const Icon = done ? CircleCheck : LoaderCircle;
  return (
    <span className={`web-signin__step${done ? " web-signin__step--done" : ""}`}>
      <Icon size={14} strokeWidth={1.6} className={done ? undefined : "web-spin"} aria-hidden />
      {children}
    </span>
  );
}
