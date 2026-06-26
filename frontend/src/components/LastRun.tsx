import { reviewerVerdictLabel } from "../lib/status";
import { titleCase } from "../lib/text";
import { formatRelativeTime } from "../lib/time";

/** One round of a node's run history — a structural subset of `NodeInvocation`. The run-view passes
 *  the node's full `invocations`; the authoring view passes a one-element list of the latest run. */
export interface LastRunRound {
  iteration: number;
  outcome: string | null;
  outcome_detail: string | null;
}

// Humanized labels for the per-round "Last run" outcomes. The reviewer outcomes (approved /
// changes_requested) MUST match `reviewerVerdictLabel`'s text so the §14.1 verdict view is byte-
// unchanged; the rest cover thinker/worker outcomes. Fallback = title-case the raw token.
const OUTCOME_LABELS: Record<string, string> = {
  prd_written: "Wrote the spec",
  built: "Built",
  approved: "Approved",
  changes_requested: "Changes requested",
  over_budget: "Over budget",
};

function outcomeLabel(outcome: string | null): string {
  if (outcome === null) return "—";
  return OUTCOME_LABELS[outcome] ?? titleCase(outcome);
}

/**
 * The shared per-node "Last run" brief (Option A / M2). A per-round list of the node's invocations,
 * each "Round {iteration} — {humanized outcome}" with the `outcome_detail` brief beneath. The tone
 * reuses `reviewerVerdictLabel`, and the reviewer labels match it, so the §14.1 verdict styling
 * holds.
 *
 * - The RUN-view `SidePanel` passes the node's full `invocations` and NO `provenance` — the render
 *   is byte-identical to the original local `LastRun` (its `SidePanel.test.tsx` is unchanged).
 * - The AUTHORING `TeamNodePanel` passes a one-element list of the node's latest run + `provenance`,
 *   which renders a muted relative-time tag ("ran 2h ago") beneath the brief.
 */
export function LastRun({
  rounds,
  provenance,
}: {
  rounds: LastRunRound[];
  provenance?: { startedAt: string; runId: string };
}) {
  if (rounds.length === 0) {
    return <p className="tv-panel-note">No run yet.</p>;
  }
  return (
    <>
      <ol className="tv-verdicts">
        {rounds.map((r) => {
          const tone = reviewerVerdictLabel(r.outcome).tone;
          return (
            <li key={r.iteration} className={`tv-verdict tv-verdict--${tone}`}>
              <div className="tv-verdict__line">
                <span className="tv-verdict__round">Round {r.iteration}</span>
                <span className="tv-verdict__label">{outcomeLabel(r.outcome)}</span>
              </div>
              {r.outcome_detail && <p className="tv-verdict__reasons">{r.outcome_detail}</p>}
            </li>
          );
        })}
      </ol>
      {provenance && (
        <p className="tv-lastrun__when" title={`run ${provenance.runId}`}>
          ran {formatRelativeTime(provenance.startedAt)}
        </p>
      )}
    </>
  );
}
