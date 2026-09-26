import { useEffect, useRef } from "react";

import { Button } from "../../design-system/components";
import type { ProbeFailure } from "../../lib/backendStatus";
import { thisComputer } from "../../lib/desktopApp";
import { ExternalLinkIcon, RefreshIcon, WifiOffIcon } from "./icons";
import { LaunchFrame } from "./LaunchFrame";
import { offlineDetail } from "./launchLines";

/**
 * DT-Offline — Tvashtr's server can't be reached, so the app can't open the user's teams (DT-14).
 * Try again reruns the launch check; the app also retries by itself when the OS says it is back
 * online. Check service status opens `<api origin>/health` in the browser (OQ-8).
 */
export function OfflinePage({
  failure,
  tries,
  apiHost,
  statusUrl,
  retrying = false,
  onRetry,
}: {
  failure: ProbeFailure;
  tries: number;
  apiHost: string | null;
  statusUrl: string | null;
  retrying?: boolean;
  onRetry: () => void;
}) {
  const retry = useRef(onRetry);
  retry.current = onRetry;
  useEffect(() => {
    const onOnline = () => retry.current();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

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
      <div className="dt-detail">{offlineDetail(failure, tries, apiHost)}</div>
    </LaunchFrame>
  );
}
