import { useEffect, useState } from "react";

import { Button } from "../../design-system/components";
import { countDesktopRunsGoing } from "../../lib/api/desktop";
import { openUpdateDownload, restartToUpdate, type UpdateState } from "../../lib/desktopApp";
import { RefreshIcon } from "./icons";
import { runsGoingLine } from "./launchLines";
import "./desktop.css";

type Shown = Extract<UpdateState, { state: "ready" | "manual" }>;

/**
 * The Shell's nav foot while an update is waiting (DT-43–46), in place of the section's foot.
 * `ready`: the new version is staged, Restart swaps it in (main shows Updating). `manual`: it can't
 * be swapped in place, so offer the stable DMG download and the one-line quarantine fix.
 */
export function UpdateCard({ update }: { update: Shown }) {
  const [runs, setRuns] = useState<number | null>(null);
  const ready = update.state === "ready";
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void countDesktopRunsGoing().then((n) => {
      if (alive) setRuns(n);
    });
    return () => {
      alive = false;
    };
  }, [ready, update.version]);

  if (ready) {
    return (
      <div className="dt-update">
        <b>Update ready · {update.version}</b>
        <span>Restarting stops running teams.{runs === null ? "" : ` ${runsGoingLine(runs)}`}</span>
        <Button variant="primary" size="sm" onClick={() => void restartToUpdate()}>
          <RefreshIcon />
          <span>Restart to update</span>
        </Button>
      </div>
    );
  }
  return (
    <div className="dt-update">
      <b>Update available · {update.version}</b>
      <span>Download it, quit Tvashtr, then drag the new Tvashtr to Applications.</span>
      <Button variant="primary" size="sm" onClick={() => void openUpdateDownload()}>
        Download update
      </Button>
      <span className="dt-update__fix">
        If macOS says Tvashtr is damaged, run:{" "}
        <code>xattr -dr com.apple.quarantine /Applications/Tvashtr.app</code>
      </span>
    </div>
  );
}
