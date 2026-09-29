import { useState } from "react";
import { FileText, Zap } from "lucide-react";

import { Button } from "../../design-system/components";
import {
  type GraphEdge,
  type GraphNode,
  getProviderCatalogue,
  type NodeInvocation,
  type RunRow,
} from "../../lib/api";
import { listRunDocs } from "../../lib/api/docs";
import type { NodeRound } from "../../lib/api/nodes";
import type { NodeTab } from "../../lib/nav";
import { nodeDescription, nodeTitle } from "../../lib/nodeNames";
import {
  deriveNodeStatus,
  isRunTerminal,
  type NodeStatus,
  WORKFLOW_FAILED,
} from "../../lib/status";
import { seedDraft } from "../agentDraft";
import { ContextManifest } from "../ContextManifest";
import { docLabel, readersLine, specLine, versionLine, writtenBy } from "../docs/agentDocs";
import { DocCard } from "../docs/DocCard";
import { EventFeed } from "../EventFeed";
import { modelLabel, type StatusBadge, statusBadge } from "../nodeBadges";
import { NodeChat } from "../NodeChat";
import { skillsAndToolsCount } from "../nodeCounts";
import { NodeDrawer } from "../NodeDrawer";
import { glyphForNode } from "../nodeGlyph";
import { NodeBadges, NodeHeader } from "../NodeHeader";
import { NodeTabs } from "../NodeTabs";
import { RunDiff } from "../RunDiff";
import { RunMemory } from "../RunMemory";
import { EmptyCard, LoadState, RoundsList } from "../runs/RunsTab";
import { useLoaded } from "../runs/useLoaded";
import { seatOf } from "../setup/modelCatalog";
import { isDesktopApp } from "../setup/modelCopy";
import { SetupTab } from "../setup/SetupTab";
import { SkillsToolsTab } from "../skills/SkillsToolsTab";
import { useShelves } from "../skills/useShelves";
import type { AgentDraftApi } from "../useAgentDraft";
import "../panel.css";

const noop = () => {};

/** The run's copy of the agent as a draft nothing can change (the read-only Setup and Skills). */
function readOnlyDraft(node: GraphNode): AgentDraftApi {
  const draft = seedDraft(node);
  return {
    draft,
    baseline: draft,
    set: noop,
    update: noop,
    changed: [],
    dirtyCount: 0,
    isDirty: false,
    problem: null,
    discard: noop,
    save: () => Promise.resolve(false),
    saveState: "idle",
    saveError: null,
  };
}

/**
 * The header's status badge from what the agent is doing in THIS run: "Waiting" (the run hasn't
 * reached it yet), "Not reached" (the run ended first), "Running", or how its last round ended.
 */
function runStatusBadge(
  status: NodeStatus,
  last: NodeInvocation | null,
  live: boolean,
): StatusBadge {
  if (status === "idle") {
    return {
      label: live ? "Waiting" : "Not reached",
      variant: "neutral",
      dot: true,
      hasRun: false,
    };
  }
  return statusBadge({ ...(last ?? { outcome: null }), status });
}

/**
 * The node's rounds in this run, newest first, in the Runs tab's shape. A round still "running" when
 * the run failed or stopped reads as the run ended (`status`, the node's derived status).
 */
function roundsOf(node: GraphNode, status: NodeStatus): NodeRound[] {
  return [...node.invocations].reverse().map((inv) => ({
    invocation_id: inv.invocation_id ?? inv.iteration,
    iteration: inv.iteration,
    status: inv.status === "running" ? status : inv.status,
    outcome: inv.outcome,
    outcome_detail: inv.outcome_detail,
    started_at: inv.started_at,
    ended_at: inv.ended_at,
    cost: inv.cost,
    model_used: null,
    runs_on: null,
    given: null,
    produced: null,
  }));
}

/**
 * The run view's agent drawer (Q20): the Team screen's drawer — the same header, badges and five
 * tabs — opening on Runs. Runs is this run's rounds with the run-only tools (Activity, Changes, Ask);
 * Memory is what the agent was given and what the run taught; Docs is the run's documents. Setup and
 * Skills & tools show the run's copy of the agent, read-only, with "Edit on the team" to change it
 * for the next run.
 */
