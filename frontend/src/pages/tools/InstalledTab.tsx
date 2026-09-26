/**
 * Toolkit › Tools › Installed (Toolkit-Tools, TkF-ToolSearch-*, TkF-ToolsEmpty-1): the tools table
 * — icon, name + Local/Remote badge, what it runs, status (Ready, or "Needs X" with Add secret),
 * who uses it and a ⋯ menu — filtered by the search words and the Status select, with the
 * "Showing tools that need attention · N" line, the Domains footnote, and the empty, no-results,
 * loading and error states.
 */
import { Info, Search, Server, TriangleAlert } from "lucide-react";
import type { MouseEvent } from "react";

import { Badge, Button } from "../../design-system/components";
import type { ToolItem } from "../../lib/api/tools";
import { navigate } from "../../lib/nav";
import { EmptyState } from "./EmptyState";
import { runsLabel, transportOf } from "./toolConfig";
import { filterTools, needsLabel, sortTools, usedByLabel } from "./toolFormat";
import { ToolRowMenu } from "./ToolRowMenu";
import { ToolTile } from "./toolIcons";
import { type StatusFilter, setToolsQuery, setToolsStatus, useToolsView } from "./toolsState";

const FILTER_LINE: Record<Exclude<StatusFilter, "all">, string> = {
  needs_attention: "Showing tools that need attention",
  ready: "Showing ready tools",
};

/** No search words, and the Status filter left nothing: say that, not "try another word". */
const FILTER_EMPTY: Record<Exclude<StatusFilter, "all">, { title: string; body: string }> = {
  needs_attention: { title: "No tools need attention", body: "Every tool is ready to use." },
  ready: {
    title: "No tools are ready",
    body: "Every tool needs attention. Open one to see what it needs.",
  },
};

export interface InstalledActions {
  onAddTool: (name?: string) => void;
  onPaste: () => void;
  onAddSecret: (tool: ToolItem) => void;
  onDuplicate: (tool: ToolItem) => void;
  onTurnOn: (tool: ToolItem) => void;
  onRemove: (tool: ToolItem) => void;
}

