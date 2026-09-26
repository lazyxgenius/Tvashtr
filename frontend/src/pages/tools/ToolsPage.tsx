/**
 * Toolkit › Tools (`#/toolkit/tools`, `#/toolkit/tools/browse`): the page header (Paste mcp.json on
 * Installed only, Add tool on both), the Installed N / Browse pill tabs driven by the address, the
 * search box and Status filter, and the tab's content. Owns the tool list both tabs read.
 */
import { Braces, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button, Input, Tabs } from "../../design-system/components";
import { type ToolItem, listTools } from "../../lib/api/tools";
import { navigate, parseRoute } from "../../lib/nav";
import { BrowseTab } from "./BrowseTab";
import { InstalledTab } from "./InstalledTab";
import { StatusSelect } from "./StatusSelect";
import { resetToolsView, setToolsQuery, setToolsStatus, useToolsView } from "./toolsState";
import "./tools.css";

type ToolsView = "installed" | "browse";

/** The sheets the page opens: the Add tool wizard (optionally with a name) or Paste mcp.json. */
export type ToolSheet = { kind: "add"; name?: string } | { kind: "paste" } | null;

/** The tool list, loaded once per visit; `reload` after a change. */
function useToolList() {
  const [tools, setTools] = useState<ToolItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setError(null);
    try {
      setTools(await listTools());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load your tools.");
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

/** Where the Add tool wizard (G6) and Paste mcp.json sheet (G7) mount. */
function ToolSheetHost({ sheet }: { sheet: ToolSheet; onClose: () => void }) {
  void sheet;
  return null;
}

export function ToolsPage({ view }: { view: ToolsView }) {
  const { tools, error, retry } = useToolList();
  const { query, status } = useToolsView();
  const [sheet, setSheet] = useState<ToolSheet>(null);

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
            // G4 opens the Add-secret dialog here; until then the Secrets page is where you add it.
            onAddSecret: () => navigate({ page: "secrets" }),
          }}
        />
      ) : (
        <BrowseTab />
      )}

      <ToolSheetHost sheet={sheet} onClose={() => setSheet(null)} />
    </>
  );
}
