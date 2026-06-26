import { type ReactNode } from "react";
import { X } from "lucide-react";

import type { GraphNode, NodeInvocation, RunRow } from "../lib/api";
import { isPrdEditable, reviewerVerdictLabel, WORKFLOW_FAILED } from "../lib/status";
import { EventFeed } from "./EventFeed";
import { PrdView } from "./PrdView";

/** The thinker's placeholder copy when there is no spec document yet — derived from run-level
 *  signals directly (this panel stays run-level; it never receives the graph's documents). The
 *  copy is generic enough for any thinker (every thinker refines the SAME shared spec). */
function specEmptyHint(
  runId: string | null,
  run: RunRow | null,
  workflowStatus: string | null,
): string {
  if (!runId || !run)
    return "No spec yet. Start a run and the product manager drafts the first one.";
  const failed = run.status === "failed" || WORKFLOW_FAILED.has(workflowStatus ?? "");
  if (failed && !run.pm_document_id)
    return "The product manager didn't finish the spec for this run.";
  return "The product manager is drafting the spec…";
}

// Nice titles for the seeded roles; a custom/authored node falls back to a title-cased role name
// (a topology-edited team can name a node anything — e.g. "architect").
const ROLE_TITLES: Record<string, { title: string; subtitle: string }> = {
  pm: { title: "Product manager", subtitle: "The spec it wrote" },
  engineer: { title: "Engineer", subtitle: "What it did, step by step" },
  reviewer: { title: "Reviewer", subtitle: "How it judged the work" },
};

/** Humanize a raw role/outcome token (`changes_requested` -> "Changes requested"). */
function titleCase(raw: string): string {
  const spaced = raw.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : raw;
}

function nodeTitle(node: GraphNode): { title: string; subtitle: string } {
  return ROLE_TITLES[node.role_name] ?? { title: titleCase(node.role_name), subtitle: "Details" };
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
 * The generalized "Last run" section (Option A): a per-round list of the node's invocations, each
 * "Round {iteration} — {humanized outcome}" with the `outcome_detail` brief beneath when present.
 * Works for ANY agent/thinker node. The tone reuses `reviewerVerdictLabel`, and the reviewer
 * outcome labels match it too, so the Reviewer's `tv-verdict--*` styling + the §14.1 per-round
 * verdict history render byte-identical to before — now just one node kind among many.
 */
function LastRun({ rounds }: { rounds: NodeInvocation[] }) {
  if (rounds.length === 0) {
    return <p className="tv-panel-note">No run yet.</p>;
  }
  return (
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
  );
}

/**
 * The right-hand run-view inspection panel. Selected by NODE ID (Option A), it switches the body on
 * the node's `kind`, not a hardcoded role: every agent/thinker node gets a uniform "Last run" brief
 * (its per-round `outcome_detail`) atop a kind-specific body — a thinker (`completion`) shows the
 * shared spec (`PrdView`, live-editable while in-flight, P1.7b); a worker (`agent`, incl. the
 * Reviewer) shows the step-by-step feed. Gates/terminals never open this panel (the canvas only
 * selects agent/completion nodes). The whole `GraphNode` is passed in — the panel reads its
 * `invocations` (already in the run-graph payload) so it stays a thin render of backend truth.
 */
export function SidePanel({
  node,
  runId,
  run,
  workflowStatus,
  onClose,
}: {
  node: GraphNode;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
  onClose: () => void;
}) {
  const { title, subtitle } = nodeTitle(node);

  // The kind-specific body beneath the brief. A thinker refines the SAME shared spec (every thinker
  // writes versions of `run.pm_document_id`), so `PrdView` is correct for ANY thinker, not just the
  // PM; editability is run-status-based (P1.7b), never role-based.
  let body: ReactNode;
  if (node.kind === "completion") {
    body = (
      <PrdView
        documentId={run?.pm_document_id ?? null}
        emptyHint={specEmptyHint(runId, run, workflowStatus)}
        editable={isPrdEditable(run?.status ?? null, workflowStatus)}
      />
    );
  } else {
    // kind === "agent" (worker, incl. the Reviewer): the agent's action/observation feed.
    body = <EventFeed runId={runId} run={run} workflowStatus={workflowStatus} />;
  }

  return (
    <aside className="tv-panel" aria-label={`${title} details`}>
      <header className="tv-panel__head">
        <div>
          <div className="tv-panel__title">{title}</div>
          <div className="tv-panel__subtitle">{subtitle}</div>
        </div>
        <button
          type="button"
          className="tv-panel__close"
          onClick={onClose}
          aria-label="Close panel"
          title="Close"
        >
          <X size={18} strokeWidth={1.7} />
        </button>
      </header>

      <div className="tv-panel__body">
        <section className="tv-lastrun" aria-label="Last run">
          <div className="tv-lastrun__head">Last run</div>
          <LastRun rounds={node.invocations} />
        </section>
        {body}
      </div>
    </aside>
  );
}
