import { createElement } from "react";
import { Layers, Maximize2 } from "lucide-react";

import { Button, Menu, type MenuEntry } from "../../design-system/components";
import type { NodeTemplate } from "../../lib/api/nodes";
import { templateIcon } from "./templateIcons";
import type { NodeTemplatesState } from "./useNodeTemplates";

const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

/**
 * The Instructions card's "Templates" button and its 250px menu (PANEL-30, Flow-Templates-1):
 * Product manager / Architect / Engineer / Reviewer, then "Compare templates in focus view".
 */
export function TemplatesMenu({
  templates,
  onPick,
  onCompare,
  disabled = false,
}: {
  templates: NodeTemplatesState;
  onPick: (template: NodeTemplate) => void;
  /** Omitted in the focus view (it is already open). */
  onCompare?: () => void;
  disabled?: boolean;
}) {
  const items: MenuEntry[] =
    templates.status === "ready" && templates.templates.length > 0
      ? templates.templates.map((t) => ({
          key: t.key,
          label: t.title,
          icon: createElement(templateIcon(t.key), icon),
          onSelect: () => onPick(t),
        }))
      : [
          {
            key: "status",
            label:
              templates.status === "loading" ? "Loading templates…" : "Couldn’t load templates.",
            disabled: true,
            onSelect: () => {},
          },
        ];
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
          <Button variant="ghost" size="sm" className="nd-btn-flush" disabled={disabled} {...props}>
            <Layers size={14} strokeWidth={1.7} aria-hidden />
            <span>Templates</span>
          </Button>
        )}
      />
    </span>
  );
}
