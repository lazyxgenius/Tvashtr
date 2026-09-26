import { Button } from "../../design-system/components";
import { thisComputer } from "../../lib/desktopApp";
import { ExternalLinkIcon, RefreshIcon, WifiOffIcon } from "./icons";
import { LaunchFrame } from "./LaunchFrame";

/**
 * DT-Offline — Tvashtr's server can't be reached, so the app can't open the user's teams (DT-14).
 * Check service status opens `<api origin>/health` in the browser (OQ-8). `detail` is the mono
 * line "<api host> · <reason> · tried 3 times" once the launch probe knows it.
 */
export function OfflinePage({
  statusUrl,
  detail,
  retrying = false,
  onRetry,
}: {
  statusUrl: string | null;
  detail?: string | null;
  retrying?: boolean;
  onRetry: () => void;
}) {
  return (
    <LaunchFrame width={560}>
      <span className="dt-tile dt-tile--panel">
        <WifiOffIcon />
      </span>
      <h1 className="dt-h1 dt-h1--36">Can’t reach Tvashtr</h1>
      <p className="dt-para dt-para--500">
        Your teams, runs and documents are stored on Tvashtr’s servers, so the app needs a
        connection to open them. Nothing on {thisComputer()} was changed.
      </p>
      <div className="dt-row">
        <Button variant="primary" size="md" loading={retrying} onClick={onRetry}>
          <RefreshIcon />
          <span>Try again</span>
        </Button>
        {statusUrl && (
          <Button
            variant="ghost"
            size="md"
            onClick={() => window.open(statusUrl, "_blank", "noopener,noreferrer")}
          >
            <ExternalLinkIcon />
            <span>Check service status</span>
          </Button>
        )}
      </div>
      {detail && <div className="dt-detail">{detail}</div>}
    </LaunchFrame>
  );
}
