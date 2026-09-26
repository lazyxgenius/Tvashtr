import { Button } from "../../design-system/components";
import { GithubIcon } from "./icons";
import { LaunchFrame, LaunchMark } from "./LaunchFrame";

/**
 * DT-Expired — the session ended (a 401 at launch or mid-session) and someone signed in on this
 * Mac before (DT-11). Signing in again returns to the address the user was on.
 */
export function ExpiredPage({
  lastLogin,
  busy = false,
  onSignIn,
}: {
  lastLogin: string;
  busy?: boolean;
  onSignIn: () => void;
}) {
  return (
    <LaunchFrame width={560}>
      <LaunchMark />
      <h1 className="dt-h1 dt-h1--36">Sign in again to continue</h1>
      <p className="dt-para">
        Your session ended. Your teams and runs are safe; sign in to pick up where you left off.
      </p>
      <Button variant="primary" size="lg" disabled={busy} onClick={onSignIn}>
        <GithubIcon />
        <span>Sign in with GitHub</span>
      </Button>
      <div className="dt-hint">Last signed in as {lastLogin}</div>
    </LaunchFrame>
  );
}
