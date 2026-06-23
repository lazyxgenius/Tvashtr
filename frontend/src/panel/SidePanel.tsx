import { type ReactNode } from "react";
import { X } from "lucide-react";

import type { NodeInvocation, RunRow } from "../lib/api";
import { reviewerVerdictLabel, WORKFLOW_FAILED } from "../lib/status";
import { EventFeed } from "./EventFeed";
import { PrdView } from "./PrdView";

/** The PM's placeholder copy when there is no document yet — derived from run-level
 *  signals directly (this panel stays run-level; it never receives the graph). */
function pmEmptyHint(
  runId: string | null,
  run: RunRow | null,
  workflowStatus: string | null,
): string {
  if (!runId || !run) return "No spec yet. Start a run and the product manager drafts the first one.";
  const failed = run.status === "failed" || WORKFLOW_FAILED.has(workflowStatus ?? "");
  if (failed && !run.pm_document_id) return "The product manager didn't finish the spec for this run.";
  return "The product manager is drafting the spec…";
}

/**
 * The reviewer view (P1.5c §14.1): the role explanation plus the per-round verdict
 * history, read from the reviewer node's persisted `AgentInvocation.outcome` rows
 * ("Round 1 — Changes requested", "Round 2 — Approved"). `rounds` is the reviewer
 * node's invocations, ascending by iteration ([] before the reviewer is reached).
 * Only the verdict LABEL is surfaced today; the reasons ("why B sent it back") need a
 * new column and arrive with the §14.2 A/B work.
 */
function ReviewerView({ rounds }: { rounds: NodeInvocation[] }) {
  return (
    <div className="tv-scroll">
      <p className="tv-panel-note">
        The reviewer reads the engineer's work against the spec, then either approves it or sends it
        back for another round of changes.
      </p>
      {rounds.length === 0 ? (
        <p className="tv-panel-note">No review yet.</p>
      ) : (
        <ol className="tv-verdicts">
          {rounds.map((r) => {
            const v = reviewerVerdictLabel(r.outcome);
            return (
              <li key={r.iteration} className={`tv-verdict tv-verdict--${v.tone}`}>
                <span className="tv-verdict__round">Round {r.iteration}</span>
                <span className="tv-verdict__label">{v.label}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const TITLES: Record<string, { title: string; subtitle: string }> = {
  pm: { title: "Product manager", subtitle: "The spec it wrote" },
  engineer: { title: "Engineer", subtitle: "What it did, step by step" },
  reviewer: { title: "Reviewer", subtitle: "How it judged the work" },
};

/**
 * The right-hand inspection panel. Rendered only when a node is selected; it
 * splits the canvas (push layout) so the clicked node stays reachable. Switches
 * body on role: PM → the spec + versions; Engineer → the run-event feed; Reviewer
 * → the per-round verdict history. The selected node's `invocations` are threaded in
 * as a slice (not the whole graph) so the panel stays graph-free.
 */
export function SidePanel({
  selectedRole,
  invocations = [],
  runId,
  run,
  workflowStatus,
  onClose,
}: {
  selectedRole: string;
  invocations?: NodeInvocation[];
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
  onClose: () => void;
}) {
  const { title, subtitle } = TITLES[selectedRole] ?? { title: selectedRole, subtitle: "Details" };

  let body: ReactNode;
  if (selectedRole === "pm") {
    body = (
      <PrdView
        documentId={run?.pm_document_id ?? null}
        emptyHint={pmEmptyHint(runId, run, workflowStatus)}
      />
    );
  } else if (selectedRole === "reviewer") {
    body = <ReviewerView rounds={invocations} />;
  } else {
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

      <div className="tv-panel__body">{body}</div>
    </aside>
  );
}
