import { createElement } from "react";
import { Layers, Maximize2, SlidersHorizontal, UserRound } from "lucide-react";

import { Button, Menu, type MenuEntry } from "../../design-system/components";
import type { SavedAgent } from "../../lib/api/myAgents";
import type { NodeTemplate } from "../../lib/api/nodes";
import { agentMenuMeta } from "../../lib/myAgentsFormat";
import { templateIcon } from "./templateIcons";
import type { NodeTemplatesState } from "./useNodeTemplates";

const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

/** M6 Agents-Menu: the account's saved agents under the built-ins, and "Manage my agents". */
export interface MyAgentsMenu {
  /** The saved agents (none: no "My agents" section). */
  agents: SavedAgent[];
  /** The menu opened: load the saved agents. */
  onOpen: () => void;
  /** R4: a saved agent picked — it applies at once. */
  onPick: (agent: SavedAgent) => void;
  /** "Manage my agents · Toolkit" (omitted: no such item). */
  onManage?: () => void;
  /** The node's role: its built-in reads "in use". */
  role?: string;
}

/**
 * The Instructions card's "Templates" button and its 250px menu (PANEL-30, Flow-Templates-1):
 * "Built-in" Product manager / Architect / Engineer / Reviewer, then (M6) "My agents" and "Manage
 * my agents", then "Compare templates in focus view" (the focus view with its Templates dialog open).
 */
export function TemplatesMenu({
  templates,
  onPick,
  onCompare,
  myAgents,
  disabled = false,
}: {
  templates: NodeTemplatesState;
  onPick: (template: NodeTemplate) => void;
  /** "Compare templates in focus view" (omitted: no such item). */
  onCompare?: () => void;
  myAgents?: MyAgentsMenu;
  disabled?: boolean;
}) {
  const items: MenuEntry[] = [{ heading: "Built-in" }];
  if (templates.status === "ready" && templates.templates.length > 0) {
    items.push(
      ...templates.templates.map((t) => ({
        key: t.key,
        label: t.title,
        icon: createElement(templateIcon(t.key), icon),
        end: myAgents?.role && t.role_name === myAgents.role ? "in use" : undefined,
        onSelect: () => onPick(t),
      })),
    );
  } else {
    items.push({
      key: "status",
      label: templates.status === "loading" ? "Loading templates…" : "Couldn’t load templates.",
      disabled: true,
      onSelect: () => {},
    });
  }
  if (myAgents && myAgents.agents.length > 0) {
    items.push(
      "separator",
      { heading: "My agents" },
      ...myAgents.agents.map((a) => ({
        key: `agent:${a.id}`,
        label: a.name,
        icon: <UserRound {...icon} />,
        end: agentMenuMeta(a),
        onSelect: () => myAgents.onPick(a),
      })),
    );
  }
  if (myAgents?.onManage) {
    items.push("separator", {
      key: "manage",
      label: "Manage my agents",
      icon: <SlidersHorizontal {...icon} />,
      end: "Toolkit",
      onSelect: myAgents.onManage,
    });
  }
  if (onCompare) {
    items.push("separator", {
      key: "compare",
      label: "Compare templates in focus view",
      icon: <Maximize2 {...icon} />,
      onSelect: onCompare,
    });
  }
  return (
    <span className="nd-templates">
      <Menu
        label="Templates"
        items={items}
        trigger={(props) => (
          // The icon sits inside the label, flush with the text, as the design draws it.
          <Button
            variant="ghost"
            size="sm"
            className="nd-btn-flush"
            disabled={disabled}
            {...props}
            onClick={() => {
              myAgents?.onOpen();
              props.onClick();
            }}
          >
            <Layers size={14} strokeWidth={1.7} aria-hidden />
            <span>Templates</span>
          </Button>
        )}
      />
    </span>
  );
}
