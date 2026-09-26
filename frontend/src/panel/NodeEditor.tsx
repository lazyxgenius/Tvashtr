import { type MutableRefObject, useState } from "react";
import { Zap } from "lucide-react";

import { LastRun } from "../components/LastRun";
import { Button } from "../design-system/components";
import {
  type GateConfig,
  getProviderCatalogue,
  type GraphEdge,
  type ProviderCatalogueEntry,
  type TeamGraphNode,
} from "../lib/api";
import type { NodeTemplate } from "../lib/api/nodes";
import type { EnginesTab, NodeTab, Route } from "../lib/nav";
import { nodeDescription, nodeTitle } from "../lib/nodeNames";
import { type AgentDraft, describeChanges } from "./agentDraft";
import { DrawerConfirm } from "./DrawerConfirm";
import { DrawerToast } from "./DrawerToast";
import { NodeFocusView } from "./focus/NodeFocusView";
import { DomainQueryBody } from "./legacy/DomainQueryBody";
import { GateBody } from "./legacy/GateBody";
import { legacySubtitle } from "./legacy/legacyCopy";
import { TerminalBody } from "./legacy/TerminalBody";
import { skillsAndToolsCount } from "./nodeCounts";
import { modelLabel, statusBadge } from "./nodeBadges";
import { NodeBadges, NodeHeader } from "./NodeHeader";
import { deleteAgentBody } from "./nodeActions";
import { NodeDrawer } from "./NodeDrawer";
import { glyphForNode } from "./nodeGlyph";
import { NodeMemorySection } from "./NodeMemorySection";
import { NodeMoreMenu } from "./NodeMoreMenu";
import { NodeTabs } from "./NodeTabs";
import { SaveBar } from "./SaveBar";
import { useSaveShortcut } from "./saveShortcut";
import { isGettingReady } from "./setup/getReady";
import { RoutingUpdateConfirm, TemplateReplaceConfirm } from "./setup/InstructionConfirms";
import { type ModelGroup, seatOf } from "./setup/modelCatalog";
import { type CredentialCover, isDesktopApp, needsModel } from "./setup/modelCopy";
import type { ModelPickerContext } from "./setup/ModelSection";
import { OutputSchemaEditor } from "./setup/OutputSchemaEditor";
import { type ContractUpdate, contractUpdate, routingOf } from "./setup/routing";
import { checkSchema, schemaDraftText } from "./setup/schemaCheck";
import { SetupTab } from "./setup/SetupTab";
import { NEW_DOCUMENT_TOAST } from "./setup/setupCopy";
import { templateAppliedText, templateApplication, templateNeedsConfirm } from "./setup/templates";
import { desktopSubscriptionNote } from "./skills/nodeSkills";
import { AddSkillView, type SkillSub } from "./skills/AddSkillViews";
import { SkillsToolsTab } from "./skills/SkillsToolsTab";
import { useShelves } from "./skills/useShelves";
import { AddToolView, type ToolSub } from "./tools/AddToolViews";
import { useAgentDraft } from "./useAgentDraft";
import { useDrawerToast } from "./useDrawerToast";
import { useNodeMemoryCount } from "./useNodeMemoryCount";
import { type LeaveGuard, useUnsavedGuard } from "./useUnsavedGuard";
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
  /**
   * The page's handle on the unsaved-changes guard: it calls `guardRef.current(proceed)` before it
   * closes the drawer, selects another node or leaves the canvas (PANEL-21).
   */
  guardRef?: MutableRefObject<LeaveGuard | null>;
  /** Delete this agent (and its arrows), close the drawer and reload the graph (PANEL-25). */
  onDelete?: () => Promise<void>;
  /** The served provider catalogue (`/api/config`); defaults to the one cached at boot. */
  catalogue?: readonly ProviderCatalogueEntry[];
  /** Open Dashboard › Engines ("Add a provider" → API keys; the key toast's "Open Engines"). */
  onOpenEngines?: (tab: EnginesTab) => void;
  /** A key added from the model picker is now on the account (the page updates its cover). */
  onProviderAdded?: (provider: string) => void;
  /** Open a Toolkit page (a library skill or tool: "Open in Toolkit"). */
  onOpenToolkit?: (route: Route) => void;
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
  tab,
  onTabChange,
  focus,
  onFocusChange,
  onClose,
  onSaved,
  onManageMemory,
  guardRef,
  onDelete,
  catalogue,
  onOpenEngines,
  onProviderAdded,
  onOpenToolkit,
  cover: pageCover,
}: NodeEditorProps) {
  const api = useAgentDraft(node, { teamId, onSaved: () => onSaved() });
  // Providers whose key was pasted into the model picker here: their hint says "(saved in Engines)",
  // and they cover the draft's model before the page's own credentials catch up.
  const [justAdded, setJustAdded] = useState<ReadonlySet<string>>(() => new Set());
  const cover: CredentialCover | null =
    pageCover && justAdded.size > 0
      ? { ...pageCover, byok: new Set([...pageCover.byok, ...justAdded]) }
      : pageCover;
  const { draft } = api;
  const memoryCount = useNodeMemoryCount(node.id);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // A template or routing change waiting on its confirm (Flow-Templates-2, Flow-Routing-2).
  const [pending, setPending] = useState<
    | { kind: "template"; template: NodeTemplate }
    | { kind: "routing"; update: ContractUpdate }
    | null
  >(null);
  const toast = useDrawerToast();
  // The Output format editor's text while it's open (null: closed). Done writes it to the draft.
  const [schemaText, setSchemaText] = useState<string | null>(null);
  // The Skills sheet open over the Skills & tools tab (write / repo / presets / library; G8).
  const [skillSub, setSkillSub] = useState<SkillSub | null>(null);
  // The Tools sheet (add a server / library / paste mcp.json, or Edit connection; G9).
  const [toolSub, setToolSub] = useState<ToolSub | null>(null);
  const shelves = useShelves(tab === "skills");

  // The header follows the draft, so a rename shows before it's saved.
  const cfg = (node.config as Record<string, unknown> | null) ?? {};
  const name = draft.title.trim() || nodeTitle({ ...node, config: { ...cfg, title: "" } });
  const description =
    draft.description.trim() || nodeDescription({ ...node, config: { ...cfg, description: "" } });
  const glyph = isEntry ? Zap : glyphForNode(node.kind, node.role_name);
  // A new agent's header shows how it ran (not yet) and its model only (Web-NewAgent).
  const isNew = isGettingReady({
    hasRun: node.last_run != null,
    savedPrompt: api.baseline.prompt,
    savedModelNeeded: needsModel(api.baseline.model, cover),
  });

  const guard = useUnsavedGuard({ dirty: api.isDirty, agentName: name, guardRef });
  // PANEL-22: no Save while the open Output format editor holds a broken schema.
  const schemaBroken = schemaText !== null && checkSchema(schemaText).state === "error";
  const canSave = api.isDirty && api.problem === null && !schemaBroken;
  // The drawer's Output format editor covers the Save footer; focus mode keeps it in view.
  const subCoversFooter =
    (schemaText !== null && tab === "setup" && !focus) ||
    ((skillSub !== null || toolSub !== null) && tab === "skills");
  // ⌘S / Ctrl+S saves; while a confirm is open the confirm's own buttons decide.
  useSaveShortcut(() => {
    if (canSave && !guard.asking && !deleting && !pending && !subCoversFooter) void api.save();
  });

  // Q7: a template sets the instructions and its default File access (a sandboxed agent's only;
  // the entry agent stays read-only). Undo puts back what it replaced.
  const canSetFileAccess = node.kind === "agent" && !isEntry;
  const applyTemplate = (template: NodeTemplate) => {
    const before = { prompt: draft.prompt, editsAllowed: draft.editsAllowed };
    api.update(templateApplication(template, draft, canSetFileAccess).patch);
    toast.show(templateAppliedText(template.title), {
      label: "Undo",
      onAction: () => api.update(before),
    });
  };
  const pickTemplate = (template: NodeTemplate) => {
    if (templateNeedsConfirm(draft.prompt)) setPending({ kind: "template", template });
    else applyTemplate(template);
  };
  const requestRoutingUpdate = () => {
    const update = contractUpdate(node.id, draft.prompt, edges);
    if (update) setPending({ kind: "routing", update });
  };
  const applyRoutingUpdate = (update: ContractUpdate) => {
    const before = draft.prompt;
    api.set("prompt", update.next);
    toast.show("Instructions updated to match your arrows", {
      label: "Undo",
      onAction: () => api.set("prompt", before),
    });
  };

  // PANEL-43: the key is on the account now; the model lands on that provider's default.
  const keySaved = (group: ModelGroup) => {
    setJustAdded((prev) => new Set([...prev, group.provider]));
    onProviderAdded?.(group.provider);
    toast.show(
      `${group.label} key saved to Engines`,
      onOpenEngines ? { label: "Open Engines", onAction: () => onOpenEngines("keys") } : undefined,
    );
  };
  const picker: ModelPickerContext = {
    catalogue: catalogue ?? getProviderCatalogue(),
    seat: seatOf(node),
    cover,
    desktop: isDesktopApp(),
    justAdded,
    onKeySaved: keySaved,
    onAddProvider: onOpenEngines ? () => onOpenEngines("keys") : undefined,
  };

  // Output format (PANEL-59/60): edit a copy; Done writes it (pretty-printed; empty = none).
  const routing = routingOf(node.id, draft.prompt, nodes, edges);
  const closeSchema = () => {
    setSchemaText(null);
    // Back on the Output format row, where the editor was opened from.
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("[data-output-format]")?.focus(),
    );
  };
  const schemaEditor =
    schemaText !== null && tab === "setup" ? (
      <OutputSchemaEditor
        value={schemaText}
        onChange={setSchemaText}
        verdictLabels={routing.kind === "verdict" ? routing.labels : null}
        onCancel={closeSchema}
        onDone={() => {
          const next = schemaDraftText(schemaText);
          if (next === null) return;
          api.set("outputSchema", next);
          closeSchema();
        }}
      />
    ) : null;

  const closeSkillSub = () => {
    setSkillSub(null);
    // Back on the list, at the menu the sheet was opened from.
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("[data-add-skill]")?.focus(),
    );
  };
  const skillEditor =
    skillSub !== null && tab === "skills" ? (
      <AddSkillView
        sub={skillSub}
        skills={draft.skills}
        library={shelves.skillLibrary}
        onChange={(v) => api.set("skills", v)}
        onLibraryAdded={shelves.addSkillItems}
        notify={toast.show}
        onOpenToolkit={onOpenToolkit}
        onClose={closeSkillSub}
      />
    ) : null;

  const closeToolSub = () => {
    setToolSub(null);
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("[data-add-tool]")?.focus(),
    );
  };
  const toolEditor =
    toolSub !== null && tab === "skills" ? (
      <AddToolView
        sub={toolSub}
        config={draft.toolConfig}
        library={shelves.toolLibrary}
        secrets={shelves.secrets}
        onChange={(v) => api.set("toolConfig", v)}
        notify={toast.show}
        onOpenToolkit={onOpenToolkit}
        onClose={closeToolSub}
      />
    ) : null;

  const commitRename = (nextName: string, nextDescription: string) => {
    // Only what actually changed goes into the draft (the built-in name stays built-in).
    const patch: Partial<AgentDraft> = {};
    if (nextName !== name) patch.title = nextName;
    if (nextDescription !== description) patch.description = nextDescription;
    if (Object.keys(patch).length > 0) api.update(patch);
    setRenaming(false);
  };

  const confirmDelete = async () => {
    setDeleteBusy(true);
    try {
      await onDelete?.();
    } finally {
      // The page closes the drawer on success; a failure leaves it open to try again.
      setDeleteBusy(false);
      setDeleting(false);
    }
  };

  let overlay = null;
  if (guard.asking) {
    overlay = (
      <DrawerConfirm
        placement="footer"
        label="Unsaved changes"
        title={`Save your changes to ${name}?`}
        onCancel={guard.keepEditing}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={guard.keepEditing}>
              Keep editing
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                api.discard();
                guard.leave();
              }}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={api.saveState === "saving"}
              disabled={api.problem !== null}
              onClick={() => {
                void api.save().then((ok) => (ok ? guard.leave() : guard.keepEditing()));
              }}
            >
              Save
            </Button>
          </>
        }
      >
        You changed {describeChanges(api.changed)}.
      </DrawerConfirm>
    );
  } else if (deleting) {
    overlay = (
      <DrawerConfirm
        title={`Delete ${name}?`}
        onCancel={() => setDeleting(false)}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={deleteBusy}
              onClick={() => void confirmDelete()}
            >
              Delete agent
            </Button>
          </>
        }
      >
        {deleteAgentBody(node.id, nodes, edges)}
      </DrawerConfirm>
    );
  } else if (pending?.kind === "template") {
    const { template } = pending;
    overlay = (
      <TemplateReplaceConfirm
        title={template.title}
        fileAccess={templateApplication(template, draft, canSetFileAccess).fileAccess}
        onCancel={() => setPending(null)}
        onReplace={() => {
          setPending(null);
          applyTemplate(template);
        }}
      />
    );
  } else if (pending?.kind === "routing") {
    const { update } = pending;
    overlay = (
      <RoutingUpdateConfirm
        update={update}
        onCancel={() => setPending(null)}
        onApply={() => {
          setPending(null);
          applyRoutingUpdate(update);
        }}
      />
    );
  }

  let body;
  switch (tab) {
    case "skills":
      // Focus mode has no sheet slot on this tab: the sheet takes the tab's place.
      body = (focus && (skillEditor ?? toolEditor)) || (
        <SkillsToolsTab
          skills={draft.skills}
          toolConfig={draft.toolConfig}
          onSkillsChange={(v) => api.set("skills", v)}
          onToolsChange={(v) => api.set("toolConfig", v)}
          note={desktopSubscriptionNote(draft.model, cover, isDesktopApp())}
          notify={toast.show}
          onAddSkill={(kind) => setSkillSub({ kind })}
          onEditSkill={(index) => setSkillSub({ kind: "write", index })}
          onAddTool={(kind) => setToolSub({ kind })}
          onEditServer={(name) => setToolSub({ kind: "server", edit: name })}
          onOpenToolkit={onOpenToolkit}
          shelves={shelves}
        />
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
          layout={focus ? "focus" : "drawer"}
          teamId={teamId}
          node={node}
          nodes={nodes}
          edges={edges}
          isEntry={isEntry}
          draft={api}
          cover={cover}
          picker={picker}
          agentName={name}
          onOpenFullEditor={focus ? undefined : () => onFocusChange(true)}
          onPickTemplate={pickTemplate}
          onUpdateRouting={requestRoutingUpdate}
          onNewDocument={() => toast.show(NEW_DOCUMENT_TOAST)}
          onEditSchema={() => setSchemaText(draft.outputSchema)}
          sub={focus ? schemaEditor : undefined}
        />
      );
  }

  const header = (
    <NodeHeader
      glyph={glyph}
      name={name}
      description={description}
      placeholder="Add a short description"
      focused={focus}
      onFocus={() => onFocusChange(!focus)}
      more={
        <NodeMoreMenu
          onOpenFocus={focus ? undefined : () => onFocusChange(true)}
          onRename={() => setRenaming(true)}
          onOpenDocs={() => onTabChange("docs")}
          onDelete={() => setDeleting(true)}
        />
      }
      rename={renaming ? { onCommit: commitRename, onCancel: () => setRenaming(false) } : null}
      onClose={onClose}
      badges={
        <NodeBadges
          status={statusBadge(node.last_run)}
          editsAllowed={isNew ? null : draft.editsAllowed}
          model={needsModel(draft.model, cover) ? null : modelLabel(draft.model)}
          onOpenRuns={() => onTabChange("runs")}
        />
      }
    />
  );
  const tabs = (
    <NodeTabs
      value={tab}
      onChange={onTabChange}
      skillsCount={skillsAndToolsCount(draft.skills, draft.toolConfig)}
      memoryCount={memoryCount}
    />
  );
  const footer = (
    <SaveBar
      dirtyCount={api.dirtyCount}
      saveState={api.saveState}
      error={api.saveError}
      canSave={canSave}
      memoryTab={tab === "memory"}
      onSave={() => void api.save()}
      onDiscard={api.discard}
    />
  );
  const toastHost = <DrawerToast toast={toast.toast} onDismiss={toast.dismiss} />;

  if (focus) {
    return (
      <NodeFocusView
        name={name}
        header={header}
        tabs={tabs}
        footer={footer}
        scroll={tab !== "setup"}
        toast={toastHost}
        overlay={overlay}
        onDock={() => onFocusChange(false)}
      >
        {body}
      </NodeFocusView>
    );
  }
  return (
    <NodeDrawer
      name={name}
      header={header}
      tabs={tabs}
      footer={footer}
      sub={schemaEditor ?? skillEditor ?? toolEditor}
      toast={toastHost}
      overlay={overlay}
    >
      {body}
    </NodeDrawer>
  );
}
