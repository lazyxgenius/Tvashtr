/**
 * The two confirms Settings asks before a save that touches the files (520px, DomainDialog frame):
 * `ReReadDialog` for a reading model with other weights (DM-89, DmF-Embed-3) and `PieceSizeDialog`
 * for a new piece size, overlap or starting point (DM-90, DmF-Piece-2) — re-read the existing files
 * now (on) and run the tests afterwards (on; only with tests and a re-read).
 */
import { useState } from "react";

import { Button, Checkbox } from "../../design-system/components";
import { DomainDialog } from "./DomainDialog";
import { formatNumber } from "./domainFormat";
import { pieceDialogText, rereadDialog, rereadTime } from "./settingsFormat";

export function ReReadDialog({
  files,
  pieces,
  slug,
  name,
  saving,
  onCancel,
  onConfirm,
}: {
  files: number;
  pieces: number;
  /** The reading model the files will be read with. */
  slug: string;
  name: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { title, text } = rereadDialog(files, pieces, slug, name);
  return (
    <DomainDialog
      title={title}
      width={520}
      top={220}
      locked={saving}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={saving} onClick={onConfirm}>
            Save and re-read
          </Button>
        </>
      }
    >
      <p className="dm-dlg__text">{text}</p>
    </DomainDialog>
  );
}

export function PieceSizeDialog({
  size,
  oldSize,
  files,
  pieces,
  slug,
  tests,
  saving,
  onCancel,
  onSave,
}: {
  size: number;
  oldSize: number;
  files: number;
  pieces: number;
  /** The reading model (for the estimate). */
  slug: string;
  /** The domain's test questions; with none, "Run tests afterwards" isn't offered. */
  tests: number;
  saving: boolean;
  onCancel: () => void;
  onSave: (choice: { reread: boolean; runTests: boolean }) => void;
}) {
  const [reread, setReread] = useState(true);
  const [runTests, setRunTests] = useState(true);
  const all = files === 1 ? "its file" : `all ${formatNumber(files)} files`;
  return (
    <DomainDialog
      title="Apply the new piece size to existing files?"
      width={520}
      top={200}
      locked={saving}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            onClick={() => onSave({ reread, runTests: reread && tests > 0 && runTests })}
          >
            Save
          </Button>
        </>
      }
    >
      <p className="dm-dlg__text">{pieceDialogText(size, oldSize, files)}</p>
      <Checkbox
        label={`Re-read ${all} now (${rereadTime(pieces, slug)})`}
        checked={reread}
        disabled={saving}
        onChange={(e) => setReread(e.target.checked)}
      />
      {reread && tests > 0 && (
        <Checkbox
          label="Run tests afterwards"
          checked={runTests}
          disabled={saving}
          onChange={(e) => setRunTests(e.target.checked)}
        />
      )}
    </DomainDialog>
  );
}
