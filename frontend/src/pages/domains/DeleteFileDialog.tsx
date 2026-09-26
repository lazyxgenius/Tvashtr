/**
 * Delete a file (DM-53, DmF-DelFile-2): a 500px dialog with the impact — its pieces leave the
 * domain, answers stop citing it, the test questions that expect it will be flagged — and an info
 * callout on what teams keep. **Delete file** (primary with a trash icon, OQ-29) hands the file to
 * the deferred delete (OQ-12): the row hides at once and the toast offers Undo.
 */
import { useEffect, useState } from "react";
import { Info, Trash } from "lucide-react";

import { Button } from "../../design-system/components";
import { type DomainFile, listDomainEvalCases } from "../../lib/api/domains";
import { DomainDialog } from "./DomainDialog";
import { deleteFileCallout, deleteFileText } from "./domainFormat";

export function DeleteFileDialog({
  domainId,
  domainName,
  file,
  totalFiles,
  onClose,
  onConfirm,
}: {
  domainId: string;
  domainName: string;
  file: DomainFile;
  /** The domain's files now (this one included). */
  totalFiles: number;
  onClose: () => void;
  onConfirm: (file: DomainFile) => void;
}) {
  // Test questions that expect this file; unknown (left out) until the cases load or if they can't.
  const [expecting, setExpecting] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    listDomainEvalCases(domainId)
      .then((cases) => {
        if (!live) return;
        setExpecting(
          cases.filter((c) => (c.expected_citation_doc_ids ?? []).includes(file.document_id))
            .length,
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [domainId, file.document_id]);

  return (
    <DomainDialog
      title={`Delete ${file.filename}?`}
      width={500}
      top={220}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="dm-btn-inline"
            onClick={() => onConfirm(file)}
          >
            <Trash size={15} strokeWidth={1.6} aria-hidden />
            <span>Delete file</span>
          </Button>
        </>
      }
    >
      <p className="dm-dlg__text">{deleteFileText(file, domainName, expecting)}</p>
      <div className="dm-callout">
        <span className="dm-callout__icon">
          <Info size={14} strokeWidth={1.6} aria-hidden />
        </span>
        <span className="dm-callout__text">
          {deleteFileCallout(domainName, Math.max(0, totalFiles - 1))}
        </span>
      </div>
    </DomainDialog>
  );
}
