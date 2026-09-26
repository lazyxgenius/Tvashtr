/**
 * Toolkit › Tools (`#/toolkit/tools`, `#/toolkit/tools/browse`): the page header (Paste mcp.json on
 * Installed only, Add tool on both), the Installed N / Browse pill tabs driven by the address, the
 * search box and Status filter, and the tab's content. Owns the tool list both tabs read, and the
 * row actions' dialogs (TkF-FixSecret-*, TkF-ToolMenu-*): Add secret, Remove, Turn on for agents,
 * and Duplicate — and adding from the Browse catalog (TkF-Catalog-*), whose toast offers the same
 * Turn on dialog — the Add tool wizard (TkF-AddTool-*) and the Paste mcp.json sheet (TkF-Paste-*).
 */
import { Braces, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Input, Tabs, useToast } from "../../design-system/components";
import { ApiDetailError } from "../../lib/api/runs";
import {
  type CatalogEntry,
  type ToolItem,
  createTool,
  duplicateTool,
  listTools,
  setToolAgents,
} from "../../lib/api/tools";
import { navigate, parseRoute } from "../../lib/nav";
import { refreshBadges } from "../../lib/workspaceStatus";
import { SecretDialog, type SecretDialogMode } from "../secrets/SecretDialog";
import { type AddedTool, AddToolSheet } from "./AddToolSheet";
import { BrowseTab } from "./BrowseTab";
import { InstalledTab } from "./InstalledTab";
import { PasteMcpJsonSheet, type PastedTools } from "./PasteMcpJsonSheet";
import { RemoveToolDialog } from "./RemoveToolDialog";
import { StatusSelect } from "./StatusSelect";
import { TurnOnForAgentsDialog } from "./TurnOnForAgentsDialog";
import {
  agentName,
  agentsFailedToast,
  catalogAddedToast,
  pastedToast,
  toolAddedToast,
  toolSecretsSavedToast,
  turnedOnToast,
} from "./toolFormat";
import {
  markToolFresh,
  resetToolsView,
  setToolsQuery,
  setToolsStatus,
  useToolsView,
} from "./toolsState";
import "./tools.css";

type ToolsView = "installed" | "browse";

/** The sheets the page opens: the Add tool wizard (optionally with a name, or with "A custom
 *  server" chosen from Browse's Custom server card) or Paste mcp.json. */
export type ToolSheet = { kind: "add"; name?: string; start?: "custom" } | { kind: "paste" } | null;

/** The server's own words for a 4xx (e.g. "tool not found in your library"), else null. */
function clientError(e: unknown): string | null {
  if (!(e instanceof ApiDetailError) || e.status < 400 || e.status >= 500) return null;
  return e.message || null;
}

/** A row action's dialog. */
type ToolDialog =
  | { kind: "secret"; tool: ToolItem; mode: SecretDialogMode }
  | { kind: "remove"; tool: ToolItem }
  | { kind: "turn-on"; tool: ToolItem }
  | null;

