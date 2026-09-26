import type { ResolutionWarning } from "../lib/api";

// Warnings about a tool/skill source that FAILED to resolve at run time and was SKIPPED.
const LOAD_KINDS = new Set(["tool", "skill"]);

/**
 * M-tools C7.A (SHARED CONTRACT S1) — the run-inspector warning banner. Lists each tool/skill source
 * that FAILED to resolve at run time and was SKIPPED (the run continued). Renders nothing when there
 * are none, so a healthy run is visually unchanged. C7.B's skill warnings flow through the same
 * `run_warnings` recorder and appear here too.
 *
 * Other run notes share the same recorder (a document or output-format miss, or — revamp-e2e — the
 * spec taken from the PM's final message); they are listed in their own words, never counted as a
 * tool that "didn't load".
 */
export function RunWarnings({ warnings }: { warnings: ResolutionWarning[] }) {
  if (!warnings || warnings.length === 0) return null;
  const loads = warnings.filter((w) => LOAD_KINDS.has(w.source_kind));
  const notes = warnings.filter((w) => !LOAD_KINDS.has(w.source_kind));
  const n = loads.length;
  return (
    <div className="tv-runwarn" role="status" aria-label="Resolution warnings">
      {n > 0 && (
        <>
          <span className="tv-runwarn__lead">
            ⚠ {n} tool{n === 1 ? "" : "s"}/skill{n === 1 ? "" : "s"} didn&rsquo;t load
          </span>
          <ul className="tv-runwarn__list">
            {loads.map((w, i) => (
              <li key={`${w.source_kind}:${w.name}:${i}`}>
                <code>{w.name}</code> — {w.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      {notes.length > 0 && (
        <ul className="tv-runwarn__list">
          {notes.map((w, i) => (
            <li key={`${w.source_kind}:${w.name}:${i}`}>
              ⚠{" "}
              {w.source_kind !== "spec" && (
                <>
                  <code>{w.name}</code> —{" "}
                </>
              )}
              <span>{w.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
