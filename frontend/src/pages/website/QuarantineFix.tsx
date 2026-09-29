/**
 * The unsigned app's fix, shown wherever install steps show (session rule, website.md OQ-5; a
 * reported deviation from the design): macOS calls a downloaded, un-notarized app "damaged" and
 * right-click → Open doesn't get past that. One Terminal line does.
 */
import { Copy } from "lucide-react";

import { IconButton, useToast } from "../../design-system/components";
import { QUARANTINE_FIX } from "../../lib/desktopDownload";

export function QuarantineFix() {
  const toast = useToast();
  const copy = () => {
    void navigator.clipboard?.writeText(QUARANTINE_FIX).then(
      () => toast({ message: "Command copied" }),
      () => undefined,
    );
  };
  return (
    <div className="web-fix">
      If macOS says “Tvashtr is damaged and can’t be opened”, open Terminal, run this once, then
      open Tvashtr again:
      <div className="web-fix__cmd">
        <code>{QUARANTINE_FIX}</code>
        <IconButton size="sm" aria-label="Copy command" onClick={copy}>
          <Copy size={15} strokeWidth={1.6} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