/** The tool list, loaded once per visit; `reload` after a change (returns the new list, or null). */
function useToolList() {
  const [tools, setTools] = useState<ToolItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async (): Promise<ToolItem[] | null> => {
    setError(null);
    try {
      const next = await listTools();
      setTools(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load your tools.");
      return null;
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const retry = () => {
    setTools(null);
    void reload();
  };
  return { tools, error, reload, retry };
}

export function ToolsPage({ view }: { view: ToolsView }) {
  const { tools, error, reload, retry } = useToolList();
  const { query, status } = useToolsView();
  const [sheet, setSheet] = useState<ToolSheet>(null);
  const [dialog, setDialog] = useState<ToolDialog>(null);
  const toast = useToast();

  // TOOL-67: "Add secret" on a row — "Add <NAME>" with the name fixed, or one field per name when
  // the tool misses more than one (spec Q3).
  const addSecret = (tool: ToolItem) => {
    const names = tool.missing_secrets;
    if (names.length === 0) return;
    const mode: SecretDialogMode =
      names.length === 1
        ? { kind: "add-prefilled", name: names[0], tools: [{ id: tool.id, name: tool.name }] }
        : { kind: "add-many", names, tool: tool.name, toolId: tool.id };
    setDialog({ kind: "secret", tool, mode });
  };

  // TOOL-68: the row flips to Ready in place, the nav's "missing" badge follows.
  const onSecretsSaved = async (tool: ToolItem, names: string[]) => {
    setDialog(null);
    const after = await reload();
    void refreshBadges();
    const row = after?.find((t) => t.id === tool.id);
    toast({ message: toolSecretsSavedToast(names, tool.name, after ? row : null) });
  };

  // TOOL-50: the row goes; counts follow in the tab and nav. No undo.
  const onRemoved = async (tool: ToolItem) => {
    setDialog(null);
    await reload();
    void refreshBadges();
    toast({ message: `${tool.name} removed from Toolkit.` });
  };

  // TOOL-51: the copy lands on top, "Not used yet"; its toast opens it.
  const duplicate = async (tool: ToolItem) => {
    try {
      const copy = await duplicateTool(tool.id);
      markToolFresh(copy.id);
      await reload();
      void refreshBadges();
      toast({
        message: `Copied as ${copy.name}. Rename it in its settings.`,
        action: {
          label: "Open",
          onClick: () => navigate({ page: "tool", toolId: copy.id }),
        },
      });
    } catch (e) {
      toast({ message: clientError(e) ?? `Couldn’t copy ${tool.name}. Try again.`, tone: "error" });
    }
  };

  // TOOL-22: add from the catalog and stay on Browse; the card turns to "In your tools". A 409
  // means it's already there, so the reload shows that too.
  const addFromCatalog = async (entry: CatalogEntry) => {
    try {
      const tool = await createTool({ name: entry.name, server_config: entry.server_config });
      markToolFresh(tool.id);
      await reload();
      void refreshBadges();
      toast({
        message: catalogAddedToast(entry.title),
        action: { label: "Choose agents", onClick: () => setDialog({ kind: "turn-on", tool }) },
      });
    } catch (e) {
      await reload();
      toast({
        message: clientError(e) ?? `Couldn’t add ${entry.title}. Try again.`,
        tone: "error",
      });
    }
  };

  // TOOL-43..45: the wizard stored the secrets, created the tool and turned it on. The new row lands
  // on top; "Open <Role>" opens that agent's Skills & tools tab on its team's canvas.
  const onToolAdded = async ({ tool, turnedOn, agentsFailed }: AddedTool) => {
    setSheet(null);
    markToolFresh(tool.id);
    await reload();
    void refreshBadges();
    if (agentsFailed) {
      toast({ message: agentsFailedToast(tool.name), tone: "error" });
      return;
    }
    const { message, agent } = toolAddedToast(tool.name, turnedOn);
    toast({
      message,
      action: agent
        ? {
            label: `Open ${agentName(agent)}`,
            onClick: () =>
              navigate({ page: "team", teamId: agent.team_id, node: agent.node_id, tab: "skills" }),
          }
        : undefined,
    });
  };

  // TOOL-65: the new rows land on top ("Not used yet"); a replaced tool keeps its row. The toast
  // offers the one tool's missing secret, or Secrets when several tools need one.
  const onPasted = async ({ added, replaced }: PastedTools) => {
    setSheet(null);
    for (const t of added) if (!replaced.includes(t.name)) markToolFresh(t.id);
    const after = await reload();
    void refreshBadges();
    const { message, needs } = pastedToast(added);
    const one = needs.length === 1 ? (after?.find((t) => t.id === needs[0].id) ?? needs[0]) : null;
    toast({
      message,
      action: one
        ? {
            label: one.missing_secrets.length > 1 ? "Add secrets" : "Add secret",
            onClick: () => addSecret(one),
          }
        : needs.length > 1
          ? { label: "Open Secrets", onClick: () => navigate({ page: "secrets" }) }
          : undefined,
    });
  };

  // TOOL-47 from the ⋯: the checked set replaces who uses it (spec Q4).
  const turnOn = async (tool: ToolItem, nodeIds: string[]) => {
    const result = await setToolAgents(tool.id, nodeIds);
    setDialog(null);
    await reload();
    toast({ message: turnedOnToast(tool.name, result.agent_count, result.skipped.length) });
  };

  // Leaving Toolkit › Tools ends the visit: forget the search, filter and fresh rows. (Opening a
  // tool keeps them, so its breadcrumb returns to the same list.)
  useEffect(
    () => () => {
      const next = parseRoute(window.location.hash).page;
      if (next !== "tools" && next !== "tool") resetToolsView();
    },
    [],
  );

  const installedCount = tools && tools.length > 0 ? tools.length : null;
  const toolNames = useMemo(() => (tools ?? []).map((t) => t.name), [tools]);

  return (
    <>
      <div className="tk-head">
        <div>
          <h1 className="tk-head__title">Tools</h1>
          <p className="tk-head__lede">
            MCP servers your agents can call. Add a server here once, then switch it on for any
            agent in its Skills &amp; tools tab.
          </p>
        </div>
        <div className="tk-head__actions">
          {view === "installed" && (
            <Button
              variant="secondary"
              className="tk-btn-inline"
              onClick={() => setSheet({ kind: "paste" })}
            >
              <Braces size={15} strokeWidth={1.6} aria-hidden />
              <span>Paste mcp.json</span>
            </Button>
          )}
          <Button className="tk-btn-inline" onClick={() => setSheet({ kind: "add" })}>
            <Plus size={15} strokeWidth={1.6} aria-hidden />
            <span>Add tool</span>
          </Button>
        </div>
      </div>

      <div className="tk-bar">
        <Tabs
          variant="pill"
          aria-label="Tools"
          value={view}
          onChange={(v) => navigate({ page: "tools", view: v }, { replace: true })}
          items={[
            { value: "installed", label: "Installed", count: installedCount },
            { value: "browse", label: "Browse" },
          ]}
        />
        {view === "installed" && (
          <div className="tk-bar__filters">
            <Input
              size="sm"
              className="tk-search"
              placeholder="Search tools"
              aria-label="Search tools"
              value={query}
              onChange={(e) => setToolsQuery(e.target.value)}
            />
            <StatusSelect value={status} onChange={setToolsStatus} />
          </div>
        )}
      </div>

      {view === "installed" ? (
        <InstalledTab
          tools={tools}
          error={error}
          onRetry={retry}
          actions={{
            onAddTool: (name) => setSheet({ kind: "add", name }),
            onPaste: () => setSheet({ kind: "paste" }),
            onAddSecret: addSecret,
            onDuplicate: (tool) => void duplicate(tool),
            onTurnOn: (tool) => setDialog({ kind: "turn-on", tool }),
            onRemove: (tool) => setDialog({ kind: "remove", tool }),
          }}
        />
      ) : (
        <BrowseTab
          tools={tools}
          error={error}
          onRetry={retry}
          actions={{
            onAdd: addFromCatalog,
            onSetUp: () => setSheet({ kind: "add", start: "custom" }),
            onPaste: () => setSheet({ kind: "paste" }),
          }}
        />
      )}

      {sheet?.kind === "add" && (
        <AddToolSheet
          initialName={sheet.name}
          takenNames={toolNames}
          onClose={() => setSheet(null)}
          onBrowse={() => {
            setSheet(null);
            navigate({ page: "tools", view: "browse" }, { replace: true });
          }}
          onPaste={() => setSheet({ kind: "paste" })}
          onAdded={(added) => void onToolAdded(added)}
        />
      )}
      {sheet?.kind === "paste" && (
        <PasteMcpJsonSheet
          existing={toolNames}
          onClose={() => setSheet(null)}
          onAdded={(result) => void onPasted(result)}
          onStale={() => void reload()}
        />
      )}

      {dialog?.kind === "secret" && (
        <SecretDialog
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onSaved={(names) => void onSecretsSaved(dialog.tool, names)}
        />
      )}
      {dialog?.kind === "remove" && (
        <RemoveToolDialog
          tool={dialog.tool}
          onClose={() => setDialog(null)}
          onRemoved={() => void onRemoved(dialog.tool)}
        />
      )}
      {dialog?.kind === "turn-on" && (
        <TurnOnForAgentsDialog
          toolName={dialog.tool.name}
          toolId={dialog.tool.id}
          onClose={() => setDialog(null)}
          onConfirm={(ids) => turnOn(dialog.tool, ids)}
        />
      )}
    </>
  );
}
