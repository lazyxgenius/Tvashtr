import { type ReactNode } from "react";
import { X } from "lucide-react";

import { LastRun } from "../components/LastRun";
import type { GraphNode, RunRow } from "../lib/api";
import { isPrdEditable, WORKFLOW_FAILED } from "../lib/status";
import { titleCase } from "../lib/text";
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

function nodeTitle(node: GraphNode): { title: string; subtitle: string } {
  return ROLE_TITLES[node.role_name] ?? { title: titleCase(node.role_name), subtitle: "Details" };
}

/**
 * The right-hand run-view inspection panel. Selected by NODE ID (Option A), it switches the body on
 * the node's `kind`, not a hardcoded role: every agent/thinker node gets a uniform "Last run" brief
 * (its per-round `outcome_detail`) atop a kind-specific body — a thinker (`completion`) shows the
 * shared spec (`PrdView`, live-editable while in-flight, P1.7b); a worker (`agent`, incl. the
 * Reviewer) shows the step-by-step feed. Gates/terminals never open this panel (the canvas only
 * selects agent/completion nodes). The whole `GraphNode` is passed in — the panel reads its
 * `invocations` (already in the run-graph payload) so it stays a thin render of backend truth.
 *
 * M2: the per-round "Last run" rendering moved to the shared `components/LastRun`; the run view
 * passes NO `provenance`, so the render is byte-identical (the authoring panel passes provenance).
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
