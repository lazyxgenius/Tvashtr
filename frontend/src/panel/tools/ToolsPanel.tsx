import { BookOpen, Braces, MoreHorizontal, Pencil, Plus, Server, Trash } from "lucide-react";

import { Button, IconButton, Menu, type MenuEntry, Switch } from "../../design-system/components";
import type { ToolLibraryItem } from "../../lib/api";
import type { Route } from "../../lib/nav";
import { InfoTip } from "../InfoTip";
import type { ToastAction } from "../useDrawerToast";
import {
  FETCH_SERVER,
  type ToolConfig,
  type ToolRowData,
  addServer,
  domainsOf,
  removeLibrary,
  removeServer,
  setDomains,
  setEnabled,
  toolRows,
} from "./nodeTools";

export type AddToolKind = "server" | "library" | "paste";

const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

/**
 * Skills & tools › Tools (PANEL-92..99; Web-Skills, Panel-SkillsEmpty, Flow-ToolMenu): the 280px
 * "Add tool" menu, the Domains switch, one row per MCP server (inline or from the library) with its
 * badge, target, Enable switch and ⋯ menu, and the empty state's inline Web fetch Add (Q15). Every
 * change goes into the draft; Save keeps it.
 */
export function ToolsPanel({
  config,
  library,
  secrets,
  onChange,
  notify,
  onAdd,
  onEditServer,
  onOpenToolkit,
}: {
  config: ToolConfig;
  /** The account's library tools and secret names (null while unknown). */
  library: readonly ToolLibraryItem[] | null;
  secrets: readonly string[] | null;
  onChange: (next: ToolConfig) => void;
  notify: (message: string, action?: ToastAction) => void;
  onAdd: (kind: AddToolKind) => void;
  onEditServer: (name: string) => void;
  onOpenToolkit?: (route: Route) => void;
}) {
  const rows = toolRows(config, library, secrets);
  const remove = (row: ToolRowData) => {
    const before = config;
    onChange(
      row.source === "library"
        ? removeLibrary(config, row.id ?? "")
        : removeServer(config, row.name),
    );
    notify(`Removed ${row.name}`, { label: "Undo", onAction: () => onChange(before) });
  };
  return (
    <section className="nd-kit nd-kit--tools" aria-labelledby="nd-kit-tools">
      <div className="nd-kit__head">
        <h3 className="nd-kit__title" id="nd-kit-tools">
          Tools
          {rows.length > 0 && <span className="nd-kit__count">{rows.length}</span>}
          <InfoTip text="MCP servers this agent can call. Secrets stay as ${NAME} and are filled in at run time." />
        </h3>
        <span className="nd-kit__add nd-kit__add--up">
          <Menu
            label="Add tool"
            items={[
              {
                key: "server",
                label: "Add a server",
                description: "Name, Local or Remote, command or URL",
                icon: <Server {...icon} />,
                onSelect: () => onAdd("server"),
              },
              {
                key: "library",
                label: "From your library",
                icon: <BookOpen {...icon} />,
                onSelect: () => onAdd("library"),
              },
              {
                key: "paste",
                label: "Paste mcp.json",
                icon: <Braces {...icon} />,
                onSelect: () => onAdd("paste"),
              },
            ]}
            trigger={(props) => (
              <Button
                variant="secondary"
                size="sm"
                className="nd-btn-flush"
                data-add-tool
                {...props}
              >
                <Plus size={13} strokeWidth={1.6} aria-hidden />
                <span>Add tool</span>
              </Button>
            )}
          />
        </span>
      </div>
      <div className="nd-kit__card">
        <div className="nd-kit__opt">
          <div>
            <div className="nd-kit__opt-title">
              Domains
              <InfoTip text="To explore yourself, use Chat/Ask. For a fixed step on the canvas, use a Query domain node." />
            </div>
            <div className="nd-kit__opt-desc">Let it ask and search your domains during a run.</div>
          </div>
          <Switch
            aria-label="Domains"
            checked={domainsOf(config)}
            onCheckedChange={(on) => onChange(setDomains(config, on))}
          />
        </div>
        {rows.length === 0 && (
          <div className="nd-kit__opt">
            <div>
              <div className="nd-kit__opt-title" id="nd-kit-fetch">
                Web fetch
              </div>
              <div className="nd-kit__opt-desc">Let it fetch web pages. No login needed.</div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="nd-btn-flush"
              aria-describedby="nd-kit-fetch"
              onClick={() => onChange(addServer(config, "fetch", FETCH_SERVER))}
            >
              <Plus size={13} strokeWidth={1.6} aria-hidden />
              <span>Add</span>
            </Button>
          </div>
        )}
      </div>
      {rows.length > 0 ? (
        <ul className="nd-kit__list">
          {rows.map((row) => (
            <ToolRow
              key={row.key}
              row={row}
              onEnable={(on) => onChange(setEnabled(config, row.name, on))}
              onEdit={row.source === "inline" ? () => onEditServer(row.name) : undefined}
              onOpenToolkit={
                row.source === "library" && row.id && onOpenToolkit
                  ? () => onOpenToolkit({ page: "tool", toolId: row.id as string })
                  : undefined
              }
              onRemove={() => remove(row)}
            />
          ))}
        </ul>
      ) : (
        <div className="nd-kit__empty">
          No servers yet. Add one, pick from your library, or paste an mcp.json.
        </div>
      )}
    </section>
  );
}

function ToolRow({
  row,
  onEnable,
  onEdit,
  onOpenToolkit,
  onRemove,
}: {
  row: ToolRowData;
  onEnable: (on: boolean) => void;
  onEdit?: () => void;
  onOpenToolkit?: () => void;
  onRemove: () => void;
}) {
  const more: MenuEntry[] = [];
  if (onEdit) {
    more.push({
      key: "edit",
      label: "Edit connection",
      icon: <Pencil {...icon} />,
      onSelect: onEdit,
    });
  }
  if (onOpenToolkit) {
    more.push({
      key: "toolkit",
      label: "Open in Toolkit",
      icon: <BookOpen {...icon} />,
      onSelect: onOpenToolkit,
    });
  }
  if (more.length > 0) more.push("separator");
  more.push({
    key: "remove",
    label: "Remove from this agent",
    icon: <Trash {...icon} />,
    danger: true,
    onSelect: onRemove,
  });
  return (
    <li className="nd-tool">
      <span className="nd-kit__icon">
        <Server size={14} strokeWidth={1.6} aria-hidden />
      </span>
      <div className="nd-tool__body">
        <div className="nd-tool__top">
          <span className="nd-tool__name">{row.name}</span>
          <span
            className={`ds-badge ds-badge--${row.badge.variant}`}
            title={
              row.missing.length > 0
                ? `Uses ${row.missing.map((m) => `\${${m}}`).join(", ")}, which isn’t set yet. Add it in Toolkit → Secrets.`
                : undefined
            }
          >
            {row.badge.label}
          </span>
        </div>
        {row.target && <div className="nd-tool__target">{row.target}</div>}
      </div>
      <Switch aria-label={`Enable ${row.name}`} checked={row.enabled} onCheckedChange={onEnable} />
      <span className="nd-tool__more">
        <Menu
          label={`More actions for ${row.name}`}
          items={more}
          trigger={(props) => (
            <IconButton size="sm" aria-label={`More actions for ${row.name}`} {...props}>
              <MoreHorizontal size={15} strokeWidth={1.6} aria-hidden />
            </IconButton>
          )}
        />
      </span>
    </li>
  );
}
