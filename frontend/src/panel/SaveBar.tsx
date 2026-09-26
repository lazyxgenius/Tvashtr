import { AlertCircle, Check } from "lucide-react";

import { Button } from "../design-system/components";
import { saveShortcutLabel } from "./saveShortcut";
import type { SaveState } from "./useAgentDraft";

/**
 * The drawer footer, always visible (PANEL-17): clean "All changes saved", dirty "N unsaved
 * changes" with Discard and Save, "Saving N changes…", "Saved. This drives the next run you
 * launch.", the error state with Try again, and the Memory tab's "save right away" note.
 */
export function SaveBar({
  dirtyCount,
  saveState,
  error,
  canSave,
  memoryTab = false,
  onSave,
  onDiscard,
}: {
  dirtyCount: number;
  saveState: SaveState;
  error?: string | null;
  canSave: boolean;
  /** On the Memory tab changes save as you make them. */
  memoryTab?: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const changes = `${dirtyCount} ${dirtyCount === 1 ? "change" : "changes"}`;
  if (saveState === "saving") {
    return (
      <footer className="nd-foot">
        <span className="nd-foot__status nd-foot__status--saving" role="status">
          Saving {changes}…
        </span>
        <Button variant="primary" size="sm" loading>
          Saving
        </Button>
      </footer>
    );
  }
  if (saveState === "error" && dirtyCount > 0) {
    return (
      <footer className="nd-foot nd-foot--error">
        <span className="nd-foot__status nd-foot__status--error" role="alert">
          <AlertCircle size={14} strokeWidth={1.8} aria-hidden />
          {error || "Couldn’t save. Try again."}
        </span>
        <div className="nd-foot__actions">
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            Discard
          </Button>
          <Button variant="primary" size="sm" onClick={onSave} disabled={!canSave}>
            Try again
          </Button>
        </div>
      </footer>
    );
  }
  if (dirtyCount > 0 && !memoryTab) {
    return (
      <footer className="nd-foot">
        <span className="nd-foot__status nd-foot__status--dirty" role="status">
          <span className="nd-foot__dot" aria-hidden />
          {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
        </span>
        <div className="nd-foot__actions">
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            Discard
          </Button>
          <Button variant="primary" size="sm" onClick={onSave} disabled={!canSave}>
            Save
            <span className="nd-foot__kbd">{saveShortcutLabel()}</span>
          </Button>
        </div>
      </footer>
    );
  }
  return (
    <footer className="nd-foot">
      {memoryTab ? (
        <span className="nd-foot__status" role="status">
          Memory changes save right away
        </span>
      ) : saveState === "saved" ? (
        <span className="nd-foot__status nd-foot__status--saved" role="status">
          <Check size={14} strokeWidth={1.8} aria-hidden />
          Saved. This drives the next run you launch.
        </span>
      ) : (
        <span className="nd-foot__status" role="status">
          <span className="nd-foot__ok">
            <Check size={14} strokeWidth={1.8} aria-hidden />
          </span>
          All changes saved
        </span>
      )}
      <Button variant="primary" size="sm" disabled>
        Save
      </Button>
    </footer>
  );
}
