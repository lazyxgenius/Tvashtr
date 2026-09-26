/**
 * Sign in (website.md WEB-26..28, WEB-30; design Web-SignIn, WbF-Start-2, WbF-Err-1).
 *
 * - Hosted: one door, **Continue with GitHub** — a plain GET form to `/api/auth/github/start`
 *   (carrying `next`), which sets the state cookie and sends the browser to GitHub. The button
 *   stays loading until the page unloads.
 * - Self-hosted (local dev, every e2e run): email + password in the same layout (WEB-28, not
 *   designed), straight on to `#/signin/done`.
 * - `?error=cancelled|failed|expired` (the callback's answers, or `#/signin/done`'s 401): what
 *   happened and **Try again**.
 */
import { Check, RefreshCw, TriangleAlert } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { Button, Input, Logo } from "../../design-system/components";
import { ApiError, type AuthUser, type Config, login, register } from "../../lib/api";
import { SIGNIN_HELP_URL } from "../../lib/desktopDownload";
import { type SignInError, navigate } from "../../lib/nav";
import { GithubIcon } from "../desktop/icons";
import { TeamCanvasMock } from "./mocks";

/** The two-column frame every sign-in screen shares (WEB-26). */
export function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <div className="web-page web-signin">
      <div className="web-signin__brand">
        <Logo size={26} />
        <div className="web-signin__pitch">
          <div className="web-signin__line">
            Your team. Your process. A reviewed pull request at the end.
          </div>
          <div className="web-signin__mock">
            <TeamCanvasMock />
          </div>
        </div>
        <a className="web-signin__back" href="#/welcome">
          ← Back to the website
        </a>
      </div>
      <main className="web-signin__side">
        <div className="web-signin__col">{children}</div>
      </main>
    </div>
  );
}

export function SignInPage({
  error,
  next,
  config,
  onAuthed,
}: {
  error?: SignInError;
  next?: string;
  /** null until `/api/config` answers (it always does, falling back to self-hosted). */
  config: Config | null;
  onAuthed: (user: AuthUser) => void;
}) {
  let body: ReactNode = null;
  if (config && error) body = <Failed error={error} next={next} hosted={config.hosted_mode} />;
  else if (config?.hosted_mode) body = <GithubDoor next={next} />;
  else if (config) body = <PasswordDoor next={next} onAuthed={onAuthed} />;
  return <SignInLayout>{body}</SignInLayout>;
}

function GithubDoor({ next }: { next?: string }) {
  return (
    <>
      <h1 className="web-signin__title">Sign in to Tvashtr</h1>
      <p className="web-signin__lede">
        Use your GitHub account. It’s how Tvashtr opens pull requests on your repos.
      </p>
      <GithubStart next={next} icon={<GithubIcon size={17} />} label="Continue with GitHub" />
      <div className="web-signin__card">
        <span>
          <Check size={14} strokeWidth={2} aria-hidden />
          New here? Signing in creates your account.
        </span>
        <span>
          <Check size={14} strokeWidth={2} aria-hidden />
          You choose which repos Tvashtr can use later, not now.
        </span>
      </div>
      {/* Desktop signs in with GitHub itself, not through this page (desktop-app.md §6, OQ-18). */}
      <div className="web-signin__foot">
        Using the Mac app? Sign in from the app with the same GitHub account.
      </div>
    </>
  );
}

/** Off to GitHub through the server, which remembers `next` in the state cookie (B-2). */
function GithubStart({ next, icon, label }: { next?: string; icon: ReactNode; label: string }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    // Back from GitHub with the Back button, the page may come from the bfcache: not leaving.
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  return (
    <form method="get" action="/api/auth/github/start" onSubmit={() => setLeaving(true)}>
      {next && <input type="hidden" name="next" value={next} />}
      <Button type="submit" variant="primary" size="lg" fullWidth loading={leaving}>
        {!leaving && icon}
        <span>{label}</span>
      </Button>
    </form>
  );
}

const ERROR_COPY: Record<SignInError, string> = {
  cancelled: "GitHub said the request was cancelled. Nothing was changed. You can try again.",
  failed: "GitHub didn’t complete the sign-in. Nothing was changed. You can try again.",
  expired:
    "That sign-in took too long or was started in another tab. Nothing was changed. You can try again.",
};

function Failed({ error, next, hosted }: { error: SignInError; next?: string; hosted: boolean }) {
  const icon = <RefreshCw size={15} strokeWidth={1.6} aria-hidden />;
  return (
    <>
      <span className="web-signin__tile web-signin__tile--warn">
        <TriangleAlert size={22} strokeWidth={1.6} aria-hidden />
      </span>
      <h1 className="web-signin__title">Sign-in didn’t finish</h1>
      <p className="web-signin__lede">
        {/* Self-hosted never meets GitHub; its only error is a session that didn't stick. */}
        {hosted
          ? ERROR_COPY[error]
          : "The sign-in didn’t complete. Nothing was changed. You can try again."}
      </p>
      {hosted ? (
        <GithubStart next={next} icon={icon} label="Try again" />
      ) : (
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => navigate({ page: "signin", next }, { replace: true })}
        >
          {icon}
          <span>Try again</span>
        </Button>
      )}
      {/* OQ-15: sign-in is a redirect, not a pop-up; blocked cookies are what break it. */}
      <div className="web-signin__foot">
        Still stuck? Check that cookies aren’t blocked, or{" "}
        <a href={SIGNIN_HELP_URL} target="_blank" rel="noopener noreferrer">
          read the sign-in help
        </a>
        .
      </div>
    </>
  );
}

/** WEB-28: email + password, for self-hosted servers (not designed; no parity gate). */
function PasswordDoor({ next, onAuthed }: { next?: string; onAuthed: (user: AuthUser) => void }) {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = signup ? await register(email, password) : await login(email, password);
      // Route first, then the session: SiteRoot sends a signed-in #/signin straight on.
      navigate({ page: "signin", done: true, next }, { replace: true });
      onAuthed(user);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401) setError("Incorrect email or password.");
      else if (status === 409) setError("That email already has an account — try logging in.");
      else if (status === 422)
        setError("Enter a valid email and a password of at least 8 characters.");
      else setError("Something went wrong. Is the backend running?");
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="web-signin__title">Sign in to Tvashtr</h1>
      <form className="web-signin__form" onSubmit={(e) => void submit(e)}>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="web-signin__error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
          {signup ? "Create account" : "Sign in"}
        </Button>
      </form>
      <p className="web-signin__toggle">
        {signup ? "Already have an account? " : "New here? "}
        <button
          type="button"
          onClick={() => {
            setSignup(!signup);
            setError(null);
          }}
        >
          {signup ? "Sign in" : "Create an account"}
        </button>
      </p>
    </>
  );
}
