import { History } from "lucide-react";

/** M5 — the version a run used, in blue (Ver-RunTag / Ver-RunBar / Ver-HomeRuns): "v7". */
export function VersionTag({ number }: { number: number }) {
  return (
    <span className="tv-vtag" title={`Ran on version ${number} of the team`}>
      <History size={12} strokeWidth={2} aria-hidden />v{number}
    </span>
  );
}
