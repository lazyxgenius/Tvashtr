import { useState } from "react";

import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import type { NodeTemplate } from "../../lib/api/nodes";
import type { AgentDraftApi } from "../useAgentDraft";
import { AccessSection } from "./AccessSection";
import { AdvancedSection } from "./AdvancedSection";
import { isGettingReady, isReadyHidden, readyItems, rememberReadyHidden } from "./getReady";
import { GetReadyChecklist } from "./GetReadyChecklist";
import { InstructionsCard } from "./InstructionsCard";
import { sameModelSibling } from "./modelCatalog";
import { type CredentialCover, needsModel } from "./modelCopy";
import { type ModelPickerContext, ModelSection } from "./ModelSection";
import { routingOf } from "./routing";
import { RoutingStatus } from "./RoutingStatus";
import { runtimeBanner } from "./setupCopy";
import { TemplateChooser } from "./TemplateChooser";
import { TemplatesMenu } from "./TemplatesMenu";
import { useNodeTemplates } from "./useNodeTemplates";

/**
 * The Setup tab (Main / Web-Setup / Panel-FullLength): instructions with the routing line, the
 * model and Images, Access & documents, and the Advanced disclosure. Every edit goes into the
 * shared draft; nothing is saved until Save. A new agent (Web-NewAgent) also gets the "Get this
 * agent ready" checklist and, while its instructions are empty, the template chooser.
 */
export function SetupTab({
  node,
  nodes,
  edges,
  isEntry,
  draft: api,
  cover,
  picker,
  agentName,
  onOpenFullEditor,
  onPickTemplate,
  onUpdateRouting,
  onNewDocument,
}: {
  node: TeamGraphNode;
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
  isEntry: boolean;
  draft: AgentDraftApi;
  /** The account's credentials (null while loading). */
  cover: CredentialCover | null;
  /** What the model pickers offer (the catalogue for this agent's seat, and the key flows). */
  picker: ModelPickerContext;
  /** The agent's name as the header shows it (the same-model advisory names it). */
  agentName: string;
  onOpenFullEditor?: () => void;
  /** A template picked from the menu or the chooser (the editor asks before replacing text). */
  onPickTemplate: (template: NodeTemplate) => void;
  /** "Update instructions": write the verdict lines the arrows need (the editor confirms first). */
  onUpdateRouting: () => void;
  /** Writes got a name no agent on the team uses yet (the drawer's toast). */
  onNewDocument?: () => void;
}) {
  const { draft, set, update } = api;
  const templates = useNodeTemplates();
  const [readyHidden, setReadyHidden] = useState(() => isReadyHidden(node.id));
  // "Start from scratch" (or any text typed since) keeps the editor, even when it's emptied again.
  const [editorOpen, setEditorOpen] = useState(false);
  const routing = routingOf(node.id, draft.prompt, nodes, edges);
  // The Changed marks follow the draft; while a save is on its way they step back (Flow-Save-2).
  const marking = api.saveState !== "saving";
  const changed = marking ? api.changed : [];
  const modelNeeded = needsModel(draft.model, cover);
  const gettingReady =
    !readyHidden &&
    isGettingReady({
      hasRun: node.last_run != null,
      savedPrompt: api.baseline.prompt,
      savedModelNeeded: needsModel(api.baseline.model, cover),
    });
  const showChooser =
    !editorOpen && api.baseline.prompt.trim() === "" && draft.prompt.trim() === "";
  return (
    <div className="nd-stack">
      {gettingReady && (
        <GetReadyChecklist
          items={readyItems(draft, { modelNeeded, isEntry })}
          onHide={() => {
            rememberReadyHidden(node.id);
            setReadyHidden(true);
          }}
        />
      )}
      <InstructionsCard
        prompt={draft.prompt}
        saved={marking ? api.baseline.prompt : undefined}
        onChange={(v) => {
          setEditorOpen(true);
          set("prompt", v);
        }}
        focusEditor={editorOpen}
        templates={
          <TemplatesMenu
            templates={templates}
            onPick={onPickTemplate}
            onCompare={onOpenFullEditor}
          />
        }
        chooser={
          showChooser ? (
            <TemplateChooser
              templates={templates}
              onPick={onPickTemplate}
              onScratch={() => setEditorOpen(true)}
            />
          ) : undefined
        }
        banner={runtimeBanner({
          isEntry,
          readsFrom: draft.readsFrom,
          readsDefault: draft.readsDefault,
        })}
        routing={
          <RoutingStatus
            routing={routing}
            // Shows the verdict lines the arrows route on, then writes them into the draft
            // (Discard or the toast's Undo brings the text back); nothing is saved until Save.
            onUpdate={isEntry ? undefined : onUpdateRouting}
          />
        }
        onOpenFullEditor={onOpenFullEditor}
      />
      <ModelSection
        nodeId={node.id}
        model={draft.model}
        onModelChange={(v) => set("model", v)}
        multimodal={draft.multimodal}
        onMultimodalChange={(v) => set("multimodal", v)}
        picker={picker}
        sameModelAs={sameModelSibling(node, draft.model, nodes, edges, {
          verdict: routing.kind === "verdict",
        })}
        agentName={agentName}
        changed={changed}
      />
      <AccessSection
        agentName={agentName}
        nodeId={node.id}
        nodes={nodes}
        edges={edges}
        editsAllowed={draft.editsAllowed}
        onEditsChange={(v) => set("editsAllowed", v)}
        isEntry={isEntry}
        verdict={routing.kind === "verdict"}
        reads={{ readsFrom: draft.readsFrom, readsDefault: draft.readsDefault }}
        onReadsChange={(next) => update(next)}
        writesTo={draft.writesTo}
        onWritesChange={(v) => set("writesTo", v)}
        onNewDocument={onNewDocument}
        changed={changed}
      />
      <AdvancedSection
        fallbackModel={draft.fallbackModel}
        outputSchema={draft.outputSchema}
        onBackupChange={(v) => set("fallbackModel", v)}
        picker={picker}
        changed={changed}
      />
    </div>
  );
}