export function RunNodeDrawer({
  node,
  nodes,
  edges,
  isEntry = false,
  runId,
  run,
  workflowStatus,
  tab,
  onTabChange,
  onClose,
  onOpenDoc,
  onEditOnTeam,
  offTeam = false,
}: {
  node: GraphNode;
  /** The run's graph: the read-only Setup's routing, reads and writes. */
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** The run's entry agent (no arrow into it). */
  isEntry?: boolean;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
  tab: NodeTab;
  onTabChange: (tab: NodeTab) => void;
  onClose: () => void;
  /** A document's Open: the document viewer over the run's canvas. */
  onOpenDoc?: (docId: string) => void;
  /** "Edit on the team": the team's canvas with this agent open on Setup. Omitted: no button. */
  onEditOnTeam?: () => void;
  /** The agent this run copied has since been deleted from the team. */
  offTeam?: boolean;
}) {
  const shelves = useShelves(tab === "skills");
  const title = nodeTitle(node);
  const status = deriveNodeStatus(node.status, run, workflowStatus);
  const live = !isRunTerminal(run, workflowStatus);
  const last = node.invocations[node.invocations.length - 1] ?? null;
  const copy = readOnlyDraft(node);

  let body;
  switch (tab) {
    case "setup":
      body = (
        <SetupTab
          readOnly
          node={node}
          nodes={nodes}
          edges={edges}
          isEntry={isEntry}
          draft={copy}
          picker={{
            catalogue: getProviderCatalogue(),
            seat: seatOf(node),
            cover: null,
            desktop: isDesktopApp(),
            justAdded: new Set<string>(),
          }}
          agentName={title}
          onPickTemplate={noop}
          onUpdateRouting={noop}
        />
      );
      break;
    case "skills":
      body = (
        <fieldset className="nd-readonly" disabled>
          <SkillsToolsTab
            skills={copy.draft.skills}
            toolConfig={copy.draft.toolConfig}
            onSkillsChange={noop}
            onToolsChange={noop}
            note={null}
            notify={noop}
            onAddSkill={noop}
            onEditSkill={noop}
            onAddTool={noop}
            onEditServer={noop}
            shelves={shelves}
          />
        </fieldset>
      );
      break;
    case "memory":
      body = <RunMemory invocations={node.invocations} runId={runId} />;
      break;
    case "docs":
      body = (
        <RunDocuments
          node={node}
          runId={runId}
          run={run}
          workflowStatus={workflowStatus}
          onOpenDoc={onOpenDoc}
        />
      );
      break;
    default:
      body = (
        <RunRounds
          node={node}
          runId={runId}
          run={run}
          workflowStatus={workflowStatus}
          status={status}
          live={live}
        />
      );
  }

  // Setup and Skills & tools say where a change goes instead of offering Save.
  const footer =
    tab === "setup" || tab === "skills" ? (
      <footer className="nd-foot">
        <span className="nd-foot__status">
          This run uses a copy of the team from when it started.{" "}
          {offTeam
            ? "This agent is no longer on the team."
            : "Change the agent on the team to change the next run."}
        </span>
        {onEditOnTeam && (
          <Button variant="secondary" size="sm" onClick={onEditOnTeam}>
            Edit on the team
          </Button>
        )}
      </footer>
    ) : undefined;

  return (
    <NodeDrawer
      name={title}
      label={`${title} in this run`}
      header={
        <NodeHeader
          glyph={isEntry ? Zap : glyphForNode(node.kind, node.role_name)}
          name={title}
          description={nodeDescription(node)}
          onClose={onClose}
          badges={
            <NodeBadges
              status={runStatusBadge(status, last, live)}
              editsAllowed={node.edits_allowed ?? null}
              model={modelLabel(node.model ?? "") || null}
              onOpenRuns={() => onTabChange("runs")}
            />
          }
        />
      }
      tabs={
        <NodeTabs
          value={tab}
          onChange={onTabChange}
          skillsCount={skillsAndToolsCount(copy.draft.skills, copy.draft.toolConfig)}
          memoryCount={0}
        />
      }
      footer={footer}
    >
      {body}
    </NodeDrawer>
  );
}

