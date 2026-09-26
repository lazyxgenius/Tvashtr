import { useState } from "react";
import { Braces, ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "../../design-system/components";
import type { ChangeGroup } from "../agentDraft";
import { ChangedDot } from "../ChangedDot";
import { ModelButton } from "./ModelButton";
import { SettingRow } from "./SettingRow";
import { BACKUP_HINT, OUTPUT_FORMAT_HINT, TIPS } from "./setupCopy";

/**
 * The Advanced disclosure (PANEL-57/58/59): the backup model and the advisory output format, with a
 * one-line summary of both while it's closed.
 */
export function AdvancedSection({
  fallbackModel,
  outputSchema,
  onOpenBackup,
  onEditSchema,
  defaultOpen = false,
  changed = [],
}: {
  fallbackModel: string;
  outputSchema: string;
  onOpenBackup?: () => void;
  onEditSchema?: () => void;
  defaultOpen?: boolean;
  /** The parts that differ from the saved agent (their rows get the Changed dot). */
  changed?: readonly ChangeGroup[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const schemaSet = outputSchema.trim() !== "";
  const summary = `Backup model: ${fallbackModel.trim() || "none"} · Output format: ${
    schemaSet ? "set" : "none"
  }`;
  // The button and its body are both rows of the Setup stack (the design's 22px gap between them).
  return (
    <>
      <button
        type="button"
        className="nd-adv"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="nd-adv__title">
          {open ? (
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
          ) : (
            <ChevronRight size={14} strokeWidth={1.8} aria-hidden />
          )}
          Advanced
          {!open && (changed.includes("backupModel") || changed.includes("outputFormat")) && (
            <ChangedDot inline />
          )}
        </span>
        <span className="nd-adv__summary">{summary}</span>
      </button>
      {open && (
        <div className="nd-adv__body">
          <SettingRow
            label="Backup model"
            tip={TIPS.backup}
            hint={BACKUP_HINT}
            changed={changed.includes("backupModel")}
          >
            <ModelButton model={fallbackModel} emptyLabel="None" onOpen={onOpenBackup} />
          </SettingRow>
          <SettingRow
            label="Output format"
            tip={TIPS.outputFormat}
            hint={OUTPUT_FORMAT_HINT}
            changed={changed.includes("outputFormat")}
          >
            <div className="nd-outfmt">
              <span className="nd-muted">{schemaSet ? "Set" : "None"}</span>
              <Button variant="secondary" size="sm" className="nd-btn-flush" onClick={onEditSchema}>
                <Braces size={13} strokeWidth={1.7} aria-hidden />
                <span>{schemaSet ? "Edit" : "Add JSON schema"}</span>
              </Button>
            </div>
          </SettingRow>
        </div>
      )}
    </>
  );
}
