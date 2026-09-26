import { Zap } from "lucide-react";

import { LastRun } from "../components/LastRun";
import type { GateConfig, GraphEdge, TeamGraphNode } from "../lib/api";
import type { NodeTab } from "../lib/nav";
import { nodeDescription, nodeTitle } from "../lib/nodeNames";
import { DomainQueryBody } from "./legacy/DomainQueryBody";
import { GateBody } from "./legacy/GateBody";
import { legacySubtitle } from "./legacy/legacyCopy";
import { TerminalBody } from "./legacy/TerminalBody";
import { skillsAndToolsCount } from "./nodeCounts";
import { modelLabel, statusBadge } from "./nodeBadges";
import { NodeBadges, NodeHeader } from "./NodeHeader";
import { NodeDrawer } from "./NodeDrawer";
import { glyphForNode } from "./nodeGlyph";
import { NodeMemorySection } from "./NodeMemorySection";
import { NodeTabs } from "./NodeTabs";
import { SaveBar } from "./SaveBar";
import { type CredentialCover, needsModel } from "./setup/modelCopy";
import { SetupTab } from "./setup/SetupTab";
import { SkillsSection } from "./SkillsSection";
import { ToolsSection } from "./ToolsSection";
import { useAgentDraft } from "./useAgentDraft";
import { useNodeMemoryCount } from "./useNodeMemoryCount";
import "./panel.css";

export interface NodeEditorProps {
  teamId: string;
  node: TeamGraphNode;
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
  /** The team's entry agent (no arrow into it): read-only, starts from the idea. */
  isEntry: boolean;
  /** The account's API keys and usable subscriptions (null while loading). */
  cover: CredentialCover | null;
  tab: NodeTab;
  onTabChange: (tab: NodeTab) => void;
  focus: boolean;
  onFocusChange: (focus: boolean) => void;
  onClose: () => void;
  /** Refetch the team graph (and validity) after a save. */
  onSaved: () => void | Promise<void>;
  /** Open the Memory shelf. */
  onManageMemory?: () => void;
}

/**
 * The agent panel's controller: one per selected node. Agents get the tabbed drawer with the shared
 * draft (`useAgentDraft`, kept here so the drawer and the focus view edit the same draft); gates,
 * endpoints and Query-domain nodes keep their own bodies inside the same shell, without tabs.
 */
export function NodeEditor(props: NodeEditorProps) {
  const { node } = props;
  if (node.kind === "gate" || node.kind === "terminal" || node.kind === "domain_query") {
    return <LegacyNodeDrawer {...props} />;
  }
  return <AgentEditor {...props} />;
}

function LegacyNodeDrawer({ teamId, node, onClose, onSaved }: NodeEditorProps) {
  const name =
    node.kind === "gate"
      ? (node.config as GateConfig | null)?.title || nodeTitle(node)
      : nodeTitle(node);
  const terminalKind =
    node.kind === "terminal"
      ? ((node.config as { terminal_kind?: string } | null)?.terminal_kind ?? "stop")
      : undefined;
  return (
    <NodeDrawer
      name={name}
      bare
      header={
        <NodeHeader
          glyph={glyphForNode(node.kind, node.role_name, terminalKind)}
          name={name}
          description={legacySubtitle(node.kind, (node.config as GateConfig | null)?.gate_kind)}
          onClose={onClose}
        />
      }
    >
      {node.kind === "gate" && (
        <GateBody key={node.id} teamId={teamId} node={node} onSaved={onSaved} />
      )}
      {node.kind === "terminal" && (
        <TerminalBody key={node.id} teamId={teamId} node={node} onSaved={onSaved} />
      )}
      {node.kind === "domain_query" && (
        <DomainQueryBody key={node.id} teamId={teamId} node={node} onSaved={onSaved} />
      )}
    </NodeDrawer>
  );
}

function AgentEditor({
  teamId,
  node,
  nodes,
  edges,
  isEntry,
  cover,
  tab,
  onTabChange,
  focus,
  onFocusChange,
  onClose,
  onSaved,
  onManageMemory,
}: NodeEditorProps) {
  const api = useAgentDraft(node, { teamId, onSaved: () => onSaved() });
  const { draft } = api;
  const memoryCount = useNodeMemoryCount(node.id);

  // The header follows the draft, so a rename shows before it's saved.
  const cfg = (node.config as Record<string, unknown> | null) ?? {};
  const name = draft.title.trim() || nodeTitle({ ...node, config: { ...cfg, title: "" } });
  const description =
    draft.description.trim() || nodeDescription({ ...node, config: { ...cfg, description: "" } });
  const glyph = isEntry ? Zap : glyphForNode(node.kind, node.role_name);

  let body;
  switch (tab) {
    case "skills":
      // Until the Skills & tools rebuild lands: the existing editors, bound to the draft.
      body = (
        <div className="nd-interim">
          <SkillsSection value={draft.skills} onChange={(v) => api.set("skills", v)} />
          <ToolsSection value={draft.toolConfig} onChange={(v) => api.set("toolConfig", v)} />
        </div>
      );
      break;
    case "memory":
      body = <NodeMemorySection nodeId={node.id} onManageAll={onManageMemory} />;
      break;
    case "runs":
    case "docs":
      body = node.last_run ? (
        <LastRun
          rounds={[
            {
              iteration: node.last_run.iteration,
              outcome: node.last_run.outcome,
              outcome_detail: node.last_run.outcome_detail,
            },
          ]}
          provenance={{ startedAt: node.last_run.started_at, runId: node.last_run.run_id }}
        />
      ) : (
        <p className="tv-panel-note">This agent hasn’t run yet.</p>
      );
      break;
    default:
      body = (
        <SetupTab
          node={node}
          nodes={nodes}
          edges={edges}
          isEntry={isEntry}
          draft={api}
          cover={cover}
          onOpenFullEditor={focus ? undefined : () => onFocusChange(true)}
        />
      );
  }

  return (
    <NodeDrawer
      name={name}
      variant={focus ? "focus" : "dock"}
      onDismissFocus={() => onFocusChange(false)}
      header={
        <NodeHeader
          glyph={glyph}
          name={name}
          description={description}
          focused={focus}
          onFocus={() => onFocusChange(!focus)}
          onMore={() => {}}
          onClose={onClose}
          badges={
            <NodeBadges
              status={statusBadge(node.last_run)}
              editsAllowed={draft.editsAllowed}
              model={needsModel(draft.model, cover) ? null : modelLabel(draft.model)}
              onOpenRuns={() => onTabChange("runs")}
            />
          }
        />
      }
      tabs={
        <NodeTabs
          value={tab}
          onChange={onTabChange}
          skillsCount={skillsAndToolsCount(draft.skills, draft.toolConfig)}
          memoryCount={memoryCount}
        />
      }
      footer={
        <SaveBar
          dirtyCount={api.dirtyCount}
          saveState={api.saveState}
          error={api.saveError}
          canSave={api.isDirty && api.problem === null}
          memoryTab={tab === "memory"}
          onSave={() => void api.save()}
          onDiscard={api.discard}
        />
      }
    >
      {body}
    </NodeDrawer>
  );
}
