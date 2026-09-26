import { Button } from "../../design-system/components";
import { CopyIcon, ExternalLinkIcon, SpinnerIcon } from "./icons";
import { LaunchFrame } from "./LaunchFrame";

/**
 * DT-Waiting — the app waits while the user finishes signing in in the default browser (DT-7).
 * The browser hands the result back through `tvashtr://auth/done`; the app then goes on by itself.
 */
export function WaitingPage({
  onReopen,
  onCopyLink,
  onCancel,
}: {
  onReopen: () => void;
  onCopyLink: () => void;
  onCancel: () => void;
}) {
  return (
    <LaunchFrame width={560}>
      <span className="dt-tile dt-tile--coral" role="status" aria-label="Waiting for your browser">
        <SpinnerIcon />
      </span>
      <h1 className="dt-h1 dt-h1--36">Finish signing in in your browser</h1>
      <p className="dt-para">
        We opened GitHub in your default browser. When you’re done there, you’ll come back here on
        your own.
      </p>
      <div className="dt-row">
        <Button variant="secondary" size="sm" onClick={onReopen}>
          <ExternalLinkIcon />
          <span>Open the browser again</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={onCopyLink}>
          <CopyIcon />
          <span>Copy the sign-in link</span>
        </Button>
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </LaunchFrame>
  );
}