type RunTool = "activity" | "changes" | "ask";
const TOOL_LABEL: Record<RunTool, string> = {
  activity: "Activity",
  changes: "Changes",
  ask: "Ask",
};

/**
 * The Runs tab in a run: this agent's rounds in the run (the Team drawer's Last run card and earlier
 * rounds, each with its exact cost and context), then the run-only tools. A worker has its step
 * feed (Activity) and the run's file changes (Changes); once the agent has run, Ask explains what
 * it did.
 */
function RunRounds({
  node,
  runId,
  run,
  workflowStatus,
  status,
  live,
}: {
  node: GraphNode;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
  status: NodeStatus;
  live: boolean;
}) {
  const tools: RunTool[] = [
    ...(node.kind === "agent" ? (["activity", "changes"] as const) : []),
    ...(node.invocations.length > 0 ? (["ask"] as const) : []),
  ];
  const [picked, setPicked] = useState<RunTool | null>(null);
  const tool = picked && tools.includes(picked) ? picked : (tools[0] ?? null);
  const rounds = roundsOf(node, status);
  const byIteration = new Map(node.invocations.map((inv) => [inv.iteration, inv]));

  return (
    <div className="nd-stack">
      {rounds.length === 0 ? (
        <EmptyCard title="Not reached in this run">
          {live
            ? "Its rounds show up here once the run gets to it."
            : "The run ended before it got to this agent."}
        </EmptyCard>
      ) : (
        <RoundsList
          rounds={rounds}
          more={(r) => <RoundLedger inv={byIteration.get(r.iteration)} />}
        />
      )}
      {tool && (
        <section className="nd-runtools" aria-label="In this run">
          <div className="tv-seg" role="group" aria-label="Run tools">
            {tools.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tool === t}
                className={`tv-seg__btn${tool === t ? " tv-seg__btn--active" : ""}`}
                onClick={() => setPicked(t)}
              >
                {TOOL_LABEL[t]}
              </button>
            ))}
          </div>
          {tool === "activity" ? (
            <EventFeed node={node} runId={runId} run={run} workflowStatus={workflowStatus} />
          ) : tool === "changes" ? (
            <RunDiff runId={runId} />
          ) : (
            <NodeChat runId={runId} nodeId={node.id} />
          )}
        </section>
      )}
    </div>
  );
}

/** A round's exact tokens and cost, and the context it was given (worker rounds). */
function RoundLedger({ inv }: { inv: NodeInvocation | undefined }) {
  const cost = inv?.cost;
  const manifest = inv?.context_manifest;
  const hasManifest = Array.isArray(manifest?.parts);
  if (!cost && !hasManifest) return null;
  return (
    <div className="nd-ledger">
      {cost && (
        <div className="nd-round__meta">
          <span>
            {cost.prompt_tokens.toLocaleString()} in / {cost.completion_tokens.toLocaleString()} out
          </span>
          <span>${cost.cost_usd.toFixed(4)}</span>
        </div>
      )}
      {manifest && hasManifest && <ContextManifest manifest={manifest} />}
    </div>
  );
}

/** The placeholder when the run has no documents yet — from run-level signals. */
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
 * The Docs tab in a run: the run's documents — the shared spec first, then what the agents wrote —
 * each opening in the document viewer (where a live run's spec is edited). Reloads when this
 * agent's round moves on, so a new version shows up.
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
  const docs = useLoaded(
    runId && `${runId}:${node.status}:${node.iteration}`,
    () => listRunDocs(runId ?? "").then((d) => d.documents),
    { keep: true },
  );
  const all = docs.value ?? [];
  if (all.length === 0) {
    return docs.state === "loading" || docs.state === "error" ? (
      <LoadState
        state={docs.state}
        loading="Loading documents"
        error="Couldn’t load this run’s documents."
        onRetry={docs.retry}
      />
    ) : (
      <EmptyCard
        title="No documents yet"
        icon={<FileText size={28} strokeWidth={1.4} aria-hidden />}
      >
        {specEmptyHint(runId, run, workflowStatus)}
      </EmptyCard>
    );
  }
  const ordered = [...all.filter((d) => d.is_shared_spec), ...all.filter((d) => !d.is_shared_spec)];
  return (
    <ul className="nd-docs__list">
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
