import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Check, FileText, History, X } from "lucide-react";

import { Button, IconButton } from "../../design-system/components";
import { approveWithEdits } from "../../lib/api/canvas";
import { getDocument } from "../../lib/api/docs";
import { getMarkdown, PRD_EDITOR_EXTENSIONS } from "../../lib/prdEditor";
import { docBlocks } from "../docs/docMarkdown";
import { useLoaded } from "../runs/useLoaded";
import { diffSeq } from "../setup/lineDiff";
import "../docs/viewer.css";

/** How many places the edit changed: each run of changed blocks (an edited bullet is one). */
function editCount(from: string, to: string): number {
  let n = 0;
  let inChange = false;
  for (const p of diffSeq(docBlocks(from), docBlocks(to))) {
    if (p.op !== "same" && !inChange) n += 1;
    inChange = p.op !== "same";
  }
  return n;
}

/** The P1.7 steering editor on the spec's latest version; reports each change as markdown. */
function SpecEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (baseline: string, markdown: string) => void;
}) {
  const baseline = useRef<string | null>(null);
  const editor = useEditor({
    extensions: PRD_EDITOR_EXTENSIONS,
    content,
    onCreate: ({ editor: e }) => {
      baseline.current ??= getMarkdown(e);
    },
    onUpdate: ({ editor: e }) => {
      const markdown = getMarkdown(e);
      baseline.current ??= markdown;
      onChange(baseline.current, markdown);
    },
  });
  return <EditorContent editor={editor} className="dv-editor dv-md" />;
}

/**
 * M11 (Cnv-EditApprove): a spec approval gate's drawer — the spec in the steering editor, what an
 * edit becomes ("Your edits become spec v3. The Engineer starts from it." and "1 edit"), and Reject /
 * Approve as is / Approve with my edits. Approve with my edits is one POST to the gate's resolve
 * route: the server saves the spec as its next version and approves.
 */
export function SpecApproveDrawer({
  runId,
  taskId,
  docId,
  nextAgent,
  busy = false,
  onReject,
  onApprove,
  onApproved,
  onVersions,
  onClose,
  onEditing,
}: {
  runId: string;
  taskId: number;
  docId: string;
  /** The agent after the gate ("Engineer"), when there is one. */
  nextAgent: string | null;
  busy?: boolean;
  onReject: () => void;
  onApprove: () => void;
  /** Approved with the edits (the run moves on). */
  onApproved: () => void;
  /** "Spec versions": the document viewer, with the spec's versions. */
  onVersions: () => void;
  onClose: () => void;
  /** Whether there is an edit now (the Now bar says "you are editing the spec"). */
  onEditing?: (editing: boolean) => void;
}) {
  const doc = useLoaded(docId, () => getDocument(docId));
  const latest = doc.value?.versions.at(-1) ?? null;
  const [edit, setEdit] = useState<{ baseline: string; markdown: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edits = edit ? editCount(edit.baseline, edit.markdown) : 0;
  const n = latest?.version_no ?? 0;
  const editing = edits > 0;
  useEffect(() => {
    onEditing?.(editing);
  }, [editing, onEditing]);
  useEffect(() => () => onEditing?.(false), [onEditing]);

  const approveEdited = async () => {
    if (!edit || edits === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await approveWithEdits(runId, taskId, edit.markdown);
      onApproved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="nd-drawer nd-drawer--dock sa-drawer" aria-label={`Spec v${n}`}>
      <header className="sa-head">
        <span className="nd-glyph" aria-hidden>
          <FileText size={16} strokeWidth={1.6} />
        </span>
        <div className="sa-head__titles">
          <div className="sa-head__title">Spec v{n}</div>
          {latest && (
            <div className="sa-head__sub">
              Your edits become spec v{n + 1}.{nextAgent && ` The ${nextAgent} starts from it.`}
              {edits > 0 && (
                <>
                  {" "}
                  <span className="sa-head__edits">
                    {edits} edit{edits === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="sa-head__actions">
          <IconButton
            size="sm"
            aria-label="Spec versions"
            title="Spec versions"
            onClick={onVersions}
          >
            <History size={15} strokeWidth={1.6} />
          </IconButton>
          <IconButton size="sm" aria-label="Close" title="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.6} />
          </IconButton>
        </div>
      </header>
      <div className="sa-body">
        {latest ? (
          <SpecEditor
            key={latest.version_no}
            content={latest.content}
            onChange={(baseline, markdown) => setEdit({ baseline, markdown })}
          />
        ) : doc.state === "error" ? (
          <p className="dv-note" role="alert">
            Couldn’t load the spec.{" "}
            <Button variant="secondary" size="sm" onClick={doc.retry}>
              Retry
            </Button>
          </p>
        ) : (
          <p className="dv-note" role="status">
            Loading the spec…
          </p>
        )}
        {error && (
          <p className="dv-saveerr" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="nd-foot">
        <Button variant="ghost" size="sm" disabled={busy || saving} onClick={onReject}>
          Reject
        </Button>
        <div className="sa-foot__approve">
          <Button variant="secondary" size="sm" disabled={busy || saving} onClick={onApprove}>
            Approve as is
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="nd-btn-flush"
            disabled={busy || edits === 0}
            loading={saving}
            onClick={() => void approveEdited()}
          >
            <Check size={14} strokeWidth={1.8} aria-hidden />
            <span>Approve with my edits</span>
          </Button>
        </div>
      </footer>
    </aside>
  );
}
