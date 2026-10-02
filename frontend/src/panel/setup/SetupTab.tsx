import { type ReactNode, useState } from "react";
import { Layers } from "lucide-react";

import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import { Button } from "../../design-system/components";
import type { NodeTemplate } from "../../lib/api/nodes";
import { InstructionsEditor } from "../focus/InstructionsEditor";
import type { AgentDraftApi } from "../useAgentDraft";
import { AccessSection } from "./AccessSection";
import { AdvancedSection } from "./AdvancedSection";
import { isGettingReady, isReadyHidden, readyItems, rememberReadyHidden } from "./getReady";
import { GetReadyChecklist } from "./GetReadyChecklist";
import { InstructionHistory } from "./InstructionHistory";
import { InstructionsCard } from "./InstructionsCard";
import { sameModelSibling } from "./modelCatalog";
import { type ModelPickerContext, ModelSection } from "./ModelSection";
import { routingOf } from "./routing";
import { RoutingStatus } from "./RoutingStatus";
import { SettingSection } from "./SettingRow";
import { runtimeBanner } from "./setupCopy";
import { TemplateChooser } from "./TemplateChooser";
import { type MyAgentsMenu, TemplatesMenu } from "./TemplatesMenu";
import { useNodeTemplates } from "./useNodeTemplates";

/**
 * The Setup tab (Main / Web-Setup / Panel-FullLength): instructions with the routing line, the
 * model and Images, Access & documents, and the Advanced disclosure. Every edit goes into the
 * shared draft; nothing is saved until Save. A new agent (Web-NewAgent) also gets the "Get this
 * agent ready" checklist and, while its instructions are empty, the template chooser.
 * `layout="focus"` is focus mode's Setup (Desktop-Focus): the full instructions editor on the left
 * and Routing, Model, Access & documents and Advanced (open) in a column on the right; its
 * Templates button opens the Templates dialog and "Preview as the agent sees it" the preview (both
 * owned by the editor, which renders them over / in place of this tab).
 * `readOnly` is the run view's Setup: what the run's copy of the agent had, with every control
 * disabled (the instructions stay readable and Advanced starts open).
 */
