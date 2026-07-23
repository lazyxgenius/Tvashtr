import type { ContextManifest, InvocationCost } from "../lib/api";
import { reviewerVerdictLabel } from "../lib/status";
import { titleCase } from "../lib/text";
import { formatRelativeTime } from "../lib/time";
import { ContextManifest as ContextManifestTable } from "../panel/ContextManifest";

/** One round of a node's run history — a structural subset of `NodeInvocation`. The run-view passes
 *  the node's full `invocations`; the authoring view passes a one-element list of the latest run. */
export interface LastRunRound {
  iteration: number;
  outcome: string | null;
  outcome_detail: string | null;
  // M-legible (run-view only, optional + additive): the invocation's status. When "failed" the round
  // reads "Failed" in the danger tone instead of the em dash `outcomeLabel(null)` gives it. The
  // RUN-view caller passes `NodeInvocation` (which already carries `status`); the AUTHORING caller
  // omits it, so its em dash is unchanged (extending that contract is out of scope).
  status?: string;
  // M-ledger C6 (optional): the round's token/$ cost + context-budget snapshot. The RUN-view passes
  // the node's `invocations` (which carry both from the /graph contract); the AUTHORING caller
  // passes NEITHER, so its render stays byte-identical. Present ⇒ a cost line / the manifest table.
  cost?: InvocationCost | null;
  context_manifest?: ContextManifest | null;
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

// M-ledger C6: the one-line per-round cost — e.g. "1,240 in / 320 out · $0.0041".
function costSummary(cost: InvocationCost): string {
  return `${cost.prompt_tokens.toLocaleString()} in / ${cost.completion_tokens.toLocaleString()} out · $${cost.cost_usd.toFixed(4)}`;
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
          // M-legible: a failed invocation has no `outcome`, so `outcomeLabel(null)` would render "—"
          // in a neutral tone — a node that DIED reading as an unremarkable round. Surface it as
          // failed (its reason already renders beneath via `outcome_detail`).
          const failed = r.status === "failed";
          const tone = failed ? "failed" : reviewerVerdictLabel(r.outcome).tone;
          const label = failed ? "Failed" : outcomeLabel(r.outcome);
          return (
            <li key={r.iteration} className={`tv-verdict tv-verdict--${tone}`}>
              <div className="tv-verdict__line">
                <span className="tv-verdict__round">Round {r.iteration}</span>
                <span className="tv-verdict__label">{label}</span>
              </div>
              {r.outcome_detail && <p className="tv-verdict__reasons">{r.outcome_detail}</p>}
              {r.cost && <p className="tv-verdict__cost">{costSummary(r.cost)}</p>}
              {r.context_manifest && <ContextManifestTable manifest={r.context_manifest} />}
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
