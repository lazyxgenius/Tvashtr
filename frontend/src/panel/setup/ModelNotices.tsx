import type { ReactNode } from "react";
import { AlertTriangle, Info, X } from "lucide-react";

/** One dismissible note under a model row (Panel-Warnings): an advisory, or a warning. */
function ModelNotice({
  tone,
  onDismiss,
  children,
}: {
  tone: "info" | "warn";
  onDismiss: () => void;
  children: ReactNode;
}) {
  const Icon = tone === "warn" ? AlertTriangle : Info;
  return (
    <div role="status" className={`nd-notice nd-notice--${tone}`}>
      <span className="nd-notice__icon">
        <Icon size={13} strokeWidth={1.6} aria-hidden />
      </span>
      <span className="nd-notice__text">{children}</span>
      <button type="button" aria-label="Dismiss" className="nd-notice__x" onClick={onDismiss}>
        <X size={13} strokeWidth={1.6} aria-hidden />
      </button>
    </div>
  );
}

/** PANEL-46: a verdict agent running the same model as the agent whose work it checks. */
export function SameModelAdvisory({
  name,
  sibling,
  model,
  onDismiss,
}: {
  name: string;
  sibling: string;
  model: string;
  onDismiss: () => void;
}) {
  return (
    <ModelNotice tone="info" onDismiss={onDismiss}>
      {name} and {sibling} both run <code>{model}</code>. Reviews are stronger when the reviewer
      runs a more capable model than the one it checks.
    </ModelNotice>
  );
}

/** PANEL-47: a main or backup model the catalogue doesn't list. Soft: Save still works. */
export function UnknownModelWarning({
  model,
  onDismiss,
}: {
  model: string;
  onDismiss: () => void;
}) {
  return (
    <ModelNotice tone="warn" onDismiss={onDismiss}>
      No provider matches <code>{model}</code>. It will fail at run time if the name is wrong or the
      key isn’t set.
    </ModelNotice>
  );
}
