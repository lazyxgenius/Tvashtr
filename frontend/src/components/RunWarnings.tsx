import type { ResolutionWarning } from "../lib/api";

/**
 * M-tools C7.A (SHARED CONTRACT S1) — the run-inspector warning banner. Lists each tool/skill source
 * that FAILED to resolve at run time and was SKIPPED (the run continued). Renders nothing when there
 * are none, so a healthy run is visually unchanged. C7.B's skill warnings flow through the same
 * `run_warnings` recorder and appear here too.
 */
export function RunWarnings({ warnings }: { warnings: ResolutionWarning[] }) {
  if (!warnings || warnings.length === 0) return null;
  const n = warnings.length;
  return (
    <div className="tv-runwarn" role="status" aria-label="Resolution warnings">
      <span className="tv-runwarn__lead">
        ⚠ {n} tool{n === 1 ? "" : "s"}/skill{n === 1 ? "" : "s"} didn&rsquo;t load
      </span>
      <ul className="tv-runwarn__list">
        {warnings.map((w, i) => (
          <li key={`${w.source_kind}:${w.name}:${i}`}>
            <code>{w.name}</code> — {w.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
