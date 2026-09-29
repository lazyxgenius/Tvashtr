import { type MutableRefObject, useEffect, useState } from "react";
import { Zap } from "lucide-react";

import { Button } from "../design-system/components";
import {
  type GateConfig,
  getProviderCatalogue,
  type GraphEdge,
  type ProviderCatalogueEntry,
  type TeamGraphNode,
} from "../lib/api";
import { deleteMemory, type Memory } from "../lib/api/memory";
import { getNodeRuns, type NodeTemplate } from "../lib/api/nodes";
import type { EnginesTab, NodeTab, Route } from "../lib/nav";
import { nodeDescription, nodeTitle } from "../lib/nodeNames";
import { type AgentDraft, describeChanges, revertGroup } from "./agentDraft";
import { DrawerConfirm } from "./DrawerConfirm";
import { DocsTab } from "./docs/DocsTab";
import type { DocPlace } from "./docs/docView";
import { AgentPreview } from "./focus/AgentPreview";
import { FocusDocsTab } from "./focus/FocusDocsTab";
import { FocusMemoryTab } from "./focus/FocusMemoryTab";
import { FocusRunsTab } from "./focus/FocusRunsTab";
import { FocusSkillsTab } from "./focus/FocusSkillsTab";
import { DrawerToast } from "./DrawerToast";
import { NodeFocusView } from "./focus/NodeFocusView";
import { ReviewChanges } from "./focus/ReviewChanges";
import { reviewSections } from "./focus/reviewSections";
import { TemplatesDialog } from "./focus/TemplatesDialog";
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
import { MemoryTab } from "./memory/MemoryTab";
import { useNodeMemories } from "./memory/useNodeMemories";
import { NodeMoreMenu } from "./NodeMoreMenu";
import { NodeTabs } from "./NodeTabs";
import { RunsTab } from "./runs/RunsTab";
import { useLoaded } from "./runs/useLoaded";
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
import { desktopSubscriptionName, desktopSubscriptionNote } from "./skills/nodeSkills";
import { AddSkillView, type SkillSub } from "./skills/AddSkillViews";
import { SkillsToolsTab } from "./skills/SkillsToolsTab";
import { useShelves } from "./skills/useShelves";
import { AddToolView, type ToolSub } from "./tools/AddToolViews";
import { useAgentDraft } from "./useAgentDraft";
import { useDrawerToast } from "./useDrawerToast";
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
  /** Docs "See all documents in this run": the page's Documents drawer on that run (DOCS-6). */
  onOpenDocuments?: (runId: string) => void;
  /** A document's Open: the document viewer (DOCS-18), on that version or compare. */
  onOpenDoc?: (docId: string, place?: DocPlace) => void;
  /** Focus Runs' "Open this run on the canvas": the run view of that run (FOCUS-64). */
  onOpenRun?: (runId: string) => void;
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
  guardRef,
  onDelete,
  catalogue,
  onOpenEngines,
  onProviderAdded,
  onOpenToolkit,
  onOpenDocuments,
  onOpenDoc,
  onOpenRun,
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
  const memories = useNodeMemories(node.id);
  // The note waiting on its Delete confirm (Flow-Memory-4).
  const [forgetting, setForgetting] = useState<Memory | null>(null);
  const [forgetBusy, setForgetBusy] = useState(false);
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
  // Focus mode's Setup body: the editor, "Preview as the agent sees it" or Review changes (OQ-4).
  const [setupView, setSetupView] = useState<"edit" | "preview" | "review">("edit");
  // The Templates dialog (focus mode; the drawer menu's "Compare templates in focus view" opens it
  // together with the focus view, so the flag lives here, above both). From the drawer it's
  // "wanted" until the focus view is up, then opens on top of it (so it gets Escape, Tab and the
  // keyboard focus: this effect runs after the focus view's). Docking closes it.
  const [templates, setTemplates] = useState<"closed" | "wanted" | "open">("closed");
  const templatesOpen = templates === "open";
  if (!focus && templatesOpen) setTemplates("closed");
  useEffect(() => {
    if (focus && templates === "wanted") setTemplates("open");
  }, [focus, templates]);
  // Review changes closes itself once nothing is left to review (the last Undo, or a Save).
  if (setupView === "review" && !api.isDirty) setSetupView("edit");
  const view = focus && tab === "setup" ? setupView : "edit";
  // The Output format editor's text while it's open (null: closed). Done writes it to the draft.
  const [schemaText, setSchemaText] = useState<string | null>(null);
  // The Skills sheet open over the Skills & tools tab (write / repo / presets / library; G8).
  const [skillSub, setSkillSub] = useState<SkillSub | null>(null);
  // The Tools sheet (add a server / library / paste mcp.json, or Edit connection; G9).
  const [toolSub, setToolSub] = useState<ToolSub | null>(null);
  const shelves = useShelves(tab === "skills" || view === "review");
  // Runs and Docs share this agent's history, keyed on its last run (a new round reloads it); focus
  // Memory reads its latest run's repo ("This repo").
  const last = node.last_run;
  const [historyWanted, setHistoryWanted] = useState(false);
  if (!historyWanted && (tab === "runs" || tab === "docs" || (focus && tab === "memory")))
    setHistoryWanted(true);
  const history = useLoaded(
    historyWanted && last ? `${last.run_id}:${last.iteration}:${last.outcome ?? ""}` : null,
    () => getNodeRuns(teamId, node.id),
  );

  // The header follows the draft, so a rename shows before it's saved.
  const cfg = (node.config as Record<string, unknown> | null) ?? {};
  const builtInName = nodeTitle({ ...node, config: { ...cfg, title: "" } });
  const builtInDescription = nodeDescription({ ...node, config: { ...cfg, description: "" } });
  const name = draft.title.trim() || builtInName;
  const description = draft.description.trim() || builtInDescription;
  const glyph = isEntry ? Zap : glyphForNode(node.kind, node.role_name);
  // A new agent's header shows how it ran (not yet) and its model only (Web-NewAgent).
  const isNew = isGettingReady({
    hasRun: node.last_run != null,
    savedPrompt: api.baseline.prompt,
    savedModel: api.baseline.model,
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
    const busy = guard.asking || deleting || pending || forgetting || templatesOpen;
    if (canSave && !busy && !subCoversFooter) void api.save();
  });

  // Q7: a template sets the instructions and its default File access (thinker or worker: both run
  // the agent loop; only the entry agent stays read-only). Undo puts back what it replaced.
  const canSetFileAccess = !isEntry;
  // `promptOnly`: the focus view's Templates dialog replaces only the instructions (OQ-5).
  const applyTemplate = (template: NodeTemplate, promptOnly = false) => {
    const before = { prompt: draft.prompt, editsAllowed: draft.editsAllowed };
    api.update(templateApplication(template, draft, canSetFileAccess && !promptOnly).patch);
    toast.show(templateAppliedText(template.title), {
      label: "Undo",
      onAction: () => api.update(before),
    });
  };
  const pickTemplate = (template: NodeTemplate) => {
    if (templateNeedsConfirm(draft.prompt)) setPending({ kind: "template", template });
    else applyTemplate(template);
  };
  // Templates: the drawer menu's "Compare templates in focus view" and focus mode's button.
  const openTemplates = () => {
    setTemplates(focus ? "open" : "wanted");
    if (!focus) onFocusChange(true);
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
        retryLibrary={shelves.failed.skillLibrary ? shelves.retry : undefined}
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
        retryLibrary={shelves.failed.toolLibrary ? shelves.retry : undefined}
        secrets={shelves.secrets}
        onChange={(v) => api.set("toolConfig", v)}
        notify={toast.show}
        onOpenToolkit={onOpenToolkit}
        onClose={closeToolSub}
      />
    ) : null;

  // "Turn on File access in Setup" / "Set in Setup": the Setup tab, on that control.
  const openSetup = (selector: string) => {
    onTabChange("setup");
    window.requestAnimationFrame(() => {
      const button = document.querySelector<HTMLElement>(selector);
      button?.scrollIntoView?.({ block: "nearest" });
      button?.focus();
    });
  };
  const openFileAccess = () => openSetup('[aria-label="File access"] button');

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
  } else if (forgetting) {
    const note = forgetting;
    const close = () => setForgetting(null);
    overlay = (
      <DrawerConfirm
        title="Delete this note?"
        onCancel={close}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={forgetBusy}
              onClick={() => {
                setForgetBusy(true);
                void memories
                  .change(() => deleteMemory(note.id))
                  .then((done) => {
                    setForgetBusy(false);
                    close();
                    if (!done) toast.show("Couldn’t delete the note. Try again.");
                  });
              }}
            >
              Delete note
            </Button>
          </>
        }
      >
        {note.tier === "repo" || note.tier === "account"
          ? "Agents stop seeing it on their next run."
          : `${name} won’t be reminded of it again.`}{" "}
        You can’t undo this.
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
  } else if (focus && templatesOpen) {
    overlay = (
      <TemplatesDialog
        roleName={node.role_name}
        onClose={() => setTemplates("closed")}
        onUse={(template) => {
          setTemplates("closed");
          // The dialog already says it replaces the instructions (FOCUS-38): no second confirm,
          // and only the instructions change (OQ-5).
          applyTemplate(template, true);
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

  // Focus mode has no sheet slot on the Skills tab: an open sheet takes the tab's place.
  const sheetOpen = tab === "skills" && (skillSub !== null || toolSub !== null);
  let body;
  switch (tab) {
    case "skills": {
      const skillsTab = {
        skills: draft.skills,
        toolConfig: draft.toolConfig,
        onSkillsChange: (v: unknown[] | null) => api.set("skills", v),
        onToolsChange: (v: AgentDraft["toolConfig"]) => api.set("toolConfig", v),
        note: desktopSubscriptionNote(draft.model, cover, isDesktopApp()),
        notify: toast.show,
        onAddSkill: (kind: SkillSub["kind"]) => setSkillSub({ kind }),
        onEditSkill: (index: number) => setSkillSub({ kind: "write", index }),
        onAddTool: (kind: ToolSub["kind"]) => setToolSub({ kind }),
        onEditServer: (name: string) => setToolSub({ kind: "server", edit: name }),
        onOpenToolkit,
        shelves,
      };
      if (!focus) body = <SkillsToolsTab {...skillsTab} />;
      else
        body = (sheetOpen && (skillEditor ?? toolEditor)) || (
          <FocusSkillsTab
            tab={skillsTab}
            node={node}
            name={name}
            nodes={nodes}
            subscription={desktopSubscriptionName(draft.model, cover, isDesktopApp())}
          />
        );
      break;
    }
    case "memory": {
      const memoryTab = {
        teamId,
        nodeId: node.id,
        rememberSaved: cfg.memory_remember_enabled === true,
        editsAllowed: draft.editsAllowed,
        isEntry,
        memories,
        notify: toast.show,
        onRememberSaved: () => void onSaved(),
        onOpenFileAccess: openFileAccess,
        onDelete: setForgetting,
        onOpenShelf: onOpenToolkit,
      };
      body = focus ? (
        <FocusMemoryTab tab={memoryTab} repoKey={history.value?.runs[0]?.repo_key ?? null} />
      ) : (
        <MemoryTab {...memoryTab} />
      );
      break;
    }
    case "runs":
      body = focus ? (
        <FocusRunsTab
          teamId={teamId}
          nodeId={node.id}
          history={history}
          verdict={routing.kind === "verdict"}
          onOpenRun={onOpenRun}
        />
      ) : (
        <RunsTab history={history} onOpenFocus={() => onFocusChange(true)} />
      );
      break;
    case "docs":
      body = focus ? (
        <FocusDocsTab history={history} onOpenDoc={(docId, at) => onOpenDoc?.(docId, at)} />
      ) : (
        <DocsTab
          nodeId={node.id}
          name={name}
          isEntry={isEntry}
          verdict={routing.kind === "verdict"}
          writesTo={api.baseline.writesTo}
          readsFrom={api.baseline.readsFrom}
          agentCount={nodes.filter((n) => n.kind === "agent" || n.kind === "completion").length}
          history={history}
          onOpenDoc={(doc) => onOpenDoc?.(doc.id)}
          onOpenAll={(runId) => onOpenDocuments?.(runId)}
          onSetup={(row) => openSetup(`[data-setup-row="${row}"]`)}
        />
      );
      break;
    default:
      body =
        view === "preview" ? (
          <AgentPreview
            teamId={teamId}
            nodeId={node.id}
            draft={{
              prompt: draft.prompt,
              model: draft.model,
              edits_allowed: draft.editsAllowed,
              reads_from: draft.readsFrom,
              reads_default: draft.readsDefault,
              // [] (not absent): an absent key would preview the SAVED skills.
              skills: draft.skills ?? [],
            }}
            onBack={() => setSetupView("edit")}
          />
        ) : view === "review" ? (
          <ReviewChanges
            sections={reviewSections(api.baseline, draft, api.changed, {
              builtInName,
              builtInDescription,
              skillLibrary: shelves.skillLibrary,
              toolLibrary: shelves.toolLibrary,
            })}
            onUndo={(group) => api.update(revertGroup(api.baseline, group))}
            onBack={() => setSetupView("edit")}
          />
        ) : null;
      body ??= (
        <SetupTab
          layout={focus ? "focus" : "drawer"}
          node={node}
          nodes={nodes}
          edges={edges}
          isEntry={isEntry}
          draft={api}
          picker={picker}
          agentName={name}
          onOpenFullEditor={focus ? undefined : () => onFocusChange(true)}
          onPickTemplate={pickTemplate}
          onUpdateRouting={requestRoutingUpdate}
          onNewDocument={() => toast.show(NEW_DOCUMENT_TOAST)}
          onEditSchema={() => setSchemaText(draft.outputSchema)}
          onCompareTemplates={openTemplates}
          onPreview={() => setSetupView("preview")}
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
      memoryCount={memories.count}
    />
  );
  const footer = (
    <SaveBar
      dirtyCount={api.dirtyCount}
      saveState={api.saveState}
      error={api.saveError}
      problem={api.problem}
      canSave={canSave}
      memoryTab={tab === "memory"}
      onSave={() => void api.save()}
      onDiscard={api.discard}
      onReview={
        focus
          ? () => {
              onTabChange("setup");
              setSetupView("review");
            }
          : undefined
      }
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
        scroll={sheetOpen}
        toast={toastHost}
        overlay={overlay}
        // Escape leaves the preview / review first, then docks (FOCUS-13).
        onDock={() => (view !== "edit" ? setSetupView("edit") : onFocusChange(false))}
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
