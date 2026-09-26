import { useState } from "react";
import { AlertTriangle, KeyRound, Monitor } from "lucide-react";

import { Switch } from "../../design-system/components";
import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import type { NodeTemplate } from "../../lib/api/nodes";
import type { AgentDraftApi } from "../useAgentDraft";
import { AccessSection } from "./AccessSection";
import { AdvancedSection } from "./AdvancedSection";
import { isGettingReady, isReadyHidden, readyItems, rememberReadyHidden } from "./getReady";
import { GetReadyChecklist } from "./GetReadyChecklist";
import { InstructionsCard } from "./InstructionsCard";
import { ModelButton } from "./ModelButton";
import { type CredentialCover, type ModelHint, modelHint, needsModel } from "./modelCopy";
import { routingOf } from "./routing";
import { RoutingStatus } from "./RoutingStatus";
import { SettingRow, SettingSection } from "./SettingRow";
import { runtimeBanner, TIPS } from "./setupCopy";
import { TemplateChooser } from "./TemplateChooser";
import { TemplatesMenu } from "./TemplatesMenu";
import { useNodeTemplates } from "./useNodeTemplates";

function HintLine({ hint }: { hint: ModelHint }) {
  const Icon =
    hint.icon === "monitor"
      ? Monitor
      : hint.icon === "key"
        ? KeyRound
        : hint.icon === "warn"
          ? AlertTriangle
          : null;
  if (!Icon) return <>{hint.text}</>;
  return (
    <span className="nd-hint__icon">
      <Icon size={13} strokeWidth={1.7} aria-hidden />
      {hint.text}
    </span>
  );
}

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
  onOpenFullEditor,
  onPickTemplate,
  onUpdateRouting,
}: {
  node: TeamGraphNode;
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
  isEntry: boolean;
  draft: AgentDraftApi;
  /** The account's credentials (null while loading). */
  cover: CredentialCover | null;
  onOpenFullEditor?: () => void;
  /** A template picked from the menu or the chooser (the editor asks before replacing text). */
  onPickTemplate: (template: NodeTemplate) => void;
  /** "Update instructions": write the verdict lines the arrows need (the editor confirms first). */
  onUpdateRouting: () => void;
}) {
  const { draft, set, update } = api;
  const templates = useNodeTemplates();
  const [readyHidden, setReadyHidden] = useState(() => isReadyHidden(node.id));
  // "Start from scratch" (or any text typed since) keeps the editor, even when it's emptied again.
  const [editorOpen, setEditorOpen] = useState(false);
  const routing = routingOf(node.id, draft.prompt, nodes, edges);
  const hint = modelHint(draft.model, cover);
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
      <SettingSection title="Model">
        <SettingRow
          label="Model"
          tip={TIPS.model}
          hint={hint ? <HintLine hint={hint} /> : undefined}
          changed={changed.includes("model")}
        >
          <ModelButton model={draft.model} emptyLabel="Choose a model" />
        </SettingRow>
        <SettingRow label="Images" tip={TIPS.images} changed={changed.includes("images")}>
          <Switch
            aria-label="Images"
            checked={draft.multimodal}
            onCheckedChange={(v) => set("multimodal", v)}
          />
        </SettingRow>
      </SettingSection>
      <AccessSection
        editsAllowed={draft.editsAllowed}
        onEditsChange={(v) => set("editsAllowed", v)}
        isEntry={isEntry}
        readsFrom={draft.readsFrom}
        readsDefault={draft.readsDefault}
        onReadsChange={(readsFrom, readsDefault) => update({ readsFrom, readsDefault })}
        writesTo={draft.writesTo}
        onWritesChange={(v) => set("writesTo", v)}
        changed={changed}
      />
      <AdvancedSection
        fallbackModel={draft.fallbackModel}
        outputSchema={draft.outputSchema}
        changed={changed}
      />
    </div>
  );
}
