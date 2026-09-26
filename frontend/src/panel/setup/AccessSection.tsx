import { FileText, Lock, Plus, X } from "lucide-react";

import type { ChangeGroup } from "../agentDraft";
import { SettingRow, SettingSection } from "./SettingRow";
import { FILE_ACCESS_HINT, TIPS } from "./setupCopy";

/**
 * Access & documents (PANEL-49..56): File access, the documents it reads (in order) and the one it
 * writes. The entry agent stays read-only, starts from the idea and writes the shared spec (Q5).
 */
export function AccessSection({
  editsAllowed,
  onEditsChange,
  isEntry,
  readsFrom,
  readsDefault,
  onReadsChange,
  writesTo,
  onWritesChange,
  onAddRead,
  onChooseWrites,
  changed = [],
}: {
  editsAllowed: boolean;
  onEditsChange: (next: boolean) => void;
  isEntry: boolean;
  readsFrom: string[];
  readsDefault: boolean;
  onReadsChange: (readsFrom: string[], readsDefault: boolean) => void;
  writesTo: string;
  onWritesChange: (next: string) => void;
  onAddRead?: () => void;
  onChooseWrites?: () => void;
  /** The parts that differ from the saved agent (their rows get the Changed dot). */
  changed?: readonly ChangeGroup[];
}) {
  const accessHint = isEntry ? (
    <span className="nd-hint__lock">
      <span>
        <Lock size={12} strokeWidth={1.8} aria-hidden />
      </span>
      {FILE_ACCESS_HINT.entry}
    </span>
  ) : editsAllowed ? (
    FILE_ACCESS_HINT.edits
  ) : (
    FILE_ACCESS_HINT.readOnly
  );

  // The chips it reads, in order. With no names listed it reads the spec by default.
  const implicitSpec = readsFrom.length === 0 && readsDefault;
  const chips = implicitSpec ? ["spec"] : readsFrom;
  const removeRead = (name: string) => {
    if (implicitSpec) onReadsChange([], false);
    else
      onReadsChange(
        readsFrom.filter((n) => n !== name),
        readsDefault,
      );
  };

  return (
    <SettingSection title="Access & documents">
      <SettingRow
        label="File access"
        tip={TIPS.fileAccess}
        hint={accessHint}
        changed={changed.includes("fileAccess")}
      >
        <div className="tv-seg nd-seg" role="group" aria-label="File access">
          <button
            type="button"
            className={`tv-seg__btn${editsAllowed ? " tv-seg__btn--active" : ""}`}
            aria-pressed={editsAllowed}
            disabled={isEntry}
            onClick={() => onEditsChange(true)}
          >
            Can edit files
          </button>
          <button
            type="button"
            className={`tv-seg__btn${!editsAllowed ? " tv-seg__btn--active" : ""}`}
            aria-pressed={!editsAllowed}
            disabled={isEntry}
            onClick={() => onEditsChange(false)}
          >
            Read-only
          </button>
        </div>
      </SettingRow>
      <SettingRow label="Reads" tip={TIPS.reads} changed={changed.includes("reads")}>
        {isEntry ? (
          <span className="nd-plain">The idea you type when you press Run</span>
        ) : (
          <div className="nd-chips">
            {chips.length === 0 && <span className="nd-muted">Nothing</span>}
            {chips.map((name) => (
              <span key={name} className="nd-chip">
                <FileText size={13} strokeWidth={1.7} aria-hidden />
                {name}
                {implicitSpec && <span className="nd-chip__tag">default</span>}
                <button
                  type="button"
                  className="nd-chip__x"
                  aria-label={`Remove ${name}`}
                  onClick={() => removeRead(name)}
                >
                  <X size={12} strokeWidth={1.8} />
                </button>
              </span>
            ))}
            <button type="button" className="nd-dashed" onClick={onAddRead}>
              <Plus size={12} strokeWidth={1.8} aria-hidden />
              Add
            </button>
          </div>
        )}
      </SettingRow>
      <SettingRow label="Writes" tip={TIPS.writes} changed={changed.includes("writes")}>
        {isEntry ? (
          <div className="nd-chips">
            <span className="nd-chip">
              <FileText size={13} strokeWidth={1.7} aria-hidden />
              spec
              <span className="nd-chip__tag">default</span>
            </span>
          </div>
        ) : writesTo ? (
          <div className="nd-chips">
            <span className="nd-chip">
              <FileText size={13} strokeWidth={1.7} aria-hidden />
              {writesTo}
              <button
                type="button"
                className="nd-chip__x"
                aria-label={`Remove ${writesTo}`}
                onClick={() => onWritesChange("")}
              >
                <X size={12} strokeWidth={1.8} />
              </button>
            </span>
          </div>
        ) : (
          <div className="nd-writes">
            <span className="nd-muted">Nothing</span>
            <button type="button" className="nd-dashed" onClick={onChooseWrites}>
              <Plus size={12} strokeWidth={1.8} aria-hidden />
              Choose
            </button>
          </div>
        )}
      </SettingRow>
    </SettingSection>
  );
}