export function SetupTab({
  layout = "drawer",
  node,
  nodes,
  edges,
  isEntry,
  draft: api,
  picker,
  agentName,
  onOpenFullEditor,
  onPickTemplate,
  onUpdateRouting,
  onNewDocument,
  onEditSchema,
  onCompareTemplates,
  onPreview,
  sub,
  history,
  myAgents,
  basedOn,
  readOnly = false,
}: {
  layout?: "drawer" | "focus";
  node: TeamGraphNode;
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
  isEntry: boolean;
  draft: AgentDraftApi;
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
  /** Open the Output format editor. */
  onEditSchema?: () => void;
  /** The drawer menu's "Compare templates in focus view"; focus mode's Templates button. */
  onCompareTemplates?: () => void;
  /** Focus mode: "Preview as the agent sees it". */
  onPreview?: () => void;
  /** Focus mode: a sub-view (the Output format editor) in the settings column's place. */
  sub?: ReactNode;
  /** M5: the drawer's Instructions › History (authoring): the team, its latest version, and
   *  "Use this text". */
  history?: { teamId: string; version?: number; onUse: (text: string, number: number) => void };
  /** M6: the Templates menu's "My agents" (Agents-Menu). */
  myAgents?: MyAgentsMenu;
  /** M6: the Instructions card's based-on banner (Agents-Use). */
  basedOn?: { label: string; onDetach?: () => void };
  readOnly?: boolean;
}) {
  const { draft, set, update } = api;
  const templates = useNodeTemplates();
  const [readyHidden, setReadyHidden] = useState(() => isReadyHidden(node.id));
  // "Start from scratch" (or any text typed since) keeps the editor, even when it's emptied again.
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const routing = routingOf(node.id, draft.prompt, nodes, edges);
  // The Changed marks follow the draft; while a save is on its way they step back (Flow-Save-2).
  const marking = api.saveState !== "saving";
  const changed = marking ? api.changed : [];
  const gettingReady =
    !readOnly &&
    !readyHidden &&
    isGettingReady({
      hasRun: node.last_run != null,
      savedPrompt: api.baseline.prompt,
      savedModel: api.baseline.model,
    });
  const showChooser =
    !readOnly && !editorOpen && api.baseline.prompt.trim() === "" && draft.prompt.trim() === "";
  const checklist = gettingReady && (
    <GetReadyChecklist
      items={readyItems(draft, { modelNeeded: draft.model.trim() === "", isEntry })}
      onHide={() => {
        rememberReadyHidden(node.id);
        setReadyHidden(true);
      }}
    />
  );
  const banner = runtimeBanner({
    isEntry,
    readsFrom: draft.readsFrom,
    readsDefault: draft.readsDefault,
    focus: layout === "focus",
  });
  const routingStatus = (
    <RoutingStatus
      routing={routing}
      // Shows the verdict lines the arrows route on, then writes them into the draft
      // (Discard or the toast's Undo brings the text back); nothing is saved until Save.
      onUpdate={isEntry || readOnly ? undefined : onUpdateRouting}
    />
  );
  const controls = (
    <>
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
        onEditSchema={onEditSchema}
        defaultOpen={layout === "focus" || readOnly}
        changed={changed}
      />
    </>
  );
  // Read-only: one disabled fieldset turns off every control in it.
  const settings = readOnly ? (
    <fieldset className="nd-readonly" disabled>
      {controls}
    </fieldset>
  ) : (
    controls
  );
  const templatesMenu = (
    <TemplatesMenu
      templates={templates}
      onPick={onPickTemplate}
      onCompare={onCompareTemplates}
      myAgents={myAgents}
    />
  );

  if (layout === "focus") {
    return (
      <div className="fx-setup">
        <InstructionsEditor
          prompt={draft.prompt}
          saved={marking ? api.baseline.prompt : undefined}
          onChange={(v) => set("prompt", v)}
          banner={banner}
          templates={
            // The icon sits inside the label, flush with the text, as the design draws it.
            <Button
              variant="ghost"
              size="sm"
              className="nd-btn-flush"
              aria-haspopup="dialog"
              onClick={onCompareTemplates}
            >
              <Layers size={14} strokeWidth={1.7} aria-hidden />
              <span>Templates</span>
            </Button>
          }
          autoFocus
          onPreview={onPreview}
        />
        <div
          className={`fx-aside${sub ? " fx-aside--sub" : ""}`}
          role="group"
          aria-label="Settings"
        >
          {sub ?? (
            <>
              {checklist}
              <div className="fx-routing">
                <SettingSection title="Routing">{routingStatus}</SettingSection>
              </div>
              {settings}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="nd-stack">
      {checklist}
      <InstructionsCard
        prompt={draft.prompt}
        saved={marking ? api.baseline.prompt : undefined}
        onChange={(v) => {
          setEditorOpen(true);
          set("prompt", v);
        }}
        focusEditor={editorOpen}
        readOnly={readOnly}
        templates={readOnly ? undefined : templatesMenu}
        chooser={
          showChooser ? (
            <TemplateChooser
              templates={templates}
              onPick={onPickTemplate}
              onScratch={() => setEditorOpen(true)}
            />
          ) : undefined
        }
        banner={banner}
        basedOn={basedOn}
        routing={routingStatus}
        onOpenFullEditor={onOpenFullEditor}
        history={
          history && !readOnly
            ? { open: historyOpen, onToggle: () => setHistoryOpen((o) => !o) }
            : undefined
        }
      />
      {history && !readOnly && historyOpen && (
        <InstructionHistory
          teamId={history.teamId}
          nodeId={node.id}
          version={history.version}
          agent={agentName}
          role={node.role_name}
          draft={draft.prompt}
          onUse={history.onUse}
        />
      )}
      {settings}
    </div>
  );
}
