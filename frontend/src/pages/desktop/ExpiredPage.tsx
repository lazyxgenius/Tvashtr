import { Button } from "../../design-system/components";
import type { AuthUser } from "../../lib/api";
import { GithubIcon } from "./icons";
import { LaunchFrame, LaunchMark } from "./LaunchFrame";
import { EmailSignIn } from "./WelcomePage";

/**
 * DT-Expired — the session ended (a 401 at launch or mid-session) and someone signed in on this
 * Mac before (DT-11). Signing in again returns to the address the user was on. A self-hosted
 * backend (`hosted: false`) signs in again with email and password (OQ-37).
 */
export function ExpiredPage({
  lastLogin,
  hosted,
  busy = false,
  onSignIn,
  onAuthed,
}: {
  lastLogin: string;
  hosted: boolean;
  busy?: boolean;
  onSignIn: () => void;
  onAuthed: (user: AuthUser) => void;
}) {
  return (
    <LaunchFrame width={560}>
      <LaunchMark />
      <h1 className="dt-h1 dt-h1--36">Sign in again to continue</h1>
      <p className="dt-para">
        Your session ended. Your teams and runs are safe; sign in to pick up where you left off.
      </p>
      {hosted ? (
        <Button variant="primary" size="lg" disabled={busy} onClick={onSignIn}>
          <GithubIcon />
          <span>Sign in with GitHub</span>
        </Button>
      ) : (
        <EmailSignIn onAuthed={onAuthed} />
      )}
      <div className="dt-hint">Last signed in as {lastLogin}</div>
    </LaunchFrame>
  );
}