export function InstalledTab({
  tools,
  error,
  onRetry,
  actions,
}: {
  tools: ToolItem[] | null;
  error: string | null;
  onRetry: () => void;
  actions: InstalledActions;
}) {
  const { query, status, freshIds } = useToolsView();

  if (tools === null) {
    if (error) {
      return (
        <section className="tk-card">
          <div className="tk-state" role="alert">
            <span>Couldn’t load your tools.</span>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </section>
      );
    }
    return (
      <section className="tk-card" aria-busy="true" aria-label="Loading tools">
        <div className="tk-skel" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="tk-skel__row">
              <span className="tk-skel__tile" />
              <span className="tk-skel__bar" style={{ width: 120 }} />
              <span className="tk-skel__bar" style={{ width: 180 }} />
              <span className="tk-skel__bar" style={{ width: 90 }} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (tools.length === 0) {
    return (
      <section className="tk-card">
        <EmptyState
          icon={<Server size={24} strokeWidth={1.6} />}
          title="No tools yet"
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={actions.onPaste}>
                Paste mcp.json
              </Button>
              <Button
                size="sm"
                onClick={() => navigate({ page: "tools", view: "browse" }, { replace: true })}
              >
                Browse catalog
              </Button>
            </>
          }
        >
          Tools are MCP servers your agents can call, like web fetch or GitHub. Start from the
          catalog, or connect your own.
        </EmptyState>
      </section>
    );
  }

  const rows = filterTools(sortTools(tools, freshIds), query, status);

  return (
    <>
      {status !== "all" && (
        <div className="tk-filterline">
          {`${FILTER_LINE[status]} · ${rows.length}`}
          <button
            type="button"
            className="tk-filterline__clear"
            onClick={() => setToolsStatus("all")}
          >
            Clear
          </button>
        </div>
      )}
      {rows.length === 0 && !query.trim() && status !== "all" ? (
        <section className="tk-card">
          <EmptyState
            icon={<Search size={24} strokeWidth={1.6} />}
            title={FILTER_EMPTY[status].title}
            actions={
              <Button variant="secondary" size="sm" onClick={() => setToolsStatus("all")}>
                Clear filter
              </Button>
            }
          >
            {FILTER_EMPTY[status].body}
          </EmptyState>
        </section>
      ) : rows.length === 0 ? (
        <section className="tk-card">
          <EmptyState
            icon={<Search size={24} strokeWidth={1.6} />}
            title={`No tools match “${query.trim()}”`}
            actions={
              <>
                <Button variant="secondary" size="sm" onClick={() => setToolsQuery("")}>
                  Clear search
                </Button>
                <Button size="sm" onClick={() => actions.onAddTool(query.trim())}>
                  Add tool
                </Button>
              </>
            }
          >
            Try another word, or add it as a custom server.
          </EmptyState>
        </section>
      ) : (
        <>
          <ToolsTable rows={rows} actions={actions} />
          <div className="tk-note">
            <span className="tk-note__icon">
              <Info size={15} strokeWidth={1.6} aria-hidden />
            </span>
            <span>
              <b>Domains</b> is built in. Turn it on for an agent in its Skills &amp; tools tab. It
              isn’t added here.
            </span>
          </div>
        </>
      )}
    </>
  );
}

function ToolsTable({ rows, actions }: { rows: ToolItem[]; actions: InstalledActions }) {
  const open = (tool: ToolItem) => navigate({ page: "tool", toolId: tool.id });
  // A click on the row (outside its buttons) opens the tool's page (TOOL-14).
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, tool: ToolItem) => {
    if ((e.target as HTMLElement).closest("button, a, [role='menu']")) return;
    open(tool);
  };

  return (
    <section className="tk-card tk-card--open">
      <table className="tk-table">
        <thead>
          <tr>
            <th scope="col">Tool</th>
            <th scope="col">Runs</th>
            <th scope="col">Status</th>
            <th scope="col">Used by</th>
            <th scope="col">
              <span className="tk-sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tool) => {
            const kind = transportOf(tool.server_config);
            return (
              <tr key={tool.id} className="tk-row" onClick={(e) => onRowClick(e, tool)}>
                <td>
                  <div className="tk-toolcell">
                    <ToolTile tool={tool} />
                    <div>
                      <a
                        className="tk-toolcell__name"
                        href={`#/toolkit/tools/${encodeURIComponent(tool.id)}`}
                      >
                        {tool.name}
                      </a>
                      {kind && (
                        <div>
                          {/* A Local tool runs in the agent's cloud sandbox — never on this
                              computer, even on Desktop (spec Q10). */}
                          <Badge
                            variant="outline"
                            title={kind === "local" ? "Runs in the agent’s sandbox" : undefined}
                          >
                            {kind === "local" ? "Local" : "Remote"}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <span className="tk-runs">{runsLabel(tool.server_config)}</span>
                </td>
                <td>
                  {tool.status === "ready" ? (
                    <span className="tk-ready">
                      <span className="tk-ready__dot" aria-hidden="true" />
                      Ready
                    </span>
                  ) : (
                    <div className="tk-needs">
                      <span className="tk-needs__label">
                        <TriangleAlert size={13} strokeWidth={1.6} aria-hidden />
                        {needsLabel(tool)}
                      </span>
                      {tool.missing_secrets.length > 0 && (
                        <Button variant="tint" size="sm" onClick={() => actions.onAddSecret(tool)}>
                          Add secret
                        </Button>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <span className="tk-usedby">{usedByLabel(tool.used_by)}</span>
                </td>
                <td>
                  <ToolRowMenu
                    name={tool.name}
                    onEdit={() => open(tool)}
                    onDuplicate={() => actions.onDuplicate(tool)}
                    onTurnOn={() => actions.onTurnOn(tool)}
                    onRemove={() => actions.onRemove(tool)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
