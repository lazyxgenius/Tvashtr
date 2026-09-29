import { createElement } from "react";
import { Pencil } from "lucide-react";

import type { NodeTemplate } from "../../lib/api/nodes";
import { templateIcon } from "./templateIcons";
import { CHOOSER_TEMPLATE_KEYS, TEMPLATE_TITLES } from "./templates";
import type { NodeTemplatesState } from "./useNodeTemplates";

/**
 * What a new agent shows in place of its empty instructions (PANEL-33, Web-NewAgent): "Start from a
 * template" with Product manager / Engineer / Reviewer, or "Start from scratch" (an empty editor).
 */
export function TemplateChooser({
  templates,
  onPick,
  onScratch,
}: {
  templates: NodeTemplatesState;
  onPick: (template: NodeTemplate) => void;
  onScratch: () => void;
}) {
  return (
    <div className="nd-chooser" role="group" aria-label="Start from a template">
      <div className="nd-chooser__title">Start from a template</div>
      <div className="nd-chooser__sub">Pick one to fill in the instructions, then edit it.</div>
      <div className="nd-chooser__row">
        {CHOOSER_TEMPLATE_KEYS.map((key) => {
          const template = templates.templates.find((t) => t.key === key);
          return (
            <button
              key={key}
              type="button"
              className="nd-chooser__pill"
              disabled={!template}
              onClick={() => template && onPick(template)}
            >
              {createElement(templateIcon(key), {
                size: 13,
                strokeWidth: 1.6,
                "aria-hidden": true,
              })}
              {template?.title ?? TEMPLATE_TITLES[key]}
            </button>
          );
        })}
        <button
          type="button"
          className="nd-chooser__pill nd-chooser__pill--plain"
          onClick={onScratch}
        >
          <Pencil size={13} strokeWidth={1.6} aria-hidden />
          Start from scratch
        </button>
      </div>
      {templates.status === "error" && (
        <div className="nd-chooser__error" role="alert">
          Couldn’t load templates.
        </div>
      )}
    </div>
  );
}
