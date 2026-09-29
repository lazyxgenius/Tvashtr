import { Button } from "../../design-system/components";
import { CopyIcon, RefreshIcon, WarningIcon } from "./icons";
import { LaunchFrame } from "./LaunchFrame";

/** The design's paragraph covers a timeout and a cancel on GitHub (DT-9). */
const DEFAULT_REASON =
  "The browser didn’t send you back within 10 minutes, or you cancelled on GitHub. Nothing was changed.";

/**
 * DtF-Sign-2 — sign-in didn't finish (DT-9): no answer within 10 minutes, or cancelled on GitHub.
 * Try again starts a fresh browser sign-in; Copy the sign-in link makes a fresh link without
 * opening the browser, for a browser on another computer.
 */
export function SignInFailedPage({
  reason,
  onTryAgain,
  onCopyLink,
}: {
  /** Another reason in the server's own words (an expired or refused code); else the design's. */
  reason?: string | null;
  onTryAgain: () => void;
  onCopyLink: () => void;
}) {
  return (
    <LaunchFrame width={560}>
      <span className="dt-tile dt-tile--amber">
        <WarningIcon />
      </span>
      <h1 className="dt-h1 dt-h1--36">Sign-in didn’t finish</h1>
      <p className="dt-para">{reason ?? DEFAULT_REASON}</p>
      <div className="dt-row">
        <Button variant="primary" size="md" onClick={onTryAgain}>
          <RefreshIcon />
          <span>Try again</span>
        </Button>
        <Button variant="ghost" size="md" onClick={onCopyLink}>
          <CopyIcon />
          <span>Copy the sign-in link</span>
        </Button>
      </div>
      <div className="dt-hint">
        Browser opened on another computer? Copy the link and open it here instead.
      </div>
    </LaunchFrame>
  );
}
