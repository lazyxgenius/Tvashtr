import { type ReactNode, useState } from "react";

import { LastRun } from "../../components/LastRun";
import type { GraphNode, RunRow } from "../../lib/api";
import { listRunDocs } from "../../lib/api/docs";
import { nodeTitle } from "../../lib/nodeNames";
import { deriveNodeStatus, type NodeStatus, WORKFLOW_FAILED } from "../../lib/status";
import { docLabel, readersLine, specLine, versionLine, writtenBy } from "../docs/agentDocs";
import { DocCard } from "../docs/DocCard";
import { EventFeed } from "../EventFeed";
import { modelLabel, statusBadge } from "../nodeBadges";
import { NodeChat } from "../NodeChat";
import { NodeDrawer } from "../NodeDrawer";
import { glyphForNode } from "../nodeGlyph";
import { NodeBadges, NodeHeader } from "../NodeHeader";
import { RunDiff } from "../RunDiff";
import { RunMemory } from "../RunMemory";
import { useLoaded } from "../runs/useLoaded";

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

/**
 * The run's documents on a thinker's drawer: the shared spec first, then what the agents wrote, each
 * opening in the document viewer (where a live run's spec is edited). Reloads when this node's round
 * moves on, so a new version shows up.
 */
function RunDocuments({
  node,
  runId,
  run,
  workflowStatus,
  onOpenDoc,
}: {
  node: GraphNode;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
  onOpenDoc?: (docId: string) => void;
}) {
  const docs = useLoaded(runId && `${runId}:${node.status}:${node.iteration}`, () =>
    listRunDocs(runId ?? "").then((d) => d.documents),
  );
  const all = docs.value ?? [];
  if (all.length === 0) {
    return <p className="tv-panel-note">{specEmptyHint(runId, run, workflowStatus)}</p>;
  }
  const ordered = [...all.filter((d) => d.is_shared_spec), ...all.filter((d) => !d.is_shared_spec)];
  return (
    <ul className="nd-docs__list tv-rundocs">
      {ordered.map((d) => (
        <DocCard
          key={d.id}
          shared={d.is_shared_spec}
          title={docLabel(d)}
          sub={d.is_shared_spec ? specLine(d) : writtenBy(d)}
          meta={d.is_shared_spec ? versionLine(d) : readersLine(d)}
          onOpen={onOpenDoc && (() => onOpenDoc(d.id))}
        />
      ))}
    </ul>
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
 * (`completion`) shows the run's documents (open in the viewer), a worker the
 * step-by-step feed, its changes, Ask and Memory. No tabs and no Save: nothing here is edited.
 */
export function RunNodeDrawer({
  node,
  runId,
  run,
  workflowStatus,
  onClose,
  onOpenDoc,
}: {
  node: GraphNode;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
  onClose: () => void;
  /** A document's Open: the document viewer over the run's canvas. */
  onOpenDoc?: (docId: string) => void;
}) {
  const title = nodeTitle(node);
  const status = deriveNodeStatus(node.status, run, workflowStatus);
  const last = node.invocations[node.invocations.length - 1] ?? null;

  // A thinker refines the SAME shared spec, so its drawer lists the run's documents (any thinker);
  // editing the spec happens in the viewer, while the run is live (P1.7b).
  const body: ReactNode =
    node.kind === "completion" ? (
      <ThinkerBody
        node={node}
        runId={runId}
        run={run}
        workflowStatus={workflowStatus}
        onOpenDoc={onOpenDoc}
      />
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
 * A thinker (`completion`) node's drawer body: the run's documents (the shared spec first; Open shows
 * one in the viewer, where a live run's spec is edited, P1.7b). Once the node has a recorded run, a
 * Spec|Ask segmented tab is added so the user can ask what the thinker did (Mode A). Spec stays the
 * default; before the node has run (no invocations) it is just the documents.
 */
function ThinkerBody({
  node,
  runId,
  run,
  workflowStatus,
  onOpenDoc,
}: {
  node: GraphNode;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
  onOpenDoc?: (docId: string) => void;
}) {
  const canAsk = node.invocations.length > 0;
  const [tab, setTab] = useState<"spec" | "ask" | "memory">("spec");
  const spec = (
    <RunDocuments
      node={node}
      runId={runId}
      run={run}
      workflowStatus={workflowStatus}
      onOpenDoc={onOpenDoc}
    />
  );
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
