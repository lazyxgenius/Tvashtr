import { type ReactNode } from "react";
import { X } from "lucide-react";

import type { RunRow } from "../lib/api";
import { WORKFLOW_FAILED } from "../lib/status";
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
 * The minimal reviewer view (P1.5a prompt 2): a short DS-voiced explanation of the
 * reviewer's role + its current round once it has looped.
 * NOTE: the per-round verdicts (approved / changes-requested + reasons) land in
 * P1.5a prompt 3, when the backend exposes `AgentInvocation.outcome`. This prompt
 * shows status + round only.
 */
function ReviewerView({ iteration }: { iteration: number }) {
  return (
    <div className="tv-scroll">
      <p className="tv-panel-note">
        The reviewer reads the engineer's work against the spec, then either approves it or sends it
        back for another round of changes.
      </p>
      {iteration >= 2 && <p className="tv-panel-note">Currently on round {iteration}.</p>}
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
 * → the minimal role view. The selected node's `iteration` is threaded in as a
 * scalar (not the graph) so the panel stays run-level.
 */
export function SidePanel({
  selectedRole,
  iteration = 0,
  runId,
  run,
  workflowStatus,
  onClose,
}: {
  selectedRole: string;
  iteration?: number;
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
    body = <ReviewerView iteration={iteration} />;
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
