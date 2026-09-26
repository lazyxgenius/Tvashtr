import { useState } from "react";
import { Braces, ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "../../design-system/components";
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
}: {
  fallbackModel: string;
  outputSchema: string;
  onOpenBackup?: () => void;
  onEditSchema?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const schemaSet = outputSchema.trim() !== "";
  const summary = `Backup model: ${fallbackModel.trim() || "none"} · Output format: ${
    schemaSet ? "set" : "none"
  }`;
  return (
    <div>
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
        </span>
        <span className="nd-adv__summary">{summary}</span>
      </button>
      {open && (
        <div className="nd-adv__body">
          <SettingRow label="Backup model" tip={TIPS.backup} hint={BACKUP_HINT}>
            <ModelButton model={fallbackModel} emptyLabel="None" onOpen={onOpenBackup} />
          </SettingRow>
          <SettingRow label="Output format" tip={TIPS.outputFormat} hint={OUTPUT_FORMAT_HINT}>
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
    </div>
  );
}
