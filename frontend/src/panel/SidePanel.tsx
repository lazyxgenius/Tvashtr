import { X } from "lucide-react";

import type { RunRow } from "../lib/api";
import { deriveNodeStatus } from "../lib/status";
import { EventFeed } from "./EventFeed";
import { PrdView } from "./PrdView";

/** The PM's placeholder copy when there is no document yet (drafting / none / failed). */
function pmEmptyHint(runId: string | null, run: RunRow | null, workflowStatus: string | null): string {
  if (!runId || !run) return "No spec yet. Start a run and the product manager drafts the first one.";
  // Reuse the single source of truth; "done" implies a document exists, so we
  // only ever reach this for idle / running / failed.
  if (deriveNodeStatus("pm", run, workflowStatus) === "failed")
    return "The product manager didn't finish the spec for this run.";
  return "The product manager is drafting the spec…";
}

/**
 * The right-hand inspection panel. Rendered only when a node is selected; it
 * splits the canvas (push layout) so the clicked node stays reachable. Switches
 * body on role: PM -> the spec + versions; Engineer -> the run-event feed.
 */
export function SidePanel({
  selectedRole,
  runId,
  run,
  workflowStatus,
  onClose,
}: {
  selectedRole: string;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
  onClose: () => void;
}) {
  const isPm = selectedRole === "pm";
  const title = isPm ? "Product manager" : "Engineer";
  const subtitle = isPm ? "The spec it wrote" : "What it did, step by step";

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
        {isPm ? (
          <PrdView
            documentId={run?.pm_document_id ?? null}
            emptyHint={pmEmptyHint(runId, run, workflowStatus)}
          />
        ) : (
          <EventFeed runId={runId} run={run} workflowStatus={workflowStatus} />
        )}
      </div>
    </aside>
  );
}
