import { useId, useState } from "react";
import { Info, X } from "lucide-react";

import { Button, IconButton } from "../../design-system/components";
import type { NodeTemplate } from "../../lib/api/nodes";
import { useModalDialog } from "../../lib/useModalDialog";
import { templateIcon } from "../setup/templateIcons";
import { useNodeTemplates } from "../setup/useNodeTemplates";

/**
 * "Start from a template" (Focus-Templates, FOCUS-35..39): an 860px dialog over the focus view with
 * the built-in templates on the left (the agent's own role picked first) and the picked one's full
 * instructions on the right. "Use … template" replaces only the instructions in the draft (spec
 * OQ-5); nothing is saved until Save. Escape closes this dialog only (the dialog stack).
 */
export function TemplatesDialog({
  roleName,
  onUse,
  onClose,
}: {
  /** The agent's role: its template is the first one shown. */
  roleName: string;
  onUse: (template: NodeTemplate) => void;
  onClose: () => void;
}) {
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  // Loaded (or, after a failure, tried again) each time the dialog opens.
  const templates = useNodeTemplates();
  const titleId = useId();
  const list = templates.templates;
  const [picked, setPicked] = useState<string | null>(null);
  const current =
    list.find((t) => t.key === picked) ??
    list.find((t) => t.role_name === roleName || t.key === roleName) ??
    list[0] ??
    null;

  return (
    <div className="fx-tpl-layer">
      <div className="fx-tpl-scrim" aria-hidden onClick={onClose} />
      <div
        ref={ref}
        className="fx-tpl"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a template"
        aria-describedby={titleId}
        tabIndex={-1}
      >
        <header className="fx-tpl__head">
          <div>
            <h2 className="fx-tpl__title" id={titleId}>
              Start from a template
            </h2>
            <p className="fx-tpl__lede">Built-in templates for the four standard agents.</p>
          </div>
          <IconButton size="sm" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.6} aria-hidden />
          </IconButton>
        </header>
        <div className="fx-tpl__grid">
          <ul className="fx-tpl__list" aria-label="Templates">
            {templates.status !== "ready" || list.length === 0 ? (
              <li
                className="fx-tpl__status"
                role={templates.status === "error" ? "alert" : "status"}
              >
                {templates.status === "loading"
                  ? "Loading templates…"
                  : "Couldn’t load templates — try again."}
              </li>
            ) : (
              list.map((t) => {
                const Icon = templateIcon(t.key);
                const on = current?.key === t.key;
                return (
                  <li key={t.key}>
                    <button
                      type="button"
                      className={`fx-tpl__item${on ? " fx-tpl__item--on" : ""}`}
                      aria-pressed={on}
                      onClick={() => setPicked(t.key)}
                    >
                      <span className="fx-tpl__icon" aria-hidden>
                        <Icon size={14} strokeWidth={1.6} />
                      </span>
                      <span>
                        <span className="fx-tpl__name">{t.title}</span>
                        <span className="fx-tpl__summary">{t.summary}</span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="fx-tpl__preview" role="region" aria-label="Preview">
            <div className="fx-tpl__eyebrow">Preview</div>
            {current && <div className="fx-tpl__prompt">{current.prompt}</div>}
          </div>
        </div>
        <footer className="fx-tpl__foot">
          <span className="fx-tpl__note">
            <Info size={13} strokeWidth={1.6} aria-hidden />
            This replaces the current instructions. You can Discard before you save.
          </span>
          <div className="fx-tpl__actions">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!current}
              onClick={() => current && onUse(current)}
            >
              {current ? `Use ${current.title} template` : "Use template"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
