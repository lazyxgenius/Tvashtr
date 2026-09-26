import { type FormEvent, useState } from "react";

import { Avatar, Button, Input } from "../../design-system/components";
import { ApiError, type AuthUser, login, register } from "../../lib/api";
import { thisComputer } from "../../lib/desktopApp";
import { FolderIcon, GithubIcon, KeyIcon, PowerIcon } from "./icons";
import { LaunchFrame, LaunchMark } from "./LaunchFrame";

export interface WebHandoff {
  login: string;
  host: string;
}

/**
 * DT-Welcome — first launch, never signed in on this Mac — and its DT-Handoff variant, when the
 * app was opened from the website (a `from=web` link, DT-10). Sign in happens in the default
 * browser (DT-6); a self-hosted backend shows the email/password form instead (OQ-37).
 *
 * Honest copy (OQ-4): only steps on a Claude/Grok plan run on the Mac (API-key steps run on
 * Tvashtr's servers), so the lede and the third card say so.
 */
export function WelcomePage({
  handoff,
  hosted,
  busy = false,
  onSignIn,
  onAuthed,
}: {
  handoff: WebHandoff | null;
  hosted: boolean;
  busy?: boolean;
  onSignIn: (account: "current" | "github") => void;
  onAuthed: (user: AuthUser) => void;
}) {
  const where = thisComputer();
  return (
    <LaunchFrame width={820}>
      <LaunchMark />
      <h1 className="dt-h1 dt-h1--46">Welcome to Tvashtr</h1>
      <p className="dt-lede">
        This app runs your agents on {where} with your own Claude or Grok plan. Sign in to pick up
        your teams, or to start your first one.
      </p>
      {!hosted ? (
        <EmailSignIn onAuthed={onAuthed} />
      ) : handoff ? (
        <>
          <Button variant="primary" size="lg" disabled={busy} onClick={() => onSignIn("current")}>
            <Avatar name={handoff.login} size="sm" accent />
            <span>Continue as {handoff.login}</span>
          </Button>
          <div className="dt-handoff-note">
            You opened the app from {handoff.host}, where you’re signed in.{" "}
            <button
              type="button"
              className="dt-link"
              disabled={busy}
              onClick={() => onSignIn("github")}
            >
              Use a different account
            </button>
          </div>
        </>
      ) : (
        <>
          <Button variant="primary" size="lg" disabled={busy} onClick={() => onSignIn("github")}>
            <GithubIcon />
            <span>Sign in with GitHub</span>
          </Button>
          <div className="dt-help">
            Opens your browser. Use the same account as the website. New to Tvashtr? Signing in
            creates your account.
          </div>
        </>
      )}
      <div className="dt-cards">
        <ValueCard icon={<KeyIcon />} title="Your plan first">
          Uses the Claude or Grok plan you already pay for, through your own Claude Code or Grok.
        </ValueCard>
        <ValueCard icon={<FolderIcon />} title="Your folders and repos">
          Teams can work in a folder on {where} or on a GitHub repo.
        </ValueCard>
        <ValueCard icon={<PowerIcon />} title="Stops when you quit">
          Steps on your plan run on {where}. Quit the app and they stop.
        </ValueCard>
      </div>
    </LaunchFrame>
  );
}

function ValueCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="dt-card">
      <div className="dt-card__head">
        {icon}
        <span className="dt-card__title">{title}</span>
      </div>
      <span className="dt-card__body">{children}</span>
    </div>
  );
}

/** OQ-37: a self-hosted backend (`hosted_mode: false`) signs in with email and password. */
function EmailSignIn({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user =
        mode === "login" ? await login(email, password) : await register(email, password);
      onAuthed(user);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401) setError("Incorrect email or password.");
      else if (status === 409) setError("That email already has an account — sign in instead.");
      else if (status === 422)
        setError("Enter a valid email and a password of at least 8 characters.");
      else setError("Couldn't reach Tvashtr. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="dt-form" onSubmit={(e) => void submit(e)} aria-label="Sign in with email">
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(null);
        }}
        required
      />
      <Input
        label="Password"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setError(null);
        }}
        required
      />
      {error && (
        <div className="dt-form__error" role="alert">
          {error}
        </div>
      )}
      <Button type="submit" variant="primary" size="lg" loading={busy} fullWidth>
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
      <div className="dt-handoff-note">
        {mode === "login" ? "New to Tvashtr? " : "Have an account? "}
        <button
          type="button"
          className="dt-link"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "Create an account" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
