import { type ReactNode } from "react";

import { LastRun } from "../components/LastRun";
import type { GraphNode, RunRow } from "../lib/api";
import { deriveNodeStatus, isPrdEditable, type NodeStatus, WORKFLOW_FAILED } from "../lib/status";
import { titleCase } from "../lib/text";
import { DrawerShell, type PanelMode } from "./DrawerShell";
import { EventFeed } from "./EventFeed";
import { glyphForNode } from "./nodeGlyph";
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
const ROLE_TITLES: Record<string, string> = {
  pm: "Product manager",
  engineer: "Engineer",
  reviewer: "Reviewer",
};

function nodeTitle(node: GraphNode): string {
  return ROLE_TITLES[node.role_name] ?? titleCase(node.role_name);
}

// F1c Decision 2: the run-view subtitle is STATUS-based (from the SAME derived status the node card
// uses — `deriveNodeStatus`), not role-based. Reads what the node is doing right now.
const STATUS_SUBTITLE: Record<NodeStatus, string> = {
  running: "Working now",
  done: "Finished",
  idle: "Not reached yet",
  failed: "Failed",
  stopped: "Stopped",
};

/**
 * The right-hand run-view inspection drawer (F1c reskin). Selected by NODE ID (Option A), it keeps
 * the CAPABILITY-based split (F1c Decision 2 — the Tvashtr-25 pivot retired privileged roles): every
 * agent/thinker node shows a uniform "Last run" brief atop a kind-specific body — a thinker
 * (`completion`) shows the shared spec (`PrdView`, live-editable while in-flight, P1.7b); a worker
 * (`agent`, incl. the Reviewer) shows the step-by-step feed (whose brief IS its verdict history).
 * Gates/terminals never open this panel in a run (the canvas only selects agent/completion there).
 *
 * The subtitle is STATUS-based (Working now / Finished / Not reached yet / Failed / Stopped); the
 * drawer⇄modal chrome + the sticky `panelMode` live in the shared `DrawerShell`.
 */
export function SidePanel({
  node,
  runId,
  run,
  workflowStatus,
  panelMode = "drawer",
  onTogglePanelMode,
  onClose,
}: {
  node: GraphNode;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
  panelMode?: PanelMode;
  onTogglePanelMode?: () => void;
  onClose: () => void;
}) {
  const title = nodeTitle(node);
  const status = deriveNodeStatus(node.status, run, workflowStatus);
  const subtitle = STATUS_SUBTITLE[status] ?? "Inspector";

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
    <DrawerShell
      glyph={glyphForNode(node.kind, node.role_name)}
      title={title}
      subtitle={subtitle}
      ariaLabel={`${title} details`}
      panelMode={panelMode}
      onTogglePanelMode={onTogglePanelMode}
      onClose={onClose}
    >
      <section className="tv-lastrun" aria-label="Last run">
        <div className="tv-lastrun__head">Last run</div>
        <LastRun rounds={node.invocations} />
      </section>
      {body}
    </DrawerShell>
  );
}
