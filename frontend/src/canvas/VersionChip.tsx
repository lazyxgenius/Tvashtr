import { ChevronDown, History, Save } from "lucide-react";
import { useId } from "react";

import { Button } from "../design-system/components";
import type { TeamVersions } from "../lib/api/versions";
import { versionAge } from "../lib/versionFormat";

/**
 * M5 — the header's version chip (Ver-History / Ver-Draft, ruling R3): "v7 · saved 2m ago", or
 * amber "v7 · 2 changes since v7" with Save as v8 beside it. It opens and closes History (coral
 * while History is open, unless it has changes).
 */
export function VersionChip({
  versions: v,
  open,
  saving,
  onToggle,
  onSave,
}: {
  versions: TeamVersions;
  open: boolean;
  saving: boolean;
  onToggle: () => void;
  onSave: () => void;
}) {
  const textId = useId();
  const draft = v.changes > 0;
  return (
    <>
      <button
        type="button"
        className={`cv-ver${draft ? " cv-ver--draft" : open ? " cv-ver--open" : ""}`}
        aria-label="Version history"
        aria-describedby={textId}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="cv-ver__icon">
          <History size={13} strokeWidth={1.6} aria-hidden />
        </span>
        {draft && <span className="cv-ver__dot" aria-hidden />}
        <span className="cv-ver__num">v{v.current}</span>
        <span id={textId}>
          {draft
            ? `· ${v.changes} change${v.changes === 1 ? "" : "s"} since v${v.current}`
            : `· saved ${versionAge(v.saved_at)}`}
        </span>
        <span className="cv-ver__icon">
          <ChevronDown size={12} strokeWidth={1.6} aria-hidden />
        </span>
      </button>
      {draft && (
        <Button
          variant="secondary"
          size="sm"
          className="cv-btn-flush"
          loading={saving}
          onClick={onSave}
        >
          <Save size={14} strokeWidth={1.6} aria-hidden />
          <span>Save as v{v.next}</span>
        </Button>
      )}
    </>
  );
}
