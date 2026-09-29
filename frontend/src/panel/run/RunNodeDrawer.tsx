import { type ReactNode, useEffect, useState } from "react";

import { LastRun } from "../../components/LastRun";
import { type DocumentMeta, getRunDocuments, type GraphNode, type RunRow } from "../../lib/api";
import { nodeTitle } from "../../lib/nodeNames";
import {
  deriveNodeStatus,
  isPrdEditable,
  type NodeStatus,
  WORKFLOW_FAILED,
} from "../../lib/status";
import { EventFeed } from "../EventFeed";
import { modelLabel, statusBadge } from "../nodeBadges";
import { NodeChat } from "../NodeChat";
import { NodeDrawer } from "../NodeDrawer";
import { glyphForNode } from "../nodeGlyph";
import { NodeBadges, NodeHeader } from "../NodeHeader";
import { PrdView } from "../PrdView";
import { RunDiff } from "../RunDiff";
import { RunMemory } from "../RunMemory";

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

/** M-docs: the run-view document PICKER. Lists EVERY document the run produced — the entry PM's spec
 *  plus any node's authored document (a Design Doc, etc.) — and opens the selected one in the SAME
 *  TipTap editor via {@link PrdView}. A single-document run (the common case) shows NO chip bar and
 *  is byte-identical to the old single-PrdView panel. Editability is run-level; every document shares
 *  it. Fetches the run's document list on open; each chip opens its document by id. */
function PrdDocuments({
  runId,
  run,
  workflowStatus,
}: {
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
}) {
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setDocs([]);
      return;
    }
    let cancelled = false;
    getRunDocuments(runId)
      .then((r) => {
        if (!cancelled) setDocs(r.documents);
      })
      .catch(() => {
        if (!cancelled) setDocs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Default to the run's primary spec (pm_document_id) when present, else the first document.
  const primaryId = run?.pm_document_id ?? null;
  const hasPrimary = docs.some((d) => d.id === primaryId);
  const activeId = selectedId ?? (hasPrimary ? primaryId : (docs[0]?.id ?? primaryId));

  return (
    <div className="tv-prd-docs">
      {docs.length > 1 && (
        <div
          className="tv-prd__versions"
          role="group"
          aria-label="Documents"
          data-testid="doc-picker"
        >
          {docs.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`tv-prd__version${d.id === activeId ? " tv-prd__version--active" : ""}`}
              onClick={() => setSelectedId(d.id)}
              data-doc-name={d.name ?? d.doc_type}
            >
              {d.name ?? d.title}
            </button>
          ))}
        </div>
      )}
      <PrdView
        documentId={activeId}
        emptyHint={specEmptyHint(runId, run, workflowStatus)}
        editable={isPrdEditable(run?.status ?? null, workflowStatus)}
      />
    </div>
  );
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
 * The run view's drawer (Q20): the agent drawer's shell and header — the node's name, a
 * STATUS-based subtitle (Working now / Finished / Not reached yet / Failed / Stopped) and its last
 * round's badge and model — over the uniform "Last run" brief and a kind-specific body: a thinker
 * (`completion`) shows the run's documents (`PrdView`, live-editable in-flight), a worker the
 * step-by-step feed, its changes, Ask and Memory. No tabs and no Save: nothing here is edited.
 */
