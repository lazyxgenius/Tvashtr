import { ButtonLink } from "../design-system/components";
import type { ResolutionWarning } from "../lib/api";
import { connectorsHref } from "../panel/connectors/connectorFormat";
import "../panel/connectors/connectors.css";

// Warnings about a tool/skill source that FAILED to resolve at run time and was SKIPPED.
const LOAD_KINDS = new Set(["tool", "skill"]);
// A connector the run went on without (its sign-in expired, it was disconnected, …).
const CONNECTOR = "connector";

/**
 * M-tools C7.A (SHARED CONTRACT S1) — the run-inspector warning banner. Lists each tool/skill source
 * that FAILED to resolve at run time and was SKIPPED (the run continued). Renders nothing when there
 * are none, so a healthy run is visually unchanged. C7.B's skill warnings flow through the same
 * `run_warnings` recorder and appear here too.
 *
 * Other run notes share the same recorder (a document or output-format miss, or — revamp-e2e — the
 * spec taken from the PM's final message); they are listed in their own words, never counted as a
 * tool that "didn't load".
 *
 * A connector the run went on without reads "Ran without <name>: <reason>." and the banner offers
 * Open Connectors, where it is fixed (contract: Run time, Warnings).
 */
export function RunWarnings({ warnings }: { warnings: ResolutionWarning[] }) {
  if (!warnings || warnings.length === 0) return null;
  const loads = warnings.filter((w) => LOAD_KINDS.has(w.source_kind));
  const skipped = warnings.filter((w) => w.source_kind === CONNECTOR);
  const notes = warnings.filter(
    (w) => !LOAD_KINDS.has(w.source_kind) && w.source_kind !== CONNECTOR,
  );
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
      {skipped.length > 0 && (
        <>
          <ul className="tv-runwarn__list">
            {skipped.map((w, i) => (
              <li key={`${w.name}:${i}`}>
                ⚠ Ran without <b>{w.name}</b>: {w.reason}.
              </li>
            ))}
          </ul>
          <ButtonLink
            className="tv-runwarn__open"
            variant="secondary"
            size="sm"
            href={connectorsHref()}
          >
            Open Connectors
          </ButtonLink>
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