export function RunNodeDrawer({
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
  const title = nodeTitle(node);
  const status = deriveNodeStatus(node.status, run, workflowStatus);
  const last = node.invocations[node.invocations.length - 1] ?? null;

  // A thinker refines the SAME shared spec, so `PrdView` is correct for ANY thinker; editability is
  // run-status-based (P1.7b), never role-based.
  const body: ReactNode =
    node.kind === "completion" ? (
      <ThinkerBody node={node} runId={runId} run={run} workflowStatus={workflowStatus} />
    ) : (
      <WorkerBody node={node} runId={runId} run={run} workflowStatus={workflowStatus} />
    );

  return (
    <NodeDrawer
      name={title}
      label={`${title} in this run`}
      bare
      header={
        <NodeHeader
          glyph={glyphForNode(node.kind, node.role_name)}
          name={title}
          description={STATUS_SUBTITLE[status] ?? "Inspector"}
          onClose={onClose}
          badges={
            <NodeBadges
              status={statusBadge(last)}
              editsAllowed={node.edits_allowed ?? null}
              model={modelLabel(node.model ?? "") || null}
            />
          }
        />
      }
    >
      <section className="tv-lastrun" aria-label="Last run">
        <div className="tv-lastrun__head">Last run</div>
        <LastRun rounds={node.invocations} />
      </section>
      {body}
    </NodeDrawer>
  );
}

/**
 * A worker (`agent`) node's drawer body: the action/observation feed and the run's per-file diff,
 * behind an Activity|Changes segmented tab (M-changes). A diff is the product of a worker editing
 * the repo, so it lives on the worker; it can't stack under the auto-scrolling feed, so the tab
 * shows one at a time. "Activity" is the default (so nothing about the run view changes until the
 * reviewer clicks "Changes"), and RunDiff only fetches once it's the active tab.
 */
function WorkerBody({
  node,
  runId,
  run,
  workflowStatus,
}: {
  node: GraphNode;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
}) {
  // Mode A: the Ask + Memory tabs appear only once the node has a recorded run to explain / inspect.
  const canAsk = node.invocations.length > 0;
  const [tab, setTab] = useState<"activity" | "changes" | "ask" | "memory">("activity");
  return (
    <>
      <div className="tv-worktabs">
        <div className="tv-seg" role="group" aria-label="Worker view">
          <button
            type="button"
            aria-pressed={tab === "activity"}
            className={`tv-seg__btn${tab === "activity" ? " tv-seg__btn--active" : ""}`}
            onClick={() => setTab("activity")}
          >
            Activity
          </button>
          <button
            type="button"
            aria-pressed={tab === "changes"}
            className={`tv-seg__btn${tab === "changes" ? " tv-seg__btn--active" : ""}`}
            onClick={() => setTab("changes")}
          >
            Changes
          </button>
          {canAsk ? (
            <>
              <button
                type="button"
                aria-pressed={tab === "ask"}
                className={`tv-seg__btn${tab === "ask" ? " tv-seg__btn--active" : ""}`}
                onClick={() => setTab("ask")}
              >
                Ask
              </button>
              <button
                type="button"
                aria-pressed={tab === "memory"}
                className={`tv-seg__btn${tab === "memory" ? " tv-seg__btn--active" : ""}`}
                onClick={() => setTab("memory")}
              >
                Memory
              </button>
            </>
          ) : null}
        </div>
      </div>
      {tab === "activity" ? (
        <EventFeed node={node} runId={runId} run={run} workflowStatus={workflowStatus} />
      ) : tab === "changes" ? (
        <RunDiff runId={runId} />
      ) : tab === "memory" ? (
        <RunMemory invocations={node.invocations} runId={runId} />
      ) : (
        <NodeChat runId={runId} nodeId={node.id} />
      )}
    </>
  );
}

/**
 * A thinker (`completion`) node's drawer body: the shared spec (`PrdView`, live-editable in-flight,
 * P1.7b). Once the node has a recorded run, a Spec|Ask segmented tab is added so the user can ask
 * what the thinker did (Mode A). Spec stays the default, so the run view is unchanged until asked;
 * before the node has run (no invocations) it is just the bare spec (byte-identical to before).
 */
function ThinkerBody({
  node,
  runId,
  run,
  workflowStatus,
}: {
  node: GraphNode;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
}) {
  const canAsk = node.invocations.length > 0;
  const [tab, setTab] = useState<"spec" | "ask" | "memory">("spec");
  const spec = <PrdDocuments runId={runId} run={run} workflowStatus={workflowStatus} />;
  if (!canAsk) return spec;
  return (
    <>
      <div className="tv-worktabs">
        <div className="tv-seg" role="group" aria-label="Thinker view">
          <button
            type="button"
            aria-pressed={tab === "spec"}
            className={`tv-seg__btn${tab === "spec" ? " tv-seg__btn--active" : ""}`}
            onClick={() => setTab("spec")}
          >
            Spec
          </button>
          <button
            type="button"
            aria-pressed={tab === "ask"}
            className={`tv-seg__btn${tab === "ask" ? " tv-seg__btn--active" : ""}`}
            onClick={() => setTab("ask")}
          >
            Ask
          </button>
          <button
            type="button"
            aria-pressed={tab === "memory"}
            className={`tv-seg__btn${tab === "memory" ? " tv-seg__btn--active" : ""}`}
            onClick={() => setTab("memory")}
          >
            Memory
          </button>
        </div>
      </div>
      {tab === "spec" ? (
        spec
      ) : tab === "memory" ? (
        <RunMemory invocations={node.invocations} runId={runId} />
      ) : (
        <NodeChat runId={runId} nodeId={node.id} />
      )}
    </>
  );
}
